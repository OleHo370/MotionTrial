// Frame-exact teacher references for the recut opening sample. The master video
// and its raw MediaPipe archive remain the source of every point and cut.
import {prepareFirstThreeReference,visible} from './first-three-reference.js';
import {getFourPointBodyFrame} from './four-point-game-runtime.js';
import {prepareAnchoredReference} from './start-position.js';
import {prepareHandoffReferences} from './practice-handoff.js';
import {prepareFootAnchorReferences} from './practice-foot-anchors.js';
import {TUBE_RULES} from './practice-tube.js';
import {BODY_NAMES} from './practice-centers.js';

export const RECUT_VERSION='recut-six-exact-frame-v1';
const TORSO=[11,12,23,24],EPS=1e-6;
const finiteFrame=frame=>Number.isInteger(frame)&&frame>=0;
const thresholdFor=step=>step.referenceVisibilityThreshold??.45;
const sampleFrame=sample=>sample?.sourceFrameIndex;
const pointTrusted=(point,threshold)=>visible(point)&&point.visibility>=threshold
  &&(point.presence===undefined||point.presence>=threshold);
const jointName=index=>BODY_NAMES[index]??({11:'left shoulder',12:'right shoulder',23:'left hip',24:'right hip'}[index]??`joint ${index}`);
const joinNames=indices=>indices.map(index=>jointName(index).toLowerCase()).join(indices.length===2?' and ':', ');
const trusted=(sample,indices,aspect,threshold)=>{
  if(sample?.status!=='pose'||!Array.isArray(sample.landmarks)||!getFourPointBodyFrame(sample,aspect))return false;
  const points=new Map(sample.landmarks.map(point=>[point.index,point]));
  return points.size===sample.landmarks.length&&[...TORSO,...indices].every(index=>{
    const point=points.get(index);
    return pointTrusted(point,threshold);
  });
};

function exactBoundary(source,frame,indices,threshold){
  const data=source.data,aspect=data.width/data.height;
  const exact=data.samples.find(sample=>sampleFrame(sample)===frame);
  const supports=data.samples.filter(sample=>Math.abs(sampleFrame(sample)-frame)<=Math.ceil(source.video.fps*.25)
    &&trusted(sample,indices,aspect,threshold));
  const available=trusted(exact,indices,aspect,threshold)&&supports.length>=2;
  const points=new Map((exact?.landmarks??[]).map(point=>[point.index,point]));
  const missingControlIndices=indices.filter(index=>!pointTrusted(points.get(index),threshold));
  const missingTorsoIndices=TORSO.filter(index=>!pointTrusted(points.get(index),threshold));
  const time=source.video.sourceStartSeconds+frame/source.video.fps;
  const reason=available?null:exact?.status!=='pose'
    ?`No reliable teacher pose was observed at source frame ${frame} (${time.toFixed(2)} s).`
    :missingControlIndices.length
      ?`The teacher's ${joinNames(missingControlIndices)} ${missingControlIndices.length===1?'is':'are'} not reliably observed at source frame ${frame} (${time.toFixed(2)} s).`
      :missingTorsoIndices.length
        ?`The teacher's ${joinNames(missingTorsoIndices)} ${missingTorsoIndices.length===1?'is':'are'} not reliably observed at source frame ${frame} (${time.toFixed(2)} s).`
        :`Source frame ${frame} (${time.toFixed(2)} s) lacks enough supporting teacher observations for a reliable target.`;
  return {available,sourceId:source.id,sourceFrameIndex:frame,tMs:exact?.tMs??null,
    sourceTimeSeconds:time,samples:available?supports:[],threshold,reason,
    missingControlIndices,missingTorsoIndices,observedStatus:exact?.status??'unavailable'};
}

/** Intervals partition the master; endpoint frames are shared without retiming. */
export function prepareRecutLesson(manifest,sources,options={}){
  if(manifest?.schemaVersion!=='recut-six-teaching-v1'||manifest.steps?.length!==6||sources.size!==1)
    throw new Error('This lesson requires the six frame-exact master-video categories.');
  const source=[...sources.values()][0],fps=source.video.fps,frameCount=source.video.frameCount;
  const indices=options.pointIndices??[15,16,27,28];
  if(!(fps>0)||!Number.isInteger(frameCount)||frameCount<2||Math.abs(source.video.sourceStartSeconds)>EPS
    ||Math.abs(source.video.durationSeconds-frameCount/fps)>EPS
    ||Math.abs(source.video.sourceEndSeconds-frameCount/fps)>EPS
    ||!Array.isArray(source.data.samples)||!source.data.samples.length
    ||source.data.samples.some((sample,i,samples)=>!finiteFrame(sampleFrame(sample))||sampleFrame(sample)>=frameCount
      ||i>0&&sampleFrame(sample)<=sampleFrame(samples[i-1])
      ||!Number.isFinite(sample.tMs)||!Number.isFinite(sample.sourceTimeSeconds)
      ||Math.abs(sample.tMs-sampleFrame(sample)*1000/fps)>EPS
      ||Math.abs(sample.sourceTimeSeconds-sampleFrame(sample)/fps)>EPS))
    throw new Error('The master observations must retain their exact decoded source-frame IDs and timestamps.');
  const steps=structuredClone(manifest.steps),boundaries=steps.map(()=>({})),seams=[];
  const teachingFirst=manifest.rules?.sourceTeachingStartFrame??0;
  if(!finiteFrame(teachingFirst)||teachingFirst>=frameCount)
    throw new Error('The teaching range must begin at a declared source frame.');
  let cursor=teachingFirst;
  for(const step of steps){
    const first=step.sourceStartFrame,last=step.sourceEndFrameExclusive;
    if(step.sourceId!==source.id||!finiteFrame(first)||!finiteFrame(last)||first!==cursor||last<=first||last>frameCount
      ||!finiteFrame(step.referenceStartFrame)||!finiteFrame(step.referenceEndFrame)
      ||step.referenceStartFrame<first||step.referenceStartFrame>=last
      ||step.referenceEndFrame<step.referenceStartFrame||step.referenceEndFrame>Math.min(last,frameCount-1)
      ||Math.abs(step.practiceStartSeconds-step.referenceStartFrame/fps)>EPS
      ||Math.abs(step.teacherFreezeSeconds-step.referenceEndFrame/fps)>EPS)
      throw new Error('A teaching category or its exact reference frame is outside the continuous master.');
    step.startSeconds=first/fps;step.endSeconds=last/fps;
    step.sourceStartSeconds=source.video.sourceStartSeconds+step.startSeconds;
    step.sourceEndSeconds=source.video.sourceStartSeconds+step.endSeconds;
    step.durationSeconds=(last-first)/fps;step.continuityVersion=RECUT_VERSION;
    cursor=last;
  }
  if(cursor!==frameCount)throw new Error('The six categories must cover every teaching frame without gaps.');
  for(let i=0;i<steps.length;i++){
    const step=steps[i],next=steps[i+1];
    if(i===0)boundaries[i].start=exactBoundary(source,step.referenceStartFrame,indices,thresholdFor(step));
    if(next){
      if(step.referenceEndFrame!==next.referenceStartFrame||step.referenceEndFrame!==next.sourceStartFrame)
        throw new Error('Adjacent categories must share exactly the same observed cut frame.');
      const boundary=exactBoundary(source,step.referenceEndFrame,indices,Math.max(thresholdFor(step),thresholdFor(next)));
      boundaries[i].end=boundary;boundaries[i+1].start=boundary;
      const id=`${step.id}--${next.id}`;step.endBoundaryId=id;next.startBoundaryId=id;
      seams.push({id,fromStepId:step.id,toStepId:next.id,sourceId:source.id,available:boundary.available,
        sourceFrameIndex:boundary.sourceFrameIndex,tMs:boundary.tMs,sourceTimeSeconds:boundary.sourceTimeSeconds,
        cutSeconds:step.endSeconds,supportTimesMs:boundary.samples.map(sample=>sample.tMs),threshold:boundary.threshold,
        closedGapSeconds:0,reason:boundary.reason,missingControlIndices:[...boundary.missingControlIndices],
        missingTorsoIndices:[...boundary.missingTorsoIndices]});
    }else boundaries[i].end=exactBoundary(source,step.referenceEndFrame,indices,thresholdFor(step));
  }
  const references=steps.map((step,i)=>{
    const referenceStep={...step,startSeconds:step.practiceStartSeconds,endSeconds:step.teacherFreezeSeconds};
    const reference=prepareFirstThreeReference(referenceStep,source.data,{...options,boundaries:boundaries[i]});
    const endpointQuality=Object.fromEntries(['start','end'].map(side=>{
      const boundary=boundaries[i][side];
      return [side,{sourceId:boundary.sourceId,sourceFrameIndex:boundary.sourceFrameIndex,sourceTimeSeconds:boundary.sourceTimeSeconds,
        available:boundary.available,threshold:boundary.threshold,reason:boundary.reason,
        missingControlIndices:[...boundary.missingControlIndices],missingTorsoIndices:[...boundary.missingTorsoIndices],
        observedStatus:boundary.observedStatus}];
    }));
    const unavailable=Object.values(endpointQuality).filter(boundary=>!boundary.available);
    const unassessedReason=unavailable.length?unavailable.map(boundary=>boundary.reason).join(' '):reference.referenceUsable?null:reference.unknownReason;
    return {...reference,...(unassessedReason?{referenceUsable:false,unknownReason:`${unassessedReason} Demonstration only; this step is not assessed.`}:{}),
      endpointQuality,unassessedReason,
      continuityVersion:RECUT_VERSION,referenceStartFrame:step.referenceStartFrame,referenceEndFrame:step.referenceEndFrame,
      boundaryProvenance:'All four controls at each endpoint come from one actual master frame. Adjacent categories share the identical archived sample; no nearest-sample retiming or missing-point interpolation.'};
  });
  const guidanceReferences=prepareHandoffReferences(prepareFootAnchorReferences(references.map((reference,i)=>{
    const step=steps[i],exact=source.data.samples.find(sample=>sampleFrame(sample)===step.referenceStartFrame);
    // Restrict anchor selection to the specified frame. A nearby torso cannot
    // silently replace an unavailable teacher start while the video stays put.
    return prepareAnchoredReference(reference,{...step,startSeconds:step.practiceStartSeconds},
      {...source.data,samples:exact?[exact]:[]});
  }),{minimumFootDisplacement:TUBE_RULES.minimumFootDisplacement}));
  return {steps,references,guidanceReferences,seams,version:RECUT_VERSION,coverage:{
    sourceId:source.id,firstFrame:teachingFirst,endFrameExclusive:frameCount,frameCount:frameCount-teachingFirst,fps,
    startSeconds:teachingFirst/fps,endSeconds:frameCount/fps,gapFrames:0,overlapFrames:0,
    note:'Half-open category intervals cover every declared teaching frame exactly once. A boundary frame is also held as the previous finish target.'}};
}
