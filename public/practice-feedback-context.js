// Presentation evidence only. These descriptions never change a review, target,
// timing rule, camera sample or advancement decision. Horizontal directions use
// the original, unmirrored image axes; wording must call them "sideways" rather
// than infer an anatomical left/right heading from a front-facing camera.
import {REVIEW_RULES} from './practice-attempt-review.js';

export const FEEDBACK_CONTEXT_VERSION='practice-feedback-context-v1';
const aliases={15:33,16:34,27:35,28:36,33:33,34:34,35:35,36:36};
const canonical=index=>aliases[index]??null;
const finite=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const hands=index=>[33,34].includes(index);
const direction=(dx,dy)=>Math.abs(dy)>=Math.abs(dx)*1.6
  ?dy<0?'up':'down':Math.abs(dx)>=Math.abs(dy)*1.6?dx<0?'left':'right':'mixed';

function expectedDirection(control,path){
  if(control?.valid!==true||!finite(control.start)||!finite(control.end))return null;
  if(control.moving===false||control.targetGeometry?.mode==='hold')return 'hold';
  const displacement=distance(control.start,control.end);
  const minimum=hands(canonical(control.index))?REVIEW_RULES.minimumHandDisplacement:REVIEW_RULES.minimumFootDisplacement;
  if(displacement<minimum)return 'hold';
  if(path?.available===false||control.pathAvailable===false)return null;
  const points=(control.points??path?.points??[]).filter(finite);
  const dx=control.end.x-control.start.x,dy=control.end.y-control.start.y;
  const heading=direction(dx,dy);
  if(heading==='mixed')return heading;
  // Do not describe a circle or material reversal as a simple raise/lower.
  const axis=heading==='up'||heading==='down'?'y':'x',sign=Math.sign(axis==='y'?dy:dx);
  const route=[control.start,...points,control.end];
  let forward=0,backward=0;
  for(let i=1;i<route.length;i++){
    const travel=(route[i][axis]-route[i-1][axis])*sign;
    if(travel>=0)forward+=travel;else backward-=travel;
  }
  return backward>Math.max(.25,forward*.35)?'mixed':heading;
}

function reliableLimb(limb,control,minimumCoverage=REVIEW_RULES.minimumCoverage){
  return !!limb&&limb.status!=='unknown'&&limb.fresh===true&&limb.startSeen===true
    &&limb.materialMovementHidden!==true&&Number.isFinite(limb.coverage)&&limb.coverage>=minimumCoverage
    &&limb.sampleCount>=3&&control?.valid===true&&control.samples?.length>=3
    &&(!limb.movementEvidence||limb.movementEvidence.coverage>=minimumCoverage);
}

function guideDistance(point,control){
  const route=control.points?.length>=2?control.points:[control.start,control.end];
  let nearest=Infinity;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy;
    const fraction=n?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/n)):0;
    nearest=Math.min(nearest,distance(point,{x:a.x+fraction*dx,y:a.y+fraction*dy}));
  }
  return nearest;
}

function wrongWayExcursion(control,limb,expected,issues){
  if(!['up','down'].includes(expected)||!reliableLimb(limb,control,.85)
    ||!issues.some(issue=>canonical(issue.index)===canonical(control.index)&&issue.code==='off_guide')
    ||issues.some(issue=>canonical(issue.index)===canonical(control.index)&&issue.code==='tracking_unknown'))return null;
  const samples=control.samples;
  if(samples.some((sample,i)=>!finite(sample.point)||!Number.isFinite(sample.elapsedMs)
    ||!Number.isFinite(sample.observedAtMs)||i>0&&(sample.elapsedMs<=samples[i-1].elapsedMs
      ||sample.observedAtMs<=samples[i-1].observedAtMs)))return null;
  const intervals=new Map((control.observedIntervals??[]).map(interval=>[interval.to,interval.from]));
  const start=samples.find(sample=>distance(sample.point,control.start)<=REVIEW_RULES.endpointRadius);
  if(!start||start!==samples[0])return null;
  const horizontalMinimum=Math.max(.35,distance(control.start,control.end)*.25);
  let first=null,previous=null,supported=0,sign=0;
  for(const sample of samples){
    const dx=sample.point.x-start.point.x,dy=sample.point.y-start.point.y;
    const sideways=Math.abs(dx)>=horizontalMinimum&&Math.abs(dx)>=Math.abs(dy)*1.6
      &&guideDistance(sample.point,control)>REVIEW_RULES.broadGuideRadius;
    const currentSign=Math.sign(dx),gap=previous?sample.elapsedMs-previous.elapsedMs:0;
    const linked=previous&&gap>0&&gap<=REVIEW_RULES.maximumObservedGapMs
      &&intervals.get(sample.elapsedMs)===previous.elapsedMs;
    if(!sideways||!linked||currentSign!==sign){first=sideways?sample.elapsedMs:null;supported=sideways?1:0;}
    else supported++;
    sign=currentSign;previous=sample;
    // Several accepted original samples must sustain the excursion. A brief
    // noisy point, missing interval or ordinary wide curve does not qualify.
    if(first!==null&&supported>=3&&sample.elapsedMs-first>=REVIEW_RULES.minimumOffGuideMs)
      return sign<0?'left':'right';
  }
  return null;
}

function rangeSupport(control,limb,issues){
  if(!hands(canonical(control.index))||!reliableLimb(limb,control)
    ||!issues.some(issue=>canonical(issue.index)===canonical(control.index)
      &&['movement_incomplete','endpoint_unreached'].includes(issue.code))
    ||issues.some(issue=>canonical(issue.index)===canonical(control.index)
      &&['off_guide','tracking_unknown'].includes(issue.code)))return false;
  const displacement=distance(control.start,control.end);
  return control.moving===true&&displacement>=REVIEW_RULES.minimumHandDisplacement
    &&Number.isFinite(control.maximumForward)&&control.maximumForward<displacement*.85
    &&Number.isFinite(control.maximumDeviation)&&control.maximumDeviation<=REVIEW_RULES.broadGuideRadius;
}

/** Only bounded wording annotations leave this helper; raw tracking stays local. */
export function derivePracticeFeedbackContext({step,review,session,reference,pathReference}={}){
  const empty={version:FEEDBACK_CONTEXT_VERSION,limbs:[]};
  if(!review||reference?.referenceUsable!==true||pathReference?.referenceUsable!==true)return empty;
  const validSession=session?.frameUsable===true&&session.referenceUsable===true
    &&session.referenceId===reference.id&&Array.isArray(session.controls);
  const controls=validSession?session.controls:reference.guides??[];
  const issues=review.issues??[],limbs=[];
  const sources=[];
  for(const control of controls){
    const index=canonical(control.index);
    if(index===null||limbs.some(limb=>limb.index===index))continue;
    const path=pathReference.paths?.find(item=>canonical(item.index)===index);
    const expected=expectedDirection(control,path);
    if(!expected)continue;
    const result=validSession?review.limbs?.find(limb=>canonical(limb.index)===index):null;
    const observed=wrongWayExcursion(control,result,expected,issues);
    limbs.push({index,expectedDirection:expected,...(observed?{observedDirection:observed}:{})});
    sources.push({control,result,index,expected});
  }
  const moving=sources.filter(({control,result})=>control.moving===true
    &&result?.movementObserved===true&&reliableLimb(result,control));
  const drifting=sources.filter(({control,result,index,expected})=>expected==='hold'
    &&reliableLimb(result,control)&&issues.some(issue=>canonical(issue.index)===index&&issue.code==='hold_drift'));
  const coordination=drifting.some(held=>moving.some(moved=>hands(held.index)!==hands(moved.index)));
  const range=sources.some(({control,result})=>rangeSupport(control,result,issues));
  // Focus is advice supported by a measured pattern, never a confidence score
  // or an inference that the learner was afraid to move.
  return {version:FEEDBACK_CONTEXT_VERSION,limbs,
    ...(coordination?{practiceFocus:'coordination'}:range?{practiceFocus:'range'}:{})};
}
