// Software checks only. The preserved teacher archive is actual MediaPipe
// evidence. Explicitly constructed fixture traces below are NOT live inference.
// This script never opens a camera, USB device, network service, or paid API.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildUploadedLesson,createUploadedLessonRanges,UPLOADED_LESSON_STEP_IDS} from '../public/uploaded-lesson-reference.js';
import {prepareStartPosition} from '../public/start-position.js';
import {createAttemptReview,observeAttemptReview,finalizeAttemptReview} from '../public/practice-attempt-review.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {practiceSummaryPayload} from '../public/practice-session-summary.js';
import {practiceAiWordingIssues,descriptivePracticeFeedback} from '../public/practice-descriptive-feedback.js';
import {derivePracticeFeedbackContext} from '../public/practice-feedback-context.js';

const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const manifest=await read('../public/practice-media/recut-six/manifest.json');
const archive=await read('../public/practice-media/recut-six/master.poses.json');
const original=JSON.stringify({manifest,archive});
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let count=0;
const check=(name,fn)=>{fn();count++;console.log(`PASS: ${name}`);};
const realOptions={samples:archive.samples,width:archive.width,height:archive.height,durationSeconds:17.5,
  videoUrl:'blob:software-check-preserved-teacher',sourceSha256:archive.sourceClipSha256,fileName:'Preserved actual teacher fixture.mp4',
  ranges:manifest.steps.slice(0,5).map(step=>({startSeconds:step.startSeconds,endSeconds:step.endSeconds,title:step.title}))};
const actual=buildUploadedLesson(realOptions);

check('Actual saved instructor observations prepare the five existing movements without changing source evidence',()=>{
  assert.equal(actual.manifest.steps.length,5);
  assert.equal(actual.sources.size,1);
  assert.deepEqual(actual.provenance.usableSteps,[true,true,true,true,true]);
  assert.equal(actual.provenance.kind,'uploaded-instructor-video');
  assert.equal(actual.provenance.automaticFormRecognition,false);
  assert.equal(actual.provenance.interpolatedObservations,0);
  assert.deepEqual(actual.rawData.samples,archive.samples);
  assert.notEqual(actual.rawData.samples,archive.samples);
  assert.ok(actual.rawData.samples.every(sample=>sample.landmarks.every(point=>point.index<=32)));
  assert.ok(actual.data.samples.some(sample=>sample.landmarks.some(point=>point.index===33)));
  assert.equal(actual.manifest.source.sha256,archive.sourceClipSha256);
  assert.equal(actual.manifest.source.src,realOptions.videoUrl);
  assert.ok(actual.refs.every(ref=>/uploaded instructor/i.test(ref.guideProvenance)));
  assert.ok(actual.guidanceRefs.every(reference=>prepareStartPosition(reference).usable));
  assert.equal(JSON.stringify({manifest,archive}),original);
});

check('Real shared cuts keep one observed anatomical frame and preserve handoff continuity',()=>{
  for(let i=0;i<4;i++){
    for(const guide of actual.guidanceRefs[i].guides){
      const next=actual.guidanceRefs[i+1].guides.find(other=>other.index===guide.index);
      assert.equal(guide.endObservation.tMs,next.startObservation.tMs);
      assert.deepEqual(guide.endRaw,next.startRaw);
      assert.ok(guide.finishHandoff?.insideNextStart);
    }
  }
});

// Constructed, anatomically explicit stationary torso and a slow left-palm raise.
// All fingers/feet required by the center adapter have same-frame observations.
function constructed({missingStart=false,interiorGap=false,missingHand=false,allMissing=false}={}){
  return Array.from({length:51},(_,i)=>{
    const seconds=i/10,progress=i/50;
    const points=[{index:0,x:.50,y:.16},{index:1,x:.48,y:.15},{index:2,x:.52,y:.15},
      {index:11,x:.42,y:.30},{index:12,x:.58,y:.30},{index:23,x:.44,y:.60},{index:24,x:.56,y:.60},
      ...[15,17,19].map(index=>({index,x:.35,y:.57-progress*.24})),
      ...[16,18,20].map(index=>({index,x:.65,y:.57})),
      ...[29,31].map(index=>({index,x:.43,y:.90})),...[30,32].map(index=>({index,x:.57,y:.90}))]
      .filter(point=>!(missingHand&&[15,17,19].includes(point.index)))
      .map(point=>({...point,z:0,visibility:.99,presence:.99}));
    const missing=allMissing||missingStart&&i<=2||interiorGap&&i===25;
    return {tMs:seconds*1000,sourceTimeSeconds:seconds,status:missing?'missing':'pose',
      landmarks:missing?[]:points,provenance:'CONSTRUCTED software fixture, not live inference'};
  });
}
const syntheticOptions=options=>{
  const samples=constructed(options);
  return {samples,width:800,height:800,durationSeconds:5,videoUrl:'blob:constructed-software-fixture',
    sourceSha256:sha(samples),fileName:'CONSTRUCTED fixture',ranges:[{startSeconds:0,endSeconds:5,title:'Constructed palm raise'}]};
};

check('One to five editable segments use bounded Factory schema slots, not recognized movement names',()=>{
  for(let stepCount=1;stepCount<=5;stepCount++){
    const ranges=createUploadedLessonRanges({durationSeconds:10,stepCount});
    assert.equal(ranges.length,stepCount);assert.equal(ranges[0].startSeconds,0);assert.equal(ranges.at(-1).endSeconds,10);
    for(let i=1;i<ranges.length;i++)assert.equal(ranges[i].startSeconds,ranges[i-1].endSeconds);
    const result=buildUploadedLesson({...syntheticOptions(),ranges:undefined,stepCount});
    assert.equal(result.manifest.steps.length,stepCount);
    assert.deepEqual(result.manifest.steps.map(step=>step.id),UPLOADED_LESSON_STEP_IDS.slice(0,stepCount));
    assert.ok(result.manifest.steps.every(step=>step.motion==='uploaded-custom'&&step.uploaded));
  }
  assert.throws(()=>createUploadedLessonRanges({durationSeconds:1,stepCount:5}),/0.6 seconds/);
});

check('Constructed supported instructor route feeds the unchanged learner review and Factory evidence schema',()=>{
  const instructor=buildUploadedLesson(syntheticOptions());
  assert.deepEqual(instructor.provenance.usableSteps,[true]);
  assert.equal(instructor.pathRefs[0].paths.length,1);
  assert.equal(instructor.pathRefs[0].paths[0].index,33);
  const reference=instructor.guidanceRefs[0],path=instructor.pathRefs[0],frame=reference.teacherFrame;
  const session=createAttemptReview(reference,path,{bodyFrame:frame,aspect:1,startAtMs:0,durationMs:5000,playbackRate:1});
  for(const sample of instructor.data.samples)observeAttemptReview(session,{sample,aspectRatio:1,observedAtMs:sample.tMs},
    {nowMs:sample.tMs,elapsedMs:sample.tMs});
  const review=finalizeAttemptReview(session,{nowMs:5000,elapsedMs:5000});
  assert.equal(review.status,'match',JSON.stringify(review.issues));
  const context=derivePracticeFeedbackContext({step:instructor.manifest.steps[0],review,session,reference,pathReference:path});
  const phrased=descriptivePracticeFeedback(review,context);
  const payload=practiceSummaryPayload({sessionId:'constructed-upload-session',attempts:[{attemptId:'attempt-1',
    stepId:instructor.manifest.steps[0].id,status:review.status,messages:phrased.messages,
    issues:practiceAiWordingIssues(review),context}],results:[{stepId:instructor.manifest.steps[0].id,status:'matched'}]});
  assert.ok(payload,'User-uploaded instructor evidence fits the existing Factory endpoint schema');
});

check('Uploaded display framing comes from one actual supported initial face-and-feet frame with explicit margins',()=>{
  const options=syntheticOptions(),instructor=buildUploadedLesson(options);
  const calibration=instructor.refs[0].framingCalibration;
  assert.ok(calibration);assert.equal(calibration.sourceTimeSeconds,0);
  assert.equal(calibration.topY,.075);assert.equal(calibration.bottomY,.91);
  assert.match(calibration.provenance,/Display-only calibration/);
  assert.match(calibration.provenance,/not landmarks/);
  assert.deepEqual(instructor.guidanceRefs[0].framingCalibration,calibration);
  assert.deepEqual(instructor.provenance.framingCalibration,calibration);
  assert.deepEqual([...instructor.sources.values()][0].framingCalibration,calibration);
  assert.ok(actual.refs.every(reference=>reference.framingCalibration.sourceTimeSeconds===.5));
  assert.ok(actual.guidanceRefs.every(reference=>reference.framingCalibration.sourceTimeSeconds===.5));
  assert.deepEqual(instructor.rawData.samples,options.samples,'Display margins never alter source landmarks');
});

check('Missing initial face tracking cannot fall back to the built-in instructor framing',()=>{
  const options=syntheticOptions();
  options.samples=options.samples.map(sample=>({...sample,landmarks:sample.landmarks.filter(point=>point.index>10)}));
  const instructor=buildUploadedLesson(options);
  assert.equal(instructor.refs[0].framingCalibration,null);
  assert.equal(instructor.guidanceRefs[0].framingCalibration,null);
  assert.equal(instructor.provenance.framingCalibration,null);
  assert.deepEqual(instructor.provenance.usableSteps,[false]);
  assert.equal(instructor.manifest.steps[0].assessed,false);
  assert.equal(instructor.manifest.steps[0].assessmentAvailable,false);
  assert.match(instructor.manifest.steps[0].unassessedReason,/face-to-foot framing/);
  assert.equal(instructor.pathRefs[0].referenceUsable,false);
});

check('Missing boundary observations stay unavailable rather than choosing a nearby good pose',()=>{
  const result=buildUploadedLesson(syntheticOptions({missingStart:true}));
  assert.equal(result.refs[0].endpointQuality.start.available,false);
  assert.equal(result.refs[0].referenceUsable,false);
  assert.equal(result.guidanceRefs[0].referenceUsable,false);
  assert.equal(result.provenance.usableSteps[0],false);
  assert.ok(result.refs[0].guides.every(guide=>!guide.startAvailable&&guide.start===null));
});

check('Interior missing movement frames do not become an invented route',()=>{
  const result=buildUploadedLesson(syntheticOptions({interiorGap:true}));
  assert.equal(result.refs[0].referenceUsable,true,'Supported endpoint evidence remains separate from route coverage');
  assert.equal(result.pathRefs[0].referenceUsable,false);
  assert.equal(result.pathRefs[0].paths[0].available,false);
  assert.match(result.pathRefs[0].paths[0].reason,/missing recorded tracking/);
  assert.equal(result.provenance.usableSteps[0],false);
});

check('No pose and missing anatomical hands cannot produce assessable instructor targets',()=>{
  for(const options of [{allMissing:true},{missingHand:true}]){
    const result=buildUploadedLesson(syntheticOptions(options));
    assert.deepEqual(result.provenance.usableSteps,[false]);
    assert.equal(result.refs[0].referenceUsable,false);
    assert.equal(result.pathRefs[0].referenceUsable,false);
    assert.equal(result.provenance.interpolatedObservations,0);
  }
});

check('Stale timestamps, duplicate/wrong anatomical IDs and invalid ranges are rejected explicitly',()=>{
  const duplicate=syntheticOptions();duplicate.samples[2].landmarks.push({...duplicate.samples[2].landmarks[0]});
  assert.throws(()=>buildUploadedLesson(duplicate),/anatomical landmarks/);
  const virtual=syntheticOptions();virtual.samples[2].landmarks.push({index:33,x:.5,y:.5,visibility:1});
  assert.throws(()=>buildUploadedLesson(virtual),/anatomical landmarks/);
  const stale=syntheticOptions();stale.samples[5].tMs=0;
  assert.throws(()=>buildUploadedLesson(stale),/source-video timestamps/);
  const cpuClock=syntheticOptions();cpuClock.samples[5].tMs=50000;
  assert.throws(()=>buildUploadedLesson(cpuClock),/source-video timestamps/);
  const invalidRanges=[[{startSeconds:-1,endSeconds:5}],[{startSeconds:0,endSeconds:6}],
    [{startSeconds:0,endSeconds:3},{startSeconds:2,endSeconds:5}],[],[{startSeconds:0,endSeconds:.2}]];
  for(const ranges of invalidRanges)assert.throws(()=>buildUploadedLesson({...syntheticOptions(),ranges}),RangeError);
});

check('Foot anchors do not carry across deliberately skipped instructor footage',()=>{
  const result=buildUploadedLesson({...syntheticOptions(),ranges:[{startSeconds:0,endSeconds:2},{startSeconds:3,endSeconds:5}]});
  for(const guide of result.guidanceRefs[1].guides.filter(guide=>[35,36].includes(guide.index)))
    assert.equal(guide.targetGeometry.carriedFromReferenceId,null);
});

check('Original archives and caller-owned sample/range objects stay immutable and repeatable',()=>{
  const input=syntheticOptions(),before=JSON.stringify(input);
  const a=buildUploadedLesson(input),b=buildUploadedLesson(input);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(a.manifest,b.manifest);assert.deepEqual(a.refs,b.refs);assert.deepEqual(a.pathRefs,b.pathRefs);
  assert.equal(JSON.stringify({manifest,archive}),original);
  a.rawData.samples[0].landmarks[0].x=0;
  assert.equal(JSON.stringify(input),before);
});

console.log(`Uploaded instructor lesson: ${count} software checks passed. No physical-camera or paid Factory validation claimed.`);
