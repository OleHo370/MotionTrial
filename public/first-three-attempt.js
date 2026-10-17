// Keep the exercise's completion requirements consistent with its visible guides.
// Shared endpoint/route rules and other practice pages remain unchanged.
import {positionedMovementRulesFor,createPositionedMovementSession,evaluatePositionedMovement} from './start-position.js';
import {createMovementPathSession,evaluateMovementPaths} from './movement-path.js';

export const finishTargetSize=(reference,index)=>{
  const shared=reference?.guides?.find(guide=>guide.index===index)?.finishTargetSize;
  return Number.isFinite(shared)&&shared>0?shared:positionedMovementRulesFor(reference).endRadius*.85;
};
export const finishTriangleSize=(bodyFrame,canvasHeight,reference,index)=>finishTargetSize(reference,index)*bodyFrame.scale*canvasHeight;

// Same upright triangle drawn by first-three.js, expressed in fixed-body units.
// Tube mode uses the visible target itself; legacy endpoint rules stay unchanged.
export function finishTargetContains(point,target,reference,index){
  if(!point||!target||![point.x,point.y,target.x,target.y].every(Number.isFinite))return false;
  const size=finishTargetSize(reference,index);
  const x=Math.abs(point.x-target.x),y=point.y-target.y,epsilon=1e-8;
  return y>=-size-epsilon&&y<=size*.65+epsilon
    &&x<=.9/1.65*(y+size)+epsilon;
}

const copyFrame=frame=>({hip:{...frame.hip},scale:frame.scale,aspect:frame.aspect});
const signature=reference=>JSON.stringify([reference?.id,reference?.referenceUsable,reference?.guideVersion,
  reference?.teacherFrame,reference?.focusJoints,reference?.guides]);
const sameFrame=(a,b)=>a&&b&&Math.abs(a.aspect-b.aspect)<1e-6&&Math.abs(a.scale-b.scale)<1e-9
  &&Math.abs(a.hip?.x-b.hip?.x)<1e-9&&Math.abs(a.hip?.y-b.hip?.y)<1e-9;

export function createPracticeMatcher({requireRoute=false,retainStartedTargets=false}={}){
  const retain=!!retainStartedTargets&&!requireRoute;
  const decorate=result=>({...result,pathRequired:false,practiceMode:'endpoints',paths:[],endpointStatus:result.status});
  function waiting(reference,session,reason){
    return decorate({status:'unknown',percent:null,reason,message:reason,limbs:[],requiresPositioning:false,
      referenceUsable:reference.referenceUsable,bodyFrame:copyFrame(session.retainedStart.bodyFrame),
      rulesVersion:positionedMovementRulesFor(reference).version,recoveringTracking:true});
  }
  function suspend(session){
    session.recoveryPending=true;session.baselines=null;session.sampleCount=0;session.invalidated=true;
    for(const index of Object.keys(session.maximumForward))session.maximumForward[index]=0;
  }
  return Object.freeze({
    mode:requireRoute?'route':'endpoints',requiresRoute:!!requireRoute,retainsStartedTargets:retain,
    createSession(reference,pathReference,live,bodyFrame,aspect){
      if(requireRoute)return createMovementPathSession(reference,pathReference,live,bodyFrame,aspect);
      const session=createPositionedMovementSession(reference,live,bodyFrame,aspect);
      if(retain&&!session.invalidated)session.retainedStart={referenceSignature:signature(reference),
        referenceKey:session.referenceKey,bodyFrame:copyFrame(bodyFrame),aspect,
        lastSampleTMs:live.tMs,lastObservedAtMs:null};
      return session;
    },
    evaluate(reference,pathReference,live,options){
      if(requireRoute)return {...evaluateMovementPaths(reference,pathReference,live,options),pathRequired:true,practiceMode:'route'};
      const {session,bodyFrame,attemptAspectRatio,nowMs,observedAtMs}=options,anchor=session.retainedStart;
      // A changed exercise or physical camera frame still needs a new start.
      const retainThisAttempt=retain&&anchor&&anchor.referenceSignature===signature(reference)
        &&sameFrame(anchor.bodyFrame,bodyFrame)&&Math.abs(anchor.aspect-attemptAspectRatio)<1e-6;
      if(retainThisAttempt&&session.recoveryPending){
        const fresh=live?.status==='pose'&&Number.isFinite(live.tMs)&&live.tMs>anchor.lastSampleTMs
          &&Number.isFinite(nowMs)&&nowMs>=0&&Number.isFinite(observedAtMs)&&observedAtMs>=0&&observedAtMs<=nowMs
          &&nowMs-observedAtMs<=positionedMovementRulesFor(reference).maximumAgeMs
          &&(anchor.lastObservedAtMs===null||observedAtMs>anchor.lastObservedAtMs);
        const recovered=fresh?createPositionedMovementSession(reference,live,bodyFrame,attemptAspectRatio,{requireAllStarts:false}):null;
        if(!recovered||recovered.invalidated||recovered.referenceKey!==anchor.referenceKey)
          return waiting(reference,session,'Tracking is unclear. The finish targets stay active; keep required joints visible.');
        // Reacquisition establishes an observed baseline, not a completed move.
        // Unseen movement during the gap cannot count toward the finish.
        Object.assign(session,recovered,{retainedStart:anchor,recoveryPending:false,recoveryBaseline:true,lastObservedAtMs:observedAtMs});
        anchor.lastSampleTMs=live.tMs;anchor.lastObservedAtMs=observedAtMs;
        return waiting(reference,session,'Tracking restored. Move toward the triangles; if already there, ease back and return.');
      }
      const result=evaluatePositionedMovement(reference,live,options);
      if(retainThisAttempt&&result.status==='unknown'){
        suspend(session);
        return waiting(reference,session,'Tracking is temporarily unclear. The finish targets stay active; keep required joints visible.');
      }
      if(retainThisAttempt&&session.recoveryBaseline&&result.status==='mismatch'){
        // Recovery may occur at the endpoint. A fresh backed-off position can
        // then arm the return movement, without requiring a trip to the squares.
        for(const limb of result.limbs.filter(l=>l.valid&&l.movementRequired&&!l.movementObserved&&l.projectedDisplacement<0)){
          const point=live.landmarks.find(p=>p.index===limb.index);
          session.baselines[limb.index]={x:(point.x*bodyFrame.aspect-bodyFrame.hip.x)/bodyFrame.scale,
            y:(point.y-bodyFrame.hip.y)/bodyFrame.scale};
          session.maximumForward[limb.index]=0;
        }
      }
      if(retainThisAttempt){anchor.lastSampleTMs=live.tMs;anchor.lastObservedAtMs=observedAtMs;}
      return decorate(result);
    },
  });
}
