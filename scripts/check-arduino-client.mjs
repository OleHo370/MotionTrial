// Deterministic browser-client checks with FAKE HTTP responses and clocks.
// No LAN device, serial port, physical indicators or camera is accessed.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createArduinoFeedbackClient} from '../public/arduino-feedback-client.js';
import {attachArduinoFeedback} from '../public/arduino-feedback-ui.js';

const checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS: '+name);}
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function clock(){
  let time=0,id=0;const timers=new Map();
  return {now:()=>time,setTimer(fn,ms){const key=++id;timers.set(key,{fn,at:time+ms});return key;},
    clearTimer:key=>timers.delete(key),get count(){return timers.size;},
    async tick(ms){const target=time+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=target)
      .sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
      time=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}time=target;await flush();}};
}
function harness({respond}={}){
  const time=clock(),calls=[],states=[];let connection=0;
  const fetchFn=async(url,options)=>{
    const call={path:url.split('/').at(-1),body:options.body?JSON.parse(options.body):null,options};calls.push(call);
    let data=respond?await respond(call):undefined;
    if(data===undefined)data=call.path==='status'?{supported:true,pairingConfigured:true}
      :call.path==='connect'?{connected:true,sessionId:'session-'+(++connection),address:call.body.address,state:'idle'}
      :call.path==='signal'?{connected:true,state:call.body.state}:{};
    return {ok:data.httpError!==true,json:async()=>data};
  };
  const client=createArduinoFeedbackClient({fetchFn,...time,onState:s=>states.push(s)});
  return {client,time,calls,states};
}
const connect=h=>h.client.connect({address:'192.168.1.73'});

await check('Optional relay discovery handles missing/old servers without blocking practice',async()=>{
  const h=harness({respond:()=>{throw Error('offline');}});await h.client.probe();
  assert.equal(h.client.getState().supported,false);assert.equal(h.client.getState().connected,false);
  assert.match(h.client.getState().message,/Restart/);assert.equal(h.time.count,0);h.client.destroy();
});
await check('Pairing is explicit and connection begins neutral, never with cached green or warning',async()=>{
  const h=harness();await h.client.probe();assert.equal(h.client.getState().pairingConfigured,true);
  assert.equal(h.calls.filter(c=>c.path==='connect').length,0);
  h.client.setSignal({state:'off'});assert.equal(await connect(h),true);await h.time.tick(100);
  assert.equal(h.calls.at(-1).body.state,'idle');h.client.destroy();await flush();assert.equal(h.time.count,0);
});
await check('Heartbeat sends current small states only and stale guidance becomes silent idle',async()=>{
  const h=harness();await connect(h);h.client.setSignal({state:'good',reason:'All inside.'});await h.time.tick(100);
  assert.equal(h.calls.at(-1).body.state,'good');h.client.setSignal({state:'off',reason:'Left foot outside.'});
  await h.time.tick(100);assert.equal(h.calls.at(-1).body.state,'off');
  h.client.setSignal({state:'idle',reason:'Tracking unclear.'});await h.time.tick(100);
  assert.equal(h.calls.at(-1).body.state,'idle');h.client.setSignal({state:'good'});await h.time.tick(500);
  assert.equal(h.calls.at(-1).body.state,'idle');
  const signals=h.calls.filter(c=>c.path==='signal');assert.ok(signals.every((c,i)=>c.body.sequence===i+1));
  assert.ok(signals.every(c=>Object.keys(c.body).sort().join(',')==='sequence,sessionId,state'));
  assert.ok(h.time.count<=1);h.client.destroy();await flush();
});
await check('HTTP failure ends heartbeats and cannot claim connected green',async()=>{
  const h=harness({respond:c=>c.path==='signal'?{httpError:true,message:'Arduino unavailable'}:undefined});
  await connect(h);h.client.setSignal({state:'good'});await h.time.tick(100);
  assert.equal(h.client.getState().connected,false);assert.equal(h.client.getState().state,'idle');
  const count=h.calls.length;await h.time.tick(1000);assert.equal(h.calls.length,count);assert.equal(h.time.count,0);
  h.client.destroy();
});
await check('A slow or stalled browser request is single-flight and canceled at a bounded deadline',async()=>{
  const h=harness({respond:c=>c.path==='signal'?new Promise((resolve,reject)=>{
    c.options.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true});}):undefined});
  await connect(h);h.client.setSignal({state:'off'});await h.time.tick(500);
  assert.equal(h.calls.filter(c=>c.path==='signal').length,1);await h.time.tick(600);
  assert.equal(h.client.getState().connected,false);assert.equal(h.time.count,0);h.client.destroy();
});
await check('Disconnect cancels old requests and their late response cannot restore hardware state',async()=>{
  let release;const h=harness({respond:c=>c.path==='signal'?new Promise(resolve=>release=resolve):undefined});
  await connect(h);h.client.setSignal({state:'off'});await h.time.tick(100);
  const old=h.calls.at(-1);await h.client.disconnect({keepalive:true});
  assert.equal(old.options.signal.aborted,true);assert.equal(h.calls.at(-1).path,'disconnect');
  assert.equal(h.calls.at(-1).options.keepalive,true);release({connected:true,state:'off'});await flush();
  assert.equal(h.client.getState().connected,false);assert.equal(h.client.getState().state,'idle');
  assert.equal(h.time.count,0);h.client.destroy();
});
await check('Overlapping connection requests ignore stale handshakes, errors and generations',async()=>{
  let first;const h=harness({respond:c=>c.path==='connect'&&c.body.address==='192.168.1.11'
    ?new Promise(resolve=>first=resolve):undefined});
  const old=h.client.connect({address:'192.168.1.11',key:'a'.repeat(32)});await flush();
  assert.equal(await connect(h),true);first({connected:true,sessionId:'old',address:'192.168.1.11'});
  assert.equal(await old,false);assert.equal(h.client.getState().address,'192.168.1.73');
  await h.time.tick(100);assert.notEqual(h.calls.at(-1).body.sessionId,'old');
  assert.equal(JSON.stringify(h.client.getState()).includes('a'.repeat(32)),false);h.client.destroy();await flush();
});
await check('Neutral tracking/pause supersedes a pending warning immediately and ignores its late reply',async()=>{
  let release;const h=harness({respond:c=>c.path==='signal'&&c.body.state==='off'
    ?new Promise(resolve=>release=resolve):undefined});
  await connect(h);h.client.setSignal({state:'off'});await h.time.tick(100);
  const old=h.calls.at(-1);h.client.setSignal({state:'idle',reason:'Camera stopped'});await flush();
  assert.equal(old.options.signal.aborted,true);assert.equal(h.calls.at(-1).body.state,'idle');
  assert.ok(h.calls.at(-1).body.sequence>old.body.sequence);
  release({connected:true,state:'off'});await flush();
  assert.equal(h.client.getState().state,'idle');assert.equal(h.client.getState().connected,true);
  h.client.destroy();await flush();assert.equal(h.time.count,0);
});

function element(){return {value:'',disabled:false,hidden:false,textContent:'',dataset:{},events:new Map(),
  setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.events.set(name,fn);},
  removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}};}
/* Wi-Fi UI regression preserved with its now-commented initializer.
   The active USB UI is covered by check-arduino-usb-client.mjs.
await check('Actual settings UI restores only the IP, hides automatic pairing, and stays optional',async()=>{
  const elements=new Map(),stored=[],signals=[],observations=[],context={reference:{id:'real-ref'},pathReference:{},
    observation:{sample:{landmarks:[]}},frame:{},active:true,contextKey:'clip-1'};
  const doc={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}};
  let publish;const fake={probe(){publish({pairingConfigured:true,connected:false,message:'Ready'});},
    async connect(config){assert.deepEqual(config,{address:'192.168.1.73',key:''});publish({connected:true,state:'good',message:'Connected'});return true;},
    disconnect(){publish({connected:false,state:'idle',message:'Disconnected'});},setSignal:s=>signals.push(s),getState:()=>({}),destroy(){}};
  const ui=attachArduinoFeedback({getContext:()=>context,document:doc,now:()=>1234,
    storage:{getItem:()=> '192.168.1.73',setItem:(...v)=>stored.push(v)},
    clientFactory:options=>{publish=options.onState;return fake;},
    guidanceFactory:()=>({update(...args){observations.push(args);return {state:'good',reason:'Inside'};},reset(){}})});
  assert.equal(doc.getElementById('arduino-address').value,'192.168.1.73');
  assert.equal(doc.getElementById('arduino-key-field').hidden,true);ui.update();
  assert.equal(observations[0][2],context.observation);assert.equal(observations[0][4].active,true);
  await doc.getElementById('arduino-connect').events.get('click')();
  assert.equal(stored.length,1);assert.deepEqual(stored[0],['motiontrial.arduino.address','192.168.1.73']);
  assert.equal(doc.getElementById('hardware-indicator').textContent,'Arduino · green');
  ui.neutral();assert.equal(signals.at(-1).state,'idle');ui.destroy();assert.equal(doc.getElementById('arduino-connect').events.size,0);
});
*/
await check('Controller arms hardware only during unpaused imitation/grace and uses raw observations',async()=>{
  const require=createRequire(import.meta.url),{parse}=require('next/dist/compiled/acorn');
  const source=await readFile(new URL('../public/first-three.js',import.meta.url),'utf8');
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const init=tree.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations)
    .find(n=>n.id.name==='hardwareFeedback').init;
  let getContext;const state={operation:1,index:0,active:true,paused:false,phase:'watching',observation:{raw:true},
    fixedFrame:{frozen:true},camera:{getState:()=>({running:true,generation:2})}};
  const scope={state,guidance:()=>({id:'guide'}),pathReference:()=>({id:'route'}),
    attachArduinoFeedback:options=>{getContext=options.getContext;return {};}};
  vm.runInNewContext(source.slice(init.start,init.end),scope);
  for(const phase of ['loading','preparing','camera','watching','positioning','feedback','stopped','finished']){
    state.phase=phase;assert.equal(getContext().active,false,phase);}
  for(const phase of ['demonstrating','grace']){state.phase=phase;assert.equal(getContext().active,true);}
  assert.equal(getContext().observation,state.observation);assert.equal(getContext().frame,state.fixedFrame);
  state.paused=true;assert.equal(getContext().active,false);state.paused=false;
  state.attemptInterrupted='interrupted';assert.equal(getContext().active,false);state.attemptInterrupted=null;
  state.camera.getState=()=>({running:false,generation:2});assert.equal(getContext().active,false);
  assert.match(source,/hardwareFeedback\.neutral\(\)/);assert.match(source,/hardwareFeedback\.destroy\(\)/);
});

const output=new URL('../artifacts/arduino-wifi-review/',import.meta.url);await mkdir(output,{recursive:true});
await writeFile(new URL('client-qa.json',output),JSON.stringify({passed:true,groups:checks.length,checks,
  provenance:'Preserved Wi-Fi browser transport and active controller-context code with explicit fake HTTP responses/timers. Active USB UI is tested separately. No LAN board, live camera or physical lights/buzzer tested.'},null,2)+'\n');
console.log(`PASS: ${checks.length} Arduino browser integration groups.`);
