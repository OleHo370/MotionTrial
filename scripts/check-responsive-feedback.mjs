/** Responsive and final-summary orchestration QA. Actual controller functions
 * run against labelled software voices, camera state, clock and Factory replies.
 * No physical camera, speaker, Arduino or paid model call is performed. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {controllerHarness,source} from './check-review-flow.mjs';
import {createPracticeSummaryClient} from '../public/practice-session-summary.js';

const checks=[],out=new URL('../artifacts/responsive-feedback-review/',import.meta.url);
const mismatch={status:'mismatch',passed:false,percent:null,
  issues:[{index:33,code:'too_fast'},{index:34,code:'too_slow'}],
  messages:['Left hand: too fast.','Right hand: too slow.'],ruleVersion:'CONSTRUCTED review fixture'};
const unknown={status:'unknown',passed:false,percent:null,
  issues:[{index:34,code:'tracking_unknown'}],messages:['Right hand: tracking unclear.']};
const matched={status:'match',passed:true,percent:null,issues:[],messages:['Targets reached.']};
const descriptiveMessages=[
  'Your left hand moved faster than the demonstration. Slow down to follow the teacher’s pace.',
  'Your right hand moved slower than the demonstration. Keep it moving with the teacher until it reaches its ending triangle.',
];
const summaryMessages=[
  'You completed all five movements with matching feedback after seven attempts that received feedback.',
  'The earlier corrections asked you to slow your left hand and keep your right hand moving with the teacher. Your right hand also had one review with unclear tracking, which was kept separate from measured movement mistakes.',
];
async function check(name,run){await run();checks.push(name);console.log(`PASS: ${name}`);}
function deferredAi({summary=false}={}){
  const calls=[];let revision=0;
  return {calls,request(payload){const token=revision;return new Promise(resolve=>calls.push({payload,token,resolve}));},
    cancel(){revision++;},getState:()=>({source:'local',pending:false,sessionId:null}),
    reply(index,messages=summary?summaryMessages:descriptiveMessages){const call=calls[index];
      call.resolve({source:'factory',...(summary?{sessionId:call.payload.sessionId}
        :{attemptId:call.payload.attemptId,stepId:call.payload.stepId,status:call.payload.status}),messages});},
    fail(index){calls[index].resolve(null);}};
}
function harness(options={}){
  const ai=deferredAi(),summary=deferredAi({summary:true});
  const h=controllerHarness({knownStepIds:true,speechOptions:{enabled:true},...options,
    overrides:{aiFeedback:ai,aiSummary:summary,...options.overrides}});
  return {...h,ai,summary};
}

let result='PASS',failure=null;
try{
await check('An immediate neutral lead-in covers preparation; an early AI reply waits until that speech ends',async()=>{
  const h=harness();await h.call('beginReview',mismatch,'retry');
  assert.equal(h.speech.utterances.length,1);assert.equal(h.ai.calls.length,1);
  assert.doesNotMatch(h.speech.utterances[0].args[0].messages.join(' '),/too fast|too slow|well done|perfect/i);
  assert.equal(h.env.sessionHistory.getAttempts().length,0,'A generic lead-in is not attempt feedback');
  h.ai.reply(0);await h.flush();assert.equal(h.speech.utterances.length,1);
  assert.equal(h.env.sessionHistory.getAttempts().length,0);
  await h.finishSpeech();assert.equal(h.speech.utterances.length,2);
  assert.deepEqual(h.env.sessionHistory.getAttempts()[0].messages,descriptiveMessages);
  assert.equal(h.state.feedback.status,'mismatch');assert.equal(h.state.results.size,0);
  const now=h.clock.now;await h.finishSpeech();assert.equal(h.state.phase,'positioning');
  assert.equal(h.state.index,0);assert.equal(h.clock.now,now,'Final voice end adds no continuation delay');
});
await check('A lead-in that finishes before AI cannot retry early; late wording begins exactly once',async()=>{
  const h=harness();await h.call('beginReview',mismatch,'retry');const lead=h.speech.utterances[0];
  await h.finishSpeech();await h.advance(7000);await h.call('tick');
  assert.equal(h.state.phase,'feedback');assert.equal(h.speech.utterances.length,1);
  assert.equal(h.env.sessionHistory.getAttempts().length,0);
  h.ai.reply(0);await h.flush();assert.equal(h.speech.utterances.length,2);
  await h.finishSpeech('completed',lead);assert.equal(h.state.phase,'feedback');
  assert.equal(h.speech.utterances.length,2,'Duplicate lead-in callbacks cannot replace final speech');
  await h.finishSpeech();assert.equal(h.state.phase,'positioning');
  assert.equal(h.env.sessionHistory.getAttempts().length,1);
});
await check('Muting a pending lead-in still waits for AI and then uses the full descriptive reading interval',async()=>{
  const h=harness();await h.call('beginReview',mismatch,'retry');const old=h.speech.utterances[0];
  h.env.$('spoken-feedback').checked=false;await h.call('speechSettingAction');
  assert.equal(h.speech.busy,false);await h.finishSpeech('completed',old);
  assert.equal(h.state.phase,'feedback');assert.equal(h.env.feedbackCycle.pendingAi,true);
  h.ai.reply(0);await h.flush();const wait=await h.call('feedbackReadingMs');
  assert.equal(h.speech.utterances.length,1);assert.equal(h.env.sessionHistory.getAttempts().length,1);
  await h.advance(wait-1);await h.call('tick');assert.equal(h.state.phase,'feedback');
  await h.advance(1);await h.call('tick');assert.equal(h.state.phase,'positioning');assert.equal(h.state.results.size,0);
});
await check('A failed lead-in releases only preparation speech; failed final speech uses reading fallback',async()=>{
  const h=harness();await h.call('beginReview',mismatch,'retry');await h.finishSpeech('error');
  assert.equal(h.state.phase,'feedback');assert.equal(h.speech.utterances.length,1);
  h.ai.reply(0);await h.flush();assert.equal(h.speech.utterances.length,2);
  await h.finishSpeech('watchdog');const wait=await h.call('feedbackReadingMs');
  await h.advance(wait-1);await h.call('tick');assert.equal(h.state.phase,'feedback');
  await h.advance(1);await h.call('tick');assert.equal(h.state.phase,'positioning');
});
await check('Stop, retry, navigation, pause and changed camera invalidate both lead-in and late AI callbacks',async()=>{
  for(const action of ['stop','retryFeedback','choose','pause','camera-loss','camera-generation']){
    const h=harness();h.state.cameraRunning=true;await h.call('beginReview',mismatch,'retry');
    const lead=h.speech.utterances[0];
    if(action.startsWith('camera')){
      if(action==='camera-generation')h.cameraState.generation++;
      await h.emitCameraState({running:action!=='camera-loss',phase:action==='camera-loss'?'idle':'running'});
    }else await h.call(action,...(action==='choose'?[2,true]:[]));
    const calls=h.speech.utterances.length,history=h.env.sessionHistory.getAttempts().length,index=h.state.index;
    h.ai.reply(0);await h.flush();await h.finishSpeech('completed',lead);
    assert.equal(h.speech.utterances.length,calls,action);assert.equal(h.state.index,index,action);
    assert.equal(h.env.sessionHistory.getAttempts().length,history,action);
    assert.equal(h.env.feedbackWordingSource,'local',action);
    assert.notEqual(h.state.results.get('first-three-01')?.status,'matched',action);
  }
});
await check('Pause and resume retain selected full sentences without another AI call or duplicate history entry',async()=>{
  const h=harness();await h.call('beginReview',mismatch,'retry');h.ai.reply(0);await h.flush();await h.finishSpeech();
  const final=h.speech.utterances.at(-1),attemptId=h.env.sessionHistory.getAttempts()[0].attemptId;
  await h.call('pause');await h.finishSpeech('completed',final);await h.call('pause');
  assert.equal(h.ai.calls.length,1);assert.equal(h.speech.utterances.length,3);
  assert.deepEqual([...h.speech.utterances.at(-1).args[0].messages],descriptiveMessages);
  assert.equal(h.env.sessionHistory.getAttempts().length,1);
  assert.equal(h.env.sessionHistory.getAttempts()[0].attemptId,attemptId);
  await h.finishSpeech();assert.equal(h.state.phase,'positioning');
});
await check('Resuming a paused preparation uses local feedback and rejects the old AI reply',async()=>{
  const h=harness();await h.call('beginReview',mismatch,'retry');await h.call('pause');await h.call('pause');
  assert.equal(h.ai.calls.length,1);assert.equal(h.env.sessionHistory.getAttempts().length,1);
  assert.deepEqual([...h.env.sessionHistory.getAttempts()[0].messages],mismatch.messages);
  h.ai.reply(0);await h.flush();assert.equal(h.env.feedbackWordingSource,'local');
  assert.equal(h.env.sessionHistory.getAttempts().length,1);await h.finishSpeech();assert.equal(h.state.phase,'positioning');
});
await check('Final AI summary receives all five successes, earlier retries, unclear tracking and selected spoken sentences',async()=>{
  const h=harness();await h.call('beginReview',mismatch,'retry');h.ai.reply(0);await h.flush();
  await h.finishSpeech();await h.finishSpeech();await h.call('beginReview',unknown,'retry');await h.finishSpeech();
  for(let index=0;index<5;index++){
    assert.equal(h.state.index,index);await h.call('beginReview',matched,'advance');await h.finishSpeech();
  }
  assert.equal(h.state.phase,'finished');assert.equal(h.state.active,false);assert.equal(h.cameraState.running,false);
  assert.equal(h.summary.calls.length,1);const payload=h.summary.calls[0].payload;
  assert.equal(payload.attempts.length,7);assert.equal(payload.results.length,5);
  assert.deepEqual(payload.attempts[0].messages,descriptiveMessages);
  assert.deepEqual(payload.attempts[1].issues,unknown.issues);
  assert.deepEqual(payload.attempts.map(attempt=>attempt.status),['mismatch','unknown','match','match','match','match','match']);
  assert.ok(payload.results.every(result=>result.status==='matched'));
  assert.doesNotMatch(JSON.stringify(payload),/landmarks|cameraFrame|videoFrame|relax your hands|putting together a summary/i);
  assert.match(h.env.lessonSummary.messages.join(' '),/7 attempts|seven attempts/);
  assert.match(h.env.lessonSummary.messages.join(' '),/unclear/);
  const intro=h.speech.utterances.at(-1);h.summary.reply(0);await h.flush();
  assert.equal(h.speech.utterances.at(-1),intro,'Early summary cannot interrupt the final lead-in');
  await h.finishSpeech();assert.deepEqual([...h.speech.utterances.at(-1).args[0].messages],summaryMessages);
  await h.finishSpeech();assert.equal(h.env.summaryCycle.speechDone,true);
  assert.equal(h.state.phase,'finished');assert.equal(h.state.index,4);assert.equal(h.state.active,false);
  assert.equal(h.cameraState.running,false);assert.equal(h.state.results.size,5);
});
await check('Manual completion remains unverified in final summary; delayed AI waits for the summary intro',async()=>{
  const h=harness({stateOverrides:{index:4}});
  for(const step of h.state.manifest.steps.slice(0,4))h.state.results.set(step.id,{stepId:step.id,status:'matched'});
  await h.call('recordAndAdvance','manual');const intro=h.speech.utterances.at(-1);
  assert.equal(h.state.phase,'finished');assert.match(h.env.lessonSummary.messages[0],/4 of 5|4 of five/);
  assert.match(h.env.lessonSummary.messages[0],/manually|not verified/);
  assert.equal(h.summary.calls[0].payload.results.at(-1).status,'manual');
  await h.finishSpeech();assert.equal(h.speech.utterances.at(-1),intro);
  h.summary.reply(0,['You completed four movements with matching feedback. The final movement was advanced manually and was not verified as a match.']);
  await h.flush();assert.equal(h.speech.utterances.length,2);await h.finishSpeech();assert.equal(h.state.phase,'finished');
});
await check('Restart, navigation and End cancel pending summaries and cannot replay late words in a new lesson',async()=>{
  for(const action of ['startPracticeAction','choose','stop'])for(const stage of ['intro','summary']){
    const h=harness({stateOverrides:{index:4}});await h.call('beginReview',matched,'advance');await h.finishSpeech();
    if(stage==='summary'){h.summary.reply(0);await h.flush();await h.finishSpeech();}
    const old=h.speech.utterances.at(-1),calls=h.speech.utterances.length;
    await h.call(action,...(action==='choose'?[1,true]:[]));const phase=h.state.phase,index=h.state.index;
    h.summary.reply(0);await h.flush();await h.finishSpeech('completed',old);
    assert.equal(h.speech.utterances.length,calls,`${action}:${stage}`);
    assert.equal(h.state.phase,phase);assert.equal(h.state.index,index);assert.equal(h.env.lessonSummary,null);
    if(action==='startPracticeAction'){
      assert.equal(h.env.sessionHistory.getAttempts().length,0);assert.equal(h.state.results.size,0);
      assert.equal(h.state.phase,'camera');assert.equal(h.state.index,0);
    }
  }
});
await check('Timeout, unavailable AI and muted final speech keep a complete local summary without restarting practice',async()=>{
  for(const mode of ['timeout','unavailable','muted']){
    const summary=mode==='timeout'?createPracticeSummaryClient({timeoutMs:25,fetchImpl:()=>new Promise(()=>{})})
      :mode==='unavailable'?createPracticeSummaryClient({fetchImpl:null}):deferredAi({summary:true});
    const h=harness({speechOptions:{enabled:mode!=='muted'},stateOverrides:{index:4},overrides:{aiSummary:summary}});
    await h.call('beginReview',matched,'advance');
    if(mode==='muted'){await h.advance(3000);await h.call('tick');}else await h.finishSpeech();
    assert.equal(h.state.phase,'finished');
    if(mode==='timeout'){await new Promise(resolve=>setTimeout(resolve,40));await h.flush();}
    if(mode==='muted'){summary.fail(0);await h.flush();}else await h.finishSpeech();
    assert.equal(h.env.lessonSummary.source,'local');assert.equal(h.env.summaryCycle.pendingAi,false);
    if(mode==='muted'){await h.advance(await h.call('summaryReadingMs'));await h.call('tick');}
    else await h.finishSpeech();
    assert.equal(h.env.summaryCycle.speechDone,true);assert.equal(h.state.phase,'finished');
    assert.equal(h.cameraState.running,false);assert.equal(h.state.results.size,1);
  }
});
}catch(error){result='FAIL';failure=error.stack??String(error);console.error(failure);process.exitCode=1;}
await mkdir(out,{recursive:true});await writeFile(new URL('verification.json',out),JSON.stringify({result,checkedAt:new Date().toISOString(),
  checks,failure,controllerSha256:createHash('sha256').update(source).digest('hex'),
  provenance:'Production controller declarations, strict session journal and client with explicitly constructed clock, voices, review evidence, camera state and AI replies. No paid AI, physical camera, speaker, Arduino or learner acceptance.'},null,2)+'\n');
console.log(`Responsive feedback and final summary: ${checks.length} groups ${result.toLowerCase()} (software fixtures).`);
