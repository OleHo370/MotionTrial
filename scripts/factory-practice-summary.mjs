// Summaries use the complete retained attempt history, never camera frames or
// landmarks. Every sentence offered to Droid is generated from recorded facts.
const names={15:'Left hand',16:'Right hand',27:'Left foot',28:'Right foot',33:'Left hand',34:'Right hand',35:'Left foot',36:'Right foot'};
const stepIds=['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05'];
const measuredCodes=['too_fast','too_slow','late_start','off_guide','hold_drift','endpoint_unreached','movement_incomplete'];
const unknownCodes=['reference_unknown','tracking_unknown','attempt_incomplete','timing_unknown'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f<>]/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
const words=value=>value.trim().split(/\s+/).filter(Boolean).length;
const canonicalStep=value=>stepIds.includes(value)?value:Number.isInteger(value)&&value>=1&&value<=5?stepIds[value-1]:null;

export function normalizePracticeSummaryRequest(value){
  if(!object(value)||!keys(value,['sessionId','attempts','results'])||!id(value.sessionId)
    ||!Array.isArray(value.attempts)||value.attempts.length>200
    ||!Array.isArray(value.results)||value.results.length>5)return null;
  const attempts=[],seenAttempts=new Set(),results=[],seenResults=new Set();
  for(const source of value.attempts){
    const stepId=canonicalStep(source?.stepId);
    if(!object(source)||!keys(source,['attemptId','stepId','status','messages','issues'])||!id(source.attemptId)
      ||seenAttempts.has(source.attemptId)||!stepId||!['match','mismatch','unknown'].includes(source.status)
      ||!Array.isArray(source.messages)||!source.messages.length||source.messages.length>8
      ||!source.messages.every(message=>text(message,600))||source.messages.join(' ').length>2400
      ||words(source.messages.join(' '))>200||!Array.isArray(source.issues)||source.issues.length>16)return null;
    const issues=[],seenIssues=new Set();
    for(const issue of source.issues){
      if(!object(issue)||!keys(issue,['index','code'])||![...measuredCodes,...unknownCodes].includes(issue.code)
        ||!(issue.index==null||Number.isInteger(issue.index)&&Object.hasOwn(names,issue.index)))return null;
      if((measuredCodes.includes(issue.code)||issue.code==='timing_unknown')&&issue.index==null)return null;
      const identity=`${names[issue.index]??'general'}:${issue.code}`;
      if(seenIssues.has(identity))return null;
      seenIssues.add(identity);issues.push({index:issue.index??null,code:issue.code,limb:names[issue.index]??null});
    }
    seenAttempts.add(source.attemptId);attempts.push({attemptId:source.attemptId,stepId,status:source.status,messages:[...source.messages],issues});
  }
  for(const source of value.results){
    const stepId=canonicalStep(source?.stepId);
    if(!object(source)||!keys(source,['stepId','status'])||!stepId||seenResults.has(stepId)
      ||!['matched','manual'].includes(source.status))return null;
    // A manually skipped step is not evidence of a successful motion.
    if(source.status==='matched'&&!attempts.some(attempt=>attempt.stepId===stepId&&attempt.status==='match'))return null;
    seenResults.add(stepId);results.push({stepId,status:source.status});
  }
  return{sessionId:value.sessionId,attempts,results};
}

const countText=count=>`${count} ${count===1?'attempt':'attempts'}`;
const list=values=>values.length<3?values.join(' and '):`${values.slice(0,-1).join(', ')} and ${values.at(-1)}`;
function describeSteps(values){
  const sorted=[...new Set(values)].sort((left,right)=>left-right),ranges=[];
  for(let index=0;index<sorted.length;index++){
    const first=sorted[index];let last=first;
    while(sorted[index+1]===last+1)last=sorted[++index];
    ranges.push(first===last?`${first}`:`${first}–${last}`);
  }
  return`${sorted.length===1?'step':'steps'} ${list(ranges)}`;
}
const fragments={
  too_fast:count=>`moved too quickly in ${countText(count)}`,
  too_slow:count=>`moved too slowly in ${countText(count)}`,
  late_start:count=>`started late in ${countText(count)}`,
  off_guide:count=>`left the progress beam in ${countText(count)}`,
  hold_drift:count=>`drifted from its hold position in ${countText(count)}`,
  endpoint_unreached:count=>`missed its target triangle in ${countText(count)}`,
  movement_incomplete:count=>`left its movement unfinished in ${countText(count)}`,
};
const corrections={too_fast:'Follow the teacher\'s pace more closely.',too_slow:'Follow the teacher\'s pace more closely.',
  late_start:'Begin moving when the teacher begins.',off_guide:'Keep it within the beam as you move.',
  hold_drift:'Keep it steady at the hold position.',endpoint_unreached:'Move it fully into the target triangle.',
  movement_incomplete:'Follow the whole movement through to its target.'};

export function practiceSummaryEvidence(request){
  const matched=request.results.filter(result=>result.status==='matched').length;
  const manual=request.results.filter(result=>result.status==='manual').length;
  const unknown=request.attempts.filter(attempt=>attempt.status==='unknown').length;
  const uncertainTiming=request.attempts.filter(attempt=>attempt.status==='match'
    &&(attempt.issues.some(issue=>issue.code==='timing_unknown')
      ||attempt.messages.some(message=>/^(Left|Right) (hand|foot): timing unclear\.$/.test(message)))).length;
  const attemptedSteps=new Set(request.attempts.map(attempt=>attempt.stepId));
  const repeatAttempts=request.attempts.length-attemptedSteps.size;
  const previouslyCorrected=new Set(),laterReachedSteps=new Set();
  for(const attempt of request.attempts){
    if(['mismatch','unknown'].includes(attempt.status)&&attempt.issues.some(issue=>issue.limb&&measuredCodes.includes(issue.code)))
      previouslyCorrected.add(attempt.stepId);
    else if(attempt.status==='match'&&previouslyCorrected.has(attempt.stepId))
      laterReachedSteps.add(stepIds.indexOf(attempt.stepId)+1);
  }
  const history=request.attempts.length
    ?`You received feedback on ${countText(request.attempts.length)} across ${attemptedSteps.size} ${attemptedSteps.size===1?'step':'steps'}${repeatAttempts?`, including ${repeatAttempts} repeat ${repeatAttempts===1?'attempt':'attempts'}`:''}. `
    :'No attempt feedback was recorded. ';
  // A later matching attempt establishes target completion only. It does not
  // establish that an earlier timing error was subsequently measured/resolved.
  const progression=laterReachedSteps.size
    ?` After earlier corrections, later attempts reached the targets in ${describeSteps([...laterReachedSteps])}.`:'';
  const entries=[{entryId:'completion',kind:'completion',allowedText:[
    `${history}You completed ${matched} of the five steps with matching feedback.${manual?` You moved past ${manual} ${manual===1?'step':'steps'} manually.`:''}${progression}`,
    `${history}Matching feedback confirmed completion of ${matched} of the five steps.${manual?` Another ${manual} ${manual===1?'step was':'steps were'} advanced manually.`:''}${progression}`,
  ]}];
  const grouped=new Map();
  for(const attempt of request.attempts){
    if(!['mismatch','unknown'].includes(attempt.status))continue;
    for(const issue of attempt.issues){
      if(!issue.limb||!measuredCodes.includes(issue.code))continue;
      if(!grouped.has(issue.limb))grouped.set(issue.limb,new Map());
      const counts=grouped.get(issue.limb),record=counts.get(issue.code)??{count:0,steps:new Set()};
      record.count++;record.steps.add(stepIds.indexOf(attempt.stepId)+1);counts.set(issue.code,record);
    }
  }
  for(const limb of ['Left hand','Right hand','Left foot','Right foot']){
    const counts=grouped.get(limb);if(!counts)continue;
    const facts=[...counts].map(([code,record])=>({code,count:record.count,steps:[...record.steps].sort()}));
    const ordered=[...facts].sort((left,right)=>right.count-left.count||measuredCodes.indexOf(left.code)-measuredCodes.indexOf(right.code));
    const stepContext=describeSteps(facts.flatMap(fact=>fact.steps));
    const describe=values=>values.map((fact,index)=>`${index?'It':`During ${stepContext}, your ${limb.toLowerCase()}`} ${fragments[fact.code](fact.count)}.`).join(' ');
    // Both alternatives contain every recorded issue for this limb. Droid can
    // put recurrent feedback first, but cannot omit or invent a correction.
    const focus=corrections[ordered[0].code],correction=`Next time, ${focus[0].toLowerCase()}${focus.slice(1)}`;
    entries.push({entryId:`limb-${limb.toLowerCase().replace(' ','-')}`,kind:'limb',limb,facts,allowedText:[
      `${describe(ordered)} ${correction}`,
      `${describe(facts)} ${correction}`,
    ]});
  }
  if(unknown||uncertainTiming){
    const sentences=[];
    if(unknown)sentences.push(`${unknown} ${unknown===1?'attempt contained':'attempts contained'} unclear tracking or incomplete evidence. Those unclear observations were kept separate from measured movement mistakes.`);
    if(uncertainTiming)sentences.push(`${uncertainTiming} ${uncertainTiming===1?'completed attempt reached':'completed attempts reached'} the targets while timing was unclear.`);
    entries.push({entryId:'uncertainty',kind:'uncertainty',allowedText:[sentences.join(' ')]});
  }else if(!grouped.size){
    entries.push({entryId:'next-practice',kind:'next-practice',allowedText:[
      'No specific hand or foot corrections were recorded in the completed feedback. Keep following the teacher and reaching each target on your next practice.',
      'The recorded feedback did not identify a specific hand or foot correction. Continue matching the demonstration and reaching the targets in your next practice.',
    ]});
  }
  return{matched,manual,unknown,uncertainTiming,attemptCount:request.attempts.length,repeatAttempts,
    laterReachedSteps:[...laterReachedSteps].sort((left,right)=>left-right),entries,
    transcript:request.attempts.map(({attemptId,stepId,status,messages})=>({attemptId,stepId,status,messages}))};
}

export function practiceSummaryOutputSchema(evidence){
  return{type:'object',properties:{entries:{type:'array',minItems:evidence.entries.length,maxItems:evidence.entries.length,
    items:{oneOf:evidence.entries.map(entry=>({type:'object',properties:{entryId:{const:entry.entryId},
      text:{type:'string',enum:[...new Set(entry.allowedText)]}},required:['entryId','text'],additionalProperties:false}))}}},
    required:['entries'],additionalProperties:false};
}

export function validatePracticeSummaryOutput(output,evidence){
  if(!object(output)||!keys(output,['entries'])||!Array.isArray(output.entries)||output.entries.length!==evidence.entries.length)return null;
  const supplied=new Map(evidence.entries.map(entry=>[entry.entryId,entry])),accepted=new Map();
  for(const entry of output.entries){
    if(!object(entry)||!keys(entry,['entryId','text'])||accepted.has(entry.entryId)
      ||!supplied.get(entry.entryId)?.allowedText.includes(entry.text))return null;
    accepted.set(entry.entryId,entry.text);
  }
  const messages=evidence.entries.map(entry=>accepted.get(entry.entryId)),joined=messages.join(' ');
  return messages.length>0&&messages.length<=6&&messages.every(message=>text(message,800))&&joined.length<=3600&&words(joined)<=350?messages:null;
}

export function localPracticeSummary(request,reason='factory-not-configured'){
  const evidence=practiceSummaryEvidence(request);
  const messages=evidence.entries.map(entry=>entry.allowedText[0]);
  return{source:'local',sessionId:request.sessionId,messages,reason};
}
