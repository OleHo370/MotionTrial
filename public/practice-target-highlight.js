// Immediate location feedback only. This never completes an attempt or changes
// the post-clip review: a lit triangle means the current point is near its goal.
import {visible} from './first-three-reference.js';
import {REVIEW_RULES} from './practice-attempt-review.js';

const finitePoint=point=>!!point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
export function getLiveTargetHighlights(reference,observation,frame,
  {nowMs,maximumAgeMs=REVIEW_RULES.maximumAgeMs}={}){
  const sample=observation?.sample,at=observation?.observedAtMs;
  const frameValid=frame&&finitePoint(frame.hip)&&Number.isFinite(frame.scale)&&frame.scale>=.025
    &&Number.isFinite(frame.aspect)&&frame.aspect>0;
  let fresh=!!frameValid&&sample?.status==='pose'&&Array.isArray(sample.landmarks)
    &&Number.isFinite(sample.tMs)&&sample.tMs>=0&&Number.isFinite(nowMs)
    &&Number.isFinite(at)&&at>=0&&at<=nowMs&&nowMs-at<=maximumAgeMs
    &&Number.isFinite(observation.aspectRatio)&&Math.abs(observation.aspectRatio-frame.aspect)<1e-6;
  const points=new Map();
  if(fresh)for(const point of sample.landmarks){
    if(!point||!Number.isInteger(point.index)||points.has(point.index)){fresh=false;break;}
    points.set(point.index,point);
  }
  return (reference?.guides??[]).map(guide=>{
    const point=points.get(guide.index);
    const valid=!!fresh&&guide.valid===true&&finitePoint(guide.end)&&visible(point)
      &&point.visibility>=REVIEW_RULES.visibilityThreshold
      &&(point.presence===undefined||point.presence>=REVIEW_RULES.visibilityThreshold);
    const normalized=valid?{x:(point.x*frame.aspect-frame.hip.x)/frame.scale,
      y:(point.y-frame.hip.y)/frame.scale}:null;
    const distance=valid?Math.hypot(normalized.x-guide.end.x,normalized.y-guide.end.y):null;
    return {index:guide.index,valid,reached:valid&&distance<=REVIEW_RULES.endpointRadius,distance};
  });
}
