// Deterministic presentation checks use constructed review evidence. No live
// learner, camera, physical speaker or paid AI service is exercised here.
import assert from 'node:assert/strict';
import {descriptivePracticeFeedback,practiceAiWordingIssues} from '../public/practice-descriptive-feedback.js';
import {createPracticeAiFeedback} from '../public/practice-ai-feedback.js';
import {createPracticeSessionHistory,localPracticeSessionSummary,practiceSummaryPayload}
  from '../public/practice-session-summary.js';

const checks=[];
const issue=(index,code,extra={})=>({index,code,...extra});
const review=(status,issues=[],limbs=[])=>({status,passed:status==='match',issues,limbs,
  percent:null,rulesVersion:'constructed-review-fixture',elapsedMs:3140,
  messages:['Constructed legacy review wording.'],reason:'Constructed legacy review wording.'});

{
  const original=review('unknown',[issue(28,'tracking_unknown')],[{index:28,moving:true,timingAssessed:false}]);
  const before=structuredClone(original),result=descriptivePracticeFeedback(original);
  assert.deepEqual(original,before,'Presentation must not mutate the grader result.');
  for(const key of ['status','passed','issues','limbs','percent','rulesVersion','elapsedMs'])
    assert.deepEqual(result[key],before[key],`Measured ${key} is unchanged.`);
  assert.deepEqual(result.messages,[
    'The camera could not clearly track your right foot throughout this attempt. Keep that foot visible from start to finish before trying again.'
  ]);
  assert.doesNotMatch(result.messages.join(' '),/too (?:fast|slow)|moved faster|movement is complete/);
  assert.equal(result.feedbackStyle,'compact');assert.equal(result.speechStyle,'descriptive');
  checks.push('Unclear right-foot tracking becomes a complete, actionable sentence without inventing a movement mistake or changing the unknown result.');
}

{
  const original=review('match',[],[{index:35,moving:false,timingAssessed:false},
    {index:36,moving:true,timingAssessed:false},{index:34,moving:true,timingAssessed:true}]);
  const result=descriptivePracticeFeedback(original);
  assert.deepEqual(result.messages,[
    'You reached all ending targets. This movement is complete.',
    'The timing of your right foot could not be determined in this attempt, so its speed was not assessed.'
  ]);
  assert.deepEqual(original.issues,[]);assert.equal(result.status,'match');
  assert.deepEqual(practiceAiWordingIssues(original),[issue(36,'timing_unknown')]);
  assert.equal(result.messages[0].split(/\s+/).length,9,'Ordinary match text retains a short reading interval.');
  checks.push('An accepted endpoint result retains its match and separately explains unavailable moving-foot timing without diagnosing speed.');
}

{
  const original=review('mismatch',[issue(15,'too_fast'),issue(33,'too_fast'),issue(28,'off_guide')],
    [{index:15,moving:true,timingAssessed:false},{index:28,moving:true,timingAssessed:false}]);
  assert.deepEqual(practiceAiWordingIssues(original),[
    issue(33,'too_fast'),issue(36,'off_guide'),issue(36,'timing_unknown')
  ]);
  const result=descriptivePracticeFeedback(original);
  assert.equal(result.messages.length,2);
  assert.equal((result.messages.join(' ').match(/Your left hand moved faster/g)??[]).length,1);
  assert.match(result.messages[1],/right foot moved outside.*right foot.*speed was not assessed/);
  assert.equal(result.issues.length,3,'Canonical wording deduplication must not remove grader issues.');
  checks.push('Legacy and current indices deduplicate only the wording annotations; measured speed and guide errors remain factual and preserve original evidence.');
}

{
  for(const [code,pattern]of [['tracking_unknown',/could not clearly track this attempt/],
    ['reference_unknown',/targets were unavailable/],['attempt_incomplete',/Reach all of the ending triangles/]]){
    const result=descriptivePracticeFeedback(review('unknown',[issue(null,code)]));
    assert.match(result.messages[0],pattern);assert.doesNotMatch(result.messages[0],/Your (?:left|right)/);
  }
  const framing=descriptivePracticeFeedback(review('unknown',[
    issue(null,'tracking_unknown',{message:'The camera framing changed. Set up again.'})
  ]));
  assert.match(framing.messages[0],/framing changed.*keep the camera still/);
  assert.deepEqual(practiceAiWordingIssues(review('unknown',[issue(99,'invented_code')])),[]);
  checks.push('General uncertainty and missing reference or incomplete-attempt messages state their limitation without inventing an anatomical cause.');
}

{
  for(const [message,pattern]of [
    ['Camera stopped or changed.',/camera stopped or changed.*Restart the camera/],
    ['Camera unavailable.',/camera is unavailable.*Start the camera/],
    ['Tutorial playback interrupted.',/tutorial playback was interrupted.*Replay this movement/]
  ]){
    const result=descriptivePracticeFeedback({...review('unknown'),messages:[message],reason:message});
    assert.match(result.messages[0],pattern);assert.equal(result.status,'unknown');
  }
  assert.deepEqual(practiceAiWordingIssues({...review('unknown'),messages:['Camera unavailable.']}),[]);
  checks.push('Camera loss and tutorial interruptions retain precise full-sentence local explanations and require no AI issue inference.');
}

{
  const payload={attemptId:'constructed-uncertain-foot',stepId:'first-three-01',status:'unknown',
    messages:['Right foot: tracking unclear.'],issues:[issue(36,'tracking_unknown')]};
  let captured;
  const client=createPracticeAiFeedback({fetchImpl:async(url,options)=>{
    captured={url,body:JSON.parse(options.body)};
    return {ok:true,json:async()=>({...payload,source:'factory',messages:[
      'The camera could not clearly track your right foot throughout this attempt. Keep that foot visible from start to finish before trying again.'
    ]})};
  }});
  const result=await client.request({...payload,landmarks:['ignored constructed data']});
  assert.equal(result.source,'factory');assert.equal(result.status,'unknown');
  assert.deepEqual(captured.body,payload);assert.equal(captured.url,'/api/practice-feedback');
  assert.equal(Object.hasOwn(result,'issues'),false,'AI wording does not supply new grading evidence.');
  client.cancel();
  checks.push('The AI client accepts full uncertainty wording with unchanged attempt identity and strips unrelated constructed fields before sending.');
}

{
  const payload={attemptId:'constructed-timing',stepId:'first-three-02',status:'match',
    messages:['Targets reached.','Right foot: timing unclear.'],issues:[issue(36,'timing_unknown')]};
  let count=0,replyCount=6;
  const client=createPracticeAiFeedback({fetchImpl:async()=>{
    count++;return {ok:true,json:async()=>({...payload,source:'factory',
      messages:Array.from({length:replyCount},()=> 'The timing of your right foot was not assessed.')})};
  }});
  assert.equal((await client.request(payload)).messages.length,6);
  replyCount=7;assert.equal(await client.request(payload),null);
  replyCount=1;assert.equal(await client.request({...payload,issues:[issue(null,'timing_unknown')]}),null);
  assert.equal(count,2,'Unidentified timing uncertainty is rejected before a request.');
  client.cancel();
  checks.push('Up to six bounded feedback paragraphs are accepted; excessive responses and timing uncertainty without an identified limb are rejected.');
}

{
  const history=createPracticeSessionHistory({sessionId:'constructed-session'});
  const local=descriptivePracticeFeedback(review('match',[],[{index:36,moving:true,timingAssessed:false}]));
  assert.equal(history.record({attemptId:'constructed-review-1',stepId:'first-three-01',status:local.status,
    messages:local.messages,issues:practiceAiWordingIssues(local)}),true);
  const payload=history.snapshot([{stepId:'first-three-01',status:'matched'}]);
  assert.deepEqual(practiceSummaryPayload(payload),payload);
  const result=localPracticeSessionSummary(payload);
  assert.match(result.messages.join(' '),/One completed attempt reached the targets while timing was unclear/);
  assert.doesNotMatch(result.messages.join(' '),/moved too fast|moved too slowly/);
  assert.equal(practiceSummaryPayload({...payload,attempts:[{...payload.attempts[0],issues:[issue(null,'timing_unknown')]}]}),null);
  checks.push('Descriptive and AI timing wording retains its grounded uncertainty annotation in the final summary without becoming an observed speed problem.');
}

{
  const history=createPracticeSessionHistory({sessionId:'constructed-mixed-session'});
  const original=review('unknown',[issue(33,'too_fast'),issue(36,'tracking_unknown')]);
  const local=descriptivePracticeFeedback(original);
  history.record({attemptId:'constructed-mixed-review',stepId:'first-three-01',status:local.status,
    messages:local.messages,issues:practiceAiWordingIssues(local)});
  const summary=localPracticeSessionSummary(history.snapshot());
  assert.match(summary.messages.join(' '),/left hand moved too fast/);
  assert.match(summary.messages.join(' '),/Those unclear observations were kept separate from measured movement mistakes/);
  assert.doesNotMatch(summary.messages.join(' '),/right foot moved too fast|right foot moved too slowly/);
  checks.push('A mixed review summarizes its measured left-hand mistake while preserving separate right-foot tracking uncertainty.');
}

{
  const issues=[33,34,35,36].flatMap(index=>[
    issue(index,'movement_incomplete'),issue(index,'off_guide')
  ]);
  issues.push(issue(null,'tracking_unknown'),issue(null,'reference_unknown'),issue(null,'attempt_incomplete'));
  const limbs=[33,34,35,36].map(index=>({index,moving:true,timingAssessed:false}));
  const original=review('unknown',issues,limbs),result=descriptivePracticeFeedback(original);
  assert.ok(result.messages.join(' ').split(/\s+/).length<=200);
  assert.ok(result.messages.length<=6&&result.messages.every(message=>message.length<=600));
  for(const name of ['left hand','right hand','left foot','right foot'])
    assert.ok(result.messages.some(message=>message.includes(name)&&/did not finish its movement/.test(message)
      &&/left the progress beam/.test(message)&&/speed could not be assessed/.test(message)));
  assert.deepEqual(result.issues,original.issues);
  const history=createPracticeSessionHistory({sessionId:'constructed-dense-session'});
  assert.equal(history.record({attemptId:'constructed-dense-review',stepId:'first-six-05',status:result.status,
    messages:result.messages,issues:practiceAiWordingIssues(result)}),true);
  checks.push('Dense four-limb feedback consolidates complete sentences and corrections within the history budget while retaining every measured issue.');
}

console.log(JSON.stringify({checks:checks.length,provenance:'Constructed review, fetch and history fixtures; no live camera, speech or paid AI.',details:checks},null,2));
