/** Spoken continuation QA. All voices, cameras, reviews and SDK replies are
 * explicitly constructed software fixtures. No physical camera, speaker,
 * Arduino or paid Factory call is used by these checks. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,} from 'node:url';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {controllerHarness,attempt,review,source} from './check-review-flow.mjs';
import {createFeedbackSpeech} from '../public/practice-feedback-speech.js';
import {createPracticeAiFeedback} from '../public/practice-ai-feedback.js';
import {createDualViewServer} from './serve-dual-view.mjs';

const root=new URL('../',import.meta.url),out=new URL('artifacts/spoken-auto-feedback-review/',root);
const checks=[],snapshots={},pageErrors=[];
const hash=value=>createHash('sha256').update(value).digest('hex');
const mismatch={status:'mismatch',passed:false,percent:null,issues:[{index:33,code:'too_fast'},{index:34,code:'too_slow'}],
  messages:['Left hand: too fast.','Right hand: too slow.'],ruleVersion:'CONSTRUCTED review fixture'};
const matched={status:'match',passed:true,percent:null,issues:[],messages:['Targets reached.']};
const unknown={status:'unknown',passed:false,percent:null,issues:[{index:33,code:'tracking_unknown'}],messages:['Left hand: tracking unclear.']};
async function check(name,run){await run();checks.push(name);console.log(`PASS: ${name}`);}

function aiFixture(){
  const calls=[];let revision=0;
  return {calls,request(payload){const token=revision;
    return new Promise(resolve=>calls.push({payload,token,resolve,result:null}));},
    cancel(){revision++;for(const call of calls)if(call.token!==revision)call.cancelled=true;},
    getState:()=>({source:'local',pending:false}),
    reply(index,messages=mismatch.messages){const call=calls[index];call.resolve({source:'factory',status:call.payload.status,
      attemptId:call.payload.attemptId,stepId:call.payload.stepId,messages});},
    fail(index){calls[index].resolve(null);},
  };
}

async function speechLifecycleChecks(){
  function fixture({voices=[{name:'CONSTRUCTED English voice',lang:'en-US',localService:true}],enabled=true}={}){
    let now=0,next=0;const timers=new Map(),spoken=[],completions=[];
    const engine={getVoices:()=>voices,speak:u=>spoken.push(u),cancel(){},addEventListener(){},removeEventListener(){}};
    class Utterance{constructor(text){this.text=text;}}
    const speech=createFeedbackSpeech({synthesis:engine,Utterance,enabled,
      setTimer:(fn,delay)=>{const id=++next;timers.set(id,{at:now+delay,fn});return id;},clearTimer:id=>timers.delete(id)});
    speech.unlock();
    return {speech,spoken,completions,
      speak:()=>speech.speakReview({...mismatch,feedbackStyle:'compact'},{onComplete:reason=>completions.push(reason)}),
      advance(ms){const end=now+ms;
        while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;
          now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;},
    };
  }
  await check('Actual speech end reports completion once and ignores retained duplicate callbacks',()=>{
    const f=fixture();assert.equal(f.speak(),true);const end=f.spoken[0].onend;
    assert.equal(f.completions.length,0);end();end();assert.deepEqual(f.completions,['completed']);assert.equal(f.speech.isBusy(),false);
    f.speech.destroy();
  });
  await check('Actual speech error and watchdog finish with failure reasons; cancellation never signals success',()=>{
    for(const kind of ['error','watchdog','cancel']){
      const f=fixture();f.speak();const end=f.spoken[0].onend,error=f.spoken[0].onerror;
      if(kind==='error')error();else if(kind==='watchdog')f.advance(18000);else f.speech.cancel();
      end();error();assert.equal(f.speech.isBusy(),false);
      if(kind==='cancel')assert.deepEqual(f.completions,[]);
      else {assert.equal(f.completions.length,1);assert.notEqual(f.completions[0],'completed');}
      f.speech.destroy();
    }
  });
  await check('Speech switched off, unavailable voices and replaced requests cannot duplicate completion',()=>{
    const f=fixture();f.speak();const oldEnd=f.spoken[0].onend;
    f.speak();oldEnd();assert.deepEqual(f.completions,[]);
    f.spoken[1].onend();assert.deepEqual(f.completions,['completed']);f.speech.destroy();
    for(const options of [{enabled:false},{voices:[{name:'CONSTRUCTED remote voice',lang:'en-US',localService:false}]}]){
      const muted=fixture(options);assert.equal(muted.speak(),false);assert.equal(muted.spoken.length,0);muted.speech.destroy();
    }
  });
}

async function controllerChecks(){
  await check('A local match waits for voice end, automatically advances once and never waits for Factory',async()=>{
    const ai=aiFixture(),h=controllerHarness({speechOptions:{enabled:true},overrides:{aiFeedback:ai}});
    await attempt(h);await review(h);assert.equal(h.speech.calls.length,1);assert.equal(ai.calls.length,0);
    assert.equal(h.state.phase,'feedback');assert.equal(h.state.results.size,0);
    h.clock.now+=1000;await h.call('tick');assert.equal(h.state.index,0);
    const utterance=h.speech.utterances[0];await h.finishSpeech();
    assert.equal(h.state.index,1);assert.equal(h.state.phase,'watching');assert.equal(h.state.results.get('step-1').status,'matched');
    await h.finishSpeech('completed',utterance);assert.equal(h.state.index,1);assert.equal(h.state.results.size,1);
  });
  await check('Observed errors display immediately; one bounded Factory rewrite is spoken once before same-clip retry',async()=>{
    const ai=aiFixture(),h=controllerHarness({speechOptions:{enabled:true},overrides:{aiFeedback:ai}});
    await h.call('beginReview',mismatch,'retry');assert.equal(h.state.phase,'feedback');
    assert.deepEqual([...h.state.feedback.messages],mismatch.messages);assert.equal(ai.calls.length,1);assert.equal(h.speech.calls.length,0);
    const messages=['Left hand: moved too quickly.','Right hand: moved too slowly.'];ai.reply(0,messages);await h.flush();
    assert.equal(h.env.feedbackWordingSource,'factory');assert.equal(h.speech.calls.length,1);
    assert.deepEqual([...h.speech.calls[0].args[0].messages],messages);assert.equal(h.state.feedback.status,'mismatch');
    await h.finishSpeech();assert.equal(h.state.index,0);assert.equal(h.state.phase,'positioning');assert.equal(h.state.results.size,0);
    assert.equal(h.state.feedback,null);assert.equal(ai.calls.length,1);
  });
  await check('Factory timeout and rejected result fall back to exact local speech; late replies cannot repaint retry',async()=>{
    for(const failure of ['timeout','null']){
      let release;
      const ai=failure==='timeout'?createPracticeAiFeedback({timeoutMs:25,fetchImpl:()=>new Promise(resolve=>{release=resolve;})}):aiFixture();
      const h=controllerHarness({speechOptions:{enabled:true},overrides:{aiFeedback:ai}});
      assert.equal(h.env.FEEDBACK_FLOW_RULES.aiWaitMs,12000,'Actual controller config bounds SDK preparation to 12 s');
      await h.call('beginReview',mismatch,'retry');
      if(failure==='timeout'){await new Promise(resolve=>setTimeout(resolve,40));await h.flush();}else {ai.fail(0);await h.flush();}
      assert.equal(h.speech.calls.length,1);assert.deepEqual([...h.speech.calls[0].args[0].messages],mismatch.messages);
      assert.equal(h.env.feedbackWordingSource,'local');await h.finishSpeech();assert.equal(h.state.phase,'positioning');
      if(failure==='timeout')release({ok:true,json:async()=>({source:'factory',messages:['Left hand: moved too quickly.']})});
      else ai.reply(0,['Left hand: moved too quickly.']);await h.flush();assert.equal(h.state.feedback,null);
      assert.equal(h.state.results.size,0);assert.equal(h.speech.calls.length,1);
    }
  });
  await check('Unknown tracking skips Factory, speaks only uncertainty and automatically retries without a pass',async()=>{
    const ai=aiFixture(),h=controllerHarness({speechOptions:{enabled:true},overrides:{aiFeedback:ai}});
    await h.call('beginReview',unknown,'retry');assert.equal(ai.calls.length,0);assert.equal(h.speech.calls.length,1);
    assert.doesNotMatch(h.speech.calls[0].args[0].messages.join(' '),/too fast|too slow/);
    await h.finishSpeech();assert.equal(h.state.phase,'positioning');assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
  });
  await check('Muted, unsupported and failed speech use a three-second reading fallback for matches and errors',async()=>{
    for(const status of [matched,unknown])for(const mode of ['muted','unsupported','error']){
      const h=controllerHarness({speechOptions:{enabled:mode!=='muted',supported:mode!=='unsupported'}});
      await h.call('beginReview',status,status.status==='match'?'advance':'retry');
      if(mode==='error')await h.finishSpeech('error');
      await h.advance(2999);await h.call('tick');assert.equal(h.state.phase,'feedback');assert.equal(h.state.index,0);
      await h.advance(1);await h.call('tick');
      assert.equal(h.state.phase,status.status==='match'?'watching':'positioning');assert.equal(h.state.index,status.status==='match'?1:0);
      assert.equal(h.state.results.size,status.status==='match'?1:0);
    }
  });
  await check('The actual speech checkbox can mute an active announcement without trapping the feedback flow',async()=>{
    const h=controllerHarness({speechOptions:{enabled:true}});await h.call('beginReview',matched,'advance');
    const old=h.speech.utterances[0];h.env.$('spoken-feedback').checked=false;await h.call('speechSettingAction');
    assert.equal(h.speech.busy,false);await h.finishSpeech('completed',old);
    assert.equal(h.state.index,0,'Canceling the old utterance cannot count as finishing its message');
    await h.advance(2999);await h.call('tick');assert.equal(h.state.index,0);
    await h.advance(1);await h.call('tick');assert.equal(h.state.index,1);assert.equal(h.state.results.size,1);
  });
  await check('Stop, navigation, replay, explicit retry, camera loss and generation change reject old speech callbacks',async()=>{
    for(const action of ['stop','choose','replayAction','retryFeedback','camera-loss','camera-generation']){
      const h=controllerHarness({speechOptions:{enabled:true}});h.state.cameraRunning=true;
      await attempt(h);await review(h);const utterance=h.speech.utterances[0];
      if(action.startsWith('camera')){
        if(action==='camera-generation')h.cameraState.generation++;
        await h.emitCameraState({running:action!=='camera-loss',phase:action==='camera-loss'?'idle':'running'});
      }else await h.call(action,...(action==='choose'?[2,true]:[]));
      await h.finishSpeech('completed',utterance);await h.advance(15000);await h.call('tick');
      assert.notEqual(h.state.results.get('step-1')?.status,'matched',action);
      assert.equal(h.state.index,action==='choose'?2:0,action);
      assert.equal(h.speech.calls.length,action==='camera-generation'?2:1,action);
    }
  });
  await check('Pause cancels the prior completion; resume replays wording once and automatically continues only after new speech',async()=>{
    const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
    const old=h.speech.utterances[0];await h.call('pause');await h.finishSpeech('completed',old);await h.advance(20000);
    await h.call('tick');assert.equal(h.state.index,0);assert.equal(h.state.paused,true);
    await h.call('pause');assert.equal(h.speech.calls.length,2);assert.equal(h.state.phase,'feedback');
    await h.finishSpeech();assert.equal(h.state.index,1);assert.equal(h.state.results.size,1);
  });
  await check('Canceling while waiting for Factory rejects late wording and retained duplicate callbacks',async()=>{
    for(const action of ['stop','retryFeedback','choose','pause']){
      const ai=aiFixture(),h=controllerHarness({speechOptions:{enabled:true},overrides:{aiFeedback:ai}});
      await h.call('beginReview',mismatch,'retry');await h.call(action,...(action==='choose'?[2,true]:[]));
      const resultCount=h.state.results.size,index=h.state.index;
      ai.reply(0);await h.flush();await h.advance(20000);await h.call('tick');
      assert.equal(h.speech.calls.length,0,action);assert.equal(h.state.results.size,resultCount,action);assert.equal(h.state.index,index,action);
      assert.equal(h.env.feedbackWordingSource,'local',action);
    }
  });
  await check('The fifth matched review finishes the five-clip lesson once and never selects clip six',async()=>{
    const h=controllerHarness({speechOptions:{enabled:true},stateOverrides:{index:4}});await attempt(h);await review(h);
    const voice=h.speech.utterances[0];await h.finishSpeech();
    assert.equal(h.state.index,4);assert.equal(h.state.phase,'finished');assert.equal(h.state.active,false);
    assert.equal(h.state.results.get('step-5').status,'matched');await h.finishSpeech('completed',voice);
    assert.equal(h.state.results.size,1);assert.equal(h.state.index,4);assert.equal(h.cameraState.running,false);
  });
}

const cameraFixture=`// CONSTRUCTED browser QA adapter: never opens a webcam.
export function createFollowCamera(options){
  let running=true,generation=1;
  const getState=()=>({running,generation,phase:running?'running':'idle',tracking:'CONSTRUCTED QA',
    message:'CONSTRUCTED camera fixture, no physical camera',provenance:'CONSTRUCTED software camera',tracks:[]});
  const stop=()=>{running=false;options.onObservation(null);options.onState(getState());};
  return {getState,stop,destroy:stop};
}`;

async function browserChecks(){
  // Dedicated ephemeral server disables both SDK and USB at construction.
  // The user's live server and in-app camera session are not changed.
  const server=createDualViewServer({publicRoot:resolve(fileURLToPath(new URL('public/',root))),
    relay:{async handle(){return false;},async close(){}},feedback:{async handle(){return false;},async close(){}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>pageErrors.push(error.message));
    await page.addInitScript(()=>{
      window.qaCameraRequests=0;window.qaSpoken=[];window.qaSpeechCancels=0;
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.qaCameraRequests++;throw Error('QA blocks webcams');};
      class FakeUtterance{constructor(text){this.text=text;}}
      const synthesis={getVoices:()=>[{name:'CONSTRUCTED software QA English voice',lang:'en-US',localService:true}],
        speak:utterance=>window.qaSpoken.push(utterance),cancel:()=>window.qaSpeechCancels++,addEventListener(){},removeEventListener(){}};
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:synthesis});
      Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:FakeUtterance});
    });
    await page.route('**/first-three-center-camera.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:cameraFixture}));
    const controller=await readFile(new URL('public/first-three.js',root),'utf8');
    await page.route('**/first-three.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:controller+`
// CONSTRUCTED review injection; routed browser QA resource only.
window.qaEnterReview=(review,index=0)=>{state.active=true;state.paused=false;state.watched=true;state.index=index;$('camera-empty').hidden=true;
 state.cameraRunning=true;feedbackSpeech.unlock();beginReview(review,review.status==='match'?'advance':'retry');};`}));
    await page.route('**/api/arduino/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"connected":false,"state":"off"}'}));
    await page.route('**/api/practice-feedback',async route=>{
      const body=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        source:'factory',attemptId:body.attemptId,stepId:body.stepId,status:body.status,
        messages:['Left hand: moved too quickly.','Right hand: moved too slowly.']})});
    });
    async function load(){await page.goto(`${base}/first-three.html?step=1`);
      await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready&&!window.firstThreeDiagnostics.loading);
      await page.evaluate(()=>{const banner=document.createElement('div');banner.textContent='SOFTWARE QA FIXTURE · no physical camera, audio, SDK or USB';
        banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:10000;text-align:center;background:#fff0bc;color:#302a13;font:11px sans-serif;padding:3px';document.body.append(banner);});}
    await load();
    await check('Browser center feedback uses a flat paper strip within the practice area, with no modal semantics or webcam request',async()=>{
      await page.evaluate(review=>window.qaEnterReview(review),mismatch);
      await page.waitForFunction(()=>window.qaSpoken.length===1);
      const appearance=await page.evaluate(()=>{
        const overlay=document.getElementById('practice-overlay'),card=overlay.querySelector('.overlay-card');
        const grid=overlay.closest('.practice-grid'),a=overlay.getBoundingClientRect(),b=grid.getBoundingClientRect(),c=card.getBoundingClientRect();
        const style=getComputedStyle(overlay),cardStyle=getComputedStyle(card);
        return {role:overlay.getAttribute('role'),modal:overlay.getAttribute('aria-modal'),position:style.position,
          background:style.backgroundColor,filter:style.backdropFilter,pointerEvents:style.pointerEvents,
          radius:cardStyle.borderRadius,shadow:cardStyle.boxShadow,border:cardStyle.borderTopWidth,
          overlay:{x:a.x,y:a.y,width:a.width,height:a.height},grid:{x:b.x,y:b.y,width:b.width,height:b.height},
          card:{x:c.x,y:c.y,width:c.width,height:c.height},cameraRequests:window.qaCameraRequests,
          speech:window.qaSpoken[0].text,message:document.getElementById('overlay-reason').textContent};
      });
      assert.equal(appearance.role,'status');assert.equal(appearance.modal,null);assert.equal(appearance.position,'absolute');
      assert.equal(appearance.filter,'none');assert.equal(appearance.background,'rgba(0, 0, 0, 0)');assert.equal(appearance.pointerEvents,'none');
      assert.equal(appearance.radius,'0px');assert.equal(appearance.shadow,'none');assert.equal(appearance.border,'0px');
      assert.ok(Math.abs(appearance.card.x+appearance.card.width/2-(appearance.grid.x+appearance.grid.width/2))<2);
      assert.ok(Math.abs(appearance.card.y+appearance.card.height/2-(appearance.grid.y+appearance.grid.height/2))<2);
      assert.equal(appearance.cameraRequests,0);assert.match(appearance.speech,/moved too quickly/);
      assert.equal(await page.locator('#feedback-ai-source').isVisible(),true);
      snapshots.desktop=appearance;await page.screenshot({path:fileURLToPath(new URL('center-feedback-desktop.png',out))});
    });
    await check('Browser speech end automatically retries the same clip and a match automatically begins the next demonstration',async()=>{
      await page.evaluate(()=>window.qaSpoken.at(-1).onend());
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='positioning');
      assert.equal(await page.evaluate(()=>window.firstThreeDiagnostics.index),0);
      assert.equal(await page.locator('#practice-overlay').isVisible(),false);
      await page.evaluate(review=>window.qaEnterReview(review),matched);await page.waitForFunction(()=>window.qaSpoken.length===2);
      await page.evaluate(()=>window.qaSpoken.at(-1).onend());await page.waitForFunction(()=>window.firstThreeDiagnostics.index===1);
      assert.equal(await page.evaluate(()=>window.firstThreeDiagnostics.results[0].status),'matched');
      assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);
    });
    await check('Small portrait and landscape center strips fit the practice area and keep every error readable',async()=>{
      for(const size of [{width:390,height:844},{width:844,height:390}]){
        await page.setViewportSize(size);await load();await page.evaluate(review=>window.qaEnterReview(review),mismatch);
        await page.waitForFunction(()=>window.qaSpoken.length===1);
        const fit=await page.evaluate(()=>{const card=document.querySelector('#practice-overlay .overlay-card'),rect=card.getBoundingClientRect();
          return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,
            scrollWidth:card.scrollWidth,clientWidth:card.clientWidth,message:document.getElementById('overlay-reason').textContent,
            cameraRequests:window.qaCameraRequests};});
        assert.ok(fit.left>=-1&&fit.right<=size.width+1,JSON.stringify(fit));assert.ok(fit.scrollWidth<=fit.clientWidth+1);
        assert.match(fit.message,/Left hand/);assert.match(fit.message,/Right hand/);assert.equal(fit.cameraRequests,0);
        snapshots[`${size.width}x${size.height}`]=fit;
        await page.screenshot({path:fileURLToPath(new URL(`center-feedback-${size.width}x${size.height}.png`,out))});
      }
    });
    assert.deepEqual(pageErrors,[]);
  }finally{await browser.close();server.closeAllConnections?.();await server.shutdown();}
}

await mkdir(out,{recursive:true});let result='PASS',failure=null;
try{await speechLifecycleChecks();await controllerChecks();if(!process.argv.includes('--no-browser'))await browserChecks();}
catch(error){result='FAIL';failure=error.stack??String(error);console.error(failure);process.exitCode=1;}
await writeFile(new URL('verification.json',out),JSON.stringify({result,checkedAt:new Date().toISOString(),checks,snapshots,pageErrors,failure,
  browserPerformed:!process.argv.includes('--no-browser'),controllerSha256:hash(source),
  speechSha256:hash(await readFile(new URL('public/practice-feedback-speech.js',root))),
  provenance:'Actual production controller declarations and speech module with constructed clocks, voices, review evidence and SDK results; browser uses dedicated ephemeral static server, blocked physical camera, fake local English speech and disconnected USB routes. No paid AI, real camera, Arduino, speaker or learner acceptance claimed.'},null,2)+'\n');
console.log(`Spoken automatic feedback: ${checks.length} groups ${result.toLowerCase()} (software fixtures).`);
