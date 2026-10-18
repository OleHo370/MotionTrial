/** Constructed custom-lesson histories only. No webcam, video inference,
 * networked Factory SDK, audio or hardware is used by these checks. */
import assert from 'node:assert/strict';
import {createPracticeSessionHistory,createPracticeSummaryClient,localPracticeSessionSummary,
  practiceSummaryPayload,practiceSessionStats} from '../public/practice-session-summary.js';
import {normalizePracticeSummaryRequest,practiceSummaryEvidence,practiceSummaryOutputSchema,
  validatePracticeSummaryOutput,localPracticeSummary} from './factory-practice-summary.mjs';

const steps=['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05'];
const countWords=['zero','one','two','three','four','five'];
const checks=[];
const attempt=(attemptId,stepId,changes={})=>({attemptId,stepId,status:'match',messages:['Targets reached.'],issues:[],...changes});
const output=entries=>({entries:entries.map(entry=>({entryId:entry.entryId,text:entry.allowedText[0]}))});
function fixture(count){
  const history=createPracticeSessionHistory({sessionId:`custom-${count}-step-session`});
  history.record(attempt('observed-retry',steps[0],{status:'mismatch',
    messages:['Your left hand got ahead of the teacher. Follow the teacher’s pace.'],issues:[{index:33,code:'too_fast'}]}));
  history.record(attempt('unclear-retry',steps[0],{status:'unknown',
    messages:['The right foot could not be tracked throughout this attempt.'],issues:[{index:36,code:'tracking_unknown'}]}));
  for(const [index,stepId] of steps.slice(0,count).entries())
    history.record(attempt(`target-match-${index}`,stepId,index?{}:{issues:[{index:34,code:'timing_unknown'}],
      messages:['Targets reached, but right-hand timing could not be assessed.']}));
  return {history,results:steps.slice(0,count).map(stepId=>({stepId,status:'matched'}))};
}
function check(name,run){run();checks.push(name);console.log(`PASS: ${name}`);}

for(const count of [1,3,5])check(`${count}-step instructor lesson retains its real total through browser, server and approved summaries`,()=>{
  const {history,results}=fixture(count),snapshot=history.snapshot(results,{lessonStepCount:count});
  const payload=practiceSummaryPayload(snapshot),request=normalizePracticeSummaryRequest(payload);
  assert.ok(payload);assert.ok(request);
  if(count===5){
    assert.equal(Object.hasOwn(snapshot,'lessonStepCount'),false);
    assert.deepEqual(history.snapshot(results),snapshot,'Existing five-step payload shape remains unchanged.');
    assert.deepEqual(practiceSummaryPayload({...snapshot,lessonStepCount:5}),payload);
    assert.deepEqual(normalizePracticeSummaryRequest({...payload,lessonStepCount:5}),request);
  }else{
    assert.equal(snapshot.lessonStepCount,count);assert.equal(payload.lessonStepCount,count);assert.equal(request.lessonStepCount,count);
  }
  assert.deepEqual(practiceSessionStats(snapshot),{matched:count,total:count,attempts:count+2,retries:2,unclear:1});
  const local=localPracticeSessionSummary(snapshot).messages.join(' ');
  assert.match(local,/whole sequence.*every step/);assert.match(local,/left hand.*ahead of the teacher/);
  assert.match(local,/could not be fully assessed.*separate/);assert.match(local,/timing was unclear, speed could not be assessed/);
  const evidence=practiceSummaryEvidence(request);
  assert.equal(evidence.lessonStepCount,count);assert.equal(evidence.matched,count);assert.equal(evidence.unknown,1);
  assert.equal(evidence.uncertainTiming,1);assert.equal(evidence.attemptCount,count+2);assert.equal(evidence.repeatAttempts,2);
  assert.deepEqual(evidence.laterReachedSteps,[1]);
  assert.match(evidence.entries[0].allowedText[0],new RegExp(`${count} of the ${countWords[count]} step`));
  assert.match(evidence.conversationEntries[0].allowedText[1],new RegExp(`${countWords[count]}-step sequence`));
  assert.equal(evidence.entries.filter(entry=>entry.kind==='limb').length,1,'Unclear right foot does not become a measured foot error.');
  const accepted=validatePracticeSummaryOutput(output(evidence.conversationEntries),evidence);
  assert.equal(accepted.length,3);assert.match(accepted.join(' '),/unclear|unassessed/);
  assert.doesNotMatch(accepted.join(' '),/right foot.*(?:too fast|too slow)|timing improved|pace corrected|perfect/i);
  assert.deepEqual(localPracticeSummary(request).messages,accepted);
  assert.equal(practiceSummaryOutputSchema(evidence).properties.entries.minItems,3);
  if(count!==5){
    assert.doesNotMatch(JSON.stringify(evidence),/five-step|of the five steps/);
    const invalid=output(evidence.conversationEntries);
    invalid.entries[0].text=invalid.entries[0].text.replace('whole sequence','five-step sequence');
    assert.equal(validatePracticeSummaryOutput(invalid,evidence),null,'Wrong lesson-total wording is not an accepted model alternative.');
  }
});

check('Invalid step counts and out-of-lesson identifiers are rejected before summarization',()=>{
  const {history,results}=fixture(3),valid=history.snapshot(results,{lessonStepCount:3});
  for(const count of [0,6,-1,1.5,'3',null,NaN,Infinity]){
    assert.throws(()=>history.snapshot(results,{lessonStepCount:count}),TypeError);
    assert.equal(practiceSummaryPayload({...valid,lessonStepCount:count}),null);
    assert.equal(normalizePracticeSummaryRequest({...valid,lessonStepCount:count}),null);
    assert.throws(()=>practiceSessionStats({...valid,lessonStepCount:count}),TypeError);
  }
  for(const count of [1,3]){
    const active=fixture(count),snapshot=active.history.snapshot(active.results,{lessonStepCount:count}),outside=steps[count];
    const extraAttempt={...snapshot,attempts:[...snapshot.attempts,attempt('out-of-lesson',outside)]};
    const extraResult={...snapshot,results:[{stepId:outside,status:'manual'}]};
    for(const invalid of [extraAttempt,extraResult]){
      assert.equal(practiceSummaryPayload(invalid),null);assert.equal(normalizePracticeSummaryRequest(invalid),null);
      assert.throws(()=>practiceSessionStats(invalid),TypeError);
    }
    assert.equal(normalizePracticeSummaryRequest({...snapshot,attempts:[attempt('numeric-outside',count+1)]}),null);
    assert.equal(normalizePracticeSummaryRequest({...snapshot,results:[{stepId:count+1,status:'manual'}]}),null);
    assert.throws(()=>active.history.snapshot([{stepId:outside,status:'manual'}],{lessonStepCount:count}),TypeError);
    active.history.record(attempt('stale-step-from-another-lesson',outside));
    assert.throws(()=>active.history.snapshot(active.results,{lessonStepCount:count}),TypeError);
  }
});

check('Custom-lesson manual transitions and missing match evidence never become verified completion',()=>{
  const {history,results}=fixture(3),snapshot=history.snapshot(results,{lessonStepCount:3});
  const manual={...snapshot,results:[...snapshot.results.slice(0,2),{stepId:steps[2],status:'manual'}]};
  const request=normalizePracticeSummaryRequest(manual),evidence=practiceSummaryEvidence(request);
  assert.equal(practiceSessionStats(manual).matched,2);assert.equal(evidence.matched,2);assert.equal(evidence.manual,1);
  assert.match(localPracticeSessionSummary(manual).messages[0],/Manually advanced steps remain unverified/);
  const messages=validatePracticeSummaryOutput(output(evidence.conversationEntries),evidence);
  assert.match(messages[0],/manually.*unverified/);assert.doesNotMatch(messages[0],/worked through the whole sequence|targets in every step|throughout the three-step sequence/);
  assert.equal(normalizePracticeSummaryRequest({...snapshot,attempts:snapshot.attempts.filter(value=>value.stepId!==steps[2])}),null);
  const numeric=normalizePracticeSummaryRequest({...manual,attempts:manual.attempts.map(value=>({...value,stepId:steps.indexOf(value.stepId)+1})),
    results:manual.results.map(value=>({...value,stepId:steps.indexOf(value.stepId)+1}))});
  assert.deepEqual(numeric,request,'Existing numeric server aliases remain valid inside the lesson boundary.');
});

{
  const {history,results}=fixture(3),snapshot=history.snapshot(results,{lessonStepCount:3});
  let sent,calls=0;
  const client=createPracticeSummaryClient({fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'/api/practice-summary');sent=JSON.parse(options.body);
    const request=normalizePracticeSummaryRequest(sent),evidence=practiceSummaryEvidence(request);
    return {ok:true,json:async()=>({source:'factory',sessionId:request.sessionId,
      messages:validatePracticeSummaryOutput(output(evidence.conversationEntries),evidence)})};
  }});
  const result=await client.request(snapshot);
  assert.equal(result.source,'factory');assert.equal(result.messages.length,3);assert.equal(sent.lessonStepCount,3);assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(sent),/landmarks|cameraFrame|five-step/);
  assert.equal(await client.request({...snapshot,lessonStepCount:0}),null);assert.equal(calls,1);
  client.cancel();
  checks.push('The browser summary client sends the custom lesson total to the existing Factory endpoint and rejects invalid counts without a request.');
  console.log(`PASS: ${checks.at(-1)}`);
}
console.log(JSON.stringify({passed:true,checks:checks.length,
  provenance:'Constructed 1-, 3- and 5-step lesson histories and an injected summary fetch; no live inference, Factory, audio or hardware.'}));
