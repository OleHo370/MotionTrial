// Real archived teacher observations; learner frames below are CONSTRUCTED
// software controls. This does not constitute live webcam or human acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BODY_INDICES,BODY_REFERENCE_OPTIONS,CENTER_REFERENCE_OPTIONS,withBodyReferenceData,withCenterReferenceData,withCenterFocus} from '../public/practice-centers.js';
import {prepareFirstThreeReference} from '../public/first-three-reference.js';
import {prepareContinuousLesson} from '../public/first-three-continuity.js';
import {prepareAnchoredReference,prepareStartPosition,createStartPositionSession,projectStartPositionTargets,evaluateStartPosition,positionedMovementRulesFor,POSITIONED_MOVEMENT_RULES} from '../public/start-position.js';
import {createFullHeightLayout,cameraViewportBounds} from '../public/full-height-layout.js';
import {projectFourPointGuides} from '../public/four-point-game-runtime.js';
import {createPracticeMatcher,finishTriangleSize} from '../public/first-three-attempt.js';

const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const close=(a,b,label,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} != ${b}`);
const manifest=await read('public/practice-media/next-three/manifest.json'),originalSteps=manifest.steps.map(withCenterFocus),sources=new Map();
for(const source of manifest.sources)sources.set(source.id,{...source,data:withBodyReferenceData(await read(`public/practice-media/first-three-centers/${source.id}.poses.json`))});
const originalDigest=digest([originalSteps,[...sources]]),lesson=prepareContinuousLesson(originalSteps,sources,BODY_REFERENCE_OPTIONS);
assert.equal(lesson.steps.length,6);assert.equal(lesson.references.length,6);assert.equal(lesson.seams.length,5);
const references=lesson.references.map((ref,i)=>prepareAnchoredReference(ref,lesson.steps[i],sources.get(lesson.steps[i].sourceId).data));
const report={
  provenance:'Offline checks use real archived 24.mp4 MediaPipe observations. Learner positions are explicitly constructed deterministic software controls, not live webcam inference or human acceptance.',
  version:lesson.version,checks:[],seams:[],geometry:[],steps:[],
  limitations:['Physical marker reachability, motion clarity and camera tracking require manual testing.','Unsupported source endpoints remain unavailable; no missing joint has been reconstructed.'],
};
const previous=originalSteps.map(step=>prepareFirstThreeReference(step,sources.get(step.sourceId).data,BODY_REFERENCE_OPTIONS));
for(let i=0;i<lesson.seams.length;i++){
  const seam=lesson.seams[i],a=lesson.references[i],b=lesson.references[i+1];
  assert.equal(seam.fromStepId,a.id);assert.equal(seam.toStepId,b.id);
  assert.ok(sources.has(seam.sourceId));assert.ok(Number.isFinite(seam.tMs));assert.ok(Number.isFinite(seam.sourceTimeSeconds));
  assert.ok(seam.supportTimesMs.length>=2);
  const deltas=[];
  for(const index of BODY_INDICES){
    const end=a.guides.find(g=>g.index===index),start=b.guides.find(g=>g.index===index);
    assert.ok(end.endRaw&&start.startRaw,`${a.id}/${b.id}: missing shared ${index}`);
    assert.deepEqual(end.endRaw,start.startRaw,`${a.id}/${b.id}: raw point ${index} must be identical`);
    assert.deepEqual(end.endObservation,start.startObservation,`${a.id}/${b.id}: point ${index} provenance must be shared`);
    const observation=end.endObservation;
    assert.equal(observation.sourceId,seam.sourceId);close(observation.tMs,seam.tMs,'Canonical seam time');
    close(observation.sourceTimeSeconds,seam.sourceTimeSeconds,'Canonical source time');
    const oldEnd=previous[i].guides.find(g=>g.index===index).endRaw,oldStart=previous[i+1].guides.find(g=>g.index===index).startRaw;
    if(oldEnd&&oldStart)deltas.push(Math.hypot((oldEnd.x-oldStart.x)*450,(oldEnd.y-oldStart.y)*360));
  }
  report.seams.push({from:a.id,to:b.id,sourceId:seam.sourceId,tMs:seam.tMs,sourceTimeSeconds:seam.sourceTimeSeconds,sharedControls:8,
    supportTimesMs:seam.supportTimesMs,closedGapSeconds:seam.closedGapSeconds,previousMaximumPixelJump:Math.max(...deltas),newRawPixelJump:0});
}
close(lesson.seams[2].closedGapSeconds,.3,'The actual omitted editorial gap must be closed');
close(lesson.steps[2].sourceEndSeconds,lesson.steps[3].sourceStartSeconds,'Source timeline at the encoded clip split');
report.checks.push('All five cuts share the exact same actual supported eight-control observation on both sides; the omitted 0.3-second editorial join is included in the teaching timeline.');

for(let i=0;i<references.length;i++){
  const ref=references[i],step=lesson.steps[i];
  const video=sources.get(step.sourceId).video;
  close(step.teacherFreezeSeconds,Math.min(step.endSeconds,video.durationSeconds-1/video.fps),'Teacher freezes at the shared cut or last decoded frame');
  assert.ok(ref.referenceUsable,`${ref.id}: ${ref.unknownReason}`);assert.ok(prepareStartPosition(ref).usable);
  assert.equal(ref.guides.length,8);assert.equal(prepareStartPosition(ref).radius,.20);
  assert.equal(positionedMovementRulesFor(ref).endRadius,.28);
  for(const guide of ref.guides){
    for(const side of ['start','end']){
      if(!guide[`${side}Raw`])continue;
      const observation=guide[`${side}Observation`];
      assert.ok(observation,`${ref.id}: ${side} ${guide.index} needs explicit source provenance`);
      const data=sources.get(observation.sourceId)?.data;assert.ok(data);
      const sample=data.samples.find(p=>Math.abs(p.tMs-observation.tMs)<1e-6);assert.ok(sample);
      close(sample.sourceTimeSeconds,observation.sourceTimeSeconds,'Observation source time');
      const point=sample.landmarks.find(p=>p.index===guide.index);assert.ok(point);
      assert.deepEqual(guide[`${side}Raw`],{x:point.x,y:point.y});
      const support=observation.supportTimesMs;assert.ok(support.length>=2);
      assert.ok(support.some(t=>Math.abs(t-observation.tMs)<1e-6),'Selected observation must be in its actual support');
      for(const time of support){
        const actual=data.samples.find(p=>Math.abs(p.tMs-time)<1e-6),p=actual?.landmarks.find(p=>p.index===guide.index);
        assert.ok(actual?.status==='pose'&&p,`${ref.id}: invalid support`);
        const threshold=step.referenceVisibilityThreshold??.45;
        assert.ok(p.visibility>=threshold&&(p.presence??1)>=threshold,`${ref.id}: low-confidence source support`);
      }
    }
  }
  report.steps.push({id:ref.id,sourceStartSeconds:step.sourceStartSeconds,sourceEndSeconds:step.sourceEndSeconds,
    startingSquares:prepareStartPosition(ref).targets.length,availableFinishTriangles:ref.guides.filter(g=>g.valid).length,
    unavailableFinishIndices:ref.guides.filter(g=>!g.valid).map(g=>g.index),focusUsable:ref.referenceUsable});
}
report.checks.push('Every available start and finish retains genuine same-ID source coordinates, selected frame time and at least two trusted supporting observations; all six anatomical movement foci remain usable.');

for(const aspect of [16/9,4/3,9/16]){
  const viewport=cameraViewportBounds(aspect),layouts=references.map(ref=>createFullHeightLayout(ref,references,aspect));
  for(let i=0;i<lesson.seams.length;i++){
    const end=projectFourPointGuides(references[i],null,aspect,layouts[i].frame);
    const position=createStartPositionSession(references[i+1]);position.bodyFrame=layouts[i+1].frame;position.aspect=aspect;
    const start=projectStartPositionTargets(references[i+1],position);
    for(const index of BODY_INDICES){
      const a=end.find(p=>p.index===index),b=start.find(p=>p.index===index);
      assert.ok(a.valid&&b.valid);close(a.end.x,b.point.x,'Projected seam x');close(a.end.y,b.point.y,'Projected seam y');
      assert.ok(b.point.x>=viewport.left&&b.point.x<=viewport.right&&b.point.y>=viewport.top&&b.point.y<=viewport.bottom);
    }
    report.geometry.push({from:references[i].id,to:references[i+1].id,nativeAspect:aspect,previewAspect:7/8,sharedControlCenters:8,maximumProjectedJump:0});
  }
}
report.checks.push('All eight triangle centers equal the next eight square centers across all five cuts for 16:9, 4:3 and 9:16 camera inputs under the actual full-height portrait projection.');

// Explicitly constructed learner observations are used only to verify logic.
const ref=references[0],step=lesson.steps[0],data=sources.get(step.sourceId).data,body=ref.teacherFrame,aspect=body.aspect;
const source=data.samples.find(p=>Math.abs(p.tMs-ref.teacherFrameTMs)<1e-6);
const fixture=(fraction,tMs)=>{
  const live=structuredClone(source);live.tMs=tMs;
  for(const guide of ref.guides){
    const point=live.landmarks.find(p=>p.index===guide.index),end=guide.valid?guide.end:guide.start;
    Object.assign(point,{x:((guide.start.x+(end.x-guide.start.x)*fraction)*body.scale+body.hip.x)/aspect,
      y:(guide.start.y+(end.y-guide.start.y)*fraction)*body.scale+body.hip.y,visibility:1,presence:1});
  }
  return live;
};
const startSession=()=>{const session=createStartPositionSession(ref);session.bodyFrame=structuredClone(body);session.aspect=aspect;return session;};
const evaluateStart=(live,session,extra={})=>evaluateStartPosition(ref,live,{attemptAspectRatio:aspect,nowMs:live.tMs,observedAtMs:live.tMs,session,...extra});
let session=startSession(),score;
for(let t=1000;t<=2500;t+=250)score=evaluateStart(fixture(0,t),session);
assert.equal(score.status,'match');assert.equal(score.holdReady,true);
const startOutside=fixture(0,1000),startPoint=startOutside.landmarks.find(p=>p.index===13);
startPoint.x+=(startPoint.x>.5?-1:1)*.201*body.scale/aspect;
score=evaluateStart(startOutside,startSession());assert.equal(score.status,'mismatch');assert.equal(score.limbs.find(l=>l.index===13).near,false);
const startInside=fixture(0,1000),insidePoint=startInside.landmarks.find(p=>p.index===13);
insidePoint.x+=(insidePoint.x>.5?-1:1)*.199*body.scale/aspect;
score=evaluateStart(startInside,startSession());assert.equal(score.status,'match');assert.equal(score.holdReady,false);
score=evaluateStart(fixture(0,1000),startSession(),{nowMs:1451});assert.equal(score.status,'unknown');assert.equal(score.holdReady,false);
const matcher=createPracticeMatcher({requireRoute:false,retainStartedTargets:true});
const begin=()=>matcher.createSession(ref,null,fixture(0,1000),body,aspect);
const evaluate=(live,movement,extra={})=>matcher.evaluate(ref,null,live,{attemptAspectRatio:aspect,bodyFrame:body,nowMs:live?.tMs??1100,observedAtMs:live?.tMs??1100,session:movement,...extra});
score=evaluate(fixture(1,1100),begin());assert.equal(score.status,'match');
for(const [offset,expected]of [[.279,true],[.281,false]]){
  const end=fixture(1,1100),point=end.landmarks.find(p=>p.index===13);
  point.x+=(point.x>.5?-1:1)*offset*body.scale/aspect;
  score=evaluate(end,begin());assert.equal(score.limbs.find(l=>l.index===13).targetReached,expected);
}
session=begin();score=evaluate(fixture(1,1100),session,{nowMs:1551});assert.equal(score.status,'unknown');assert.equal(score.requiresPositioning,false);
score=evaluate(fixture(1,1200),session);assert.equal(score.status,'unknown','Reacquisition must not credit movement during the unseen interval');
session=begin();const missing=fixture(1,1100);missing.landmarks=missing.landmarks.filter(p=>p.index!==14);
score=evaluate(missing,session);assert.equal(score.status,'unknown');assert.equal(score.percent,null);assert.equal(score.requiresPositioning,false);
close(finishTriangleSize(body,720,ref),.28*.85*body.scale*720,'Body triangle visual scale');
close(finishTriangleSize(body,720),.4*.85*body.scale*720,'Default triangle visual scale');
report.checks.push('Constructed learner controls verify smaller start half-width 0.20 and finish radius 0.28, a fresh 1.5-second start hold, rejection outside each boundary, unknown on stale/missing tracking, and no unseen-movement credit after reacquisition.');

for(const original of manifest.steps){
  const metadata=sources.get(original.sourceId),legacyData=await read('public'+metadata.poseSrc);
  const legacy=prepareAnchoredReference(prepareFirstThreeReference(original,legacyData),original,legacyData);
  assert.equal(prepareStartPosition(legacy).radius,.4);assert.equal(positionedMovementRulesFor(legacy).endRadius,.4);
  const centerData=withCenterReferenceData(metadata.data),centerStep=withCenterFocus(original);
  const center=prepareAnchoredReference(prepareFirstThreeReference(centerStep,centerData,CENTER_REFERENCE_OPTIONS),centerStep,centerData);
  assert.equal(prepareStartPosition(center).radius,.28);assert.equal(positionedMovementRulesFor(center).endRadius,.4);
}
assert.equal(POSITIONED_MOVEMENT_RULES.endRadius,.4);
report.checks.push('Legacy anatomical four-point and palm/foot four-point start and finish tolerances remain unchanged; the reduction applies only to eight-control practice.');

const brokenSources=structuredClone(sources);
for(const entry of brokenSources.values())for(const sample of entry.data.samples)sample.landmarks=sample.landmarks.filter(p=>p.index!==13);
const broken=prepareContinuousLesson(originalSteps,brokenSources,BODY_REFERENCE_OPTIONS);
for(let i=0;i<broken.seams.length;i++){
  const a=broken.references[i].guides.find(g=>g.index===13),b=broken.references[i+1].guides.find(g=>g.index===13);
  assert.equal(a.endRaw,null,'A missing boundary joint must not be reconstructed');assert.equal(b.startRaw,null);
  assert.equal(a.valid,false);assert.equal(b.valid,false);
}
assert.equal(digest([originalSteps,[...sources]]),originalDigest,'Preparing continuity mutated source data or the original lesson metadata');
report.checks.push('Removing a source joint leaves both adjacent seam endpoints unavailable; no copied opposite-side joint, generated coordinate or interpolation repairs missing observations. Raw lesson metadata and archived data remain unchanged.');

await mkdir(new URL('../artifacts/continuity-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/continuity-review/summary.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,checks:report.checks.length,seams:report.seams,geometryCases:report.geometry.length,steps:report.steps},null,2));
