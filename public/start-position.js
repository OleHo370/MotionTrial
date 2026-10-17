// Raw anatomical start-position observations. This module has no DOM, camera,
// timers, display-mirroring, recording, or network side effects.
import {getFourPointBodyFrame, FOUR_POINT_COLORS, FOUR_POINT_OPTIONS} from './four-point-game-runtime.js';
import {CENTER_POINT_VERSION,CENTER_INDICES,BODY_POINT_VERSION,BODY_INDICES,BODY_COLORS,BODY_NAMES,controlPointIndices} from './practice-centers.js';

export const START_POSITION_RULES=Object.freeze({
  version:'four-start-squares-v1.1',
  holdMs:1500,
  maximumAgeMs:450,
  radius:0.40,
  visibilityThreshold:0.45,
  indices:Object.freeze([15,16,27,28]),
});
export const CENTER_START_POSITION_RULES=Object.freeze({...START_POSITION_RULES,
  version:'four-center-start-squares-v1.1',radius:.28,indices:CENTER_INDICES});
export const BODY_START_POSITION_RULES=Object.freeze({...CENTER_START_POSITION_RULES,
  version:'eight-body-start-squares-v1.1',radius:.20,indices:BODY_INDICES});
export const COMPACT_CENTER_START_POSITION_RULES=Object.freeze({...CENTER_START_POSITION_RULES,
  version:'four-center-compact-start-v1',radius:.20});
const startRulesFor=reference=>reference?.controlPointVersion===BODY_POINT_VERSION?BODY_START_POSITION_RULES
  :reference?.controlPointVersion===CENTER_POINT_VERSION?reference.targetSizeProfile==='compact'
    ?COMPACT_CENTER_START_POSITION_RULES:CENTER_START_POSITION_RULES:START_POSITION_RULES;
const NAMES={15:'Left hand',16:'Right hand',27:'Left foot',28:'Right foot',...BODY_NAMES};
const COLORS={...FOUR_POINT_COLORS,...BODY_COLORS};
const finitePoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const inFrame=p=>finitePoint(p)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const copyFrame=frame=>frame?{hip:{...frame.hip},scale:frame.scale,aspect:frame.aspect}:null;
function tracked(p){
  return inFrame(p)&&Number.isFinite(p.visibility)&&p.visibility>=START_POSITION_RULES.visibilityThreshold&&p.visibility<=1
    &&(p.presence===undefined||Number.isFinite(p.presence)&&p.presence>=START_POSITION_RULES.visibilityThreshold&&p.presence<=1);
}
function actualSupport(guide,side='start'){
  const support=guide?.support;
  const values=Array.isArray(support?.[`${side}TimesMs`])?support[`${side}TimesMs`]:Array.isArray(support?.[`${side}Frames`])?support[`${side}Frames`]:[];
  return [...new Set(values.filter(value=>Number.isFinite(value)&&value>=0))];
}

/**
 * Page-local coordinates for FIXED squares/triangles. The archived references
 * normalize each endpoint with its own torso frame; fixed-screen targets need
 * both endpoints expressed in ONE actual teacher starting frame instead.
 * Only coordinate units change. Raw observations and their actual support stay
 * untouched; no endpoint, missing point, opposite side, or trajectory is invented.
 */
export function prepareAnchoredReference(original,step,data){
  const clone=structuredClone(original??{}),aspect=data?.width/data?.height;
  const threshold=step?.referenceVisibilityThreshold??START_POSITION_RULES.visibilityThreshold;
  clone.guideVersion='fixed-start-anchor-v1.0';
  clone.teacherFrame=null;clone.teacherFrameTMs=null;clone.teacherFrameSourceSeconds=null;
  clone.anchorProvenance='Each supported raw endpoint is expressed in one actual recorded teacher starting-torso frame. Source observations and endpoint support are unchanged; no interpolation.';
  const usablePoint=point=>tracked(point)&&point.visibility>=threshold&&(point.presence===undefined||point.presence>=threshold);
  const candidates=original?.id===step?.id&&Array.isArray(data?.samples)&&Number.isFinite(step?.startSeconds)&&Number.isFinite(aspect)&&aspect>0
    &&Number.isFinite(threshold)&&threshold>=START_POSITION_RULES.visibilityThreshold&&threshold<=1
    ?data.samples.filter(sample=>sample.status==='pose'&&Number.isFinite(sample.tMs)&&sample.tMs>=step.startSeconds*1000-.01
      &&sample.tMs<(step.startSeconds+.25)*1000&&Array.isArray(sample.landmarks))
      .sort((a,b)=>Math.abs(a.tMs-step.startSeconds*1000)-Math.abs(b.tMs-step.startSeconds*1000)):[];
  let selected=null,frame=null;
  for(const sample of candidates){
    const raw=livePoints(sample),body=raw?getFourPointBodyFrame(sample,aspect):null;
    if(body&&[11,12,23,24].every(index=>usablePoint(raw.get(index)))){
      selected=sample;frame=body;break;
    }
  }
  if(frame){
    clone.teacherFrame=copyFrame(frame);clone.teacherFrameTMs=selected.tMs;
    clone.teacherFrameSourceSeconds=Number.isFinite(selected.sourceTimeSeconds)?selected.sourceTimeSeconds:null;
    clone.teacherFrameVisibilityThreshold=threshold;
  }
  clone.guides=(Array.isArray(clone.guides)?clone.guides:[]).map(guide=>{
    const hasStart=!!frame&&finitePoint(guide.start)&&inFrame(guide.startRaw)&&actualSupport(guide).length>=2;
    const hasEnd=!!frame&&finitePoint(guide.end)&&inFrame(guide.endRaw)&&actualSupport(guide,'end').length>=2;
    const start=hasStart?normalizeInFrame(guide.startRaw,frame):null,end=hasEnd?normalizeInFrame(guide.endRaw,frame):null;
    const length=start&&end?Math.hypot(end.x-start.x,end.y-start.y):null;
    return {...guide,start,end,startAvailable:hasStart,endAvailable:hasEnd,
      valid:guide.valid===true&&hasStart&&hasEnd,available:guide.valid===true&&hasStart&&hasEnd,
      distance:length,stationary:length!==null&&length<FOUR_POINT_OPTIONS.stationaryDistance};
  });
  const focus=Array.isArray(clone.focusJoints)?clone.focusJoints:[];
  const requiredMissing=focus.filter(index=>!clone.guides.find(guide=>guide.index===index)?.valid);
  if(!frame||!focus.length||requiredMissing.length||original?.referenceUsable===false){
    clone.referenceUsable=false;
    clone.unknownReason=!frame?'The teacher needs a clearly observed starting torso frame for fixed targets.'
      :original?.referenceUsable===false?original.unknownReason||'The recorded teacher action is not assessable.'
      :requiredMissing.length?`The teacher's ${requiredMissing.map(index=>NAMES[index]??'required point').join(' and ')} need clearer supported endpoints.`
      :'This teacher step has no anatomical movement focus.';
  }else{clone.referenceUsable=true;clone.unknownReason=null;}
  return clone;
}

/**
 * All FOUR actual starts are needed. An absent optional endpoint does not erase
 * its observed start: guide.valid describes start+end and is intentionally ignored.
 * Nothing is copied from the opposite side, generated, or gap-interpolated.
 */
export function prepareStartPosition(reference){
  const rules=startRulesFor(reference);
  const guides=Array.isArray(reference?.guides)?reference.guides:[];
  const targets=controlPointIndices(reference,START_POSITION_RULES.indices).map(index=>{
    const matching=guides.filter(guide=>guide?.index===index),guide=matching.length===1?matching[0]:null;
    const support=actualSupport(guide);
    const valid=!!guide&&finitePoint(guide.start)&&inFrame(guide.startRaw)&&support.length>=2
      &&Number.isFinite(guide.startSourceSeconds)&&guide.startSourceSeconds>=0;
    return {index,label:NAMES[index],color:COLORS[index],valid,
      normalizedStart:valid?{...guide.start}:null,startRaw:valid?{...guide.startRaw}:null,
      sourceSeconds:valid?guide.startSourceSeconds:null,supportCount:support.length,support};
  });
  const missing=targets.filter(target=>!target.valid);
  const validId=typeof reference?.id==='string'&&reference.id.length>0;
  const usable=validId&&!missing.length;
  const unknownReason=!validId?'The teacher step has no valid reference identity.':missing.length
    ?`The teacher's ${missing.map(target=>target.label.toLowerCase()).join(' and ')} need clearer recorded starting positions.`:null;
  return {referenceId:reference?.id??null,usable,unknownReason,targets,
    key:JSON.stringify([reference?.id??null,targets.map(target=>[target.index,target.normalizedStart,target.startRaw,target.sourceSeconds,target.support])]),
    radius:rules.radius,rulesVersion:rules.version};
}

export function createStartPositionSession(reference){
  const prepared=prepareStartPosition(reference);
  return {referenceId:prepared.referenceId,referenceKey:prepared.key,bodyFrame:null,aspect:null,
    firstNearAtMs:null,lastObservedAtMs:null,lastSampleTMs:null,nearSampleCount:0,heldMs:0,holdReady:false};
}
function clearHold(session){session.firstNearAtMs=null;session.nearSampleCount=0;session.heldMs=0;session.holdReady=false;}
function clearFrame(session){
  clearHold(session);session.bodyFrame=null;session.aspect=null;session.lastObservedAtMs=null;session.lastSampleTMs=null;
}

/** Screen coordinates remain raw. Mirror the completed display layer separately. */
export function projectStartPositionTargets(reference,session){
  const prepared=prepareStartPosition(reference),body=session?.bodyFrame;
  const frameValid=session?.referenceKey===prepared.key&&body&&finitePoint(body.hip)
    &&Number.isFinite(body.scale)&&body.scale>=0.025&&Number.isFinite(body.aspect)&&body.aspect>0;
  return prepared.targets.map(target=>{
    const point=target.valid&&frameValid?{
      x:(target.normalizedStart.x*body.scale+body.hip.x)/body.aspect,
      y:target.normalizedStart.y*body.scale+body.hip.y,
    }:null;
    return {...target,point,valid:target.valid&&!!frameValid&&inFrame(point)};
  });
}

/**
 * The first fresh, fully observed torso+four-point camera frame fixes the square
 * positions. Later hip movement cannot chase the squares around the screen.
 * Distances use that same fixed torso frame; aspect changes invalidate the frame.
 * status=match means all four are currently near their squares. Only holdReady
 * authorizes playback after 1500 ms of distinct, consecutive fresh observations.
 * A caller starts a new session for pause/retry/stop/step or camera changes.
 */
export function evaluateStartPosition(reference,live,{attemptAspectRatio,nowMs,observedAtMs,session}){
  const prepared=prepareStartPosition(reference);
  const count=prepared.targets.length===8?'eight':'four';
  if(session.referenceId!==prepared.referenceId||session.referenceKey!==prepared.key){
    Object.assign(session,createStartPositionSession(reference));
  }
  const describe=(status,reason,limbs=[],allNear=false)=>({
    status,reason,limbs,allNear,heldMs:session.heldMs,progressMs:session.heldMs,
    holdReady:session.holdReady,bodyFrame:copyFrame(session.bodyFrame),
    referenceUsable:prepared.usable,rulesVersion:prepared.rulesVersion,
  });
  const unknown=reason=>{
    clearHold(session);
    return describe('unknown',reason,projectStartPositionTargets(reference,session).map(target=>({
      index:target.index,label:target.label,color:target.color,sourceValid:prepared.targets.find(item=>item.index===target.index).valid,
      valid:false,near:false,distance:null,target:target.point,
    })));
  };
  if(!prepared.usable)return unknown(prepared.unknownReason);
  if(!Number.isFinite(attemptAspectRatio)||attemptAspectRatio<=0){clearFrame(session);return unknown('Waiting for a valid camera frame size.');}
  if(session.aspect!==null&&Math.abs(session.aspect-attemptAspectRatio)>0.000001){
    clearFrame(session);return unknown('Camera framing changed. Establish fresh starting positions.');
  }
  if(!Number.isFinite(nowMs)||!Number.isFinite(observedAtMs)||nowMs<0||observedAtMs<0||observedAtMs>nowMs
      ||nowMs-observedAtMs>START_POSITION_RULES.maximumAgeMs){
    return unknown('Waiting for a fresh camera observation.');
  }
  if(!live||live.status!=='pose'||!Number.isFinite(live.tMs)||live.tMs<0||!Array.isArray(live.landmarks)){
    return unknown('Keep your torso, both hands and both feet visible.');
  }
  const raw=new Map();
  for(const point of live.landmarks){
    if(!point||typeof point!=='object'||!Number.isInteger(point.index))return unknown('The camera observation has an invalid joint record.');
    if(raw.has(point.index))return unknown('The camera observation has duplicate joint identities.');
    raw.set(point.index,point);
  }
  const body=getFourPointBodyFrame(live,attemptAspectRatio);
  const missing=prepared.targets.map(target=>target.index).filter(index=>!tracked(raw.get(index)));
  if(!body||missing.length)return unknown(missing.length
    ?`${missing.map(index=>NAMES[index]).join(' and ')} temporarily hidden. All ${count} points must be visible together.`
    :'Keep your torso visible to establish the starting positions.');
  if(session.lastSampleTMs!==null&&(live.tMs<=session.lastSampleTMs||observedAtMs<=session.lastObservedAtMs)){
    return unknown('Waiting for a new camera observation.');
  }
  if(session.lastSampleTMs!==null&&(live.tMs-session.lastSampleTMs>START_POSITION_RULES.maximumAgeMs
      ||observedAtMs-session.lastObservedAtMs>START_POSITION_RULES.maximumAgeMs))clearHold(session);
  session.lastSampleTMs=live.tMs;session.lastObservedAtMs=observedAtMs;
  if(!session.bodyFrame){
    // A candidate that cannot place all four squares in view is not an anchor.
    // The learner may step back before the first usable frame is committed.
    const candidate={...session,bodyFrame:copyFrame(body),aspect:attemptAspectRatio};
    if(projectStartPositionTargets(reference,candidate).some(target=>!target.valid)){
      return unknown(`Leave more room around your body so all ${count} starting squares fit in the camera view.`);
    }
    session.bodyFrame=copyFrame(body);session.aspect=attemptAspectRatio;
  }
  const targets=projectStartPositionTargets(reference,session);
  if(targets.some(target=>!target.valid))return unknown('The starting squares fall outside the camera frame. Restart positioning with more room around your body.');
  const fixed=session.bodyFrame;
  const limbs=targets.map(target=>{
    const point=raw.get(target.index);
    const normalized={x:(point.x*fixed.aspect-fixed.hip.x)/fixed.scale,y:(point.y-fixed.hip.y)/fixed.scale};
    const distance=Math.hypot(normalized.x-target.normalizedStart.x,normalized.y-target.normalizedStart.y);
    return {index:target.index,label:target.label,color:target.color,sourceValid:true,valid:true,
      near:Math.abs(normalized.x-target.normalizedStart.x)<=prepared.radius
        &&Math.abs(normalized.y-target.normalizedStart.y)<=prepared.radius,
      distance,target:target.point};
  });
  const allNear=limbs.every(limb=>limb.near);
  if(!allNear){
    clearHold(session);
    const pending=limbs.filter(limb=>!limb.near);
    return describe('mismatch',`Place your ${pending.map(limb=>limb.label.toLowerCase()).join(' and ')} in the matching starting squares.`,limbs);
  }
  if(session.firstNearAtMs===null)session.firstNearAtMs=observedAtMs;
  session.nearSampleCount++;
  session.heldMs=Math.max(0,observedAtMs-session.firstNearAtMs);
  session.holdReady=session.nearSampleCount>=2&&session.heldMs>=START_POSITION_RULES.holdMs;
  return describe('match',session.holdReady?`All ${count} starting positions held for 1.5 seconds.`
    :`All ${count} points are in place. Hold steadily for 1.5 seconds.`,limbs,true);
}

export const POSITIONED_MOVEMENT_RULES=Object.freeze({
  version:'four-fixed-targets-v1.0',
  maximumAgeMs:FOUR_POINT_OPTIONS.maximumAgeMs,
  endRadius:FOUR_POINT_OPTIONS.endRadius,
  minimumForward:FOUR_POINT_OPTIONS.minimumForward,
  forwardFraction:FOUR_POINT_OPTIONS.forwardFraction,
  stationaryDistance:FOUR_POINT_OPTIONS.stationaryDistance,
});
export const BODY_POSITIONED_MOVEMENT_RULES=Object.freeze({...POSITIONED_MOVEMENT_RULES,
  version:'eight-body-fixed-targets-v1.1',endRadius:.28});
export const COMPACT_CENTER_POSITIONED_MOVEMENT_RULES=Object.freeze({...POSITIONED_MOVEMENT_RULES,
  version:'four-center-compact-finish-v1',endRadius:.28});
export const positionedMovementRulesFor=reference=>reference?.controlPointVersion===BODY_POINT_VERSION
  ?BODY_POSITIONED_MOVEMENT_RULES:reference?.controlPointVersion===CENTER_POINT_VERSION&&reference.targetSizeProfile==='compact'
    ?COMPACT_CENTER_POSITIONED_MOVEMENT_RULES:POSITIONED_MOVEMENT_RULES;
const validFrame=frame=>!!frame&&finitePoint(frame.hip)&&Number.isFinite(frame.scale)&&frame.scale>=0.025
  &&Number.isFinite(frame.aspect)&&frame.aspect>0;
function sameFrame(a,b){
  return validFrame(a)&&validFrame(b)&&Math.abs(a.hip.x-b.hip.x)<0.000000001
    &&Math.abs(a.hip.y-b.hip.y)<0.000000001&&Math.abs(a.scale-b.scale)<0.000000001
    &&Math.abs(a.aspect-b.aspect)<0.000001;
}
const normalizeInFrame=(point,body)=>({x:(point.x*body.aspect-body.hip.x)/body.scale,y:(point.y-body.hip.y)/body.scale});
const projectInFrame=(point,body)=>point&&validFrame(body)?{x:(point.x*body.scale+body.hip.x)/body.aspect,y:point.y*body.scale+body.hip.y}:null;
function livePoints(sample){
  if(!sample||sample.status!=='pose'||!Number.isFinite(sample.tMs)||sample.tMs<0||!Array.isArray(sample.landmarks))return null;
  const raw=new Map();
  for(const point of sample.landmarks){
    if(!point||typeof point!=='object'||!Number.isInteger(point.index)||raw.has(point.index))return null;
    raw.set(point.index,point);
  }
  return raw;
}
function prepareMovement(reference){
  const starting=prepareStartPosition(reference),focus=reference?.focusJoints,rules=positionedMovementRulesFor(reference);
  const validFocus=Array.isArray(focus)&&focus.length>0&&new Set(focus).size===focus.length
    &&focus.every(index=>starting.targets.some(target=>target.index===index));
  const guides=starting.targets.map(target=>{
    const guide=reference?.guides?.find(guide=>guide?.index===target.index),support=actualSupport(guide,'end');
    const valid=target.valid&&finitePoint(guide?.end)&&inFrame(guide?.endRaw)&&support.length>=2
      &&Number.isFinite(guide?.endSourceSeconds)&&guide.endSourceSeconds>=0;
    const required=validFocus&&focus.includes(target.index);
    const end=valid?{...guide.end}:null;
    const length=valid?Math.hypot(end.x-target.normalizedStart.x,end.y-target.normalizedStart.y):null;
    return {...target,valid,required,end,distance:length,stationary:length!==null&&length<rules.stationaryDistance,
      endSupport:support,endSourceSeconds:valid?guide.endSourceSeconds:null};
  });
  const missing=guides.filter(guide=>guide.required&&!guide.valid);
  const usable=starting.usable&&validFocus&&!missing.length&&reference?.referenceUsable!==false;
  const unknownReason=!starting.usable?starting.unknownReason:!validFocus?'This step has no valid anatomical movement focus.'
    :missing.length?`The teacher's ${missing.map(guide=>guide.label.toLowerCase()).join(' and ')} need clearer recorded endpoints.`
    :reference?.referenceUsable===false?reference.unknownReason||'The recorded teacher action is not assessable.':null;
  return {referenceId:starting.referenceId,usable,unknownReason,guides,
    key:JSON.stringify([starting.key,validFocus?focus:null,guides.map(guide=>[guide.index,guide.end,guide.endSourceSeconds,guide.endSupport]),reference?.referenceUsable])};
}

/**
 * Call once at the actual positioning unlock observation. Its four raw camera
 * points establish real movement baselines in the SAME frozen frame as the
 * squares and triangles. Start evaluating with the NEXT distinct observation.
 */
export function createPositionedMovementSession(reference,live,bodyFrame,aspect,{requireAllStarts=true}={}){
  const prepared=prepareMovement(reference),raw=livePoints(live),body=raw?getFourPointBodyFrame(live,aspect):null;
  const valid=prepared.usable&&validFrame(bodyFrame)&&Math.abs(bodyFrame.aspect-aspect)<=0.000001&&body&&raw
    &&prepared.guides.filter(guide=>requireAllStarts||guide.valid).every(guide=>tracked(raw.get(guide.index)));
  return {referenceId:prepared.referenceId,referenceKey:prepared.key,bodyFrame:valid?copyFrame(bodyFrame):null,
    aspect:valid?aspect:null,baselines:valid?Object.fromEntries(prepared.guides.map(guide=>[guide.index,
      tracked(raw.get(guide.index))?normalizeInFrame(raw.get(guide.index),bodyFrame):null])):null,
    maximumForward:Object.fromEntries(prepared.guides.map(guide=>[guide.index,0])),
    sampleCount:0,lastSampleTMs:valid?live.tMs:null,lastObservedAtMs:null,invalidated:!valid,
    invalidReason:valid?null:prepared.unknownReason||'Establish all starting positions again.'};
}
function clearMovement(session,reason){
  session.baselines=null;session.sampleCount=0;session.invalidated=true;session.invalidReason=reason;
  for(const index of Object.keys(session.maximumForward))session.maximumForward[index]=0;
}

/**
 * Every available endpoint must be reached in the frozen camera coordinates.
 * Required moving anatomical foci also need observed forward travel from the
 * true unlock pose. Optional missing source endpoints remain unavailable.
 * Unknown tracking invalidates movement evidence and requests fresh positioning;
 * an endpoint seen after an occlusion can never borrow the previous movement.
 */
export function evaluatePositionedMovement(reference,live,{attemptAspectRatio,nowMs,observedAtMs,bodyFrame,session}){
  const prepared=prepareMovement(reference),rules=positionedMovementRulesFor(reference);
  const describe=(status,reason,limbs,percent=null,requiresPositioning=false)=>({
    status,percent,reason,message:reason,limbs,focusJoints:prepared.guides.filter(guide=>guide.required).map(guide=>guide.index),
    referenceUsable:prepared.usable,requiresPositioning,bodyFrame:copyFrame(session.bodyFrame),
    rulesVersion:rules.version,
  });
  const unavailableLimbs=()=>prepared.guides.map(guide=>({index:guide.index,label:guide.label,color:guide.color,
    required:guide.required,available:guide.valid,valid:false,stationary:guide.stationary,startSeen:false,
    targetReached:false,movementObserved:false,progress:null,distanceToStart:null,distanceToTarget:null,projectedDisplacement:null,
    target:guide.valid?projectInFrame(guide.end,session.bodyFrame):null}));
  const unknown=(reason,reposition=true)=>{
    clearMovement(session,reason);
    return describe('unknown',reason,unavailableLimbs(),null,reposition);
  };
  if(session.referenceId!==prepared.referenceId||session.referenceKey!==prepared.key){
    return unknown('The teacher step changed. Establish its starting positions again.');
  }
  if(!prepared.usable)return unknown(prepared.unknownReason,false);
  if(session.invalidated||!session.baselines)return unknown(session.invalidReason||'Establish all starting positions again.');
  if(!validFrame(bodyFrame)||!sameFrame(bodyFrame,session.bodyFrame)
      ||!Number.isFinite(attemptAspectRatio)||Math.abs(attemptAspectRatio-session.aspect)>0.000001){
    return unknown('Camera framing changed. Establish fresh starting positions.');
  }
  if(!Number.isFinite(nowMs)||!Number.isFinite(observedAtMs)||nowMs<0||observedAtMs<0||observedAtMs>nowMs
      ||nowMs-observedAtMs>rules.maximumAgeMs){
    return unknown('Waiting for a fresh observation. Establish the starting positions again.');
  }
  const raw=livePoints(live),body=raw?getFourPointBodyFrame(live,attemptAspectRatio):null;
  if(!raw||!body)return unknown('Keep your torso and the required hands and feet visible. Return to the starting positions.');
  const missing=prepared.guides.filter(guide=>guide.valid&&!tracked(raw.get(guide.index)));
  if(missing.length)return unknown(`${missing.map(guide=>guide.label).join(' and ')} temporarily hidden. Return to the starting positions.`);
  if(session.lastSampleTMs!==null&&(live.tMs<=session.lastSampleTMs
      ||live.tMs-session.lastSampleTMs>rules.maximumAgeMs)){
    return unknown('A camera frame was repeated or interrupted. Establish the starting positions again.');
  }
  if(session.lastObservedAtMs!==null&&(observedAtMs<=session.lastObservedAtMs
      ||observedAtMs-session.lastObservedAtMs>rules.maximumAgeMs)){
    return unknown('Camera observations were interrupted. Establish the starting positions again.');
  }
  const targets=prepared.guides.filter(guide=>guide.valid).map(guide=>projectInFrame(guide.end,session.bodyFrame));
  if(targets.some(target=>!inFrame(target)))return unknown('Leave more room around your body, then establish the starting positions again so every endpoint fits in view.');
  session.lastSampleTMs=live.tMs;session.lastObservedAtMs=observedAtMs;session.sampleCount++;
  const limbs=prepared.guides.map(guide=>{
    if(!guide.valid)return {index:guide.index,label:guide.label,color:guide.color,required:guide.required,available:false,
      valid:false,stationary:false,startSeen:true,targetReached:false,movementObserved:false,progress:null,
      distanceToStart:null,distanceToTarget:null,projectedDisplacement:null,target:null};
    const point=normalizeInFrame(raw.get(guide.index),session.bodyFrame),baseline=session.baselines[guide.index];
    const distanceToTarget=Math.hypot(point.x-guide.end.x,point.y-guide.end.y);
    const distanceToStart=Math.hypot(point.x-guide.normalizedStart.x,point.y-guide.normalizedStart.y);
    const forward=guide.distance>0?((point.x-baseline.x)*(guide.end.x-guide.normalizedStart.x)
      +(point.y-baseline.y)*(guide.end.y-guide.normalizedStart.y))/guide.distance:0;
    session.maximumForward[guide.index]=Math.max(session.maximumForward[guide.index],forward);
    const movementRequired=guide.required&&!guide.stationary;
    const requiredDisplacement=Math.max(rules.minimumForward,guide.distance*rules.forwardFraction);
    const movementObserved=!movementRequired||session.maximumForward[guide.index]>=requiredDisplacement;
    const targetReached=distanceToTarget<=rules.endRadius&&movementObserved;
    const travel=movementRequired?Math.min(1,session.maximumForward[guide.index]/requiredDisplacement):1;
    const progress=targetReached?1:Math.min(.95,.25+.35*travel+(distanceToTarget<=rules.endRadius ? .30 : 0));
    return {index:guide.index,label:guide.label,color:guide.color,required:guide.required,available:true,valid:true,
      stationary:guide.stationary,movementRequired,startSeen:true,targetReached,movementObserved,progress,
      distanceToStart,distanceToTarget,projectedDisplacement:forward,requiredDisplacement,target:projectInFrame(guide.end,session.bodyFrame)};
  });
  const available=limbs.filter(limb=>limb.available);
  if(available.every(limb=>limb.targetReached))return describe('match','All available endpoints reached. Hold briefly to finish.',limbs,100);
  const pending=available.find(limb=>!limb.targetReached);
  const reason=!pending.movementObserved?`Move your ${pending.label.toLowerCase()} along the teacher's demonstrated direction.`
    :`Bring your ${pending.label.toLowerCase()} close to its matching finish triangle.`;
  const percent=Math.min(99,Math.round(available.reduce((sum,limb)=>sum+limb.progress,0)/available.length*100));
  return describe('mismatch',reason,limbs,percent);
}
