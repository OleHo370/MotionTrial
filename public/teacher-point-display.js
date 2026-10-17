// Teacher presentation only. These cues must never become raw observations,
// learner landmarks, readiness evidence, timing inputs, or grading targets.
export const TEACHER_DISPLAY_GUIDE_VERSION='teacher-display-guides-v1';
const SUPPORTED_INDICES=Object.freeze([33,34,35,36]);
const SHA256=/^[a-f0-9]{64}$/i;
const preparedFrames=new WeakMap();
const text=value=>typeof value==='string'&&value.trim().length>0;
const inFrame=point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y)
  &&point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1;
const confidenceAt=(point,threshold)=>inFrame(point)
  &&Number.isFinite(point.visibility)&&point.visibility>=threshold&&point.visibility<=1
  &&(point.presence===undefined||Number.isFinite(point.presence)&&point.presence>=threshold&&point.presence<=1);
const fail=message=>{throw new Error(`Invalid teacher display guides: ${message}`);};

/** Validate a reviewed annotation sidecar against its untouched source archive. */
export function prepareTeacherDisplayGuides(data,annotations){
  if(!data||!Array.isArray(data.samples)||!data.samples.length)fail('the source observation archive is missing.');
  if(!annotations||annotations.schemaVersion!==TEACHER_DISPLAY_GUIDE_VERSION)fail('the schema version is unsupported.');
  for(const key of ['sourceSha256','sourceClipSha256']){
    if(typeof data[key]!=='string'||!SHA256.test(data[key])||annotations[key]!==data[key])
      fail(`${key} does not identify the source archive.`);
  }
  for(const key of ['width','height','fps']){
    if(!Number.isFinite(data[key])||data[key]<=0||annotations[key]!==data[key])
      fail(`${key} does not match the source video.`);
  }
  if(!Array.isArray(annotations.tracks))fail('tracks must be an array.');
  const sourceFrames=new Map();
  for(const sample of data.samples){
    const frame=sample.sourceFrameIndex;
    if(!Number.isInteger(frame)||frame<0||sourceFrames.has(frame))fail('source frame identities are missing or duplicated.');
    sourceFrames.set(frame,sample);
  }
  const seen=new Set();
  const tracks=annotations.tracks.map(track=>{
    if(!SUPPORTED_INDICES.includes(track?.index)||seen.has(track.index))fail('control identities must be supported and unique.');
    seen.add(track.index);
    if(!text(track.provenance)||!text(track.reason))fail('each track needs its review provenance and reason.');
    if(!Array.isArray(track.keyframes)||track.keyframes.length<2)fail('each track requires at least two reviewed keyframes.');
    let previous=-1;
    const keyframes=track.keyframes.map(key=>{
      const frame=key?.sourceFrameIndex;
      if(!Number.isInteger(frame)||frame<0||frame<=previous)fail('keyframe identities must be sorted and unique.');
      previous=frame;
      const observed=sourceFrames.get(frame);
      if(!observed||observed.status!=='pose')fail(`keyframe ${frame} has no source pose frame.`);
      if(!inFrame(key))fail(`keyframe ${frame} is outside the source image.`);
      if(typeof key.inputPngSha256!=='string'||!SHA256.test(key.inputPngSha256)
        ||key.inputPngSha256!==observed.inputPngSha256)fail(`keyframe ${frame} does not match the decoded source image.`);
      return Object.freeze({sourceFrameIndex:frame,x:key.x,y:key.y,inputPngSha256:key.inputPngSha256});
    });
    return Object.freeze({index:track.index,provenance:track.provenance,reason:track.reason,
      keyframes:Object.freeze(keyframes)});
  });
  const prepared=Object.freeze({version:TEACHER_DISPLAY_GUIDE_VERSION,
    sourceSha256:data.sourceSha256,sourceClipSha256:data.sourceClipSha256,
    width:data.width,height:data.height,fps:data.fps,tracks:Object.freeze(tracks)});
  preparedFrames.set(prepared,new Map([...sourceFrames].map(([frame,sample])=>[frame,sample.inputPngSha256])));
  return prepared;
}

function reviewedPoint(track,frame){
  const keys=track.keyframes;
  if(frame<keys[0].sourceFrameIndex||frame>keys.at(-1).sourceFrameIndex)return null;
  let left=keys[0],right=left;
  for(const key of keys){
    if(key.sourceFrameIndex===frame){left=key;right=key;break;}
    if(key.sourceFrameIndex<frame)left=key;
    else{right=key;break;}
  }
  const fraction=left===right?0:(frame-left.sourceFrameIndex)/(right.sourceFrameIndex-left.sourceFrameIndex);
  const support=left===right?[left]:[left,right];
  return {index:track.index,x:left.x+(right.x-left.x)*fraction,y:left.y+(right.y-left.y)*fraction,
    appearance:'guide',provenance:track.provenance,reason:track.reason,displayOnly:true,
    sourceFrameIndex:frame,supportSourceFrameIndices:support.map(key=>key.sourceFrameIndex),
    supportInputPngSha256:support.map(key=>key.inputPngSha256)};
}

/**
 * Return teacher drawing cues. Recorded controls retain their own confidence;
 * reviewed/interpolated guidance has no visibility or presence score at all.
 */
export function getTeacherDisplayPoints(displaySample,prepared,{
  indices=SUPPORTED_INDICES,observedThreshold=.45,reliableThreshold=.65,
}={}){
  if(!Number.isFinite(observedThreshold)||!Number.isFinite(reliableThreshold)
    ||observedThreshold<0||reliableThreshold>1||observedThreshold>reliableThreshold)
    throw new Error('Teacher display confidence thresholds are invalid.');
  if(!displaySample||displaySample.status!=='pose'||!Array.isArray(displaySample.landmarks))return [];
  const selected=new Set(indices),counts=new Map(),points=new Map();
  for(const point of displaySample.landmarks)counts.set(point.index,(counts.get(point.index)||0)+1);
  for(const point of displaySample.landmarks){
    if(!SUPPORTED_INDICES.includes(point.index)||!selected.has(point.index)||counts.get(point.index)!==1
      ||!confidenceAt(point,observedThreshold))continue;
    const shown={index:point.index,x:point.x,y:point.y,
      appearance:confidenceAt(point,reliableThreshold)?'observed':'uncertain',
      provenance:'Current-frame MediaPipe-derived teacher control',displayOnly:true,visibility:point.visibility};
    if(point.presence!==undefined)shown.presence=point.presence;
    points.set(point.index,shown);
  }
  const frame=displaySample.sourceFrameIndex;
  // An unrelated or retimed sample must not receive annotations for this video.
  if(preparedFrames.has(prepared)&&preparedFrames.get(prepared).has(frame)
    &&typeof displaySample.inputPngSha256==='string'&&SHA256.test(displaySample.inputPngSha256)
    &&displaySample.inputPngSha256===preparedFrames.get(prepared).get(frame)
    &&Number.isFinite(displaySample.tMs)&&Math.abs(displaySample.tMs-frame*1000/prepared.fps)<1e-6){
    for(const track of prepared.tracks){
      if(!selected.has(track.index))continue;
      const guide=reviewedPoint(track,frame);
      if(guide)points.set(track.index,guide);
    }
  }
  return [...points.values()].sort((a,b)=>a.index-b.index);
}
