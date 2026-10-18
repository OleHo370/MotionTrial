// Completion uses fresh raw observations. Earlier hits are never latched while
// another control is missing or away from its triangle.
import {getLiveTargetHighlights} from './practice-target-highlight.js';
import {REVIEW_RULES} from './practice-attempt-review.js';

export function createEndTargetSession(){
  return {firstNearAtMs:null,nearSampleCount:0,lastSampleTMs:null,lastObservedAtMs:null};
}
const clearHold=session=>{session.firstNearAtMs=null;session.nearSampleCount=0;};
export function evaluateEndTargets(reference,observation,frame,{nowMs,session,controlIndices}={}){
  session??=createEndTargetSession();
  const guides=Array.isArray(reference?.guides)?reference.guides:[];
  const requested=controlIndices??guides.map(guide=>guide.index),indices=Array.isArray(requested)?requested:[];
  const validSelection=Array.isArray(requested)&&new Set(indices).size===indices.length
    &&(indices.length===4&&[[33,34,35,36],[15,16,27,28]].some(set=>set.every(index=>indices.includes(index)))
      ||controlIndices!==undefined&&indices.length===2&&[33,34].every(index=>indices.includes(index)));
  const highlights=getLiveTargetHighlights({...reference,guides},observation,frame,{nowMs});
  const limbs=highlights.filter(target=>indices.includes(target.index));
  const describe=(complete,reason)=>({complete,reason,hitCount:limbs.filter(limb=>limb.valid&&limb.reached).length,
    targetCount:indices.length,limbs,heldMs:session.firstNearAtMs===null?0:Math.max(0,observation.observedAtMs-session.firstNearAtMs)});
  const unknown=reason=>{clearHold(session);return describe(false,reason);};
  if(!validSelection||reference?.referenceUsable!==true||limbs.length!==indices.length
    ||new Set(limbs.map(limb=>limb.index)).size!==indices.length)
    return unknown('Movement targets are unavailable.');
  const sample=observation?.sample,at=observation?.observedAtMs;
  if(!Number.isFinite(sample?.tMs)||sample.tMs<0||!Number.isFinite(at)||at<0||!limbs.every(limb=>limb.valid))
    return unknown('Keep every required hand and foot visible.');
  if(session.lastSampleTMs!==null&&(sample.tMs<=session.lastSampleTMs||at<=session.lastObservedAtMs))
    return unknown('Waiting for fresh tracking.');
  if(session.lastObservedAtMs!==null&&at-session.lastObservedAtMs>REVIEW_RULES.maximumObservedGapMs)clearHold(session);
  session.lastSampleTMs=sample.tMs;session.lastObservedAtMs=at;
  if(!limbs.every(limb=>limb.reached))return unknown('Reach all ending triangles at your own pace.');
  session.firstNearAtMs??=at;session.nearSampleCount++;
  const complete=session.nearSampleCount>=3&&at-session.firstNearAtMs>=REVIEW_RULES.endpointSupportMs;
  return describe(complete,complete?'All triangles reached.':'Keep all triangles reached briefly.');
}
