/** Grounded conversational coaching QA. Every review and movement context is a
 * constructed software fixture; no learner, webcam, Arduino or paid AI is used. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {normalizeFeedbackRequest,validateFactoryFeedbackOutput} from './factory-practice-feedback.mjs';
import {conversationalFeedbackEvidence,normalizeCoachingContext} from './factory-conversational-coaching.mjs';
import {normalizePracticeSummaryRequest,practiceSummaryEvidence,validatePracticeSummaryOutput} from './factory-practice-summary.mjs';
import {createPracticeAiFeedback} from '../public/practice-ai-feedback.js';

const checks=[],version='practice-feedback-context-v1';
const stepIds=['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05'];
const context=limbs=>({version,limbs});
const request=(issues,changes={})=>({attemptId:'software-context-review',stepId:stepIds[0],status:'mismatch',
  messages:['Constructed local coaching wording.'],issues,...changes});
const structured=entries=>({entries:entries.map(entry=>({entryId:entry.entryId,text:entry.allowedText[0]}))});
const attempt=(attemptId,issues,changes={})=>({...request(issues),attemptId,...changes});
const summary=(first,changes={})=>({sessionId:'software-conversational-summary',attempts:[first,
  ...stepIds.map((stepId,index)=>attempt(`completed-${index}`,[],{stepId,status:'match',messages:['Targets reached.']}))],
  results:stepIds.map(stepId=>({stepId,status:'matched'})),...changes});
function check(name,run){run();checks.push(name);console.log(`PASS: ${name}`);}

check('A shared slow upward movement becomes one main idea plus the separately grounded right-hand path issue',()=>{
  const raw=request([{index:33,code:'too_slow'},{index:34,code:'too_slow'},{index:34,code:'off_guide'}],{
    context:context([{index:33,expectedDirection:'up'},{index:34,expectedDirection:'up',observedDirection:'right'}])});
  const normalized=normalizeFeedbackRequest(raw),plan=conversationalFeedbackEvidence(normalized);
  assert.equal(plan.entries.length,2);assert.deepEqual(plan.entries[0].facts.indices,[33,34]);
  const messages=validateFactoryFeedbackOutput(structured(plan.entries),normalized);assert.ok(messages);
  assert.match(messages[0],/Both hands.*teacher.*upward/i);assert.match(messages[1],/right hand.*sideways.*upward/i);
  assert.doesNotMatch(messages.join(' '),/left hand.*slowly.*right hand.*slowly|to your right|confidence|fear/i);
  assert.equal(normalized.issues.length,3);assert.equal(normalized.status,'mismatch');
});

check('Expected upward motion does not imply an observed sideways mistake when the accepted samples supplied no direction',()=>{
  const normalized=normalizeFeedbackRequest(request([{index:34,code:'off_guide'}],{
    context:context([{index:34,expectedDirection:'up'}])}));
  const messages=validateFactoryFeedbackOutput(structured(conversationalFeedbackEvidence(normalized).entries),normalized);
  assert.match(messages.join(' '),/progress beam.*upward/i);assert.doesNotMatch(messages.join(' '),/drifted sideways|went sideways|instead of/i);
  assert.equal(normalizeCoachingContext(context([{index:34,expectedDirection:'up',observedDirection:'right'}]),
    [{index:34,code:'tracking_unknown'}]),null,'Uncertain tracking cannot authorize an observed direction claim.');
});

check('Unclear feet and unassessed hand timing remain uncertainty, preserve the outcome, and reject wrong-subject wording',()=>{
  const foot=normalizeFeedbackRequest(request([{index:36,code:'tracking_unknown'}],{status:'unknown',
    context:context([{index:36,expectedDirection:'hold'}])}));
  const entries=conversationalFeedbackEvidence(foot).entries,output=structured(entries),text=validateFactoryFeedbackOutput(output,foot).join(' ');
  assert.match(text,/right foot/i);assert.match(text,/couldn.t|can.t|camera/i);
  assert.doesNotMatch(text,/too fast|too slow|larger|smaller|confidence|afraid|fear/i);assert.equal(foot.status,'unknown');
  const other=normalizeFeedbackRequest(request([{index:35,code:'tracking_unknown'}],{status:'unknown',
    context:context([{index:35,expectedDirection:'hold'}])}));
  output.entries[0].text=conversationalFeedbackEvidence(other).entries[0].allowedText[0];
  assert.equal(validateFactoryFeedbackOutput(output,foot),null,'Opposite anatomical side is not interchangeable.');
  const timed=normalizeFeedbackRequest(request([{index:34,code:'timing_unknown'}],{status:'match',
    context:context([{index:34,expectedDirection:'up'}])}));
  const timing=validateFactoryFeedbackOutput(structured(conversationalFeedbackEvidence(timed).entries),timed).join(' ');
  assert.match(timing,/ending targets|completed/i);assert.match(timing,/timing.*can.t say whether/i);
  assert.equal(timed.status,'match');assert.doesNotMatch(timing,/moved too slowly|moved too quickly|timing matched/i);
});

check('Unsupported practice priorities are rejected; observed hold drift supports coordination and incomplete hand paths support range',()=>{
  const simple=[{index:33,code:'too_slow'},{index:36,code:'tracking_unknown'}];
  const limbs=[{index:33,expectedDirection:'up'},{index:36,expectedDirection:'hold'}];
  assert.equal(normalizeCoachingContext({...context(limbs),practiceFocus:'coordination'},simple),null);
  assert.equal(normalizeCoachingContext({...context(limbs),practiceFocus:'range'},simple),null);
  const coordination=attempt('coordination-retry',[{index:33,code:'too_slow'},{index:36,code:'hold_drift'}],{
    context:{...context(limbs),practiceFocus:'coordination'}});
  const coordEvidence=practiceSummaryEvidence(normalizePracticeSummaryRequest(summary(coordination)));
  const coord=validatePracticeSummaryOutput(structured(coordEvidence.conversationEntries),coordEvidence).join(' ');
  assert.match(coord,/coordinat/i);assert.match(coord,/hands.*steady feet|feet.*hands/i);assert.match(coord,/hold position/i);
  assert.doesNotMatch(coord,/afraid|fear|confidence|larger/i);
  const range=attempt('range-retry',[{index:33,code:'movement_incomplete'}],{
    context:{...context([{index:33,expectedDirection:'up'}]),practiceFocus:'range'}});
  const rangeEvidence=practiceSummaryEvidence(normalizePracticeSummaryRequest(summary(range)));
  const reach=validatePracticeSummaryOutput(structured(rangeEvidence.conversationEntries),rangeEvidence).join(' ');
  assert.match(reach,/full|complete/i);assert.match(reach,/larger/i);assert.doesNotMatch(reach,/confidence|afraid|fear|cured/i);
});

check('Final synthesis retains every selected retry and uses future pacing guidance without inventing range, confidence or an emotional cause',()=>{
  const first=attempt('paced-unclear-retry',[{index:33,code:'too_slow'},{index:36,code:'tracking_unknown'}],{status:'unknown',
    messages:['Both the measured slow hand and the unclear foot were explained in complete sentences.'],
    context:context([{index:33,expectedDirection:'up'},{index:36,expectedDirection:'hold'}])});
  const body=summary(first),normalized=normalizePracticeSummaryRequest(body),evidence=practiceSummaryEvidence(normalized);
  assert.equal(evidence.transcript.length,6);assert.deepEqual(evidence.transcript[0].messages,first.messages);
  assert.deepEqual(evidence.transcript[0].context,first.context);assert.equal(evidence.matched,5);assert.equal(evidence.unknown,1);
  const model=structured(evidence.conversationEntries),messages=validatePracticeSummaryOutput(model,evidence),text=messages.join(' ');
  assert.equal(messages.length,3);assert.match(text,/teacher.*rhythm|rhythm.*teacher/i);assert.match(text,/unclear|reliable/i);
  assert.doesNotMatch(text,/larger|small movement|confidence|afraid|fear|nervous|\b\d+ attempts?\b/i);
  model.entries[1].text='Your movement was small because you were afraid; be more confident.';
  assert.equal(validatePracticeSummaryOutput(model,evidence),null);
});

{
  const raw=request([{index:34,code:'off_guide'}],{context:context([{index:34,expectedDirection:'up',observedDirection:'right'}])});
  let sent;
  const messages=validateFactoryFeedbackOutput(structured(conversationalFeedbackEvidence(normalizeFeedbackRequest(raw)).entries),normalizeFeedbackRequest(raw));
  const client=createPracticeAiFeedback({fetchImpl:async(_url,options)=>{
    sent=JSON.parse(options.body);return{ok:true,json:async()=>({source:'factory',attemptId:raw.attemptId,stepId:raw.stepId,status:raw.status,messages})};
  }});
  const result=await client.request({...raw,landmarks:['SOFTWARE private fixture stripped']});
  assert.deepEqual(sent.context,raw.context);assert.deepEqual(result.messages,messages);assert.equal(result.status,'mismatch');
  assert.doesNotMatch(JSON.stringify(sent),/landmarks|SOFTWARE private/);client.cancel();
  checks.push('The browser AI client sends sanitized movement context and receives conversational paragraphs without grading authority or raw observations.');
}

await mkdir('artifacts/conversational-coaching-review',{recursive:true});
await writeFile('artifacts/conversational-coaching-review/verification.json',JSON.stringify({
  provenance:'Constructed reviews, direction annotations, fetch and complete-history fixtures; no live Factory, webcam, learner or hardware.',
  passed:true,checks:checks.length,details:checks},null,2)+'\n');
console.log(JSON.stringify({passed:true,checks:checks.length,report:'artifacts/conversational-coaching-review/verification.json'}));
