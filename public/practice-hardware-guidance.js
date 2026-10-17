// Optional live circuit feedback. This observer never grades an attempt, changes
// playback, smooths a landmark, mirrors a coordinate, or sends a network request.
import {REVIEW_RULES} from './practice-attempt-review.js';

export const HARDWARE_GUIDANCE_RULES=Object.freeze({
  version:'raw-four-point-hardware-guidance-v1',
  warningDelayMs:250,recoveryDelayMs:200,
  visibilityThreshold:REVIEW_RULES.visibilityThreshold,
  maximumAgeMs:REVIEW_RULES.maximumAgeMs,
  maximumObservedGapMs:REVIEW_RULES.maximumObservedGapMs,
  warningRadius:REVIEW_RULES.broadGuideRadius,
  recoveryRadius:REVIEW_RULES.endpointRadius,
});
const INDICES=Object.freeze([33,34,35,36]);
const NAMES={33:'Left hand',34:'Right hand',35:'Left foot',36:'Right foot'};
const finitePoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const validFrame=f=>!!f&&finitePoint(f.hip)&&Number.isFinite(f.aspect)&&f.aspect>0
  &&Number.isFinite(f.scale)&&f.scale>=.025&&f.hip.x>=0&&f.hip.x<=f.aspect
  &&f.hip.y>=0&&f.hip.y<=1&&f.scale<=Math.hypot(f.aspect,1);
const trusted=p=>finitePoint(p)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1
  &&Number.isFinite(p.visibility)&&p.visibility>=REVIEW_RULES.visibilityThreshold&&p.visibility<=1
  &&(p.presence===undefined||Number.isFinite(p.presence)
    &&p.presence>=REVIEW_RULES.visibilityThreshold&&p.presence<=1);
const normalize=(p,f)=>({x:(p.x*f.aspect-f.hip.x)/f.scale,y:(p.y-f.hip.y)/f.scale});
const clamp=n=>Math.max(0,Math.min(1,n));
function segmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy;
  const t=n?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/n):0;
  return distance(p,{x:a.x+t*dx,y:a.y+t*dy});
}
function guideDistance(point,control){
  if(!control.moving)return distance(point,control.start);
  let nearest=Infinity;
  for(let i=1;i<control.points.length;i++)
    nearest=Math.min(nearest,segmentDistance(point,control.points[i-1],control.points[i]));
  return nearest;
}
function controlsFor(reference,pathReference){
  const guides=reference?.guides,paths=pathReference?.paths;
  if(reference?.referenceUsable!==true||pathReference?.referenceUsable!==true
    ||!Array.isArray(guides)||guides.length!==4||!Array.isArray(paths)
    ||new Set(guides.map(g=>g?.index)).size!==4
    ||new Set(paths.map(p=>p?.index)).size!==paths.length
    ||pathReference.referenceId!==undefined&&pathReference.referenceId!==reference.id)return null;
  const controls=[];
  for(const index of INDICES){
    const guide=guides.find(g=>g?.index===index),path=paths.find(p=>p?.index===index);
    if(guide?.valid!==true||!finitePoint(guide.start)||!finitePoint(guide.end))return null;
    const moving=guide.targetGeometry?.mode!=='hold'&&distance(guide.start,guide.end)
      >=(index>=35?REVIEW_RULES.minimumFootDisplacement:REVIEW_RULES.minimumHandDisplacement);
    if(moving&&(path?.available!==true||!Array.isArray(path.points)
      ||path.points.length<2||!path.points.every(finitePoint)))return null;
    controls.push({index,label:guide.label??NAMES[index],moving,start:{...guide.start},end:{...guide.end},
      points:moving?path.points.map(p=>({x:p.x,y:p.y})):[]});
  }
  return controls;
}
const unknownLimbs=()=>INDICES.map(index=>({index,label:NAMES[index],status:'unknown',deviation:null,moving:null}));
const frameKey=f=>validFrame(f)?JSON.stringify([f.hip.x,f.hip.y,f.scale,f.aspect]):null;
const controlKey=controls=>controls?JSON.stringify(controls):null;
const rawKey=observation=>JSON.stringify([observation.sample.status,observation.aspectRatio,
  observation.sample.landmarks.map(p=>[p.index,p.x,p.y,p.visibility,p.presence])]);

/**
 * Input is the same raw, unmirrored observation and frozen body frame consumed
 * by the end-of-clip reviewer. The broad route is a spatial UNION, so this does
 * not demand a teacher phase, ordered checkpoints, or synchronised progress.
 * Repeated render calls may expire a result but cannot accumulate support.
 */
export function createHardwareGuidance(){
  let result,mode,lastNowMs,lastSampleTMs,lastObservedAtMs,lastRawKey,lastValidAtMs;
  let previousReference,previousPathReference,previousFrameKey,previousControlKey,previousContext;
  let outsideSince,recoverySince;
  const snapshot=()=>({...result,limbs:result.limbs.map(limb=>({...limb}))});
  function clearEvidence(){mode='idle';outsideSince=new Map();recoverySince=null;lastValidAtMs=null;}
  function neutral(reason){
    clearEvidence();result={state:'idle',reason,limbs:unknownLimbs()};return snapshot();
  }
  function reset(){
    clearEvidence();lastNowMs=null;lastSampleTMs=null;lastObservedAtMs=null;lastRawKey=null;
    previousReference=null;previousPathReference=null;previousFrameKey=null;previousControlKey=null;previousContext=undefined;
    result={state:'idle',reason:'Practice is not active.',limbs:unknownLimbs()};return snapshot();
  }
  reset();
  function update(reference,pathReference,observation,frame,{nowMs,active=false,contextKey=null}={}){
    if(!active){reset();return snapshot();}
    const controls=controlsFor(reference,pathReference),fk=frameKey(frame),ck=controlKey(controls);
    if(previousReference!==reference||previousPathReference!==pathReference||previousFrameKey!==fk
      ||previousControlKey!==ck||previousContext!==contextKey){
      reset();previousReference=reference;previousPathReference=pathReference;
      previousFrameKey=fk;previousControlKey=ck;previousContext=contextKey;
    }
    if(!Number.isFinite(nowMs)||nowMs<0||lastNowMs!==null&&nowMs<lastNowMs)
      return neutral('Tracking clock changed.');
    lastNowMs=nowMs;
    if(!controls)return neutral('Movement guidelines are unavailable.');
    if(!fk)return neutral('Camera placement is unavailable.');
    const sample=observation?.sample,observedAtMs=observation?.observedAtMs;
    if(!Number.isFinite(observedAtMs)||observedAtMs<0||observedAtMs>nowMs
      ||nowMs-observedAtMs>REVIEW_RULES.maximumAgeMs)
      return neutral('Fresh camera tracking is unavailable.');
    if(!Number.isFinite(observation?.aspectRatio)||Math.abs(observation.aspectRatio-frame.aspect)>1e-6)
      return neutral('Camera framing changed.');
    if(!Number.isFinite(sample?.tMs)||sample.tMs<0||!Array.isArray(sample.landmarks)
      ||sample.landmarks.some(p=>!Number.isInteger(p?.index)||p.index<0)
      ||new Set(sample.landmarks.map(p=>p.index)).size!==sample.landmarks.length)
      return neutral('Camera tracking is invalid.');
    const key=rawKey(observation);
    if(lastSampleTMs!==null&&(sample.tMs<=lastSampleTMs||observedAtMs<=lastObservedAtMs)){
      if(sample.tMs===lastSampleTMs&&observedAtMs===lastObservedAtMs&&key===lastRawKey)
        return snapshot();
      return neutral('Camera tracking did not advance.');
    }
    lastSampleTMs=sample.tMs;lastObservedAtMs=observedAtMs;lastRawKey=key;
    const points=new Map(sample.landmarks.map(point=>[point.index,point]));
    if(sample.status!=='pose'||!INDICES.every(index=>trusted(points.get(index))))
      return neutral('Keep both hands and both feet visible.');
    if(lastValidAtMs===null||observedAtMs-lastValidAtMs>REVIEW_RULES.maximumObservedGapMs)clearEvidence();
    lastValidAtMs=observedAtMs;
    const limbs=controls.map(control=>{
      const deviation=guideDistance(normalize(points.get(control.index),frame),control);
      const status=deviation>HARDWARE_GUIDANCE_RULES.warningRadius?'outside'
        :deviation<=HARDWARE_GUIDANCE_RULES.recoveryRadius?'inside':'border';
      return {index:control.index,label:control.label,moving:control.moving,deviation,status};
    });
    for(const limb of limbs){
      if(limb.status==='outside'){
        if(!outsideSince.has(limb.index))outsideSince.set(limb.index,observedAtMs);
      }else outsideSince.delete(limb.index);
    }
    const outside=limbs.filter(limb=>limb.status==='outside');
    const sustained=outside.filter(limb=>observedAtMs-outsideSince.get(limb.index)>=HARDWARE_GUIDANCE_RULES.warningDelayMs);
    const allInside=limbs.every(limb=>limb.status==='inside');
    if(allInside)recoverySince??=observedAtMs;else recoverySince=null;
    if(sustained.length)mode='off';
    else if(allInside&&observedAtMs-recoverySince>=HARDWARE_GUIDANCE_RULES.recoveryDelayMs)mode='good';
    const state=mode==='off'?'off':outside.length?'idle':mode;
    const reason=state==='off'?(outside.length
      ?`${(sustained.length?sustained:outside).map(limb=>limb.label).join(' and ')} outside the general guideline.`
      :'Move fully inside the guidelines to clear the warning.')
      :state==='good'?'All four points are within the general guidelines.'
      :outside.length?'Checking movement outside the guideline.':'Checking all four points.';
    result={state,reason,limbs};return snapshot();
  }
  return {update,reset,getState:snapshot};
}
