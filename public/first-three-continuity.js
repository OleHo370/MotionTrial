// One genuine observed pose per teaching cut, shared by both adjacent steps.
// The original manifest and all raw archives remain immutable.
import {prepareFirstThreeReference,visible} from './first-three-reference.js';
import {getFourPointBodyFrame} from './four-point-game-runtime.js';

export const CONTINUITY_VERSION='continuous-observed-cuts-v1';
const TORSO=[11,12,23,24],EPS=1e-6;
const sourceTime=(step,source,side)=>source.video.sourceStartSeconds+step[`${side}Seconds`];
const cropKey=source=>JSON.stringify([source.video.width,source.video.height,
  ...['x','y','width','height'].map(key=>source.video.sourceCropPixels?.[key])]);
function supported(sample,indices,aspect,threshold){
  if(sample?.status!=='pose'||!Number.isFinite(sample.tMs)||!Number.isFinite(sample.sourceTimeSeconds)||!Array.isArray(sample.landmarks))return false;
  const points=new Map(sample.landmarks.map(point=>[point.index,point]));
  return points.size===sample.landmarks.length&&!!getFourPointBodyFrame(sample,aspect)
    &&[...TORSO,...indices].every(index=>{
      const point=points.get(index);
      return visible(point)&&point.visibility>=threshold&&(point.presence===undefined||point.presence>=threshold);
    });
}
function boundaryPose(source,cutSeconds,indices,threshold){
  const aspect=source.data.width/source.data.height;
  const trusted=source.data.samples.filter(sample=>supported(sample,indices,aspect,threshold));
  const candidates=trusted.filter(sample=>Math.abs(sample.sourceTimeSeconds-cutSeconds)<=.125+EPS)
    .sort((a,b)=>Math.abs(a.sourceTimeSeconds-cutSeconds)-Math.abs(b.sourceTimeSeconds-cutSeconds)||a.tMs-b.tMs);
  for(const sample of candidates){
    const samples=trusted.filter(other=>Math.abs(other.tMs-sample.tMs)<=250+EPS);
    if(samples.length>=2)return {available:true,sourceId:source.id,tMs:sample.tMs,
      sourceTimeSeconds:sample.sourceTimeSeconds,samples,threshold};
  }
  // Never replace a missing joint with a guess or a pose from another phase.
  return {available:false,sourceId:source.id,tMs:null,sourceTimeSeconds:cutSeconds,samples:[],threshold};
}

export function prepareContinuousLesson(originalSteps,sources,options={}){
  const steps=structuredClone(originalSteps).map(step=>({...step,originalTeachingInterval:{
    startSeconds:step.startSeconds,endSeconds:step.endSeconds,
    sourceStartSeconds:step.sourceStartSeconds,sourceEndSeconds:step.sourceEndSeconds,
  }})),boundaries=steps.map(()=>({})),seams=[];
  const indices=options.pointIndices??[15,16,27,28];
  for(let i=0;i<steps.length-1;i++){
    const previous=steps[i],next=steps[i+1],left=sources.get(previous.sourceId),right=sources.get(next.sourceId);
    if(!left||!right)throw new Error('A teaching cut is missing its recorded source.');
    const originalEndSeconds=sourceTime(previous,left,'end'),originalStartSeconds=sourceTime(next,right,'start');
    const sameSource=left.id===right.id;
    const compatible=cropKey(left)===cropKey(right)&&left.data.sourceSha256===right.data.sourceSha256
      &&left.data.modelSha256===right.data.modelSha256;
    const joined=sameSource?Math.abs(originalEndSeconds-originalStartSeconds)<EPS
      :Math.abs(left.video.sourceEndSeconds-right.video.sourceStartSeconds)<EPS
        &&Math.abs(originalStartSeconds-right.video.sourceStartSeconds)<EPS
        &&originalEndSeconds<=originalStartSeconds+EPS&&originalStartSeconds-originalEndSeconds<=.35;
    if(!compatible||!joined)throw new Error('These teaching clips do not share a consecutive source timeline and crop.');
    const threshold=Math.max(previous.referenceVisibilityThreshold??.45,next.referenceVisibilityThreshold??.45);
    // At an encoded-source join, use the incoming archive with its explicit ID.
    const boundary=boundaryPose(sameSource?left:right,originalStartSeconds,indices,threshold);
    const cut=sameSource&&boundary.available?boundary.sourceTimeSeconds:originalStartSeconds;
    previous.endSeconds=cut-left.video.sourceStartSeconds;
    next.startSeconds=cut-right.video.sourceStartSeconds;
    previous.sourceEndSeconds=cut;next.sourceStartSeconds=cut;
    const id=`${previous.id}--${next.id}`;
    const metadata={id,fromStepId:previous.id,toStepId:next.id,available:boundary.available,
      sourceId:boundary.sourceId,tMs:boundary.tMs,sourceTimeSeconds:boundary.sourceTimeSeconds,
      supportTimesMs:boundary.samples.map(sample=>sample.tMs),threshold,
      originalEndSeconds,originalStartSeconds,cutSeconds:cut,
      closedGapSeconds:Math.max(0,originalStartSeconds-originalEndSeconds),
      reason:boundary.available?null:'No supported shared control-point observation at this cut. The boundary remains unassessed.'};
    previous.endBoundaryId=id;next.startBoundaryId=id;
    boundaries[i].end=boundary;boundaries[i+1].start=boundary;seams.push(metadata);
  }
  for(const step of steps){
    const source=sources.get(step.sourceId);
    if(!source||step.startSeconds<0||step.endSeconds>source.video.durationSeconds+EPS||step.endSeconds<=step.startSeconds)throw new Error('A continuous teaching cut is outside its recording.');
    step.durationSeconds=step.endSeconds-step.startSeconds;
    step.sourceStartFrame=Math.round(step.sourceStartSeconds*source.video.fps);
    step.sourceEndFrameExclusive=Math.round(step.sourceEndSeconds*source.video.fps);
    // Same-source neighbors share the boundary image. At a file's end, show the
    // final decodable frame before the next source's genuinely adjacent frame.
    step.teacherFreezeSeconds=Math.min(step.endSeconds,source.video.durationSeconds-1/source.video.fps);
    step.continuityVersion=CONTINUITY_VERSION;
  }
  const references=steps.map((step,i)=>{
    const reference=prepareFirstThreeReference(step,sources.get(step.sourceId).data,{...options,boundaries:boundaries[i]});
    return {...reference,continuityVersion:CONTINUITY_VERSION,
      boundaryProvenance:'Adjacent endpoints share one actual archived pose and explicit source ID. Only playback cuts change; no missing landmarks are generated or interpolated.'};
  });
  return {steps,references,seams,version:CONTINUITY_VERSION};
}
