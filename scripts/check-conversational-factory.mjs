/** Constructed presentation facts only. No Factory API, camera, audio or USB. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {normalizeFeedbackRequest,validateFactoryFeedbackOutput} from './factory-practice-feedback.mjs';
import {normalizePracticeSummaryRequest,practiceSummaryEvidence,practiceSummaryOutputSchema,
  validatePracticeSummaryOutput,localPracticeSummary} from './factory-practice-summary.mjs';
import {coachingContextVersion,normalizeCoachingContext,conversationalFeedbackEvidence,
  coachingOutputSchema,validateCoachingOutput} from './factory-conversational-coaching.mjs';
const checks=[];
const check=(name,run)=>{run();checks.push(name);console.log(`PASS: ${name}`);};
const context=(limbs,practiceFocus)=>({version:coachingContextVersion,limbs,...(practiceFocus?{practiceFocus}:{})});
const feedback=(changes={})=>({attemptId:'constructed-feedback',stepId:'first-three-03',status:'mismatch',
  messages:['Constructed measured feedback.'],issues:[{index:33,code:'too_slow'},{index:34,code:'too_slow'},{index:34,code:'off_guide'}],
  context:context([{index:33,expectedDirection:'up'},{index:34,expectedDirection:'up',observedDirection:'right'}]),...changes});
const structured=entries=>({entries:entries.map(entry=>({entryId:entry.entryId,text:entry.allowedText[0]}))});
const attempt=(attemptId,changes={})=>({attemptId,stepId:'first-three-03',status:'mismatch',messages:['Constructed prior feedback.'],
  issues:[{index:33,code:'too_slow'}],context:context([{index:33,expectedDirection:'up'}]),...changes});
const summary=attempts=>normalizePracticeSummaryRequest({sessionId:'constructed-session',attempts,results:[]});
const narrative=attempts=>{const request=summary(attempts);assert.ok(request);return practiceSummaryEvidence(request);};

check('Known beam direction groups shared bilateral pace issues into a main idea without repeating them',()=>{
  const request=normalizeFeedbackRequest(feedback());assert.ok(request);
  const evidence=conversationalFeedbackEvidence(request);assert.equal(evidence.entries.length,2);
  const text=evidence.entries[0].allowedText.join(' ');assert.match(text,/Both hands/);assert.match(text,/upward/);
  assert.equal(evidence.entries[0].facts.issueIds.length,2);assert.equal(evidence.entries[1].facts.indices[0],34);
  const messages=validateFactoryFeedbackOutput(structured(evidence.entries),request);assert.equal(messages.length,2);
  assert.doesNotMatch(messages.join(' '),/left hand moved too slowly.*right hand moved too slowly/i);
});
check('Observed wrong-way movement is only described with a measured guide deviation and verified direction context',()=>{
  const request=normalizeFeedbackRequest(feedback()),entries=conversationalFeedbackEvidence(request).entries;
  assert.match(entries[1].allowedText[0],/right hand drifted sideways instead of following the upward guide/i);
  assert.doesNotMatch(entries[1].allowedText.join(' '),/to (?:your|the) right|leftward|rightward/);
  const noObserved=normalizeFeedbackRequest(feedback({context:context([{index:33,expectedDirection:'up'},{index:34,expectedDirection:'up'}])}));
  assert.ok(conversationalFeedbackEvidence(noObserved).entries[1].allowedText.every(text=>!text.includes('drifted sideways')));
  assert.equal(normalizeFeedbackRequest(feedback({issues:[{index:34,code:'too_slow'}]})),null);
  assert.equal(normalizeCoachingContext(context([{index:34,expectedDirection:'up',observedDirection:'invented'}]),[{index:34,code:'off_guide'}]),null);
});
check('Context validation rejects raw observations, duplicate limb aliases, unsupported focus and incompatible fields',()=>{
  for(const value of [context([{index:33,expectedDirection:'up',landmarks:[]}]),
    context([{index:33,expectedDirection:'up'},{index:15,expectedDirection:'up'}]),
    context([{index:null,expectedDirection:'up'}]),context([{index:'33',expectedDirection:'up'}]),
    context([{index:'__proto__',expectedDirection:'up'}]),
    {...context([]),version:'invented-version'},context([{index:33,expectedDirection:'made-up'}]),
    {...context([]),frames:[]},context([{index:33,expectedDirection:'up'}],'coordination'),
    context([{index:33,expectedDirection:'up'}],'range')])assert.equal(normalizeCoachingContext(value,[{index:33,code:'too_slow'}]),null);
});
check('Structured conversational output rejects invented words, changed sides, extra claims and omitted priorities',()=>{
  const request=normalizeFeedbackRequest(feedback()),entries=conversationalFeedbackEvidence(request).entries,valid=structured(entries);
  assert.deepEqual(validateCoachingOutput(valid,entries),entries.map(entry=>entry.allowedText[0]));
  for(const invalid of [{...valid,score:99},{entries:valid.entries.slice(1)},
    {entries:[...valid.entries,valid.entries[0]]},
    {entries:valid.entries.map((entry,index)=>index?entry:{...entry,text:entry.text.replace('Both hands','Both feet')})},
    {entries:valid.entries.map((entry,index)=>index?entry:{...entry,text:'You were nervous and afraid to lift your hands.'})}])
    assert.equal(validateCoachingOutput(invalid,entries),null);
  assert.equal(coachingOutputSchema(entries).properties.entries.minItems,2);
});
check('Unclear evidence is conversational but cannot become an observed speed or direction error',()=>{
  const request=normalizeFeedbackRequest(feedback({status:'unknown',issues:[{index:36,code:'tracking_unknown'}],
    context:context([{index:36,expectedDirection:'hold'}])}));
  const entries=conversationalFeedbackEvidence(request).entries,all=entries.flatMap(entry=>entry.allowedText).join(' ');
  assert.match(all,/right foot/);assert.match(all,/couldn't|lost a clear view/);
  assert.doesNotMatch(all,/too fast|too slow|drifted sideways|confident|fear|larger/);
});
check('A single bilateral pace issue is not presented as a recurring timing problem or a range limitation',()=>{
  const evidence=narrative([attempt('once',{issues:[{index:33,code:'too_slow'},{index:34,code:'too_slow'}],
    context:context([{index:33,expectedDirection:'up'},{index:34,expectedDirection:'up'}])})]);
  const joined=evidence.conversationEntries.flatMap(entry=>entry.allowedText).join(' ');
  assert.match(joined,/teacher’s rhythm|teacher's rhythm/);assert.doesNotMatch(joined,/across several attempts|more than once|larger|fear|confident/i);
  const repeat=narrative([attempt('one'),attempt('two')]);assert.match(repeat.conversationEntries[1].allowedText[0],/across several attempts/);
});
check('A single left-hand pace correction cannot be generalized to the unassessed right hand or feet',()=>{
  const evidence=narrative([attempt('left-only',{issues:[{index:33,code:'too_slow'}],
    context:context([{index:33,expectedDirection:'up'},{index:34,expectedDirection:'up'}])})]);
  const priority=evidence.conversationEntries[1].allowedText.join(' ');
  assert.match(priority,/left hand/);assert.doesNotMatch(priority,/your hands|right hand|your feet/);
  const mixed=narrative([attempt('left-hand-foot',{issues:[{index:33,code:'too_slow'},{index:35,code:'late_start'}],
    context:context([{index:33,expectedDirection:'up'},{index:35,expectedDirection:'left'}])})]);
  assert.match(mixed.conversationEntries[1].allowedText[1],/timing of your left hand and left foot/);
  assert.doesNotMatch(mixed.conversationEntries[1].allowedText.join(' '),/right hand|right foot|your hands and feet/);
});
check('Hand and foot coordination advice requires drift in a held limb plus a supported moving counterpart',()=>{
  const coordination=context([{index:33,expectedDirection:'up'},{index:34,expectedDirection:'up'},
    {index:35,expectedDirection:'hold'},{index:36,expectedDirection:'hold'}],'coordination');
  const record=attempt('coordination',{issues:[{index:36,code:'hold_drift'}],context:coordination});
  const evidence=narrative([record]),joined=evidence.conversationEntries.flatMap(entry=>entry.allowedText).join(' ');
  assert.match(joined,/coordinating.*hands.*feet/);assert.match(joined,/right foot drift/);
  assert.doesNotMatch(joined,/left foot drift|fear|balance disorder|larger/i);
  assert.equal(summary([{...record,issues:[{index:36,code:'tracking_unknown'}]}]),null);
});
check('Curved moving routes support focus without pretending that their direction was a simple raise or lower',()=>{
  const coordination=attempt('mixed-coordination',{issues:[{index:36,code:'hold_drift'}],
    context:context([{index:33,expectedDirection:'mixed'},{index:36,expectedDirection:'hold'}],'coordination')});
  const range=attempt('mixed-range',{issues:[{index:33,code:'movement_incomplete'}],
    context:context([{index:33,expectedDirection:'mixed'}],'range')});
  assert.ok(summary([coordination]));assert.ok(summary([range]));
  const unclearHeld={...coordination,issues:[...coordination.issues,{index:36,code:'tracking_unknown'}]};
  const unclearMoving={...coordination,issues:[...coordination.issues,{index:33,code:'tracking_unknown'}]};
  const unclearRange={...range,issues:[...range.issues,{index:33,code:'tracking_unknown'}]};
  for(const record of [unclearHeld,unclearMoving,unclearRange])assert.equal(summary([record]),null);
  assert.equal(normalizeFeedbackRequest(feedback({issues:[{index:34,code:'off_guide'},{index:34,code:'tracking_unknown'}]})),null);
});
check('Full hand-path practice and comfortable larger movement are offered only for a measured incomplete or unreached path',()=>{
  const record=attempt('range',{issues:[{index:33,code:'movement_incomplete'}],
    context:context([{index:33,expectedDirection:'up'}],'range')});
  const evidence=narrative([record]),joined=evidence.conversationEntries.flatMap(entry=>entry.allowedText).join(' ');
  assert.match(joined,/comfortably larger|complete hand path|full hand path/i);
  assert.doesNotMatch(joined,/nervous|fear|afraid|confident|patient|rehabilit/i);
  assert.equal(summary([{...record,issues:[{index:33,code:'too_slow'}]}]),null);
  assert.equal(summary([{...record,issues:[{index:33,code:'tracking_unknown'}],status:'unknown'}]),null);
});
check('Three future-oriented summary paragraphs avoid reciting attempt numbers while all earlier wording stays in evidence',()=>{
  const records=[attempt('early'),attempt('retry'),attempt('success',{status:'match',issues:[],messages:['Constructed completion.']})];
  const request=normalizePracticeSummaryRequest({sessionId:'full-history',attempts:records,
    results:[{stepId:'first-three-03',status:'matched'}]});
  assert.ok(request);const evidence=practiceSummaryEvidence(request),messages=validatePracticeSummaryOutput(structured(evidence.conversationEntries),evidence);
  assert.equal(messages.length,3);assert.deepEqual(evidence.transcript.map(entry=>entry.messages),records.map(entry=>entry.messages));
  assert.deepEqual(evidence.conversationEntries.map(entry=>entry.kind),['takeaway','priority','nextPractice']);
  assert.equal(practiceSummaryOutputSchema(evidence).properties.entries.minItems,3);
  assert.doesNotMatch(messages.join(' '),/\b\d+ attempts?\b|timing improved|pace corrected|perfect|resolved/i);
  assert.deepEqual(localPracticeSummary(request).messages,messages);
  assert.ok(messages.join(' ').split(/\s+/).length<=350);assert.ok(messages.every(text=>text.length<=800));
});
check('A later target match cannot resolve previous missing timing, and manual navigation cannot become a verified completion',()=>{
  const records=[attempt('retry'),attempt('matched',{status:'match',issues:[{index:33,code:'timing_unknown'}],
    messages:['Constructed matched targets with unclear timing.']})];
  const request=normalizePracticeSummaryRequest({sessionId:'limited-match',attempts:records,
    results:[{stepId:'first-three-03',status:'matched'},{stepId:'first-three-01',status:'manual'}]});
  const evidence=practiceSummaryEvidence(request),joined=evidence.conversationEntries.flatMap(entry=>entry.allowedText).join(' ');
  assert.match(joined,/unverified|have not been confirmed/);assert.match(joined,/still unassessed/);
  assert.doesNotMatch(joined,/timing improved|pace corrected|perfect|resolved|every step/i);
});
check('Timing-only uncertainty does not invent a camera view problem or a measured speed mistake',()=>{
  const records=[attempt('timing-only',{status:'match',issues:[{index:33,code:'timing_unknown'}],
    messages:['Constructed matched targets with timing unassessed.']})];
  const evidence=narrative(records),joined=evidence.conversationEntries.flatMap(entry=>entry.allowedText).join(' ');
  assert.match(joined,/not enough timing|pace remained unassessed/);
  assert.doesNotMatch(joined,/clearer camera|camera view|keep.*visible|camera held steady|timing improved|camera fault/i);
  const reference=narrative([attempt('reference-only',{status:'unknown',issues:[{index:null,code:'reference_unknown'}]})]);
  assert.match(reference.conversationEntries[1].allowedText[0],/movement reference was not available/);
  assert.doesNotMatch(reference.conversationEntries.flatMap(entry=>entry.allowedText).join(' '),/clearer camera|camera view/);
  const incomplete=narrative([attempt('incomplete-only',{status:'unknown',issues:[{index:null,code:'attempt_incomplete'}]})]);
  assert.match(incomplete.conversationEntries[1].allowedText[0],/attempt ended before/);
  assert.doesNotMatch(incomplete.conversationEntries.flatMap(entry=>entry.allowedText).join(' '),/clearer camera|camera view/);
  const generic=narrative([attempt('unspecified-unknown',{status:'unknown',issues:[]})]);
  assert.match(generic.conversationEntries[1].allowedText[0],/not contain enough reliable movement evidence/);
  assert.doesNotMatch(generic.conversationEntries.flatMap(entry=>entry.allowedText).join(' '),/clearer camera|camera view/);
});
check('Summary direction cannot be borrowed from an unaffected partner limb or collapse conflicting correction paths',()=>{
  const unrelated=attempt('unrelated-up',{issues:[{index:33,code:'off_guide'}],
    context:context([{index:33,expectedDirection:'mixed'},{index:34,expectedDirection:'up'}])});
  const unrelatedEvidence=narrative([unrelated]);
  assert.doesNotMatch(unrelatedEvidence.conversationEntries[1].allowedText.join(' '),/guide went upward/);
  const up=attempt('corrected-up',{issues:[{index:33,code:'off_guide'}],context:context([{index:33,expectedDirection:'up'}])});
  const down=attempt('corrected-down',{issues:[{index:33,code:'off_guide'}],context:context([{index:33,expectedDirection:'down'}])});
  const conflict=narrative([up,down]);assert.doesNotMatch(conflict.conversationEntries[1].allowedText.join(' '),/guide went upward|guide went downward/);
  const supported=narrative([up]);assert.match(supported.conversationEntries[1].allowedText[0],/left hand.*guide went upward/);
});
check('Dense combined corrections stay inside the speech bounds and keep actual uncertainty separate',()=>{
  const issues=[33,34,35,36].flatMap(index=>['too_fast','off_guide','hold_drift','endpoint_unreached'].map(code=>({index,code})));
  const request=normalizeFeedbackRequest(feedback({issues,context:context([33,34,35,36].map(index=>({index,expectedDirection:'mixed'})))}));
  const entries=conversationalFeedbackEvidence(request).entries;assert.ok(entries.length<=3);
  for(let variant=0;variant<3;variant++){
    const output={entries:entries.map(entry=>({entryId:entry.entryId,text:entry.allowedText[variant%entry.allowedText.length]}))};
    assert.ok(validateCoachingOutput(output,entries));
  }
});
await mkdir('artifacts/conversational-factory-review',{recursive:true});
await writeFile('artifacts/conversational-factory-review/verification.json',JSON.stringify({passed:true,checks:checks.length,
  provenance:'Constructed typed presentation facts only; no live Factory, camera, audio or hardware.',details:checks},null,2)+'\n');
console.log(JSON.stringify({passed:true,checks:checks.length,report:'artifacts/conversational-factory-review/verification.json'}));
