// Ordered spatial practice routes made only from actual archived observations.
// This page-local module does not change the older start/end matching rules.
import {createPositionedMovementSession,evaluatePositionedMovement} from './start-position.js';
import {getFourPointBodyFrame,FOUR_POINT_COLORS} from './four-point-game-runtime.js';
import {CENTER_POINT_VERSION,BODY_POINT_VERSION,BODY_COLORS,BODY_NAMES,controlPointIndices} from './practice-centers.js';

export const MOVEMENT_PATH_RULES=Object.freeze({
  version:'ordered-source-path-v1.1',
  checkpointHalfWidth:.18,
  simplifyTolerance:.06,
  minimumCheckpoints:3,
  maximumCheckpoints:5,
  minimumCheckpointTravel:.025,
  phaseAmbiguityDistance:.035,
  maximumAgeMs:450,
  maximumSourceGapFactor:1.6,
  minimumSourceGapMs:100,
  maximumSourceGapMs:250,
  minimumArcLength:.12,
  pathProgressWeight:.75,
  endpointProgressWeight:.25,
});
// Foot centers retain the observed heel/toe turns; older wrist/ankle routes keep
// their five-square limit and all existing matching tolerances.
export const CENTER_MOVEMENT_PATH_RULES=Object.freeze({...MOVEMENT_PATH_RULES,version:'ordered-center-path-v1',maximumCheckpoints:8,preferredMaximumCheckpoints:5});
const INDICES=[15,16,27,28],TORSO=[11,12,23,24];
const NAMES={15:'Left hand',16:'Right hand',27:'Left foot',28:'Right foot',...BODY_NAMES};
const COLORS={...FOUR_POINT_COLORS,...BODY_COLORS};
const finitePoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const inFrame=p=>finitePoint(p)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const unit=value=>Math.max(0,Math.min(1,value));
const validFrame=body=>!!body&&finitePoint(body.hip)&&Number.isFinite(body.scale)&&body.scale>=.025&&Number.isFinite(body.aspect)&&body.aspect>0;
const normalize=(point,body)=>({x:(point.x*body.aspect-body.hip.x)/body.scale,y:(point.y-body.hip.y)/body.scale});
const project=(point,body)=>validFrame(body)&&finitePoint(point)?{x:(point.x*body.scale+body.hip.x)/body.aspect,y:point.y*body.scale+body.hip.y}:null;
const copyFrame=body=>validFrame(body)?{hip:{...body.hip},scale:body.scale,aspect:body.aspect}:null;
function trusted(point,threshold){
  return inFrame(point)&&Number.isFinite(point.visibility)&&point.visibility>=threshold&&point.visibility<=1
    &&(point.presence===undefined||Number.isFinite(point.presence)&&point.presence>=threshold&&point.presence<=1);
}
function rawPoints(sample){
  if(!sample||sample.status!=='pose'||!Array.isArray(sample.landmarks)||!Number.isFinite(sample.tMs)||sample.tMs<0)return null;
  const points=new Map();
  for(const point of sample.landmarks){
    if(!point||!Number.isInteger(point.index)||points.has(point.index))return null;
    points.set(point.index,point);
  }
  return points;
}
function identicalFrame(a,b){
  return validFrame(a)&&validFrame(b)&&Math.abs(a.hip.x-b.hip.x)<1e-9&&Math.abs(a.hip.y-b.hip.y)<1e-9
    &&Math.abs(a.scale-b.scale)<1e-9&&Math.abs(a.aspect-b.aspect)<1e-6;
}
function pointSegmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?unit(((point.x-a.x)*dx+(point.y-a.y)*dy)/length):0;
  return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
}
/** RDP selects existing observed vertices. It never generates a route observation. */
function simplifyIndices(points,tolerance,start=0,end=points.length-1){
  if(end-start<2)return [start,end];
  let greatest=0,selected=-1;
  for(let i=start+1;i<end;i++){
    const d=pointSegmentDistance(points[i].point,points[start].point,points[end].point);
    if(d>greatest){greatest=d;selected=i;}
  }
  if(greatest<=tolerance)return [start,end];
  return [...simplifyIndices(points,tolerance,start,selected).slice(0,-1),...simplifyIndices(points,tolerance,selected,end)];
}
function chooseCheckpoints(polyline,rules=MOVEMENT_PATH_RULES){
  const last=polyline.length-1;
  const corners=simplifyIndices(polyline,rules.simplifyTolerance).filter(index=>index>0&&index<last
    &&polyline[index].arcPhase>=.06&&polyline[index].arcPhase<=.94);
  if(corners.length>rules.maximumCheckpoints)return null;
  const wanted=Math.max(corners.length,Math.max(rules.minimumCheckpoints,
    Math.min(rules.preferredMaximumCheckpoints??rules.maximumCheckpoints,Math.ceil(polyline.at(-1).arcLength/.30)-1)));
  const selected=new Set(corners),interior=polyline.map((point,index)=>index).filter(index=>index>0&&index<last);
  const candidates=new Set();
  for(let k=1;k<=wanted;k++){
    const phase=k/(wanted+1);
    const nearest=interior.reduce((best,index)=>Math.abs(polyline[index].arcPhase-phase)<Math.abs(polyline[best].arcPhase-phase)?index:best,interior[0]);
    candidates.add(nearest);
  }
  while(selected.size<wanted){
    let choices=[...candidates].filter(index=>!selected.has(index));
    if(!choices.length)choices=interior.filter(index=>!selected.has(index));
    if(!choices.length)return null;
    let best=choices[0],bestSeparation=-1;
    for(const index of choices){
      const phase=polyline[index].arcPhase;
      const separation=Math.min(phase,1-phase,...[...selected].map(other=>Math.abs(phase-polyline[other].arcPhase)));
      if(separation>bestSeparation){best=index;bestSeparation=separation;}
    }
    selected.add(best);
  }
  const ordered=[...selected].sort((a,b)=>a-b);
  return ordered.map((index,i)=>{
    const observed=polyline[index],previous=i?polyline[ordered[i-1]].arcPhase:0,next=i<ordered.length-1?polyline[ordered[i+1]].arcPhase:1;
    return {...observed,ordinal:i+1,halfWidth:MOVEMENT_PATH_RULES.checkpointHalfWidth,halfSize:MOVEMENT_PATH_RULES.checkpointHalfWidth,
      phase:observed.arcPhase,phaseMin:(previous+observed.arcPhase)/2,phaseMax:(observed.arcPhase+next)/2};
  });
}

/** Actual source samples become a route in the existing fixed teacher frame. */
export function prepareMovementPaths(reference,step,data){
  const rules=[CENTER_POINT_VERSION,BODY_POINT_VERSION].includes(reference?.controlPointVersion)?CENTER_MOVEMENT_PATH_RULES:MOVEMENT_PATH_RULES;
  const focus=reference?.focusJoints,aspect=data?.width/data?.height,body=reference?.teacherFrame;
  const threshold=step?.referenceVisibilityThreshold??.45;
  const validFocus=Array.isArray(focus)&&focus.length>0&&new Set(focus).size===focus.length&&focus.every(index=>controlPointIndices(reference,INDICES).includes(index));
  const samples=Array.isArray(data?.samples)?data.samples:[];
  const anchorSample=samples.find(sample=>sample.tMs===reference?.teacherFrameTMs),anchorRaw=rawPoints(anchorSample);
  const actualAnchor=anchorRaw?getFourPointBodyFrame(anchorSample,aspect):null;
  const frameValid=reference?.id===step?.id&&validFrame(body)&&Number.isFinite(aspect)&&aspect>0
    &&identicalFrame(body,actualAnchor)&&TORSO.every(index=>trusted(anchorRaw?.get(index),threshold));
  const sourceRate=Number.isFinite(data?.sampleRateHz)&&data.sampleRateHz>0?data.sampleRateHz:12;
  const maximumSourceGapMs=Math.min(MOVEMENT_PATH_RULES.maximumSourceGapMs,
    Math.max(MOVEMENT_PATH_RULES.minimumSourceGapMs,1000/sourceRate*MOVEMENT_PATH_RULES.maximumSourceGapFactor));
  const sourceError=!validFocus?'This step has no unique anatomical movement focus.':!frameValid
    ?'This route needs the actual recorded teacher starting frame.':reference.referenceUsable===false
    ?reference.unknownReason||'The recorded teacher movement cannot be assessed.':null;
  const paths=(validFocus?focus:[]).map(index=>{
    const matching=(reference.guides||[]).filter(guide=>guide.index===index),guide=matching.length===1?matching[0]:null;
    const empty=reason=>({index,label:NAMES[index],color:COLORS[index],required:true,available:false,reason,
      polyline:[],checkpoints:[],segments:[],gaps:[],sourceSampleCount:0,trustedSampleCount:0,coverage:0});
    if(sourceError)return empty(sourceError);
    if(!guide?.valid||!inFrame(guide.startRaw)||!inFrame(guide.endRaw)||!Number.isFinite(guide.startSourceSeconds)
        ||!Number.isFinite(guide.endSourceSeconds)||guide.endSourceSeconds<=guide.startSourceSeconds){
      return empty(`${NAMES[index]} needs clearly supported recorded start and finish observations.`);
    }
    const start=samples.find(sample=>Number.isFinite(sample.sourceTimeSeconds)&&Math.abs(sample.sourceTimeSeconds-guide.startSourceSeconds)<1e-7);
    const end=samples.find(sample=>Number.isFinite(sample.sourceTimeSeconds)&&Math.abs(sample.sourceTimeSeconds-guide.endSourceSeconds)<1e-7);
    if(!start||!end||start.tMs<step.startSeconds*1000-.01||end.tMs>=step.endSeconds*1000+.01||end.tMs<=start.tMs){
      return empty(`${NAMES[index]} route endpoints are not actual observations inside this step.`);
    }
    const startPoint=rawPoints(start)?.get(index),endPoint=rawPoints(end)?.get(index);
    if(!startPoint||!endPoint||distance(startPoint,guide.startRaw)>1e-9||distance(endPoint,guide.endRaw)>1e-9){
      return empty(`${NAMES[index]} route endpoints do not match their original observations.`);
    }
    const span=samples.filter(sample=>sample.tMs>=start.tMs-.01&&sample.tMs<=end.tMs+.01);
    const segments=[],gaps=[];let segment=[],previous=null,trustedCount=0;
    for(const sample of span){
      const raw=rawPoints(sample),point=raw?.get(index);
      const valid=raw&&trusted(point,threshold)&&TORSO.every(joint=>trusted(raw.get(joint),threshold))
        &&Number.isFinite(sample.sourceTimeSeconds)&&sample.sourceTimeSeconds>=0;
      if(!valid){
        if(segment.length)segments.push(segment);segment=[];previous=null;
        gaps.push({tMs:sample.tMs,sourceTimeSeconds:sample.sourceTimeSeconds??null,reason:'Missing or insufficiently tracked actual source observation.'});
        continue;
      }
      if(previous&&(sample.tMs<=previous.tMs||sample.tMs-previous.tMs>maximumSourceGapMs
          ||sample.sourceTimeSeconds<=previous.sourceTimeSeconds)){
        if(segment.length)segments.push(segment);segment=[];
        gaps.push({fromTMs:previous.tMs,toTMs:sample.tMs,reason:'Actual source observations are interrupted or out of order.'});
      }
      const observed={point:normalize(point,body),raw:{...point},tMs:sample.tMs,sourceTimeSeconds:sample.sourceTimeSeconds,
        sourceSampleIndex:samples.indexOf(sample),supportTimesMs:[sample.tMs]};
      segment.push(observed);previous=sample;trustedCount++;
    }
    if(segment.length)segments.push(segment);
    const metadata={index,label:NAMES[index],color:COLORS[index],required:true,sourceSampleCount:span.length,
      trustedSampleCount:trustedCount,coverage:trustedCount/Math.max(1,span.length),maximumSourceGapMs,segments,gaps};
    if(gaps.length||segments.length!==1)return {...metadata,available:false,reason:`${NAMES[index]} route has missing source observations. No path is drawn across the gap.`,polyline:[],checkpoints:[]};
    if(segments[0].length<MOVEMENT_PATH_RULES.minimumCheckpoints+2)return {...metadata,available:false,
      reason:`${NAMES[index]} needs more actual observations for ordered route squares.`,polyline:[],checkpoints:[]};
    let arcLength=0;
    const polyline=segments[0].map((observed,sampleIndex)=>{
      if(sampleIndex)arcLength+=distance(observed.point,segments[0][sampleIndex-1].point);
      return {...observed,sampleIndex,arcLength};
    });
    if(arcLength<MOVEMENT_PATH_RULES.minimumArcLength)return {...metadata,available:false,
      reason:`${NAMES[index]} recorded route is too small for ordered squares.`,polyline:[],checkpoints:[]};
    for(const point of polyline)point.arcPhase=point.arcLength/arcLength;
    const checkpoints=chooseCheckpoints(polyline,rules);
    if(!checkpoints)return {...metadata,available:false,reason:`${NAMES[index]} needs a clearer route with a manageable number of actual turns.`,polyline:[],checkpoints:[]};
    return {...metadata,available:true,reason:null,arcLength,polyline,checkpoints,
      startSourceSeconds:start.sourceTimeSeconds,endSourceSeconds:end.sourceTimeSeconds,
      provenance:'Only this named anatomical point is used. Route vertices and squares are actual archived observations in one fixed teacher frame. Lines between continuous observations are visual guides, not interpolated tracking.'};
  });
  const usable=!sourceError&&paths.length>0&&paths.every(path=>path.available);
  const unknownReason=usable?null:sourceError||paths.find(path=>!path.available)?.reason||'The recorded route is unavailable.';
  return {referenceId:reference?.id??null,referenceUsable:usable,unknownReason,rulesVersion:rules.version,paths,
    teacherFrame:copyFrame(body),teacherFrameTMs:reference?.teacherFrameTMs??null,teacherFrameSourceSeconds:reference?.teacherFrameSourceSeconds??null,
    key:JSON.stringify([reference?.id,rules.version,paths.map(path=>[path.index,path.available,
      path.polyline.map(point=>[point.tMs,point.point]),path.checkpoints.map(point=>point.sampleIndex)])])};
}

/** Call at the already verified four-square unlock observation. */
export function createMovementPathSession(reference,pathReference,live,bodyFrame,aspect){
  const movement=createPositionedMovementSession(reference,live,bodyFrame,aspect),raw=rawPoints(live);
  return {referenceId:reference?.id??null,pathKey:pathReference?.key??null,movement,bodyFrame:copyFrame(bodyFrame),aspect,
    invalidated:!pathReference?.referenceUsable||movement.invalidated,
    paths:Object.fromEntries((pathReference?.paths||[]).map(path=>[path.index,{
      nextIndex:0,collected:0,lastCollectedSourceIndex:0,lastCollectedPhase:0,
      lastCollectedPoint:raw?.get(path.index)&&validFrame(bodyFrame)?normalize(raw.get(path.index),bodyFrame):null,
      closestPhase:null,distanceToNext:null,outOfOrder:false,
    }]))};
}
function clearPathEvidence(session){
  session.invalidated=true;
  for(const state of Object.values(session.paths||{}))Object.assign(state,{nextIndex:0,collected:0,lastCollectedSourceIndex:0,
    lastCollectedPhase:0,lastCollectedPoint:null,closestPhase:null,distanceToNext:null,outOfOrder:false});
  if(session.movement){
    session.movement.invalidated=true;session.movement.baselines=null;session.movement.sampleCount=0;
    for(const index of Object.keys(session.movement.maximumForward))session.movement.maximumForward[index]=0;
  }
}
function pathResults(pathReference,session){
  return pathReference.paths.map(path=>{
    const progress=session.paths[path.index],collected=progress?.collected||0,total=path.checkpoints.length;
    return {index:path.index,label:path.label,color:path.color,required:true,available:path.available,
      reason:path.reason,collected,total,nextIndex:collected,complete:path.available&&collected===total,
      closestPhase:progress?.closestPhase??null,distanceToNext:progress?.distanceToNext??null,outOfOrder:!!progress?.outOfOrder};
  });
}
function counts(paths){
  const totalCheckpoints=paths.reduce((sum,path)=>sum+path.total,0),collectedCheckpoints=paths.reduce((sum,path)=>sum+path.collected,0);
  return {totalCheckpoints,collectedCheckpoints,pathProgress:totalCheckpoints?collectedCheckpoints/totalCheckpoints:0,
    pathComplete:paths.length>0&&paths.every(path=>path.available&&path.complete)};
}

/** Current endpoint proximity cannot replace visiting the ordered interior route. */
export function evaluateMovementPaths(reference,pathReference,live,{attemptAspectRatio,nowMs,observedAtMs,bodyFrame,session}){
  const unavailable=(reason,reposition=true,base=null)=>{
    clearPathEvidence(session);
    const paths=pathResults(pathReference,session);
    return {...(base||{}),status:'unknown',percent:null,reason,message:reason,limbs:base?.limbs||[],
      requiresPositioning:reposition,referenceUsable:pathReference.referenceUsable,
      rulesVersion:pathReference.rulesVersion,paths,...counts(paths)};
  };
  if(!pathReference.referenceUsable)return unavailable(pathReference.unknownReason||'The recorded route cannot be assessed.',false);
  if(session.referenceId!==reference.id||session.pathKey!==pathReference.key)return unavailable('The movement route changed. Establish its four starting positions again.');
  if(session.invalidated)return unavailable('Establish the four starting positions again before following the route.');
  const base=evaluatePositionedMovement(reference,live,{attemptAspectRatio,nowMs,observedAtMs,bodyFrame,session:session.movement});
  if(base.status==='unknown')return unavailable(base.reason,base.requiresPositioning!==false,base);
  if(!identicalFrame(bodyFrame,session.bodyFrame))return unavailable('Camera framing changed. Establish the four starting positions again.',true,base);
  if(pathReference.paths.some(path=>path.available&&path.polyline.some(observed=>!inFrame(project(observed.point,bodyFrame))))){
    return unavailable('The movement route is outside the camera view. Step back and establish the four starting positions again.',true,base);
  }
  const raw=rawPoints(live);
  if(!raw)return unavailable('A fresh anatomical camera observation is needed. Start from the four squares again.',true,base);
  for(const path of pathReference.paths){
    const state=session.paths[path.index];
    if(state.collected>=path.checkpoints.length)continue;
    const current=normalize(raw.get(path.index),session.bodyFrame),target=path.checkpoints[state.collected];
    // Include the last collected actual sample. A stationary circle then remains
    // closest to that phase instead of consuming overlapping future squares.
    const eligible=path.polyline.filter(point=>point.sampleIndex>=state.lastCollectedSourceIndex);
    let closest=eligible[0],closestDistance=Infinity;
    for(const observed of eligible){
      const d=distance(current,observed.point);
      if(d<closestDistance-1e-10){closest=observed;closestDistance=d;}
    }
    // Nearby returns of a curved route can be spatially indistinguishable under
    // normal tracking noise. Prefer the earlier still-eligible phase inside a
    // small explicit ambiguity margin. A distant endpoint remains a later phase;
    // holding one point still cannot advance the next phase or travel evidence.
    closest=eligible.find(observed=>distance(current,observed.point)<=closestDistance+MOVEMENT_PATH_RULES.phaseAmbiguityDistance)||closest;
    state.closestPhase=closest.arcPhase;state.distanceToNext=distance(current,target.point);
    const inSquare=Math.abs(current.x-target.point.x)<=MOVEMENT_PATH_RULES.checkpointHalfWidth
      &&Math.abs(current.y-target.point.y)<=MOVEMENT_PATH_RULES.checkpointHalfWidth;
    const inPhase=closest.arcPhase>=target.phaseMin-1e-10&&closest.arcPhase<=target.phaseMax+1e-10;
    const moved=!!state.lastCollectedPoint&&distance(current,state.lastCollectedPoint)>=MOVEMENT_PATH_RULES.minimumCheckpointTravel;
    state.outOfOrder=closest.arcPhase>target.phaseMax+1e-10;
    if(inSquare&&inPhase&&moved){
      state.collected++;state.nextIndex=state.collected;state.lastCollectedSourceIndex=target.sampleIndex;
      state.lastCollectedPhase=target.arcPhase;state.lastCollectedPoint={...current};state.outOfOrder=false;
    }
  }
  const paths=pathResults(pathReference,session),summary=counts(paths);
  const status=base.status==='match'&&summary.pathComplete?'match':'mismatch';
  const pending=paths.find(path=>!path.complete);
  const reason=pending?`${pending.outOfOrder?'Return your':'Guide your'} ${pending.label.toLowerCase()} to square ${pending.nextIndex+1} of ${pending.total} in order.`
    :base.status==='match'?'Ordered route and finish targets reached. Hold briefly to finish.':base.reason;
  const percent=status==='match'?100:Math.min(99,Math.round(100*MOVEMENT_PATH_RULES.pathProgressWeight*summary.pathProgress
    +MOVEMENT_PATH_RULES.endpointProgressWeight*(base.percent??0)));
  return {...base,status,percent,reason,message:reason,rulesVersion:pathReference.rulesVersion,
    paths,...summary,endpointStatus:base.status,endpointRulesVersion:base.rulesVersion};
}

/** Raw camera coordinates only. Apply mirror transforms to the display layer. */
export function projectMovementPaths(pathReference,bodyFrame,session){
  const matches=session?.pathKey===pathReference?.key&&identicalFrame(bodyFrame,session?.bodyFrame);
  return (pathReference?.paths||[]).map(path=>{
    const collected=matches?session.paths[path.index]?.collected||0:0,total=path.checkpoints.length;
    const available=path.available&&validFrame(bodyFrame);
    return {index:path.index,label:path.label,color:path.color,available,sourceAvailable:path.available,reason:path.reason,
      complete:available&&collected===total,collected,total,nextIndex:collected,
      polyline:available?path.polyline.map(observed=>project(observed.point,bodyFrame)):[],
      checkpoints:available?path.checkpoints.map((checkpoint,i)=>({ordinal:checkpoint.ordinal,
        point:project(checkpoint.point,bodyFrame),state:i<collected?'collected':i===collected?'next':'future',
        halfWidth:MOVEMENT_PATH_RULES.checkpointHalfWidth,halfSize:MOVEMENT_PATH_RULES.checkpointHalfWidth,
        sourceTimeSeconds:checkpoint.sourceTimeSeconds,tMs:checkpoint.tMs})):[]};
  });
}
