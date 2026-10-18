// Opt-in real Factory verification with two labelled software examples.
// Consumes Factory usage; never opens a camera, recording or USB connection.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDualViewServer} from './serve-dual-view.mjs';
import {createFactoryPracticeFeedbackService} from './factory-practice-feedback.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.FACTORY_API_KEY)process.loadEnvFile(path.join(root,'.env.factory.local'));
assert.ok(process.env.FACTORY_API_KEY,'An ignored local Factory key is required.');
const server=createDualViewServer({relay:{async handle(){return false;},async close(){}},
  feedback:createFactoryPracticeFeedbackService()});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`;
async function request(endpoint,body){
  const started=performance.now();
  const response=await fetch(origin+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},
    body:JSON.stringify(body),signal:AbortSignal.timeout(50000)});
  assert.equal(response.status,200);const result=await response.json();
  assert.ok(!JSON.stringify(result).includes(process.env.FACTORY_API_KEY));
  return{elapsedMs:Math.round(performance.now()-started),result};
}
try{
  assert.equal((await request('/api/practice-feedback/warmup',{})).result.modelRequested,false);
  const review={attemptId:'software-upward-retry',stepId:'first-three-02',status:'mismatch',
    messages:['Left hand: too slow.','Right hand: too slow; left beam.'],
    issues:[{index:33,code:'too_slow'},{index:34,code:'too_slow'},{index:34,code:'off_guide'}],
    context:{version:'practice-feedback-context-v1',limbs:[{index:33,expectedDirection:'up'},
      {index:34,expectedDirection:'up',observedDirection:'right'}]}};
  const feedback=await request('/api/practice-feedback',review);
  assert.equal(feedback.result.source,'factory');assert.equal(feedback.result.status,'mismatch');
  assert.equal(feedback.result.messages.length,2);assert.match(feedback.result.messages.join(' '),/both hands|pace of your hands/i);
  assert.match(feedback.result.messages.join(' '),/upward|rise/i);assert.match(feedback.result.messages.join(' '),/sideways/i);
  assert.equal((await request('/api/practice-feedback/warmup',{})).result.modelRequested,false);
  const ids=['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05'];
  const coordination={attemptId:'software-hold-retry',stepId:ids[1],status:'mismatch',
    messages:['Left foot: moved away from hold.'],issues:[{index:35,code:'hold_drift'}],
    context:{version:'practice-feedback-context-v1',limbs:[{index:33,expectedDirection:'up'},
      {index:34,expectedDirection:'up'},{index:35,expectedDirection:'hold'}],practiceFocus:'coordination'}};
  const attempts=[{...review,messages:feedback.result.messages},coordination,
    ...ids.map((stepId,index)=>({attemptId:`software-target-match-${index}`,stepId,status:'match',
      messages:['You reached the ending targets.'],issues:[]}))];
  const summary=await request('/api/practice-summary',{sessionId:'software-conversational-summary',attempts,
    results:ids.map(stepId=>({stepId,status:'matched'}))});
  assert.equal(summary.result.source,'factory');assert.equal(summary.result.messages.length,3);
  assert.match(summary.result.messages[1],/coordinat|relationship/i);
  assert.match(summary.result.messages[1],/left foot/i);assert.match(summary.result.messages[2],/next|practice/i);
  assert.doesNotMatch(summary.result.messages.join(' '),/timing (?:improved|fixed)|afraid|fear|lack.{0,12}confidence/i);
  const report={passed:true,provenance:'Labelled software issues; real authenticated Factory SDK. No person, camera or USB.',
    feedbackMs:feedback.elapsedMs,summaryMs:summary.elapsedMs,feedback:feedback.result.messages,summary:summary.result.messages};
  const directory=path.join(root,'artifacts','conversational-factory-review');await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'live-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{await server.shutdown();}
