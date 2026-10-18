// Presentation only: retain the evaluator's status, evidence and issue codes.
const names={15:'Left hand',16:'Right hand',27:'Left foot',28:'Right foot',33:'Left hand',34:'Right hand',35:'Left foot',36:'Right foot'};
const fragments={tracking_unknown:'tracking unclear',too_fast:'too fast',too_slow:'too slow',late_start:'started late',
  off_guide:'off the beam',hold_drift:'moved from its hold',endpoint_unreached:'missed the triangle',
  movement_incomplete:'movement incomplete'};
export function compactPracticeFeedback(review){
  const groups=new Map(),general=[];
  for(const issue of review?.issues??[]){
    const name=names[issue.index],fragment=fragments[issue.code];
    if(name&&fragment){if(!groups.has(name))groups.set(name,new Set());groups.get(name).add(fragment);}
    else if(issue.code==='reference_unknown')general.push('Movement targets unavailable.');
    else if(issue.code==='tracking_unknown')general.push(/framing changed/i.test(issue.message??'')?'Camera framing changed.':'Tracking unclear.');
    else if(issue.code==='attempt_incomplete')general.push('Reach all triangles.');
  }
  let messages=[...groups].map(([name,parts])=>`${name}: ${[...parts].join('; ')}.`);
  messages.push(...new Set(general));
  if(!messages.length){
    if(review?.status==='match'){
      messages=['Targets reached.'];
      for(const limb of review.limbs??[])if(limb.moving&&!limb.timingAssessed)
        messages.push(`${names[limb.index]??limb.label}: timing unclear.`);
    }else{
      const detail=(review?.messages??[]).join(' ')||review?.reason||'';
      messages=[/camera.*(stopped|changed)/i.test(detail)?'Camera stopped or changed.'
        :/(demonstration|tutorial|playback).*interrupted/i.test(detail)?'Tutorial playback interrupted.'
        :/camera.*(off|unavailable)/i.test(detail)?'Camera unavailable.'
        :review?.status==='unknown'?'Tracking unclear.':'Try this motion again.'];
    }
  }
  return {...review,messages,reason:messages[0],message:messages[0],feedbackStyle:'compact',manualContinuation:false};
}
