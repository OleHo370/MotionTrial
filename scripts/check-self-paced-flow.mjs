/** Current lesson orchestration and endpoint QA.
 * All learner points here are explicitly CONSTRUCTED software fixtures. The
 * browser replaces the camera adapter and blocks physical camera/USB access.
 * These checks cannot establish real learner or physical-device acceptance. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createEndTargetSession,evaluateEndTargets} from '../public/practice-end-targets.js';
import {compactPracticeFeedback} from '../public/practice-compact-feedback.js';
import {controllerHarness,observed,attempt,boundary,completeTargets,source} from './check-review-flow.mjs';

const root=new URL('../',import.meta.url),out=new URL('artifacts/self-paced-flow-review/',root);
const base=process.env.SELF_PACED_TEST_URL||'http://127.0.0.1:8766';
const checks=[],snapshots={},pageErrors=[];
const indices=[33,34,35,36],frame={hip:{x:.5,y:.5},scale:.5,aspect:1};
const reference={referenceUsable:true,guides:indices.map(index=>({index,valid:true,
  name:({33:'Left palm',34:'Right palm',35:'Left foot',36:'Right foot'})[index],
  start:{x:0,y:-.5},end:{x:0,y:0},targetGeometry:{mode:'move'}}))};
const sha=value=>createHash('sha256').update(value).digest('hex');
async function check(name,run){await run();checks.push(name);console.log(`PASS: ${name}`);}
const fixture=(time,{near=indices,missing=[],hidden=[],sampleTime=time,observedAt=time}={})=>({
  observedAtMs:observedAt,aspectRatio:1,provenance:'CONSTRUCTED software endpoint fixture, not live inference',
  sample:{status:'pose',tMs:sampleTime,landmarks:indices.filter(index=>!missing.includes(index)).map(index=>({
    index,x:near.includes(index)?.5:.1,y:.5,visibility:hidden.includes(index)?.1:1,presence:1}))},
});
const evaluate=(session,observation,nowMs,ref=reference,options={})=>evaluateEndTargets(ref,observation,frame,{nowMs,session,...options});

async function pureChecks(){
  await check('All current triangles require at least three fresh distinct observations and 60 ms of concurrent support',()=>{
    const session=createEndTargetSession();
    for(const t of [1000,1030])assert.equal(evaluate(session,fixture(t),t).complete,false);
    const done=evaluate(session,fixture(1060),1060);
    assert.equal(done.complete,true);assert.equal(done.hitCount,4);assert.equal(done.targetCount,4);
    assert.equal(done.limbs.length,4);
  });
  await check('Repeated timestamps and stale endpoint coordinates cannot manufacture completion support',()=>{
    const duplicates=createEndTargetSession();
    for(const t of [1000,1030,1060,1090,1200]){
      assert.equal(evaluate(duplicates,fixture(t,{sampleTime:1000,observedAt:1000}),t).complete,false);
    }
    const stale=createEndTargetSession();
    evaluate(stale,fixture(1000),1000);evaluate(stale,fixture(1030),1030);
    assert.equal(evaluate(stale,fixture(1030),1500).complete,false);
    assert.equal(evaluate(stale,fixture(1510),1510).complete,false,'Fresh support starts again after a stale interval');
  });
  await check('Missing, low-visibility and no-pose evidence resets simultaneous support instead of granting a partial-body pass',()=>{
    for(const interruption of [fixture(1060,{missing:[35]}),fixture(1060,{hidden:[34]}),null,
      {observedAtMs:1060,aspectRatio:1,sample:{status:'no-pose',tMs:1060,landmarks:[]}}]){
      const session=createEndTargetSession();
      evaluate(session,fixture(1000),1000);evaluate(session,fixture(1030),1030);
      assert.equal(evaluate(session,interruption,1060).complete,false);
      assert.equal(evaluate(session,fixture(1090),1090).complete,false);
      assert.equal(evaluate(session,fixture(1120),1120).complete,false);
      assert.equal(evaluate(session,fixture(1150),1150).complete,true);
    }
  });
  await check('Touching triangles separately does not latch past hits; all four must be together now',()=>{
    const session=createEndTargetSession();let time=1000;
    for(const index of indices)for(let n=0;n<3;n++){
      time+=30;const result=evaluate(session,fixture(time,{near:[index]}),time);
      assert.equal(result.complete,false);assert.equal(result.hitCount,1);
    }
    for(let n=0;n<3;n++){
      time+=30;const result=evaluate(session,fixture(time),time);assert.equal(result.complete,n===2);
    }
  });
  await check('Unsupported reference targets stay unavailable and explicit arms scope cannot pass as a four-point attempt',()=>{
    for(const bad of [{...reference,referenceUsable:false},{...reference,guides:reference.guides.slice(0,2)},
      {...reference,guides:reference.guides.map((guide,i)=>i?guide:{...guide,end:null})}]){
      const session=createEndTargetSession();
      for(const t of [1000,1030,1060])assert.equal(evaluate(session,fixture(t),t,bad).complete,false);
    }
    const arms=createEndTargetSession();
    for(const t of [1000,1030,1060]){
      const result=evaluate(arms,fixture(t,{missing:[35,36]}),t,reference,{controlIndices:[33,34]});
      assert.equal(result.complete,t===1060);assert.equal(result.targetCount,2);
    }
  });
  await check('Compact feedback names each affected side, retains uncertainty and cannot invent measured tempo',()=>{
    const wrong={status:'mismatch',passed:false,issues:[
      {index:33,code:'too_fast',name:'Left palm'},
      {index:34,code:'too_slow',name:'Right palm'},
      {index:35,code:'off_guide',name:'Left foot'}],
      messages:['Verbose placeholder must be replaced.'],reason:'Verbose placeholder must be replaced.'};
    const compact=compactPracticeFeedback(wrong);
    assert.match(compact.messages.join(' '),/left (hand|palm).*too fast/i);
    assert.match(compact.messages.join(' '),/right (hand|palm).*too slow/i);
    assert.match(compact.messages.join(' '),/left foot/i);
    assert.ok(compact.messages.every(message=>message.length<100));
    assert.equal(compact.feedbackStyle,'compact');assert.equal(compact.manualContinuation,false);
    assert.deepEqual(wrong.messages,['Verbose placeholder must be replaced.'],'Formatter keeps raw review evidence untouched');
    const unclear=compactPracticeFeedback({status:'unknown',passed:false,
      issues:[{index:36,code:'tracking_unknown',name:'Right foot'}],messages:['Tracking was unavailable.']});
    assert.doesNotMatch(unclear.messages.join(' '),/too fast|too slow/i);
    assert.match(unclear.messages.join(' '),/right foot.*tracking unclear/i);
    const interrupted=compactPracticeFeedback({status:'unknown',passed:false,issues:[],
      messages:['The demonstration was interrupted. Try this clip again with uninterrupted playback.']});
    assert.deepEqual(interrupted.messages,['Tutorial playback interrupted.']);
    const cameraStopped=compactPracticeFeedback({status:'unknown',passed:false,issues:[],
      messages:['The camera stopped or changed during this attempt. Set up and try again.']});
    assert.deepEqual(cameraStopped.messages,['Camera stopped or changed.']);
  });
}

async function controllerChecks(){
  await check('The production controller waits 100 seconds for unfinished targets instead of entering review on a deadline',async()=>{
    const h=controllerHarness();await attempt(h);await boundary(h);
    assert.equal(h.state.phase,'grace');assert.equal(h.state.deadline,null);
    h.clock.now+=100000;await h.call('tick');
    assert.equal(h.state.phase,'grace');assert.equal(h.review.finalized.length,0);assert.equal(h.state.results.size,0);
    const bad=fixture(h.clock.now,{missing:[36]});await h.call('observe',bad);
    h.clock.now+=60;await h.call('observe',fixture(h.clock.now,{missing:[36]}));
    assert.equal(h.state.phase,'grace');assert.equal(h.review.finalized.length,0);
    await completeTargets(h);assert.equal(h.state.phase,'feedback');assert.equal(h.review.finalized.length,1);
  });
  await check('Concurrent endpoint support can complete before the teacher finishes and finalizes exactly once',async()=>{
    const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);h.video.currentTime=.7;
    await completeTargets(h);assert.equal(h.state.phase,'feedback');assert.equal(h.review.finalized.length,1);
    assert.equal(h.video.paused,true);assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
    const options=h.review.finalized[0].options;
    assert.equal(options.endpointsComplete,true);assert.ok(options.elapsedMs<2000);
    for(let n=0;n<20;n++){h.clock.now+=1000;await h.call('observe',observed(h.clock.now));await h.call('tick');}
    assert.equal(h.review.finalized.length,1);assert.equal(h.state.phase,'feedback');assert.equal(h.state.index,0);
  });
  await check('Internal retry discards endpoint evidence and success advances when its message ends',async()=>{
    const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await completeTargets(h);
    const previousSession=h.state.endTargets;assert.equal(h.state.feedback.status,'match');assert.equal(h.speech.busy,true);
    await h.call('retryFeedback');
    assert.equal(h.state.phase,'positioning');assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
    assert.equal(h.state.feedback,null);assert.equal(h.state.movement,null);assert.equal(h.speech.busy,false);
    await attempt(h);assert.notEqual(h.state.endTargets,previousSession);
    h.clock.now+=10;await h.call('observe',observed(h.clock.now));
    assert.equal(h.state.phase,'demonstrating');assert.equal(h.review.finalized.length,1,'Old endpoints cannot instantly finalize retry');
    h.clock.now+=30;await h.call('observe',observed(h.clock.now));
    h.clock.now+=30;await h.call('observe',observed(h.clock.now));
    assert.equal(h.state.phase,'feedback');assert.equal(h.review.finalized.length,2);
    await h.finishSpeech();assert.equal(h.state.index,1);assert.equal(h.state.results.get('step-1').status,'matched');
  });
  await check('Incomplete sequential, missing and stale inputs cannot trigger production finishAttempt',async()=>{
    const h=controllerHarness();await attempt(h);await boundary(h);
    for(const index of indices)for(let n=0;n<3;n++){
      h.clock.now+=30;await h.call('observe',fixture(h.clock.now,{near:[index]}));
      assert.equal(h.review.finalized.length,0);
    }
    h.clock.now+=10;await h.call('observe',observed(h.clock.now));
    h.clock.now+=30;await h.call('observe',observed(h.clock.now));
    h.clock.now+=500;await h.call('tick');assert.equal(h.state.observation,null);
    h.clock.now+=10;await h.call('observe',observed(h.clock.now));
    assert.equal(h.review.finalized.length,0,'A stale gap removes earlier concurrent support');
    h.clock.now+=30;await h.call('observe',observed(h.clock.now));
    h.clock.now+=30;await h.call('observe',observed(h.clock.now));
    assert.equal(h.review.finalized.length,1);
  });
  await check('Triangle completion invalidates a pending teacher-end seek so it cannot reopen the finishing stage',async()=>{
    const h=controllerHarness();await attempt(h);let release;
    h.env.seek=()=>new Promise(resolve=>{release=resolve;});
    h.env.holdTeacherAtBoundary();assert.equal(h.state.teacherFreezePending,true);
    const operation=h.state.operation;await completeTargets(h);
    assert.equal(h.state.phase,'feedback');assert.ok(h.state.operation>operation);
    release(true);await h.flush();
    assert.equal(h.state.phase,'feedback');assert.equal(h.review.finalized.length,1);assert.equal(h.state.index,0);
  });
  await check('The actual feedback continuation cannot accept mismatched or unknown feedback',async()=>{
    for(const status of ['mismatch','unknown']){
      const h=controllerHarness();h.review.result={status,passed:false,percent:null,
        issues:[{index:33,code:status==='mismatch'?'too_fast':'tracking_unknown'}],messages:['Constructed result']};
      await attempt(h);await completeTargets(h);await h.call('completeFeedback');
      assert.equal(h.state.phase,'positioning');assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
      await h.call('retryFeedback');assert.equal(h.state.phase,'positioning');assert.equal(h.state.results.size,0);
    }
  });
}

const cameraFixture=`// CONSTRUCTED QA camera adapter. No physical camera request.
export function createFollowCamera(options){
  let running=false,generation=0,observations=0;
  Object.defineProperty(options.video,'videoWidth',{configurable:true,get:()=>450});
  Object.defineProperty(options.video,'videoHeight',{configurable:true,get:()=>360});
  const getState=()=>({running,generation,phase:running?'running':'idle',tracking:running?'constructed-qa':'off',
    message:'CONSTRUCTED QA adapter: no physical camera',provenance:'CONSTRUCTED software fixture',
    inferenceCount:observations,streamStarts:0,stoppedTracks:0,overlayJoints:[],tracks:[]});
  const stop=()=>{running=false;options.video.srcObject=null;options.onObservation(null);options.onState(getState());};
  options.startButton.addEventListener('click',()=>{running=true;generation++;options.video.srcObject=new MediaStream();options.onState(getState());});
  options.stopButton.addEventListener('click',stop);
  window.qaCameraFixture={getState,emit(landmarks){if(!running)throw new Error('QA adapter not started');
    const now=performance.now();observations++;options.onObservation({observedAtMs:now,aspectRatio:1.25,
      provenance:'CONSTRUCTED QA learner points, not live inference',sample:{status:'pose',tMs:now,landmarks}});}};
  return {getState,stop,destroy:stop};
}`;

async function browserChecks(){
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(30000);
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.addInitScript(()=>{
      window.qaCameraRequests=0;window.qaSpoken=[];
      class FakeUtterance{constructor(text){this.text=text;}}
      Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:FakeUtterance});
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
        getVoices:()=>[{name:'CONSTRUCTED software QA English voice',lang:'en-US',localService:true}],
        speak(utterance){window.qaSpoken.push(utterance);},cancel(){},addEventListener(){},removeEventListener(){}}});
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{
        window.qaCameraRequests++;throw new DOMException('QA blocks physical webcam access','NotAllowedError');
      };
    });
    await page.route('**/first-three-center-camera.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:cameraFixture}));
    await page.route('**/api/arduino/**',route=>route.fulfill({status:503,contentType:'application/json',
      body:JSON.stringify({connected:false,state:'off',message:'QA disconnected USB fixture. No physical hardware.'})}));
    await page.route('**/api/practice-feedback',route=>route.fulfill({status:503,contentType:'application/json',
      body:JSON.stringify({source:'local',reason:'QA blocks real SDK requests'})}));
    await page.goto(`${base}/first-three.html?step=1`);
    await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready&&!window.firstThreeDiagnostics.loading);
    await page.evaluate(()=>{
      const banner=document.createElement('div');banner.textContent='SOFTWARE QA FIXTURE · no physical camera or USB';
      banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:10000;text-align:center;background:#fff0bc;color:#302a13;font:12px sans-serif;padding:3px';
      document.body.append(banner);document.getElementById('spoken-feedback').checked=true;
      document.getElementById('spoken-feedback').dispatchEvent(new Event('change'));
      window.qaEmitTargets=(key,excluded=[])=>{
        const d=window.startPositionDiagnostics,frame=d.fixedFrame||d.screenLayout?.frame;
        if(!frame)throw new Error('Missing production target frame');
        const points=d.guidanceReference.guides.filter(g=>!excluded.includes(g.index)).map(g=>{
          const point=g[key];return {index:g.index,x:(point.x*frame.scale+frame.hip.x)/frame.aspect,
            y:point.y*frame.scale+frame.hip.y,visibility:1,presence:1};
        });
        // Explicitly constructed torso points satisfy the unchanged full-body
        // readiness contract. They are never represented as camera inference.
        for(const index of [11,12,23,24])points.push({index,
          x:frame.hip.x/frame.aspect+([11,23].includes(index)?-.04:.04),
          y:frame.hip.y-([11,12].includes(index)?frame.scale:0),visibility:1,presence:1});
        window.qaCameraFixture.emit(points);
      };
    });
    await check('Browser presents the five-step self-paced lesson without requesting a webcam on load',async()=>{
      assert.equal(await page.locator('#step-list button').count(),5);
      assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);
      assert.equal(await page.locator('#practice-overlay').isVisible(),false);
      assert.equal(await page.locator('#practice-overlay button').count(),0);
      assert.equal(await page.locator('#feedback-retry, #feedback-next').count(),0);
    });
    await check('Actual browser watch/readiness/attempt flow waits at the teacher boundary until all triangles have fresh support',async()=>{
      await page.click('#start-practice');
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='watching');
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='positioning'&&window.firstThreeDiagnostics.watched);
      await page.evaluate(async()=>{
        const deadline=performance.now()+2100;
        while(performance.now()<deadline&&window.firstThreeDiagnostics.phase==='positioning'){
          window.qaEmitTargets('start');await new Promise(resolve=>setTimeout(resolve,70));
        }
      });
      snapshots.afterConstructedReadiness=await page.evaluate(()=>({controller:window.firstThreeDiagnostics,
        readiness:window.startPositionDiagnostics}));
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='demonstrating');
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='grace');
      await page.waitForTimeout(1300);
      assert.equal(await page.evaluate(()=>window.firstThreeDiagnostics.phase),'grace');
      assert.equal(await page.locator('#practice-overlay').isVisible(),false);
      assert.equal(await page.locator('#teacher-video').evaluate(video=>video.paused),true);
      await page.evaluate(async()=>{
        for(let n=0;n<3;n++){window.qaEmitTargets('end',[36]);await new Promise(resolve=>setTimeout(resolve,40));}
      });
      assert.equal(await page.evaluate(()=>window.firstThreeDiagnostics.phase),'grace');
      await page.evaluate(async()=>{
        for(let n=0;n<3;n++){window.qaEmitTargets('end');await new Promise(resolve=>setTimeout(resolve,40));}
      });
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='feedback');
      assert.equal(await page.locator('#practice-overlay').isVisible(),true);
      assert.equal(await page.locator('#practice-overlay button').count(),0);
      assert.equal(await page.locator('#overlay-value').isVisible(),false);
      const message=await page.locator('#overlay-reason').textContent();
      assert.ok(message.length<350);assert.doesNotMatch(message,/automatically|next clip follows|[0-9]+ s\b/i);
      snapshots.constructedFeedback=await page.evaluate(()=>({phase:window.firstThreeDiagnostics.phase,
        feedback:window.firstThreeDiagnostics.feedback,targetStatus:window.firstThreeDiagnostics.targetStatus,
        overlayWidth:document.getElementById('practice-overlay').querySelector('.overlay-card')?.getBoundingClientRect().width,
        cameraRequests:window.qaCameraRequests}));
      await page.screenshot({path:fileURLToPath(new URL('compact-feedback.png',out))});
    });
    await check('Spoken feedback ends with immediate current-clip retry and needs no feedback button',async()=>{
      await page.waitForTimeout(3200);assert.equal(await page.evaluate(()=>window.firstThreeDiagnostics.phase),'feedback');
      assert.equal(await page.evaluate(()=>window.firstThreeDiagnostics.index),0);
      await page.evaluate(()=>window.qaSpoken.at(-1).onend());
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='positioning');
      const d=await page.evaluate(()=>window.firstThreeDiagnostics);
      assert.equal(d.index,0);assert.equal(d.feedback,null);assert.equal(d.results.length,0);assert.equal(d.watched,true);
      assert.equal(await page.locator('#practice-overlay').isVisible(),false);
      assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);
      await page.screenshot({path:fileURLToPath(new URL('retry-at-squares.png',out))});
    });
    assert.deepEqual(pageErrors,[]);
  }finally{await browser.close();}
}

await mkdir(out,{recursive:true});
let result='PASS',failure=null;
try{await pureChecks();await controllerChecks();if(!process.argv.includes('--no-browser'))await browserChecks();}
catch(error){result='FAIL';failure=error.stack??String(error);console.error(failure);process.exitCode=1;}
await writeFile(new URL('verification.json',out),JSON.stringify({result,checkedAt:new Date().toISOString(),checks,
  controllerSha256:sha(source),completionGateSha256:sha(await readFile(new URL('public/practice-end-targets.js',root))),
  compactFeedbackSha256:sha(await readFile(new URL('public/practice-compact-feedback.js',root))),
  browserPerformed:!process.argv.includes('--no-browser'),snapshots,pageErrors,failure,
  provenance:'Actual production controller declarations and browser page. All learner observations are explicitly constructed software fixtures; the browser camera adapter is replaced, getUserMedia requests are blocked, and USB requests receive a disconnected fixture. No live learner, webcam, or physical-hardware acceptance is claimed.'},null,2)+'\n');
console.log(`Self-paced lesson: ${checks.length} groups ${result.toLowerCase()} (constructed controls).`);
