// Presentation only: uncertain tracking never becomes an observed movement error.
// Keep the evaluator's status, evidence, issue codes and advancement decision.
const aliases={15:33,16:34,27:35,28:36,33:33,34:34,35:35,36:36};
const names={33:'left hand',34:'right hand',35:'left foot',36:'right foot'};
const canonicalIndex=index=>Number.isInteger(index)?aliases[index]??null:null;
const sentences=Object.freeze({
  too_fast:limb=>`Your ${limb} moved faster than the demonstration. Slow down to follow the teacher's pace.`,
  too_slow:limb=>`Your ${limb} moved more slowly than the demonstration. Move a little faster with the teacher.`,
  late_start:limb=>`Your ${limb} began moving after the teacher. Start moving sooner with the demonstration.`,
  off_guide:limb=>`Your ${limb} moved outside the progress beam. Keep it within the beam as you move.`,
  hold_drift:limb=>`Your ${limb} moved away from its hold position. Keep it steady there.`,
  endpoint_unreached:limb=>`Your ${limb} did not reach its target triangle. Move it into the triangle.`,
  movement_incomplete:limb=>`Your ${limb} did not complete its movement. Follow the whole movement on your retry.`,
  tracking_unknown:limb=>`The camera could not clearly track your ${limb} throughout this attempt. Keep that ${limb.split(' ').at(-1)} visible from start to finish before trying again.`,
  timing_unknown:limb=>`The timing of your ${limb} could not be determined in this attempt, so its speed was not assessed.`,
});
const generalCodes=new Set(['tracking_unknown','reference_unknown','attempt_incomplete']);
const timingCodes=new Set(['too_fast','too_slow','late_start']);

/** Wording evidence only. Derived timing_unknown entries do not enter grader issues. */
export function practiceAiWordingIssues(review){
  const issues=[],seen=new Set();
  const add=(index,code)=>{
    const identity=`${index??'general'}:${code}`;
    if(seen.has(identity))return;
    seen.add(identity);issues.push({index,code});
  };
  for(const issue of review?.issues??[]){
    const index=canonicalIndex(issue.index);
    if(index!==null&&Object.hasOwn(sentences,issue.code))add(index,issue.code);
    else if(generalCodes.has(issue.code))add(index,issue.code);
  }
  for(const limb of review?.limbs??[]){
    const index=canonicalIndex(limb.index);
    if(index===null||limb.moving!==true||limb.timingAssessed!==false)continue;
    // A missing timing determination is a limitation, never a speed diagnosis.
    // Do not repeat it beside a stronger uncertainty statement or contradict a
    // measured tempo issue in an inconsistent caller-supplied review.
    if(issues.some(issue=>issue.index===index
      &&(issue.code==='tracking_unknown'||timingCodes.has(issue.code))))continue;
    add(index,'timing_unknown');
  }
  return issues;
}

function generalSentence(issue){
  if(issue.code==='reference_unknown')
    return 'The movement targets were unavailable, so this attempt could not be reviewed. Replay the demonstration before trying again.';
  if(issue.code==='attempt_incomplete')
    return 'This attempt ended before the movement was complete. Reach all of the ending triangles before reviewing it.';
  if(issue.code==='tracking_unknown')return /framing changed/i.test(issue.message??'')
    ?'The camera framing changed during this attempt. Return to the starting squares and keep the camera still before trying again.'
    :'The camera could not clearly track this attempt. Keep your hands and feet visible from start to finish before trying again.';
  return null;
}

function fallbackSentence(review){
  const detail=(review?.messages??[]).join(' ')||review?.reason||review?.message||'';
  if(/camera.*(stopped|changed)/i.test(detail))
    return 'The camera stopped or changed during this attempt. Restart the camera and set up in the starting squares before trying again.';
  if(/(demonstration|tutorial|playback).*interrupted/i.test(detail))
    return 'The tutorial playback was interrupted, so this attempt could not be reviewed. Replay this movement before trying again.';
  if(/camera.*(off|unavailable)/i.test(detail))
    return 'The camera is unavailable, so this attempt could not be reviewed. Start the camera and set up in the starting squares before trying again.';
  return review?.status==='unknown'
    ?'The camera could not clearly track this attempt. Keep your hands and feet visible from start to finish before trying again.'
    :'This attempt did not match the movement. Return to the starting squares and try this movement again.';
}

const factClauses={too_fast:'moved too fast',too_slow:'moved too slowly',late_start:'started late',
  off_guide:'left the progress beam',hold_drift:'left its hold position',
  endpoint_unreached:'missed its ending triangle',movement_incomplete:'did not finish its movement'};
const correctionClauses={too_fast:"follow the teacher's pace",too_slow:"follow the teacher's pace",
  late_start:'begin with the teacher',off_guide:'stay inside the beam',hold_drift:'keep the hold steady',
  endpoint_unreached:'reach the ending triangle',movement_incomplete:'finish the whole movement'};
const join=parts=>parts.length<2?parts[0]??'':`${parts.slice(0,-1).join(', ')} and ${parts.at(-1)}`;
const wordCount=messages=>messages.join(' ').trim().split(/\s+/).filter(Boolean).length;
function boundedMessages(review,issues){
  const groups=new Map(),general=[];
  for(const issue of issues){
    if(names[issue.index]){
      if(!groups.has(issue.index))groups.set(issue.index,new Set());
      groups.get(issue.index).add(issue.code);
    }else if(issue.code==='reference_unknown')
      general.push('The movement targets were unavailable. Replay the demonstration before trying again.');
    else if(issue.code==='attempt_incomplete')
      general.push('This attempt was incomplete. Reach all ending triangles before reviewing it.');
    else if(issue.code==='tracking_unknown'){
      const framing=(review?.issues??[]).some(source=>source.code==='tracking_unknown'
        &&canonicalIndex(source.index)===null&&/framing changed/i.test(source.message??''));
      general.push(framing?'The camera framing changed. Return to the starting squares and keep the camera still.'
        :'Tracking was unclear during this attempt. Keep your hands and feet visible before trying again.');
    }
  }
  const messages=[];
  for(const [index,codes]of groups){
    const name=names[index];
    if(codes.has('tracking_unknown')){
      messages.push(sentences.tracking_unknown(name));continue;
    }
    const facts=[...codes].filter(code=>Object.hasOwn(factClauses,code));
    let text=facts.length?`Your ${name} ${join(facts.map(code=>factClauses[code]))}.`
      :sentences.timing_unknown(name);
    if(facts.length){
      const corrections=[...new Set(facts.map(code=>correctionClauses[code]))];
      text+=` On your retry, ${join(corrections)}.`;
      if(codes.has('timing_unknown'))text+=' Its speed could not be assessed.';
    }
    messages.push(text);
  }
  if(general.length)messages.push([...new Set(general)].join(' '));
  if(review?.status==='match')messages.unshift('You reached all ending targets. This movement is complete.');
  return messages;
}

export function descriptivePracticeFeedback(review){
  const groups=new Map(),general=[],issues=practiceAiWordingIssues(review);
  for(const issue of issues){
    const name=names[issue.index];
    if(name&&Object.hasOwn(sentences,issue.code)){
      if(!groups.has(name))groups.set(name,new Set());
      groups.get(name).add(sentences[issue.code](name));
    }else{
      const original=(review?.issues??[]).find(source=>source.code===issue.code
        &&canonicalIndex(source.index)===issue.index);
      const text=generalSentence(original??issue);
      if(text)general.push(text);
    }
  }
  let messages=[...groups.values()].map(parts=>[...parts].join(' '));
  messages.push(...new Set(general));
  if(review?.status==='match')
    messages.unshift('You reached all ending targets. This movement is complete.');
  if(!messages.length)messages.push(fallbackSentence(review));
  // Keep all grounded facts recordable in the bounded end-of-lesson history.
  // Only dense reviews consolidate corrections; normal messages stay detailed.
  if(wordCount(messages)>200||messages.length>6||messages.some(message=>message.length>600)
    ||messages.join(' ').length>2400)messages=boundedMessages(review,issues);
  return {...review,messages,reason:messages[0],message:messages[0],feedbackStyle:'compact',
    speechStyle:'descriptive',manualContinuation:false};
}
