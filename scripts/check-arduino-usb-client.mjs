// Actual USB client, settings UI and guidance observer with FAKE loopback HTTP,
// deterministic clocks and explicit synthetic poses. No camera or board access.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createArduinoUsbClient} from '../public/arduino-usb-client.js';
import {attachArduinoFeedback} from '../public/arduino-feedback-ui.js';

const checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS: '+name);}
const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
function clock(){
  let time=0,id=0;const timers=new Map();
  return {now:()=>time,setTime:v=>{time=v;},setTimer(fn,ms){const key=++id;timers.set(key,{fn,at:time+ms});return key;},
    clearTimer:key=>timers.delete(key),get count(){return timers.size;},
    async tick(ms){const target=time+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=target)
      .sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
      time=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}time=target;await flush();}};
}
function harness({respond}={}){
  const time=clock(),calls=[],states=[];let connection=0,reportedTime;
  const fetchFn=async(url,options)=>{
    const call={path:url.split('/').at(-1),body:options.body?JSON.parse(options.body):null,options};calls.push(call);
    let data=respond?await respond(call):undefined;
    if(data===undefined)data=call.path==='status'?{transport:'usb',supported:true,connected:false}
      :call.path==='connect'?{transport:'usb',connected:true,sessionId:'usb-'+(++connection),port:call.body.port??'COM16',state:'idle'}
      :call.path==='signal'?{transport:'usb',connected:true,state:call.body.state}:{};
    return {ok:data.httpError!==true,json:async()=>data};
  };
  const client=createArduinoUsbClient({fetchFn,...time,now:()=>reportedTime===undefined?time.now():reportedTime,onState:s=>states.push(s)});
  return {client,time,calls,states,fetchFn,overrideNow:value=>{reportedTime=value;}};
}
async function dispose(h){h.client.destroy();await flush();assert.equal(h.time.count,0);}

await check('USB discovery is optional and cannot auto-connect or activate a camera',async()=>{
  const h=harness();await h.client.probe();assert.equal(h.client.getState().supported,true);
  assert.equal(h.client.getState().connected,false);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].path,'status');assert.match(h.client.getState().message,/USB/);await dispose(h);
});
await check('An old Wi-Fi relay or missing server is not misrepresented as USB support',async()=>{
  for(const respond of [()=>({supported:true,pairingConfigured:true}),()=>{throw Error('offline');}]){
    const h=harness({respond});await h.client.probe();assert.equal(h.client.getState().supported,false);
    assert.equal(h.client.getState().connected,false);assert.match(h.client.getState().message,/Restart/);await dispose(h);
  }
});
await check('Explicit connect autodiscovers the board and always starts neutral without Wi-Fi secrets',async()=>{
  const h=harness();h.client.setSignal({state:'off'});assert.equal(await h.client.connect(),true);
  assert.deepEqual(h.calls[0].body,{});assert.equal(h.client.getState().port,'COM16');
  assert.equal(h.client.getState().transport,'usb');await h.time.tick(100);
  assert.equal(h.calls.at(-1).body.state,'idle');await dispose(h);
});
await check('Connect allows discovery/reset time, while the handshake has a 15-second deadline',async()=>{
  let release;const h=harness({respond:c=>c.path==='connect'?new Promise(resolve=>release=resolve):undefined});
  const pending=h.client.connect({port:' COM16 '});await flush();await h.time.tick(3000);
  assert.equal(h.client.getState().connecting,true);assert.equal(h.calls[0].options.signal.aborted,false);
  release({transport:'usb',connected:true,sessionId:'reset-board',port:'COM16'});assert.equal(await pending,true);
  assert.deepEqual(h.calls[0].body,{port:'COM16'});await dispose(h);
  const stalled=harness({respond:c=>c.path==='connect'?new Promise(()=>{}):undefined});
  const stuck=stalled.client.connect();await flush();await stalled.time.tick(14999);
  assert.equal(stalled.client.getState().connecting,true);await stalled.time.tick(1);assert.equal(await stuck,false);
  assert.equal(stalled.client.getState().connected,false);assert.match(stalled.client.getState().message,/timed out/);
  await dispose(stalled);
});
await check('Port-busy and permission failures remain actionable and cannot report connected green',async()=>{
  for(const message of ['COM16 is busy. Close Serial Monitor and try again.','Permission denied opening COM16.']){
    const h=harness({respond:c=>c.path==='connect'?{httpError:true,message}:undefined});
    assert.equal(await h.client.connect(),false);assert.equal(h.client.getState().message,message);
    assert.equal(h.client.getState().state,'idle');assert.equal(h.client.getState().connected,false);
    assert.equal(h.time.count,0);await dispose(h);
  }
  const wrong=harness({respond:c=>c.path==='connect'?{transport:'wifi',connected:true,sessionId:'wrong'}:undefined});
  assert.equal(await wrong.client.connect(),false);assert.equal(wrong.client.getState().connected,false);await dispose(wrong);
});
await check('Heartbeats send only states, stop stale guidance and survive a backwards/non-finite clock silently',async()=>{
  const h=harness();await h.client.connect();h.client.setSignal({state:'good',reason:'All inside.'});await h.time.tick(100);
  assert.equal(h.calls.at(-1).body.state,'good');h.client.setSignal({state:'off'});await h.time.tick(100);
  assert.equal(h.calls.at(-1).body.state,'off');await h.time.tick(500);assert.equal(h.calls.at(-1).body.state,'idle');
  h.client.setSignal({state:'good'});h.overrideNow(0);await h.time.tick(100);assert.equal(h.calls.at(-1).body.state,'idle');
  h.overrideNow(NaN);h.client.setSignal({state:'good'});h.overrideNow(undefined);await h.time.tick(100);
  assert.equal(h.calls.at(-1).body.state,'idle');
  const signals=h.calls.filter(c=>c.path==='signal');assert.ok(signals.length>3);
  assert.ok(signals.every((c,i)=>c.body.sequence===i+1));
  assert.ok(signals.every(c=>Object.keys(c.body).sort().join(',')==='sequence,sessionId,state'));
  assert.ok(h.time.count<=1);await dispose(h);
});
await check('A stalled heartbeat remains single-flight and expires after 900 ms even if fetch ignores abort',async()=>{
  const h=harness({respond:c=>c.path==='signal'?new Promise(()=>{}):undefined});
  await h.client.connect();h.client.setSignal({state:'off'});await h.time.tick(900);
  assert.equal(h.calls.filter(c=>c.path==='signal').length,1);assert.equal(h.client.getState().connected,true);
  await h.time.tick(100);assert.equal(h.client.getState().connected,false);assert.equal(h.client.getState().state,'idle');
  const count=h.calls.length;await h.time.tick(1000);assert.equal(h.calls.length,count);await dispose(h);
});
await check('Neutral supersedes an in-flight warning immediately; its late response cannot restore red',async()=>{
  let release;const h=harness({respond:c=>c.path==='signal'&&c.body.state==='off'
    ?new Promise(resolve=>release=resolve):undefined});
  await h.client.connect();h.client.setSignal({state:'off'});await h.time.tick(100);const old=h.calls.at(-1);
  h.client.setSignal({state:'idle',reason:'Tracking lost'});await flush();
  assert.equal(old.options.signal.aborted,true);assert.equal(h.calls.at(-1).body.state,'idle');
  assert.ok(h.calls.at(-1).body.sequence>old.body.sequence);release({connected:true,state:'off'});await flush();
  assert.equal(h.client.getState().state,'idle');assert.equal(h.client.getState().connected,true);await dispose(h);
});
await check('Disconnect cancels pending connects and signals without stale reconnection or leaked timers',async()=>{
  let release;const pending=harness({respond:c=>c.path==='connect'?new Promise(resolve=>release=resolve):undefined});
  const opening=pending.client.connect();await flush();await pending.client.disconnect();assert.equal(await opening,false);
  assert.equal(pending.calls[0].options.signal.aborted,true);
  release({transport:'usb',connected:true,sessionId:'too-late',port:'COM16'});await flush();
  assert.equal(pending.client.getState().connected,false);await dispose(pending);
  let warning;const active=harness({respond:c=>c.path==='signal'?new Promise(resolve=>warning=resolve):undefined});
  await active.client.connect();active.client.setSignal({state:'off'});await active.time.tick(100);
  await active.client.disconnect({keepalive:true});assert.equal(active.calls.at(-1).path,'disconnect');
  assert.equal(active.calls.at(-1).options.keepalive,true);warning({connected:true,state:'off'});await flush();
  assert.equal(active.client.getState().connected,false);assert.equal(active.client.getState().state,'idle');await dispose(active);
});
await check('Overlapping connect/probe operations ignore old handshakes and never schedule duplicate heartbeats',async()=>{
  let first,probeRelease;const h=harness({respond:c=>c.path==='connect'&&c.body.port==='COM11'
    ?new Promise(resolve=>first=resolve):c.path==='status'?new Promise(resolve=>probeRelease=resolve):undefined});
  const probing=h.client.probe();const old=h.client.connect({port:'COM11'});await flush();
  const current=h.client.connect({port:'COM16'});assert.equal(await current,true);assert.equal(await old,false);await probing;
  first({transport:'usb',connected:true,sessionId:'old',port:'COM11'});probeRelease({transport:'usb',supported:false});await flush();
  assert.equal(h.client.getState().port,'COM16');assert.equal(h.client.getState().supported,true);
  await h.time.tick(100);assert.equal(h.calls.filter(c=>c.path==='signal').length,1);
  assert.notEqual(h.calls.at(-1).body.sessionId,'old');await dispose(h);
});
await check('HTTP disconnection, bad JSON and a wrong transport fail silently without orphan heartbeats',async()=>{
  for(const result of [{httpError:true,message:'USB cable unplugged.'},{connected:false,message:'Board stopped.'},
    {connected:true,transport:'wifi',state:'good'}]){
    const h=harness({respond:c=>c.path==='signal'?result:undefined});await h.client.connect();
    h.client.setSignal({state:'good'});await h.time.tick(100);assert.equal(h.client.getState().connected,false);
    assert.equal(h.client.getState().state,'idle');assert.equal(h.time.count,0);await dispose(h);
  }
  const time=clock(),client=createArduinoUsbClient({...time,fetchFn:async()=>({ok:true,json:async()=>{throw Error('bad JSON');}})});
  await client.probe();assert.equal(client.getState().supported,false);client.destroy();await flush();assert.equal(time.count,0);
});

function element(){return {disabled:false,hidden:false,textContent:'',dataset:{},events:new Map(),
  setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.events.set(name,fn);},
  removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}};}
await check('Actual settings UI plus USB client and real guidance remain optional and neutral before imitation',async()=>{
  const h=harness(),elements=new Map(),allowed=['arduino-connect','arduino-disconnect','arduino-status','hardware-indicator'];
  const doc={getElementById(id){assert.ok(allowed.includes(id),'USB UI must not read old Wi-Fi fields');
    if(!elements.has(id))elements.set(id,element());return elements.get(id);}};
  const indices=[33,34,35,36],points=[{x:-.5,y:0},{x:.5,y:0},{x:-.3,y:1},{x:.3,y:1}];
  const context={reference:{id:'synthetic-reference',referenceUsable:true,guides:indices.map((index,i)=>({index,
    valid:true,start:points[i],end:points[i],targetGeometry:{mode:'hold'}}))},
    pathReference:{referenceUsable:true,referenceId:'synthetic-reference',paths:indices.map(index=>({index}))},
    frame:{hip:{x:.5,y:.5},scale:.25,aspect:1},active:false,contextKey:'synthetic-clip'};
  function observe(){const t=h.time.now();context.observation={observedAtMs:t,aspectRatio:1,sample:{tMs:t,status:'pose',
    landmarks:indices.map((index,i)=>({index,x:.5+points[i].x*.25,y:.5+points[i].y*.25,visibility:1}))}};ui.update();}
  const ui=attachArduinoFeedback({getContext:()=>context,document:doc,now:h.time.now,
    clientFactory:options=>createArduinoUsbClient({...options,fetchFn:h.fetchFn,...h.time})});
  await flush();assert.equal(h.calls.filter(c=>c.path==='connect').length,0);
  assert.equal(doc.getElementById('arduino-connect').textContent,'Connect USB feedback');
  assert.equal(doc.getElementById('hardware-indicator').hidden,true);
  await doc.getElementById('arduino-connect').events.get('click')();observe();await h.time.tick(100);
  assert.equal(h.calls.at(-1).body.state,'idle');context.active=true;
  for(let i=0;i<4;i++){observe();await h.time.tick(100);}
  assert.equal(h.calls.at(-1).body.state,'good');assert.equal(doc.getElementById('hardware-indicator').textContent,'Arduino · green');
  ui.neutral();await flush();assert.equal(h.calls.at(-1).body.state,'idle');
  assert.equal(ui.getState().guidance.state,'idle');await doc.getElementById('arduino-disconnect').events.get('click')();await flush();
  assert.equal(doc.getElementById('hardware-indicator').hidden,true);ui.destroy();await flush();
  assert.equal(doc.getElementById('arduino-connect').events.size,0);assert.equal(h.time.count,0);await dispose(h);
});
await check('Transport never imports serial/filesystem credentials or sends camera/pose/body metadata',async()=>{
  const source=await readFile(new URL('../public/arduino-usb-client.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/node:|localStorage|SECRET_|navigator\.serial|landmarks|observedAtMs|aspectRatio/);
  const h=harness();await h.client.connect();h.client.setSignal({state:'good',reason:'Left palm',landmarks:[{x:1}],image:'camera'});
  await h.time.tick(100);assert.deepEqual(Object.keys(h.calls.at(-1).body).sort(),['sequence','sessionId','state']);
  assert.doesNotMatch(JSON.stringify(h.calls.map(c=>c.body)),/Left palm|landmarks|image|password|SSID/);await dispose(h);
});

const output=new URL('../artifacts/arduino-usb-review/',import.meta.url);await mkdir(output,{recursive:true});
await writeFile(new URL('client-qa.json',output),JSON.stringify({passed:true,groups:checks.length,checks,
  provenance:'Actual USB HTTP client, settings UI and real guidance code using explicit fake HTTP/DOM/timers and synthetic poses. No serial board, physical lights/buzzer, LAN traffic or live camera was accessed by these tests.'},null,2)+'\n');
console.log(`PASS: ${checks.length} USB browser integration groups.`);
