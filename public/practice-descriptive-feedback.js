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

const priorities={tracking_unknown:0,reference_unknown:0,attempt_incomplete:0,
  too_fast:1,too_slow:1,late_start:1,off_guide:2,hold_drift:2,
  endpoint_unreached:3,movement_incomplete:3,timing_unknown:4};
const directionPhrase={up:'on the way up',down:'on the way down',left:'while moving sideways',
  right:'while moving sideways',mixed:'through the movement'};
function contextFor(context,index){
  if(context?.version!=='practice-feedback-context-v1')return null;
  return context.limbs?.find(limb=>canonicalIndex(limb.index)===index)??null;
}
function conversationalSentence(group,context,additional=false){
  const {code,indices}=group,paired=indices.length===2,name=paired
    ?indices.every(index=>[33,34].includes(index))?'both hands':'both feet':names[indices[0]];
  const subject=paired?`Both ${name.split(' ').at(-1)}`:`Your ${name}`;
  const contexts=indices.map(index=>contextFor(context,index));
  const expected=contexts.every(limb=>limb?.expectedDirection===contexts[0]?.expectedDirection)
    ?contexts[0]?.expectedDirection:null;
  const movement=directionPhrase[expected]?` ${directionPhrase[expected]}`:'';
  const pronoun=paired?'them':'it',possessive=paired?'their':'its';
  const also=additional?' also':'';
  const paceDirection=expected==='up'?'bring '+pronoun+' up':expected==='down'?'lower '+pronoun:'move '+pronoun;
  if(code==='too_slow')return `${subject} moved too slowly${movement}. Try to ${paceDirection} a little more quickly with the teacher.`;
  if(code==='too_fast')return `${subject} moved too quickly${movement}. Give ${pronoun} a little more time to follow the teacher's pace.`;
  if(code==='late_start')return `${subject} began after the teacher${movement}. Watch for the start of the motion and begin with the demonstration.`;
  if(code==='off_guide'){
    const sideways=contexts.every(limb=>['left','right'].includes(limb?.observedDirection));
    if(sideways&&['up','down'].includes(expected))return `${subject}${also} drifted sideways while the guide led ${expected==='up'?'upward':'downward'}. Keep ${pronoun} moving ${expected==='up'?'up':'down'} through the beam on your retry.`;
    return `${subject}${also} left the progress beam${movement}. Keep ${pronoun} following the beam as you move.`;
  }
  if(code==='hold_drift')return `${subject}${also} moved away from ${possessive} hold position. Keep ${pronoun} steady while the other parts of the movement continue.`;
  if(code==='endpoint_unreached')return `${subject} did not reach ${possessive} ending ${paired?'triangles':'triangle'}${movement}. Follow the guide all the way into ${paired?'those targets':'that target'}.`;
  if(code==='movement_incomplete')return `${subject} did not finish the movement${movement}. Follow the whole path from the starting ${paired?'squares':'square'} to the ending ${paired?'triangles':'triangle'}.`;
  if(code==='tracking_unknown')return paired
    ?`The camera could not clearly track your ${name.replace('both ','')} throughout this attempt. Keep them visible from start to finish before trying again.`
    :sentences.tracking_unknown(name);
  if(code==='timing_unknown')return paired
    ?`The timing of your ${name.replace('both ','')} could not be determined in this attempt, so their speed was not assessed.`
    :sentences.timing_unknown(name);
  return null;
}

export function descriptivePracticeFeedback(review,context){
  const issues=practiceAiWordingIssues(review),consumed=new Set(),groups=[];
  const ordered=issues.map((issue,i)=>({...issue,i})).sort((a,b)=>(priorities[a.code]??9)-(priorities[b.code]??9));
  for(const current of ordered){
    if(consumed.has(current.i))continue;
    const index=current.index;
    if(names[index]&&current.code!=='tracking_unknown'
      &&issues.some(issue=>issue.index===index&&issue.code==='tracking_unknown'))continue;
    consumed.add(current.i);
    if(!names[index]){
      const original=(review?.issues??[]).find(source=>source.code===current.code
        &&canonicalIndex(source.index)===index);
      const text=generalSentence(original??current);
      if(text)groups.push({text,code:current.code,indices:[]});
      continue;
    }
    const partner=ordered.find(other=>!consumed.has(other.i)&&other.code===current.code
      &&other.index!==index&&([33,34].includes(index)?[33,34].includes(other.index):[35,36].includes(other.index))
      &&contextFor(context,index)?.expectedDirection===contextFor(context,other.index)?.expectedDirection
      &&(current.code!=='off_guide'||contextFor(context,index)?.observedDirection===contextFor(context,other.index)?.observedDirection)
      &&(current.code==='tracking_unknown'||!issues.some(issue=>issue.index===other.index&&issue.code==='tracking_unknown')));
    const indices=partner?[index,partner.index]:[index];
    if(partner)consumed.add(partner.i);
    groups.push({code:current.code,indices});
  }
  // Present the principal corrections conversationally. The original complete
  // issue list remains on the result and in the lesson journal for the summary.
  const primary=groups.filter(group=>group.code!=='timing_unknown').slice(0,3);
  const timing=groups.filter(group=>group.code==='timing_unknown');
  let messages=primary.map((group,i)=>group.text??conversationalSentence(group,context,i>0)).filter(Boolean);
  if(!messages.length||review?.status==='match')
    messages.push(...timing.slice(0,2).map(group=>conversationalSentence(group,context)).filter(Boolean));
  if(review?.status==='match')messages.unshift('You reached all ending targets. This movement is complete.');
  if(!messages.length)messages.push(fallbackSentence(review));
  if(context?.practiceFocus==='coordination'&&issues.some(issue=>issue.code==='hold_drift')){
    const held=issues.filter(issue=>issue.code==='hold_drift'&&contextFor(context,issue.index)?.expectedDirection==='hold');
    const feet=held.filter(issue=>[35,36].includes(issue.index));
    if(feet.length){
      const named=feet.length===2?'feet':names[feet[0].index];
      const raising=[33,34].every(index=>contextFor(context,index)?.expectedDirection==='up');
      messages.push(`Keep your ${named} planted as your hands ${raising?'rise':'move'}. Rehearse that separation slowly, then bring the parts together with the teacher.`);
    }else if(held.length){
      const named=held.length===2?'hands':names[held[0].index];
      messages.push(`Keep your ${named} steady while you place the moving foot. Practise that separation first, then bring the parts together with the teacher.`);
    }
  }else if(context?.practiceFocus==='range'){
    const incomplete=issues.filter(issue=>[33,34].includes(issue.index)
      &&['movement_incomplete','endpoint_unreached'].includes(issue.code));
    const indices=[...new Set(incomplete.map(issue=>issue.index))];
    if(indices.length){
      const named=indices.length===2?'hands':names[indices[0]],expected=contextFor(context,indices[0])?.expectedDirection;
      const upward=expected==='up'&&indices.every(index=>contextFor(context,index)?.expectedDirection==='up');
      const downward=expected==='down'&&indices.every(index=>contextFor(context,index)?.expectedDirection==='down');
      messages.push(`Give your ${named} room to make the full ${upward?'upward ':downward?'downward ':''}movement. Rehearse that whole path a few times so it feels familiar, then follow the teacher again.`);
    }
  }
  if(wordCount(messages)>200||messages.length>6||messages.some(message=>message.length>600)
    ||messages.join(' ').length>2400)messages=boundedMessages(review,issues);
  return {...review,messages,reason:messages[0],message:messages[0],feedbackStyle:'compact',
    speechStyle:'descriptive',manualContinuation:false};
}
