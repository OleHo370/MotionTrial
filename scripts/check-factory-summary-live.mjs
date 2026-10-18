// Explicit paid-service diagnostic: three small Factory calls with software
// feedback only. Never opens a learner camera, recording or USB connection.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDualViewServer} from './serve-dual-view.mjs';
import {createFactoryPracticeFeedbackService} from './factory-practice-feedback.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.FACTORY_API_KEY)process.loadEnvFile(path.join(root,'.env.factory.local'));
assert.ok(process.env.FACTORY_API_KEY,'The ignored local Factory key is required.');
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
  return {elapsedMs:Math.round(performance.now()-started),result};
}
const softwareReview={stepId:'first-three-01',status:'mismatch',messages:['Left hand: too fast.','Right hand: too slow.'],
  issues:[{index:33,code:'too_fast'},{index:34,code:'too_slow'}]};
try{
  const summaryOnly=process.argv.includes('--summary-only');
  const cold=summaryOnly?null:await request('/api/practice-feedback',{attemptId:'live-software-cold',...softwareReview});
  if(cold)assert.equal(cold.result.source,'factory');
  const preparation=await request('/api/practice-feedback/warmup',{});
  assert.equal(preparation.result.ready,true);assert.equal(preparation.result.modelRequested,false);
  const warm=summaryOnly?null:await request('/api/practice-feedback',{attemptId:'live-software-warm',...softwareReview});
  if(warm)assert.equal(warm.result.source,'factory');
  const stepIds=['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05'];
  const attempts=[{attemptId:'software-retry',...softwareReview,messages:warm?.result.messages??softwareReview.messages},
    {attemptId:'software-unclear',stepId:stepIds[1],status:'unknown',messages:['Tracking unclear.'],
      issues:[{index:null,code:'tracking_unknown'}]},
    ...stepIds.map((stepId,index)=>({attemptId:`software-match-${index}`,stepId,status:'match',messages:['Targets reached.'],issues:[]}))];
  if(!summaryOnly)await request('/api/practice-feedback/warmup',{});
  const summary=await request('/api/practice-summary',{sessionId:'live-software-summary',attempts,
    results:stepIds.map(stepId=>({stepId,status:'matched'}))});
  assert.equal(summary.result.source,'factory');assert.equal(summary.result.sessionId,'live-software-summary');
  const text=summary.result.messages.join(' ');
  assert.equal(summary.result.messages.length,3);
  assert.match(text,/whole sequence|five-step sequence/i);
  assert.match(text,/getting ahead.*falling behind|timing.*hands/i);
  assert.match(text,/unclear|unassessed/i);
  const report={provenance:'Labeled software attempts; real authenticated Factory SDK. No person, webcam or USB.',
    passed:true,coldFeedbackMs:cold?.elapsedMs??null,sessionPreparationMs:preparation.elapsedMs,
    preparedFeedbackMs:warm?.elapsedMs??null,finalSummaryMs:summary.elapsedMs,messages:summary.result.messages};
  const directory=path.join(root,'artifacts','session-summary-review');await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,summaryOnly?'live-summary-verification.json':'live-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{await server.shutdown();}
