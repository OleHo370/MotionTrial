// Experimental guard retained for review, DISABLED in the live camera. It added
// whole-body prerequisites absent from the working direct observation pipeline.
// Live-only rejection of unsupported control points. Raw SDK observations stay
// intact. Never average coordinates, substitute another joint, or keep an old dot.
import {CENTER_INDICES} from './practice-centers.js';
import {getFourPointBodyFrame} from './four-point-game-runtime.js';

export const LIVE_CONTROL_RULES=Object.freeze({version:'observed-live-controls-v1',
  confidence:.45,maximumAgeMs:450,maximumJump:.40,reacquireDistance:.16,confirmFrames:2,
  maximumPalmOffset:.45,maximumFootOffset:.70,minimumFootBelowHip:-.15,minimumTorsoToFaceWidth:.8});
const trusted=p=>!!p&&[p.x,p.y,p.visibility].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1
  &&p.visibility>=LIVE_CONTROL_RULES.confidence&&p.visibility<=1
  &&(p.presence===undefined||Number.isFinite(p.presence)&&p.presence>=LIVE_CONTROL_RULES.confidence&&p.presence<=1);
const distance=(a,b,aspect)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
export function createLiveControlGuard(){
  let states=new Map(),lastTime=null,lastAspect=null,suppressed=[];
  function reset(){states=new Map();lastTime=null;lastAspect=null;suppressed=[];}
  function getState(){return {rulesVersion:LIVE_CONTROL_RULES.version,suppressed:structuredClone(suppressed),
    acceptedIndices:[...states].filter(([,s])=>s.accepted&&s.tMs===lastTime).map(([index])=>index)};}
  function apply(sample,{aspectRatio}={}){
    if(!sample||!Array.isArray(sample.landmarks)){reset();return sample;}
    const raw=sample.landmarks.filter(p=>!CENTER_INDICES.includes(p.index)),points=new Map(sample.landmarks.map(p=>[p.index,p]));
    const hideAll=reason=>{
      states.clear();suppressed=CENTER_INDICES.map(index=>({index,reason}));
      return {...sample,landmarks:raw,controlQuality:getState()};
    };
    if(!Number.isFinite(sample.tMs)||sample.tMs<0||sample.status!=='pose'||!Number.isFinite(aspectRatio)||aspectRatio<=0)
      return hideAll('No fresh observed pose.');
    if(lastTime!==null&&sample.tMs<=lastTime)return hideAll('A camera frame was repeated or arrived out of order.');
    if(lastTime!==null&&(sample.tMs-lastTime>LIVE_CONTROL_RULES.maximumAgeMs||Math.abs(lastAspect-aspectRatio)>1e-6))states.clear();
    lastTime=sample.tMs;lastAspect=aspectRatio;suppressed=[];
    const body=getFourPointBodyFrame(sample,aspectRatio);
    if(!body)return hideAll('Keep the torso and full body inside the camera view.');
    const facePoints=raw.filter(p=>p.index>=0&&p.index<=10&&trusted(p));
    let face=null;
    if(facePoints.length>=3){
      const left=Math.min(...facePoints.map(p=>p.x)),right=Math.max(...facePoints.map(p=>p.x));
      const top=Math.min(...facePoints.map(p=>p.y)),bottom=Math.max(...facePoints.map(p=>p.y));
      const width=(right-left)*aspectRatio,pad=Math.max(width*.3,(bottom-top)*.5);
      if(width>=.015){
        face={left:left-(right-left)*.1,right:right+(right-left)*.1,top:top-pad,bottom:bottom+pad};
        if(body.scale<width*LIVE_CONTROL_RULES.minimumTorsoToFaceWidth)
          return hideAll('The body estimate has collapsed near the face. Waiting for a clearly observed body.');
      }
    }
    const accepted=[];
    for(const index of CENTER_INDICES){
      const point=points.get(index),anchor=points.get(index===33?15:index===34?16:index===35?27:28);
      let reason=!trusted(point)?'This hand or foot is not clearly observed.':null;
      if(!reason&&index>=35&&face&&point.x>=face.left&&point.x<=face.right&&point.y>=face.top&&point.y<=face.bottom)
        reason='A face-region estimate cannot be used as a foot tracker.';
      if(!reason&&index>=35&&(point.y-body.hip.y)/body.scale<LIVE_CONTROL_RULES.minimumFootBelowHip)
        reason='The foot estimate is inconsistent with the observed body.';
      if(!reason&&trusted(anchor)&&distance(point,anchor,aspectRatio)/body.scale>(index>=35?LIVE_CONTROL_RULES.maximumFootOffset:LIVE_CONTROL_RULES.maximumPalmOffset))
        reason='The hand or foot estimate is detached from its observed limb.';
      if(reason){states.delete(index);suppressed.push({index,reason});continue;}
      let state=states.get(index);
      if(state?.accepted&&distance(point,state.accepted,aspectRatio)/body.scale<=LIVE_CONTROL_RULES.maximumJump){
        state={accepted:{...point},tMs:sample.tMs,pending:null,pendingCount:0};
      }else{
        const consistent=state?.pending&&distance(point,state.pending,aspectRatio)/body.scale<=LIVE_CONTROL_RULES.reacquireDistance;
        const count=consistent?state.pendingCount+1:1;
        state={accepted:state?.accepted??null,tMs:state?.tMs??null,pending:{...point},pendingCount:count};
        if(count>=LIVE_CONTROL_RULES.confirmFrames)state={accepted:{...point},tMs:sample.tMs,pending:null,pendingCount:0};
      }
      states.set(index,state);
      if(state.tMs===sample.tMs)accepted.push(point);
      else suppressed.push({index,reason:'Waiting for consistent fresh hand or foot observations.'});
    }
    return {...sample,landmarks:[...raw,...accepted],controlQuality:getState()};
  }
  return {apply,reset,getState};
}
