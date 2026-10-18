// Create a follow-along INSTRUCTOR lesson from actual local video observations.
// This does not analyze an uploaded learner recording. Raw observations and the
// video stay separate; generated targets never replace missing MediaPipe data.
import {LESSON_CONTROLS} from './first-three-controls.js';
import {prepareFirstThreeReference,visible} from './first-three-reference.js';
import {prepareAnchoredReference,prepareStartPosition} from './start-position.js';
import {prepareFootAnchorReferences} from './practice-foot-anchors.js';
import {prepareHandoffReferences} from './practice-handoff.js';
import {preparePracticeTubes,TUBE_RULES} from './practice-tube.js';
import {getFourPointBodyFrame} from './four-point-game-runtime.js';

export const UPLOADED_LESSON_VERSION='uploaded-instructor-lesson-v1';
export const UPLOADED_LESSON_STEP_IDS=Object.freeze(['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05']);
const DEFAULT_MODEL_SHA='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const SHA256=/^[a-f0-9]{64}$/i;
const TORSO=[11,12,23,24];
const threshold=.45;
const finite=Number.isFinite;
const cleanTitle=(value,fallback)=>typeof value==='string'&&value.trim().length>0
  ?value.trim().replace(/[\u0000-\u001f\u007f<>]/g,'').slice(0,100)||fallback:fallback;

/** Equal partitions are EDITABLE SUGGESTIONS, not recognized Tai Chi forms. */
export function createUploadedLessonRanges({durationSeconds,stepCount=5}={}){
  if(!finite(durationSeconds)||durationSeconds<=0||!Number.isInteger(stepCount)||stepCount<1||stepCount>5
    ||durationSeconds/stepCount<.6)throw new RangeError('Choose one to five segments, each at least 0.6 seconds long.');
  return Array.from({length:stepCount},(_,i)=>({startSeconds:durationSeconds*i/stepCount,
    endSeconds:durationSeconds*(i+1)/stepCount,title:`Uploaded movement ${i+1}`}));
}

function selectedRanges(ranges,durationSeconds){
  if(!Array.isArray(ranges)||!ranges.length||ranges.length>5)throw new RangeError('Choose between one and five instructor segments.');
  let previousEnd=-Infinity;
  return ranges.map((range,i)=>{
    if(!finite(range?.startSeconds)||!finite(range.endSeconds)||range.startSeconds<0
      ||range.endSeconds>durationSeconds+1e-7||range.endSeconds-range.startSeconds<.6
      ||range.startSeconds<previousEnd-1e-7)
      throw new RangeError('Segments must be ordered, nonoverlapping video ranges at least 0.6 seconds long.');
    previousEnd=range.endSeconds;
    return {startSeconds:range.startSeconds,endSeconds:range.endSeconds,title:cleanTitle(range.title,`Uploaded movement ${i+1}`)};
  });
}

function validateSamples(samples,durationSeconds){
  if(!Array.isArray(samples)||!samples.length||samples.length>100000)
    throw new RangeError('A bounded set of actual decoded-video observations is required.');
  let previous=-Infinity;
  for(const sample of samples){
    const seconds=sample?.sourceTimeSeconds;
    if(!finite(seconds)||seconds<0||seconds>durationSeconds+1e-7||seconds<=previous
      ||!finite(sample.tMs)||sample.tMs<0||Math.abs(sample.tMs-seconds*1000)>2
      ||!Array.isArray(sample.landmarks)||sample.landmarks.some(point=>!point||!Number.isInteger(point.index)
        ||point.index<0||point.index>32)||new Set(sample.landmarks.map(point=>point.index)).size!==sample.landmarks.length)
      throw new Error('Instructor observations must retain unique raw anatomical landmarks and increasing source-video timestamps.');
    previous=seconds;
  }
}

function trustedSample(sample,aspect){
  if(sample?.status!=='pose'||!getFourPointBodyFrame(sample,aspect))return false;
  const points=new Map(sample.landmarks.map(point=>[point.index,point]));
  return [...TORSO,...LESSON_CONTROLS.indices].every(index=>visible(points.get(index)));
}

// A boundary picks ONE actual closest frame, not the nearest good replacement.
// Two complete observed frames must support it. An obscured exact boundary
// remains unavailable even if a nearby frame happens to have better tracking.
function observedBoundary(data,seconds,sourceId){
  const closest=data.samples.reduce((best,sample)=>Math.abs(sample.sourceTimeSeconds-seconds)
    <Math.abs(best.sourceTimeSeconds-seconds)?sample:best,data.samples[0]);
  const aspect=data.width/data.height;
  const nearEnough=Math.abs(closest.sourceTimeSeconds-seconds)<=.150001;
  const supports=data.samples.filter(sample=>Math.abs(sample.sourceTimeSeconds-closest.sourceTimeSeconds)<=.250001
    &&trustedSample(sample,aspect));
  const available=nearEnough&&trustedSample(closest,aspect)&&supports.length>=2;
  return {available,sourceId,tMs:closest.tMs,sourceTimeSeconds:closest.sourceTimeSeconds,
    requestedSourceSeconds:seconds,threshold,samples:available?supports:[],reason:available?null:
      'This uploaded segment boundary does not have supported torso, palm and foot observations. Adjust the segment or use a clearer full-body video.'};
}

// Display framing is calibrated from ONE real supported initial source frame.
// A declared face-to-shoulder margin makes room above the observed face; the
// margin is layout geometry, never a fabricated head landmark or confidence.
function observedFramingCalibration(data,boundaries){
  for(const boundary of boundaries.map(item=>item.start)){
    if(!boundary.available)continue;
    const sample=data.samples.find(item=>Math.abs(item.tMs-boundary.tMs)<1e-7);
    if(!trustedSample(sample,data.width/data.height))continue;
    const points=new Map(sample.landmarks.map(point=>[point.index,point]));
    const face=sample.landmarks.filter(point=>point.index>=0&&point.index<=10&&visible(point));
    const feet=[29,30,31,32].map(index=>points.get(index));
    if(!face.length||!feet.every(visible))continue;
    const faceY=Math.min(...face.map(point=>point.y));
    const shoulderY=(points.get(11).y+points.get(12).y)/2;
    if(shoulderY<=faceY)continue;
    const topY=Math.max(0,faceY-(shoulderY-faceY)/2);
    const bottomY=Math.min(1,Math.max(...feet.map(point=>point.y))+.01);
    if(bottomY-topY<.2)continue;
    return {topY,bottomY,sourceTimeSeconds:sample.sourceTimeSeconds,
      provenance:'Display-only calibration from one actually supported initial uploaded-video frame. Top uses the observed highest visible face point minus half its face-to-shoulder distance; bottom uses the lowest observed foot point plus a 0.01 image-height margin. Bounds are clamped to the source image. These layout margins are not landmarks or replacement observations.'};
  }
  return null;
}

function anchorContinuousGroups(references,steps){
  const output=[];let group=[];
  const flush=()=>{
    if(group.length)output.push(...prepareHandoffReferences(prepareFootAnchorReferences(group,
      {minimumFootDisplacement:TUBE_RULES.minimumFootDisplacement})));
    group=[];
  };
  for(let i=0;i<references.length;i++){
    // Never carry a planted foot across intentionally omitted source footage.
    if(i&&Math.abs(steps[i-1].requestedEndSeconds-steps[i].requestedStartSeconds)>1e-7)flush();
    group.push(references[i]);
  }
  flush();return output;
}

/** Returns fields directly compatible with first-three.js state.
 * samples: real RAW 0..32 observations; tMs equals sourceTimeSeconds*1000.
 * videoUrl: local object URL identifying the original uploaded bytes.
 * sourceSha256: actual SHA-256 of those bytes, NOT a placeholder identifier.
 * ranges: 1..5 user-confirmed {startSeconds,endSeconds,title?} segments.
 * The existing five IDs identify internal Factory schema slots only; uploaded
 * movements are never claimed to be the named movements in the built-in video.
 * Missing references remain display-only; the live controller gates review.
 */
export function buildUploadedLesson({samples,width,height,durationSeconds,videoUrl,sourceSha256,
  fileName='Uploaded instructor video',ranges,stepCount=5,modelSha256=DEFAULT_MODEL_SHA}={}){
  if(!finite(width)||width<=0||!finite(height)||height<=0||!finite(durationSeconds)||durationSeconds<=0
    ||durationSeconds>3600||typeof videoUrl!=='string'||!videoUrl.startsWith('blob:')
    ||!SHA256.test(sourceSha256??'')||!SHA256.test(modelSha256??''))
    throw new TypeError('Provide the original local instructor video, its actual SHA-256, dimensions and duration.');
  validateSamples(samples,durationSeconds);
  const chosen=selectedRanges(ranges??createUploadedLessonRanges({durationSeconds,stepCount}),durationSeconds);
  const file=cleanTitle(fileName,'Uploaded instructor video'),sourceId=`uploaded-${sourceSha256.slice(0,16)}`;
  const gaps=samples.slice(1).map((sample,i)=>sample.sourceTimeSeconds-samples[i].sourceTimeSeconds).sort((a,b)=>a-b);
  const sampleRateHz=gaps.length?1/gaps[Math.floor(gaps.length/2)]:null;
  // Keep an untouched raw copy separate from the same-frame derived controls.
  const rawData={schemaVersion:'first-three-recorded-pose-v1',extractionVersion:UPLOADED_LESSON_VERSION,
    width,height,durationMs:durationSeconds*1000,sampleRateHz,sourceSha256,sourceClipSha256:sourceSha256,
    sourceStartSeconds:0,sourceEndSeconds:durationSeconds,modelSha256,packageVersion:'1.1.1',
    provenance:'Actual local MediaPipe observations extracted from the uploaded instructor video. Raw anatomical landmarks and source timestamps are preserved; no interpolation, mirrored anatomy, or prerecorded replacement.',
    samples:structuredClone(samples)};
  const data=LESSON_CONTROLS.referenceAdapter(structuredClone(rawData));
  const source={id:sourceId,video:{src:videoUrl,width,height,durationSeconds,sha256:sourceSha256,
    sourceStartSeconds:0,sourceEndSeconds:durationSeconds,
    sourceCropPixels:{x:0,y:0,width,height},
    provenance:'Original uploaded instructor bytes. Sample rate describes inference observations, not the source video frame rate.'},
    displayCrop:{x:0,y:0,width:1,height:1},observationVisibilityThreshold:threshold,
    poseSrc:null,data,rawData,displayGuides:null,uploaded:true};
  const sources=new Map([[sourceId,source]]),boundaries=[];
  const steps=chosen.map((range,index)=>{
    const start=observedBoundary(data,range.startSeconds,sourceId),end=observedBoundary(data,range.endSeconds,sourceId);
    boundaries.push({start,end});
    // Actual supported observation times determine displayed starts/finishes.
    // Unsupported boundaries keep their requested display interval, with all
    // affected reference validity flags false rather than fabricated targets.
    const practiceStartSeconds=start.available?start.sourceTimeSeconds:range.startSeconds;
    const teacherFreezeSeconds=end.available?end.sourceTimeSeconds:range.endSeconds;
    return {id:UPLOADED_LESSON_STEP_IDS[index],title:range.title,
      cue:'Watch your uploaded instructor, find the starting squares, and follow the movement to its ending targets.',
      motion:'uploaded-custom',focusJoints:[...LESSON_CONTROLS.indices],sourceId,
      startSeconds:range.startSeconds,endSeconds:range.endSeconds,
      requestedStartSeconds:range.startSeconds,requestedEndSeconds:range.endSeconds,
      sourceStartSeconds:range.startSeconds,sourceEndSeconds:range.endSeconds,
      durationSeconds:range.endSeconds-range.startSeconds,practiceStartSeconds,teacherFreezeSeconds,
      referenceStartSeconds:practiceStartSeconds,referenceEndSeconds:teacherFreezeSeconds,
      referenceVisibilityThreshold:threshold,uploaded:true,slot:index+1,
      referenceProvenance:'User-selected segment and actual observed uploaded-video boundaries; not automatic Tai Chi form recognition.'};
  });
  const framingCalibration=observedFramingCalibration(data,boundaries);
  const framingUnavailableReason='A supported face-to-foot framing calibration is unavailable. Choose a clear full-body starting pose for this instructor.';
  source.framingCalibration=framingCalibration?{...framingCalibration}:null;
  const refs=steps.map((step,index)=>{
    const reference=prepareFirstThreeReference({...step,startSeconds:step.practiceStartSeconds,endSeconds:step.teacherFreezeSeconds},
      data,{...LESSON_CONTROLS.referenceOptions,boundaries:boundaries[index]});
    const missingBoundary=!boundaries[index].start.available||!boundaries[index].end.available;
    return {...reference,uploaded:true,assessmentEvidenceKind:'uploaded-instructor-observations',
      framingCalibration:framingCalibration?{...framingCalibration}:null,
      guideProvenance:'Palm and foot centers derived only from actual same-frame anatomical landmarks in the uploaded instructor video. Supported observed endpoints only; missing components remain unavailable.',
      ...(missingBoundary?{referenceUsable:false,unknownReason:boundaries[index].start.reason||boundaries[index].end.reason}:{}),
      ...(!framingCalibration?{referenceUsable:false,unknownReason:framingUnavailableReason}:{}),
      endpointQuality:{start:{available:boundaries[index].start.available,sourceTimeSeconds:boundaries[index].start.sourceTimeSeconds,
        requestedSourceSeconds:boundaries[index].start.requestedSourceSeconds},
        end:{available:boundaries[index].end.available,sourceTimeSeconds:boundaries[index].end.sourceTimeSeconds,
        requestedSourceSeconds:boundaries[index].end.requestedSourceSeconds}}};
  });
  const anchored=refs.map((reference,index)=>prepareAnchoredReference(reference,{...steps[index],startSeconds:steps[index].practiceStartSeconds},
    {...data,samples:data.samples.filter(sample=>Math.abs(sample.tMs-boundaries[index].start.tMs)<1e-7)}));
  const guidanceRefs=anchorContinuousGroups(anchored,steps);
  for(const reference of guidanceRefs)reference.framingCalibration=framingCalibration?{...framingCalibration}:null;
  const pathRefs=steps.map((step,i)=>preparePracticeTubes(guidanceRefs[i],step,sources));
  const usableSteps=guidanceRefs.map((reference,i)=>reference.referenceUsable&&prepareStartPosition(reference).usable&&pathRefs[i].referenceUsable);
  for(let i=0;i<steps.length;i++){
    steps[i].assessed=usableSteps[i];
    steps[i].assessmentAvailable=usableSteps[i];
    steps[i].unassessedReason=usableSteps[i]?null:guidanceRefs[i].unknownReason||pathRefs[i].unknownReason
      ||prepareStartPosition(guidanceRefs[i]).unknownReason||'The uploaded instructor needs clearer supported movement observations.';
  }
  const provenance={version:UPLOADED_LESSON_VERSION,kind:'uploaded-instructor-video',sourceSha256,
    sourceFile:file,automaticFormRecognition:false,interpolatedObservations:0,
    internalStepIds:'Factory-compatible slots, not a claim of built-in movement identity',
    segmentAssignment:'user-selected-ranges',sampleCount:samples.length,usableSteps,
    framingCalibration:framingCalibration?{...framingCalibration}:null,
    unsupportedStepCount:usableSteps.filter(usable=>!usable).length};
  const manifest={schemaVersion:UPLOADED_LESSON_VERSION,title:'Your instructor lesson',uploaded:true,
    source:{file,sha256:sourceSha256,src:videoUrl,width,height,startSeconds:0,endSeconds:durationSeconds},
    sources:[{...source,data:undefined,rawData:undefined}],steps,provenance};
  return {manifest,data,sources,refs,guidanceRefs,pathRefs,rawData,provenance};
}
