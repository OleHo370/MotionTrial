// Whole-area practice: no checkpoints or required order inside the corridor.
// Unknown tracking breaks only that limb's observed run, never creates travel.
import {visible} from './first-three-reference.js';
import {finishTargetContains} from './first-three-attempt.js';
import {prepareStartPosition,positionedMovementRulesFor} from './start-position.js';
import {getFourPointBodyFrame} from './four-point-game-runtime.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const copy=frame=>frame?{hip:{...frame.hip},scale:frame.scale,aspect:frame.aspect}:null;
const normalize=(point,frame)=>({x:(point.x*frame.aspect-frame.hip.x)/frame.scale,y:(point.y-frame.hip.y)/frame.scale});
const project=(point,frame)=>({x:(point.x*frame.scale+frame.hip.x)/frame.aspect,y:point.y*frame.scale+frame.hip.y});
const trusted=point=>visible(point)&&point.visibility>=.45&&(point.presence===undefined||point.presence>=.45);
const sameFrame=(a,b)=>a&&b&&Math.abs(a.aspect-b.aspect)<1e-6&&Math.abs(a.scale-b.scale)<1e-9
  &&Math.abs(a.hip.x-b.hip.x)<1e-9&&Math.abs(a.hip.y-b.hip.y)<1e-9;
function nearest(path,point){
  let best=null;
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const fraction=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
    const hit={x:a.x+dx*fraction,y:a.y+dy*fraction};
    const candidate={distance:distance(point,hit),arc:a.arcLength+(b.arcLength-a.arcLength)*fraction};
    if(!best||candidate.distance<best.distance-1e-9)best=candidate;
  }
  return best;
}
const inStart=(reference,path,point)=>{
  const start=reference.guides.find(guide=>guide.index===path.index)?.start;
  const radius=prepareStartPosition(reference).radius;
  return !!start&&Math.abs(point.x-start.x)<=radius&&Math.abs(point.y-start.y)<=radius;
};
export function isInsidePracticeArea(reference,path,point){
  if(!path?.available||!point||![point.x,point.y].every(Number.isFinite))return false;
  const end=reference.guides.find(guide=>guide.index===path.index)?.end;
  return inStart(reference,path,point)||finishTargetContains(point,end,reference,path.index)
    ||(nearest(path,point)?.distance??Infinity)<=path.halfWidth;
}
function breakRun(state,{unknown=false}={}){
  Object.assign(state,{arc:0,complete:false,runArmed:false,lastPoint:null,observedTravel:0,
    needsRejoin:true,entryPending:false,offPath:!unknown,trackingStatus:unknown?'unknown':'observed'});
}

export function createAreaMatcher(rules){
  const resetAll=session=>{for(const state of Object.values(session.paths))breakRun(state,{unknown:true});};
  return Object.freeze({mode:'area',requiresRoute:true,retainsStartedTargets:true,
    createSession(reference,pathReference,live,bodyFrame,aspect){
      const points=new Map(live?.landmarks?.map(point=>[point.index,point])??[]);
      return {referenceId:reference.id,pathKey:pathReference.key,bodyFrame:copy(bodyFrame),aspect,
        lastSampleTMs:live?.tMs??null,lastObservedAtMs:null,
        paths:Object.fromEntries(pathReference.paths.map(path=>{
          const point=points.get(path.index),p=trusted(point)?normalize(point,bodyFrame):null;
          const runArmed=!!p&&path.available&&inStart(reference,path,p);
          return [path.index,{arc:0,complete:false,runArmed,lastPoint:runArmed?p:null,observedTravel:0,
            needsRejoin:!runArmed,entryPending:false,offPath:false,trackingStatus:p?'observed':'unknown'}];
        }))};
    },
    evaluate(reference,pathReference,live,{session,bodyFrame,attemptAspectRatio,nowMs,observedAtMs}){
      const results=()=>pathReference.paths.map(path=>{
        const state=session.paths[path.index];
        const progress=state?.complete?1:Math.max(0,Math.min(1,(state?.arc??0)/Math.max(.001,path.totalLength)));
        return {index:path.index,label:path.label,color:path.color,available:path.available,progress,
          complete:!!state?.complete,trackingStatus:state?.trackingStatus??'unknown',
          offPath:!!state?.offPath,needsRejoin:!!state?.needsRejoin,entryPending:false,
          insideArea:!!state?.runArmed&&!state?.offPath,collected:Math.round(progress*100),total:100};
      });
      const pack=(base,status,reason,showProgress=true)=>{
        const paths=results(),pathComplete=paths.length?paths.every(path=>path.complete):base.status==='match';
        const pathProgress=paths.length?paths.reduce((sum,path)=>sum+path.progress,0)/paths.length:pathComplete?1:0;
        return {requiresPositioning:false,referenceUsable:reference.referenceUsable,bodyFrame:copy(bodyFrame),
          ...base,status,reason,message:reason,percent:!showProgress?null:pathComplete?100:Math.min(99,Math.round(pathProgress*100)),
          paths,pathComplete,pathProgress,pathRequired:paths.length>0,practiceMode:'area',endpointStatus:base.status,
          rulesVersion:rules.version};
      };
      if(!pathReference.referenceUsable)return pack({status:'unknown',limbs:[]},'unknown',pathReference.unknownReason,false);
      if(session.referenceId!==reference.id||session.pathKey!==pathReference.key
        ||!sameFrame(session.bodyFrame,bodyFrame)||session.aspect!==attemptAspectRatio)
        return pack({status:'unknown',requiresPositioning:true,limbs:[]},'unknown','The movement area or camera changed. Establish the starting squares again.',false);
      const maximumAge=positionedMovementRulesFor(reference).maximumAgeMs;
      const fresh=live?.status==='pose'&&Number.isFinite(live.tMs)&&live.tMs>=0&&Array.isArray(live.landmarks)
        &&Number.isFinite(nowMs)&&nowMs>=0&&Number.isFinite(observedAtMs)&&observedAtMs>=0&&observedAtMs<=nowMs
        &&nowMs-observedAtMs<=maximumAge
        &&(session.lastSampleTMs===null||live.tMs>session.lastSampleTMs)
        &&(session.lastObservedAtMs===null||observedAtMs>session.lastObservedAtMs);
      const raw=new Map();let valid=fresh;
      if(fresh)for(const point of live.landmarks){
        if(!point||!Number.isInteger(point.index)||raw.has(point.index)){valid=false;break;}
        raw.set(point.index,point);
      }
      if(!valid){
        resetAll(session);
        return pack({status:'unknown',limbs:[]},'unknown','Tracking is missing or delayed. Return moving points to their start areas when tracking returns.');
      }
      if(session.lastSampleTMs!==null&&live.tMs-session.lastSampleTMs>maximumAge
        ||session.lastObservedAtMs!==null&&observedAtMs-session.lastObservedAtMs>maximumAge)resetAll(session);
      session.lastSampleTMs=live.tMs;session.lastObservedAtMs=observedAtMs;
      for(const path of pathReference.paths){
        const state=session.paths[path.index],point=raw.get(path.index);
        if(!trusted(point)){breakRun(state,{unknown:true});continue;}
        state.trackingStatus='observed';
        const current=normalize(point,bodyFrame);
        if(!isInsidePracticeArea(reference,path,current)){breakRun(state);continue;}
        if(!state.runArmed||!state.lastPoint){
          state.offPath=false;
          if(inStart(reference,path,current)){
            Object.assign(state,{runArmed:true,lastPoint:current,observedTravel:0,arc:0,complete:false,needsRejoin:false});
          }
          continue; // Reacquisition/rearming does not earn unseen movement.
        }
        const travelled=distance(current,state.lastPoint);
        if(travelled>rules.maximumObservedStep){breakRun(state,{unknown:true});continue;}
        // Check the entire observed short segment against the whole visible
        // area. There is no required arc window, checkpoint or direction order.
        let contained=true;
        const divisions=Math.max(8,Math.ceil(travelled/.025));
        for(let i=1;i<divisions;i++){
          const t=i/divisions,p={x:state.lastPoint.x+(current.x-state.lastPoint.x)*t,
            y:state.lastPoint.y+(current.y-state.lastPoint.y)*t};
          if(!isInsidePracticeArea(reference,path,p)){contained=false;break;}
        }
        if(!contained){breakRun(state);continue;}
        state.offPath=false;state.needsRejoin=false;state.lastPoint=current;
        state.observedTravel+=travelled;
        const candidate=nearest(path,current);
        if(candidate)state.arc=Math.max(state.arc,candidate.arc);
        const end=reference.guides.find(guide=>guide.index===path.index)?.end;
        if(state.observedTravel>=rules.minimumObservedTravel&&finishTargetContains(current,end,reference,path.index)){
          state.complete=true;state.arc=path.totalLength;
        }
      }
      const limbs=reference.guides.map(guide=>{
        const point=raw.get(guide.index),valid=guide.valid&&trusted(point);
        const current=valid?normalize(point,bodyFrame):null,path=session.paths[guide.index];
        return {index:guide.index,label:guide.label,color:guide.color,required:guide.required,
          available:guide.valid,valid:!!valid,targetReached:!!valid&&finishTargetContains(current,guide.end,reference,guide.index),
          movementObserved:!path||path.complete,hold:!path,progress:path?path.complete?1:0:null,
          target:guide.valid?project(guide.end,bodyFrame):null,distanceToTarget:valid?distance(current,guide.end):null};
      });
      const missing=limbs.filter(limb=>limb.available&&!limb.valid);
      const torsoObserved=!!getFourPointBodyFrame(live,attemptAspectRatio)
        &&[11,12,23,24].every(index=>trusted(raw.get(index)));
      const trackingUnknown=results().some(path=>path.trackingStatus==='unknown');
      const endpointStatus=missing.length||!torsoObserved?'unknown':limbs.every(limb=>limb.available&&limb.targetReached)?'match':'mismatch';
      const base={status:endpointStatus,limbs};
      if(missing.length||!torsoObserved||trackingUnknown){
        const names=missing.length?missing.map(limb=>limb.label.toLowerCase()).join(' and '):!torsoObserved?'torso':'moving points';
        return pack(base,'unknown',`Tracking is unclear for ${names}. Clear moving points can continue; hidden movement cannot count.`);
      }
      const pending=results().find(path=>!path.complete),pendingTarget=limbs.find(limb=>!limb.targetReached);
      const matched=!pending&&endpointStatus==='match';
      const reason=pending?.needsRejoin?`Return your ${pending.label.toLowerCase()} to its starting area, then stay inside the colored area.`
        :pending?`Keep your ${pending.label.toLowerCase()} inside its colored area and reach the finish triangle.`
        :matched?'Movement areas and finish targets reached; continuing.'
        :`Keep your ${pendingTarget?.label.toLowerCase()??'tracked points'} in the finish target.`;
      return pack(base,matched?'match':'mismatch',reason);
    },
  });
}
