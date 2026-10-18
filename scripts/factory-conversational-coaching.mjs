// Presentation facts only. These plans cannot affect grading, target completion
// or hardware feedback, and they never contain raw camera observations.
const names={15:'left hand',16:'right hand',27:'left foot',28:'right foot',33:'left hand',34:'right hand',35:'left foot',36:'right foot'};
const canonical={15:33,16:34,27:35,28:36,33:33,34:34,35:35,36:36};
const directions=new Set(['up','down','left','right','hold','mixed']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
const unique=values=>[...new Set(values)];
const list=values=>values.length<2?values[0]??'':`${values.slice(0,-1).join(', ')} and ${values.at(-1)}`;
export const coachingContextVersion='practice-feedback-context-v1';

export function normalizeCoachingContext(value,issues=[]){
  if(!object(value)||!keys(value,['version','limbs','practiceFocus'])||value.version!==coachingContextVersion
    ||!Array.isArray(value.limbs)||value.limbs.length>4
    ||value.practiceFocus!==undefined&&!['coordination','range'].includes(value.practiceFocus))return null;
  const limbs=[],seen=new Set();
  for(const limb of value.limbs){
    const index=canonical[limb?.index];
    if(!object(limb)||!keys(limb,['index','expectedDirection','observedDirection'])
      ||!Number.isInteger(limb.index)||!Object.hasOwn(canonical,limb.index)||!index||seen.has(index)
      ||!directions.has(limb.expectedDirection)
      ||limb.observedDirection!==undefined&&(!['up','down','left','right'].includes(limb.observedDirection)
        ||!issues.some(issue=>canonical[issue.index]===index&&issue.code==='off_guide')
        ||issues.some(issue=>canonical[issue.index]===index&&issue.code==='tracking_unknown')))return null;
    seen.add(index);limbs.push({index,expectedDirection:limb.expectedDirection,
      ...(limb.observedDirection===undefined?{}:{observedDirection:limb.observedDirection})});
  }
  const unclear=index=>issues.some(issue=>issue.code==='tracking_unknown'
    &&(issue.index==null||canonical[issue.index]===index));
  const movingHand=limbs.some(limb=>limb.index<=34&&limb.expectedDirection!=='hold'&&!unclear(limb.index));
  const movingFoot=limbs.some(limb=>limb.index>=35&&limb.expectedDirection!=='hold'&&!unclear(limb.index));
  const heldFootDrift=issues.some(issue=>canonical[issue.index]>=35&&issue.code==='hold_drift'
    &&!unclear(canonical[issue.index])&&limbs.some(limb=>limb.index===canonical[issue.index]&&limb.expectedDirection==='hold'));
  const heldHandDrift=issues.some(issue=>canonical[issue.index]<=34&&issue.code==='hold_drift'
    &&!unclear(canonical[issue.index])&&limbs.some(limb=>limb.index===canonical[issue.index]&&limb.expectedDirection==='hold'));
  const rangeIssue=issues.some(issue=>canonical[issue.index]<=34&&['endpoint_unreached','movement_incomplete'].includes(issue.code)
    &&!unclear(canonical[issue.index])&&!issues.some(other=>canonical[other.index]===canonical[issue.index]&&other.code==='off_guide')
    &&limbs.some(limb=>limb.index===canonical[issue.index]&&limb.expectedDirection!=='hold'));
  if(value.practiceFocus==='coordination'&&!((movingHand&&heldFootDrift)||(movingFoot&&heldHandDrift)))return null;
  if(value.practiceFocus==='range'&&!rangeIssue)return null;
  return{version:coachingContextVersion,limbs,...(value.practiceFocus?{practiceFocus:value.practiceFocus}:{})};
}

function subject(indices){
  const limbs=unique(indices.map(index=>names[index]).filter(Boolean));
  if(limbs.length===2&&limbs.every(limb=>limb.endsWith('hand')))return{label:'both hands',possessive:'hands',plural:true};
  if(limbs.length===2&&limbs.every(limb=>limb.endsWith('foot')))return{label:'both feet',possessive:'feet',plural:true};
  if(limbs.length>2){
    const hands=limbs.filter(limb=>limb.endsWith('hand')),feet=limbs.filter(limb=>limb.endsWith('foot'));
    const grouped=[...(hands.length===2?['hands']:hands),...(feet.length===2?['feet']:feet)];
    return{label:list(grouped),possessive:list(grouped),plural:true};
  }
  return{label:list(limbs),possessive:list(limbs),plural:limbs.length>1};
}
function directionPhrase(direction){
  if(direction==='up')return' during the upward part of the demonstration';
  if(direction==='down')return' during the downward part of the demonstration';
  if(['left','right'].includes(direction))return' during the sideways part of the demonstration';
  return'';
}
function followDirection(direction,plural){
  const pronoun=plural?'them':'it';
  if(direction==='up')return`let ${pronoun} rise along the upward guide`;
  if(direction==='down')return`press ${pronoun} down along the guide`;
  if(['left','right'].includes(direction))return`move ${pronoun} sideways along the guide`;
  return`follow the guided path with ${pronoun}`;
}
function sentenceChoices(group){
  const {code,expectedDirection:direction,observedDirection:observed}=group;
  const {label,possessive,plural}=subject(group.indices),start=label==='both hands'?'Both hands':label==='both feet'?'Both feet':`Your ${label}`;
  const pronoun=plural?'them':'it',movement=directionPhrase(direction),guided=followDirection(direction,plural);
  if(code==='too_slow')return[
    `${start} fell behind the teacher${movement}. On the next try, ${guided} a little faster so you stay with the demonstration.`,
    `${start} moved a little too slowly${movement}. Try matching the teacher's rhythm as you ${guided.replace(/^let /,'let ')}.`,
    `The main thing to adjust is the pace of your ${possessive}${movement}. Bring ${pronoun} along a little faster, keeping the same rhythm as the teacher.`,
  ];
  if(code==='too_fast')return[
    `${start} got ahead of the teacher${movement}. Give the movement a little more time and keep ${pronoun} in the demonstration's rhythm.`,
    `${start} moved too quickly${movement}. Ease the pace a little as you ${guided}, rather than rushing to the ending triangle.`,
    `Focus on slowing your ${possessive}${movement}. Follow the teacher through the whole motion, giving ${pronoun} time to travel along the guide.`,
  ];
  if(code==='late_start')return[
    `${start} started after the teacher${movement}. Watch for the beginning of the demonstration and start ${plural?'their':'its'} movement at the same time.`,
    `The start of your ${possessive} movement was a little late. On the retry, begin with the teacher, then follow the same rhythm along the guide.`,
  ];
  if(code==='off_guide'){
    const sideways=['left','right'].includes(observed),vertical=['up','down'].includes(direction);
    const wrongWay=observed&&observed!==direction&&(sideways&&vertical||['up','down'].includes(observed)&&['left','right','up','down'].includes(direction));
    if(wrongWay){
      const observedWord=sideways?'sideways':observed==='up'?'upward':'downward';
      const expectedWord=direction==='up'?'upward':direction==='down'?'downward':'sideways';
      return[
        `${start} drifted ${observedWord} instead of following the ${expectedWord} guide. On the next try, ${guided} toward the ending triangle.`,
        `For your ${possessive}, focus on the direction of the movement: the guide goes ${expectedWord}, but the tracked movement went ${observedWord}. Try following that guide more closely.`,
      ];
    }
    return[
      `${start} drifted out of the progress beam${movement}. On the retry, ${guided}, keeping ${pronoun} inside the beam from start to finish.`,
      `The path of your ${possessive} needs a little attention${movement}. Keep ${pronoun} within the beam as you follow it toward the ending triangle.`,
    ];
  }
  if(code==='hold_drift')return[
    `${start} moved away from the hold position. Let ${pronoun} stay steady there while you follow the rest of the movement.`,
    `For this retry, give the hold position a little attention. Your ${possessive} drifted away, so keep ${pronoun} settled in place as the movement continues.`,
  ];
  if(code==='endpoint_unreached'||code==='movement_incomplete')return[
    `${start} ${code==='endpoint_unreached'?'did not reach the ending target':'did not finish the guided movement'}. Take ${pronoun} through the full path${movement} until you reach the ending triangle.`,
    `Try giving your ${possessive} the full guided movement${movement}. Follow the path all the way into the ending triangle before settling into the final position.`,
  ];
  if(code==='tracking_unknown')return label?[
    `I couldn't clearly track your ${possessive}, so I can't tell how that part of the movement went. Keep ${pronoun} visible throughout the next try.`,
    `The camera lost a clear view of your ${possessive}. Let's try again with ${pronoun} visible from the starting square to the ending triangle.`,
  ]:[
    "I couldn't get a clear enough view to assess this movement. Check that your hands and feet stay in the camera frame, then give it another try.",
    "The tracking was unclear, so I can't give a reliable movement correction yet. Set up in the starting squares and keep the camera view steady for the retry.",
  ];
  if(code==='timing_unknown')return[
    `I could not determine the timing of your ${possessive} in this attempt. I can't say whether ${plural?'they were':'it was'} too fast or too slow from this recording.`,
    `There wasn't enough timing evidence for your ${possessive}. For this attempt, ${plural?'their':'its'} pace remains unassessed.`,
  ];
  if(code==='reference_unknown')return[
    "The movement reference wasn't available for a reliable comparison. Replay the demonstration before trying again; I can't identify a measured correction from this attempt.",
  ];
  return[
    "This attempt ended before there was enough movement evidence to assess it. Give yourself time to follow the whole demonstration and reach the ending targets on the retry.",
  ];
}

export function conversationalFeedbackEvidence(request){
  const context=request.context,byIndex=new Map((context?.limbs??[]).map(limb=>[limb.index,limb]));
  const groups=new Map();
  for(const issue of request.issues){
    const index=canonical[issue.index],limb=byIndex.get(index),kind=index?(index<=34?'hand':'foot'):'general';
    const expectedDirection=limb?.expectedDirection??'mixed',observedDirection=issue.code==='off_guide'?limb?.observedDirection:undefined;
    const key=`${issue.code}:${kind}:${expectedDirection}:${observedDirection??''}`;
    if(!groups.has(key))groups.set(key,{code:issue.code,indices:[],issueIds:[],expectedDirection,...(observedDirection?{observedDirection}:{})});
    const group=groups.get(key);if(index)group.indices.push(index);group.issueIds.push(issue.issueId);
  }
  const priority={reference_unknown:0,tracking_unknown:0,too_slow:1,too_fast:1,late_start:2,off_guide:2,
    endpoint_unreached:3,movement_incomplete:3,hold_drift:3,attempt_incomplete:0,timing_unknown:4};
  const ordered=[...groups.values()].sort((left,right)=>(priority[left.code]??5)-(priority[right.code]??5)
    ||right.indices.length-left.indices.length);
  // Presentation may consolidate low-priority details. The complete typed issue
  // list remains in the review and retained journal for the final synthesis.
  const selected=ordered.slice(0,3);
  if(request.status==='match'&&!selected.some(group=>group.code==='timing_unknown'))selected.length=0;
  const entries=selected.map((group,index)=>({entryId:`focus-${index}`,kind:'coaching',facts:group,
    allowedText:sentenceChoices(group)}));
  if(request.status==='match')entries.unshift({entryId:'completion',kind:'completion',allowedText:[
    'You reached the ending targets and completed this movement. Let’s carry that into the next step.',
    'That movement reached all of its ending targets. You’re ready to continue with the sequence.',
  ]});
  return{status:request.status,context,entries};
}

export function coachingOutputSchema(entries){
  return{type:'object',properties:{entries:{type:'array',minItems:entries.length,maxItems:entries.length,
    items:{oneOf:entries.map(entry=>({type:'object',properties:{entryId:{const:entry.entryId},
      text:{type:'string',enum:unique(entry.allowedText)}},required:['entryId','text'],additionalProperties:false}))}}},
    required:['entries'],additionalProperties:false};
}
export function validateCoachingOutput(output,entries,{maxWords=200,maxChars=2400,maxParagraphChars=600}={}){
  if(!object(output)||!keys(output,['entries'])||!Array.isArray(output.entries)||output.entries.length!==entries.length)return null;
  const supplied=new Map(entries.map(entry=>[entry.entryId,entry])),accepted=new Map();
  for(const entry of output.entries){
    if(!object(entry)||!keys(entry,['entryId','text'])||accepted.has(entry.entryId)
      ||!supplied.get(entry.entryId)?.allowedText.includes(entry.text))return null;
    accepted.set(entry.entryId,entry.text);
  }
  const messages=entries.map(entry=>accepted.get(entry.entryId)),joined=messages.join(' ');
  return messages.length>0&&messages.length<=6&&messages.every(text=>text.length<=maxParagraphChars
    &&!/[\u0000-\u001f\u007f<>]/.test(text))&&joined.length<=maxChars
    &&joined.trim().split(/\s+/).length<=maxWords?messages:null;
}

export function conversationalSummaryEntries(request,evidence){
  const observed=request.attempts.filter(attempt=>['mismatch','unknown'].includes(attempt.status));
  const themes=new Map();
  for(const attempt of observed)for(const issue of attempt.issues){
    if(!['too_fast','too_slow','late_start','off_guide','hold_drift','endpoint_unreached','movement_incomplete'].includes(issue.code))continue;
    const index=canonical[issue.index],kind=index<=34?'hands':'feet',key=`${kind}:${issue.code}`;
    const theme=themes.get(key)??{kind,code:issue.code,count:0,indices:new Set(),attemptIds:new Set(),contexts:[]};
    theme.count++;theme.indices.add(index);theme.attemptIds.add(attempt.attemptId);
    if(attempt.context)theme.contexts.push({index,context:attempt.context});themes.set(key,theme);
  }
  const ranked=[...themes.values()].sort((left,right)=>right.count-left.count);
  const coordination=observed.some(attempt=>attempt.context?.practiceFocus==='coordination');
  const range=observed.some(attempt=>attempt.context?.practiceFocus==='range');
  const pace=ranked.some(theme=>['too_fast','too_slow','late_start'].includes(theme.code));
  const path=ranked.find(theme=>theme.code==='off_guide');
  const hold=ranked.find(theme=>theme.code==='hold_drift');
  const limitations=evidence.unknown||evidence.uncertainTiming;
  const trackingUnclear=request.attempts.some(attempt=>attempt.issues.some(issue=>issue.code==='tracking_unknown'));
  const referenceUnclear=request.attempts.some(attempt=>attempt.issues.some(issue=>issue.code==='reference_unknown'));
  const attemptIncomplete=request.attempts.some(attempt=>attempt.issues.some(issue=>issue.code==='attempt_incomplete'));
  const takeaway=evidence.matched===5&&evidence.manual===0?[
    `You worked through the whole sequence and reached the targets in every step.${evidence.laterReachedSteps.length?' Later attempts reached the targets after earlier corrections.':''} ${themes.size?'Let’s use the earlier feedback to give your next practice a clear focus.':'For the next round, give each movement its full guided path as you follow the sequence.'}`,
    `You reached the ending targets throughout the five-step sequence.${evidence.laterReachedSteps.length?' Some steps reached their targets after another attempt.':''} ${themes.size?'The most useful next step is to carry one or two of the earlier corrections into your next round.':'For the next practice, pay attention to how each movement leads into the next.'}`,
  ]:evidence.matched>0?[
    `You reached the ending targets in the steps marked complete.${evidence.manual?' Some steps were advanced manually, so those movements remain unverified.':''} For your next round, use the feedback as a practice focus rather than a score for the whole sequence.`,
    `Your completed steps reached their ending targets.${evidence.manual?' The manually advanced steps have not been confirmed by the tracker.':''} Let’s turn the feedback you received into a clear plan for the next practice.`,
  ]:[
    'This session gives us a starting point for the next practice, even though no step was confirmed complete. Return to the demonstration and work through one movement at a time, using the guides to check the path.',
  ];
  let priority,nextPractice;
  if(coordination){
    const repeated=observed.filter(attempt=>attempt.context?.practiceFocus==='coordination').length>1;
    const feetHold=observed.some(attempt=>attempt.context?.practiceFocus==='coordination'
      &&attempt.issues.some(issue=>canonical[issue.index]>=35&&issue.code==='hold_drift'));
    const heldIndices=unique(observed.filter(attempt=>attempt.context?.practiceFocus==='coordination')
      .flatMap(attempt=>attempt.issues.filter(issue=>issue.code==='hold_drift'
        &&(feetHold?canonical[issue.index]>=35:canonical[issue.index]<=34)).map(issue=>canonical[issue.index])));
    const heldSubject=subject(heldIndices).possessive;
    priority=feetHold?[
      `${repeated?'A theme that came up more than once was':'One useful focus from the earlier feedback is'} coordinating your moving hands with steady feet. In a step that asks your hands to move, the feedback caught your ${heldSubject} drifting from the hold position. Let the hands travel through the guide while the feet stay settled.`,
      `Bring your attention to the relationship between your hands and feet. In the movement that asked your hands to travel, your ${heldSubject} drifted from the hold position. Keeping the feet steady gives you one less thing to manage while following the hand path.`,
    ]:[
      `Focus on coordinating the moving foot with hands that stay steady. In a step that asks a foot to move, the feedback caught your ${heldSubject} drifting from the hold position. Keep the held hands settled while the foot follows its guide.`,
    ];
    nextPractice=feetHold?[
      `On your next round, watch the hand movement once, then follow it while keeping your feet in their hold positions.${pace?' Give the hands a smooth, even pace that stays with the teacher.':''} Think of it as one coordinated action rather than several separate targets.`,
      `For the next practice, take one hand-moving step at a time. Settle your feet first, then follow the hand guide all the way to its target.${pace?' Stay in the teacher’s rhythm as you do it.':''} Repeat that pairing before joining the sequence again.`,
    ]:[
      'For the next practice, settle your hands in their hold positions before following the foot guide. Work on that pairing in one step first, then carry it into the sequence. Give yourself time to finish the whole guided path.',
    ];
  }else if(range){
    const repeated=observed.filter(attempt=>attempt.context?.practiceFocus==='range').length>1;
    priority=[
      `${repeated?'Completing the hand path came up more than once in the feedback.':'Give the hand movement room to finish.'} The feedback included a hand path that was unfinished or did not reach its target, so the useful focus is following the complete guide all the way to the ending triangle. Let the movement be comfortably larger where the path asks for it.`,
      'Focus on completing the full hand path. A hand movement was left unfinished or did not reach its ending triangle; take it all the way through the guide on the next try. Use a comfortably larger movement where needed to reach the target.',
    ];
    nextPractice=[
      `Watch where the teacher’s hand starts and finishes, then follow that same complete path on your next try.${pace?' Keep the pace with the teacher while you do it.':''} Once the hand reaches the ending triangle, settle into that position before continuing.`,
      'For the next round, choose a hand-moving step and pay attention to the whole journey from the starting square to the ending triangle. Make the path complete and comfortable, then repeat it in the sequence.',
    ];
  }else if(pace){
    const paceIndices=unique(ranked.filter(theme=>['too_fast','too_slow','late_start'].includes(theme.code))
      .flatMap(theme=>[...theme.indices]));
    const limb=subject(paceIndices).possessive;
    const fast=ranked.some(theme=>theme.code==='too_fast'),slow=ranked.some(theme=>theme.code==='too_slow');
    const repeated=unique(ranked.filter(theme=>['too_fast','too_slow','late_start'].includes(theme.code))
      .flatMap(theme=>[...theme.attemptIds])).length>1;
    const slowLimb=subject(unique(ranked.filter(theme=>theme.code==='too_slow').flatMap(theme=>[...theme.indices]))).possessive;
    const fastLimb=subject(unique(ranked.filter(theme=>theme.code==='too_fast').flatMap(theme=>[...theme.indices]))).possessive;
    const observation=fast&&slow?'The earlier feedback showed some movement getting ahead of the teacher and some falling behind.':slow
      ?`The earlier feedback showed your ${slowLimb} falling behind the teacher.`:fast
        ?`The earlier feedback showed your ${fastLimb} getting ahead of the teacher.`:'The earlier feedback caught movement starting after the teacher.';
    priority=[
      `${repeated?'Timing came up across several attempts, so make':'For your next practice, make'} the teacher’s rhythm your main focus. ${observation} Aim for a smooth, shared pace through the movement, rather than adjusting each target separately.${path?' Keep following the beam as you work on that rhythm.':''}`,
      `The next useful improvement is the timing of your ${limb}. ${observation} Start with the demonstration and stay with it through the full path.${path?' The beam can help you keep the direction consistent at the same time.':''}`,
    ];
    nextPractice=[
      'Watch one demonstration all the way through before starting the next attempt. Notice when the movement begins, then follow the same rhythm from the starting squares to the ending triangles. Work on that one rhythm before joining all the steps together.',
      'For your next round, pick one step and follow the teacher’s pace through its whole guided path. Let the moving parts start together with the demonstration, then carry that rhythm into the following step.',
    ];
  }else if(path){
    const indices=[...path.indices],limb=subject(indices).possessive;
    const associatedContexts=path.contexts.flatMap(item=>item.context.limbs.filter(limb=>limb.index===item.index));
    const expectedDirections=unique(associatedContexts.map(item=>item.expectedDirection));
    const context=expectedDirections.length===1&&['up','down'].includes(expectedDirections[0])?associatedContexts[0]:null;
    const guide=context?.expectedDirection==='up'?'upward':context?.expectedDirection==='down'?'downward':null;
    priority=[
      `Give the direction of your ${limb} a little more attention. The feedback caught movement leaving the beam.${guide?` In a movement for your ${names[context.index]}, the guide went ${guide}.`:''} Follow the path through the middle of the beam instead of focusing only on the ending triangle.`,
      `Your next focus is keeping your ${limb} on the guided path. The beam showed where the movement drifted away; use it to check the journey from the starting square to the target, rather than just the final position.`,
    ];
    nextPractice=[
      `Watch the direction of the teacher’s movement, then trace the same guide with your ${limb} on the next attempt. Keep the movement smooth and stay inside the beam from start to finish.`,
      'For the next round, choose one step and follow the middle of its beam all the way to the target. Once that path feels easier to follow, bring it back into the sequence.',
    ];
  }else if(hold){
    const limb=subject([...hold.indices]).possessive;
    priority=[
      `Focus on keeping your ${limb} steady when the step asks for a hold. The feedback caught movement drifting out of that position. Settle the held parts first, then follow the rest of the step without letting that hold wander.`,
      `The hold position is the most useful place to put your attention next. Your ${limb} drifted away from it, so work on keeping that position steady through the rest of the guided movement.`,
    ];
    nextPractice=[
      'On the next round, pause your attention on the starting hold before the movement begins. Keep that part steady while the moving parts follow their guides, then check the ending position before continuing.',
    ];
  }else if(limitations&&trackingUnclear){
    priority=[
      'The most useful next step is getting a clearer camera view. Some tracking or timing evidence was unavailable, so I can’t turn those gaps into movement corrections. Keep the relevant hands and feet visible throughout each attempt.',
      'Before changing the movement, give the camera a clearer view of the whole guided action. Unclear tracking or timing leaves part of the attempt unassessed; it doesn’t show that you moved too quickly, too slowly or in the wrong direction.',
    ];
    nextPractice=[
      'Set up in the starting squares with the camera held steady, then replay one step. Keep your hands and feet visible all the way to the ending triangles. A clearer attempt will give us a better basis for the next correction.',
    ];
  }else if(limitations&&referenceUnclear){
    priority=[
      'The movement reference was not available for part of this session, so a reliable comparison could not be made for those attempts. That leaves the movement unassessed; it does not identify a speed or direction correction.',
    ];
    nextPractice=[
      'Replay the demonstration before your next attempt and follow the complete guided movement through to the ending targets. A comparison with the available reference will give us a better basis for the next practice focus.',
    ];
  }else if(limitations&&evidence.unknown===0&&evidence.uncertainTiming>0){
    priority=[
      'The ending targets were reached, but there was not enough timing evidence to assess the pace. There is no measured speed correction to work on from those attempts yet, so avoid treating the missing timing as proof that you moved too fast or too slowly.',
      'Target completion and timing are separate here. The completed movement reached its targets, while its pace remained unassessed. Let the next attempt give us another chance to compare the rhythm without assuming a speed mistake in this one.',
    ];
    nextPractice=[
      'Watch the demonstration once, then follow its rhythm through the whole guided movement on your next attempt. Use the teacher as your pacing reference and give the complete path time to finish, rather than trying to correct an unmeasured speed error.',
    ];
  }else if(limitations&&attemptIncomplete){
    priority=[
      'An attempt ended before enough of the complete movement was available to assess. That does not identify a speed or direction mistake yet. The useful next focus is giving one attempt enough time to include the whole guided action.',
    ];
    nextPractice=[
      'Replay one demonstration, then follow its complete movement from the starting squares to the ending triangles. Give yourself time to finish the whole attempt before using its feedback to choose a more specific correction.',
    ];
  }else if(limitations){
    priority=[
      'Some attempts did not contain enough reliable movement evidence for an assessment. I can’t turn those gaps into a specific speed, direction or camera correction. Give the next attempt time to include the complete movement.',
    ];
    nextPractice=[
      'Replay one demonstration and follow its full guided path from the starting squares to the ending triangles. Work through that complete attempt first, then use the resulting feedback to choose a more specific practice focus.',
    ];
  }else{
    priority=[
      'No specific measured hand or foot correction stood out in the recorded feedback. Keep giving each movement its full guided path and stay with the demonstration as you join the steps together.',
      'The recorded feedback did not identify a specific movement correction to work on. Keep following the teacher through the complete path, then use the ending targets to settle into each final position.',
    ];
    nextPractice=[
      'For the next practice, replay the sequence and pay attention to how one step leads into the next. Start each movement with the teacher, follow the full guide, and settle at its ending targets before continuing.',
    ];
  }
  // Completion does not imply that speed was subsequently measured or fixed.
  // Retain a brief limitation beside successful target completion when needed.
  if(limitations&&themes.size>0)nextPractice=nextPractice.map(text=>`${text} Some tracking or timing remained unclear, so those parts are still unassessed.`);
  return[{entryId:'takeaway',kind:'takeaway',allowedText:takeaway},
    {entryId:'priority',kind:'priority',allowedText:priority},
    {entryId:'next-practice',kind:'nextPractice',allowedText:nextPractice}];
}
