// Offline verification of genuine archived teacher observations and explicitly
// CONSTRUCTED learner controls. This is not webcam inference or human acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {
  BODY_POINT_VERSION,BODY_POINT_DEFINITIONS,BODY_INDICES,BODY_COLORS,BODY_NAMES,BODY_REFERENCE_OPTIONS,
  CENTER_INDICES,CENTER_REFERENCE_OPTIONS,withBodyPracticePoints,withBodyReferenceData,
  withCenterReferenceData,withCenterFocus,
} from '../public/practice-centers.js';
import {prepareFirstThreeReference} from '../public/first-three-reference.js';
import {
  prepareAnchoredReference,prepareStartPosition,createStartPositionSession,
  projectStartPositionTargets,evaluateStartPosition,
} from '../public/start-position.js';
import {prepareMovementPaths} from '../public/movement-path.js';
import {projectFourPointGuides} from '../public/four-point-game-runtime.js';
import {createPracticeMatcher} from '../public/first-three-attempt.js';
import {FULL_HEIGHT_LAYOUT_RULES,cameraViewportBounds,createFullHeightLayout} from '../public/full-height-layout.js';

const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const close=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-9,`${label}: ${a} != ${b}`);
const inside=(value,low,high,label)=>assert.ok(value>=low-1e-9&&value<=high+1e-9,`${label}: ${value} outside [${low}, ${high}]`);
const auxiliary=[13,14,25,26],manifest=await read('public/practice-media/next-three/manifest.json');
const sources=new Map();
for(const source of manifest.sources)sources.set(source.id,await read(`public/practice-media/first-three-centers/${source.id}.poses.json`));
const sourceBefore=digest([...sources]);
assert.equal(BODY_POINT_VERSION,'eight-body-controls-v1');
assert.deepEqual(BODY_INDICES,[...CENTER_INDICES,...auxiliary]);
assert.equal(BODY_POINT_DEFINITIONS.length,8);assert.equal(new Set(BODY_INDICES).size,8);
assert.deepEqual(BODY_REFERENCE_OPTIONS.pointIndices,BODY_INDICES);
assert.equal(BODY_REFERENCE_OPTIONS.controlPointVersion,BODY_POINT_VERSION);
for(const [index,label,color]of [[13,'Left elbow','#8ee886'],[14,'Right elbow','#ff9678'],[25,'Left knee','#62c9f5'],[26,'Right knee','#f582c3']]){
  assert.equal(BODY_NAMES[index],label);assert.equal(BODY_COLORS[index],color);
}
const report={
  provenance:'Offline software verification using actual archived 24.mp4 MediaPipe observations. Learner positions are explicitly constructed deterministic controls, not live inference, webcam recordings, or human acceptance.',
  pointVersion:BODY_POINT_VERSION,checks:[],steps:[],geometry:[],legacy:[],
  limitations:['Physical camera visibility, joint placement, and simultaneous eight-target reachability still require manual testing.',
    'Step 6 has insufficient supported left-palm, right-foot and left-elbow endpoints at its existing 0.65 source confidence threshold; those finish triangles remain unavailable.'],
};
const raw=sources.get('opening').samples.find(s=>BODY_INDICES.every(index=>withBodyPracticePoints(s).landmarks.some(p=>p.index===index)));
assert.ok(raw,'An actual source frame must provide all eight controls.');
const adapted=withBodyPracticePoints(raw),rawSnapshot=structuredClone(raw);
assert.equal(adapted.controlPointVersion,BODY_POINT_VERSION);
assert.deepEqual(adapted.landmarks.filter(p=>p.index<33),raw.landmarks);
assert.deepEqual(withBodyPracticePoints(adapted),adapted,'Body adaptation must be idempotent.');
assert.deepEqual(raw,rawSnapshot,'Body adaptation mutated original MediaPipe observations.');
for(const index of auxiliary){
  assert.deepEqual(adapted.landmarks.find(p=>p.index===index),raw.landmarks.find(p=>p.index===index));
  const missing=structuredClone(raw);missing.landmarks=missing.landmarks.filter(p=>p.index!==index);
  assert.ok(!withBodyPracticePoints(missing).landmarks.some(p=>p.index===index),'Missing auxiliary joints must never be generated.');
}
report.checks.push('Eight distinct controls retain derived palm/foot centers and raw anatomical elbow/knee IDs 13, 14, 25, and 26 without substitution, retagging, or source mutation.');

const prepared=manifest.steps.map(original=>{
  const step=withCenterFocus(original),data=withBodyReferenceData(sources.get(step.sourceId));
  const ref=prepareAnchoredReference(prepareFirstThreeReference(step,data,BODY_REFERENCE_OPTIONS),step,data);
  return {step,data,ref,path:prepareMovementPaths(ref,step,data)};
});
assert.equal(prepared.length,6);
const matcher=createPracticeMatcher({requireRoute:false,retainStartedTargets:true});
for(const {step,data,ref,path}of prepared){
  const aspect=data.width/data.height,body=ref.teacherFrame,starts=prepareStartPosition(ref);
  assert.equal(ref.controlPointVersion,BODY_POINT_VERSION);assert.equal(ref.guides.length,8);
  assert.equal(starts.usable,true,`${ref.id}: ${starts.unknownReason}`);
  assert.equal(starts.radius,.20,'The compact eight-point start-square profile must match its visible size.');
  assert.equal(ref.referenceUsable,true,`${ref.id}: ${ref.unknownReason}`);
  assert.deepEqual(starts.targets.map(p=>p.index),BODY_INDICES);
  assert.deepEqual(ref.focusJoints,step.focusJoints,'Do not turn supporting elbow/knee movement into invented semantic focus.');
  assert.ok(ref.focusJoints.every(index=>CENTER_INDICES.includes(index)));
  const source=data.samples.find(sample=>sample.tMs===ref.teacherFrameTMs);
  assert.ok(source);const threshold=step.referenceVisibilityThreshold??.45;
  for(const index of auxiliary){
    const guide=ref.guides.find(p=>p.index===index);
    assert.equal(guide.label,BODY_NAMES[index]);assert.equal(guide.color,BODY_COLORS[index]);
    assert.ok(guide.startAvailable);assert.ok(guide.support.startTimesMs.length>=2);
    for(const side of ['start','end']){
      if(!guide[`${side}Available`])continue;
      const point=guide[`${side}Raw`],times=guide.support[`${side}TimesMs`];
      assert.ok(times.length>=2);
      assert.ok(times.some(time=>data.samples.some(sample=>sample.tMs===time&&sample.landmarks.some(p=>p.index===index
        &&p.x===point.x&&p.y===point.y&&p.visibility>=threshold&&(p.presence??1)>=threshold))),`${ref.id}: ${guide.label} ${side} must be an actual supported same-ID observation.`);
    }
  }
  // Construct all eight control positions in the teacher's true starting torso
  // frame. These fixture coordinates are deliberately not claimed as inference.
  const fixture=(fraction,tMs)=>{
    const live=structuredClone(source);live.tMs=tMs;
    for(const guide of ref.guides){
      const p=live.landmarks.find(p=>p.index===guide.index)||{index:guide.index};
      if(!live.landmarks.includes(p))live.landmarks.push(p);
      const end=guide.valid?guide.end:guide.start;
      Object.assign(p,{x:((guide.start.x+(end.x-guide.start.x)*fraction)*body.scale+body.hip.x)/aspect,
        y:(guide.start.y+(end.y-guide.start.y)*fraction)*body.scale+body.hip.y,visibility:1,presence:1});
    }
    return live;
  };
  const startSession=()=>{
    const session=createStartPositionSession(ref);session.bodyFrame=structuredClone(body);session.aspect=aspect;return session;
  };
  const startEval=(live,session,extra={})=>evaluateStartPosition(ref,live,{attemptAspectRatio:aspect,nowMs:live.tMs,observedAtMs:live.tMs,session,...extra});
  const held=startSession();let result;
  for(let t=1000;t<=2500;t+=250)result=startEval(fixture(0,t),held);
  assert.equal(result.status,'match');assert.equal(result.holdReady,true);assert.equal(result.limbs.length,8);
  const early=startSession();result=startEval(fixture(0,1000),early);result=startEval(fixture(0,2250),early);
  assert.equal(result.holdReady,false,'Interrupted samples cannot complete the starting hold.');
  const targets=projectStartPositionTargets(ref,held);assert.equal(targets.length,8);assert.ok(targets.every(p=>p.valid));
  const guides=projectFourPointGuides(ref,null,aspect,body);assert.equal(guides.length,8);
  const begin=()=>matcher.createSession(ref,path,fixture(0,1000),body,aspect);
  const evaluate=(live,session,extra={})=>matcher.evaluate(ref,path,live,{attemptAspectRatio:aspect,nowMs:live?.tMs??1200,
    observedAtMs:live?.tMs??1200,bodyFrame:body,session,...extra});
  let session=begin();assert.equal(session.invalidated,false);
  result=evaluate(fixture(1,1100),session);assert.equal(result.status,'match',`${ref.id}: ${result.reason}`);
  assert.equal(result.limbs.length,8);
  for(const index of auxiliary){
    const missingStart=fixture(0,2750);missingStart.landmarks=missingStart.landmarks.filter(p=>p.index!==index);
    result=startEval(missingStart,structuredClone(held));assert.equal(result.status,'unknown');assert.equal(result.holdReady,false);
    const offStart=fixture(0,2750),point=offStart.landmarks.find(p=>p.index===index);
    point.x+=(point.x>.5?-1:1)*.30*body.scale/aspect;
    result=startEval(offStart,structuredClone(held));assert.equal(result.status,'mismatch');assert.equal(result.allNear,false);
    const missingEnd=fixture(1,1100);missingEnd.landmarks=missingEnd.landmarks.filter(p=>p.index!==index);
    session=begin();result=evaluate(missingEnd,session);
    // Even an unavailable source end does not permit a missing point to create
    // a false start; supported ends must remain required for finish matching.
    if(ref.guides.find(g=>g.index===index).valid){
      assert.equal(result.status,'unknown');assert.equal(result.percent,null);assert.equal(result.requiresPositioning,false);
      const offEnd=fixture(1,1100),p=offEnd.landmarks.find(p=>p.index===index);
      p.x+=(p.x>.5?-1:1)*.41*body.scale/aspect;
      result=evaluate(offEnd,begin());assert.equal(result.status,'mismatch');assert.equal(result.limbs.find(p=>p.index===index).targetReached,false);
      const low=fixture(1,1100);low.landmarks.find(p=>p.index===index).visibility=.1;
      result=evaluate(low,begin());assert.equal(result.status,'unknown');assert.equal(result.requiresPositioning,false);
    }
  }
  // Unknown elbow/knee tracking keeps the committed targets, but reacquiring
  // an endpoint cannot borrow unseen travel and immediately award completion.
  session=begin();const missing=fixture(.2,1100);missing.landmarks=missing.landmarks.filter(p=>p.index!==14);
  result=evaluate(missing,session);assert.equal(result.status,'unknown');assert.equal(result.requiresPositioning,false);
  result=evaluate(fixture(1,1200),session);assert.equal(result.status,'unknown');assert.equal(result.recoveringTracking,true);
  result=evaluate(fixture(1,1300),session);assert.notEqual(result.status,'match');assert.equal(result.limbs.length,8);
  result=evaluate(fixture(.4,1400),session);assert.notEqual(result.status,'match');
  result=evaluate(fixture(1,1500),session);assert.equal(result.status,'match');assert.equal(result.requiresPositioning,false);
  const unavailable=ref.guides.filter(g=>!g.valid).map(g=>g.index);
  if(step.id==='first-six-06'){
    assert.deepEqual(unavailable,[33,36,13]);
    session=begin();result=evaluate(missing,session);assert.equal(result.status,'unknown');
    const recovery=fixture(.4,1200);recovery.landmarks=recovery.landmarks.filter(p=>!unavailable.includes(p.index));
    result=evaluate(recovery,session);assert.equal(result.status,'unknown');assert.equal(session.recoveryPending,false);
    const finish=fixture(1,1300);finish.landmarks=finish.landmarks.filter(p=>!unavailable.includes(p.index));
    result=evaluate(finish,session);assert.equal(result.status,'match');
  }else assert.deepEqual(unavailable,[]);
  report.steps.push({id:step.id,sourceThreshold:threshold,startingSquares:starts.targets.length,
    availableFinishTriangles:ref.guides.filter(g=>g.valid).length,unavailableFinishIndices:unavailable,
    focusIndices:ref.focusJoints,constructedStartHeld:true,constructedFinishMatched:true,
    auxiliarySourceSupport:ref.guides.filter(g=>auxiliary.includes(g.index)).map(g=>({index:g.index,start:g.support.startTimesMs.length,end:g.support.endTimesMs.length,finishAvailable:g.valid}))});
}
report.checks.push('All six actual source references provide eight supported starts; every new joint is independently required for starting and each available finish. Misplaced, missing, or low-confidence observed joints cannot pass.');
report.checks.push('Fresh constructed eight-point starts require the existing 1.5-second hold. The compact body profile retains semantic movement focus; hidden route checkpoints remain unnecessary.');
report.checks.push('Missing auxiliary tracking retains committed triangles, clears movement evidence, and requires fresh observed travel after reacquisition rather than awarding an unseen endpoint jump.');
report.checks.push('Step 6 preserves unsupported left-palm, right-foot and left-elbow finishes as unavailable; after the verified start, they do not block fresh recovery and matching of the supported finish targets.');

for(const aspect of [16/9,4/3,9/16]){
  const viewport=cameraViewportBounds(aspect),references=prepared.map(p=>p.ref);
  close(viewport.width*aspect/viewport.height,7/8,'Portrait preview aspect');
  const origins=[];
  for(const {ref}of prepared){
    const layout=createFullHeightLayout(ref,references,aspect),frame=layout.frame;
    assert.ok(frame);const factor=frame.scale/ref.teacherFrame.scale;
    close(factor,viewport.height*(1-2*FULL_HEIGHT_LAYOUT_RULES.edge)/(FULL_HEIGHT_LAYOUT_RULES.footBottomY-FULL_HEIGHT_LAYOUT_RULES.headTopY),'Full-height scale must not compress');
    close(layout.mappedHeadY,viewport.top+.02*viewport.height,'Head margin');
    close(layout.mappedSoleY,viewport.bottom-.02*viewport.height,'Foot margin');
    const session=createStartPositionSession(ref);session.bodyFrame=frame;session.aspect=aspect;
    for(const target of projectStartPositionTargets(ref,session)){
      assert.ok(target.valid);inside(target.point.x,viewport.left,viewport.right,`${ref.id} ${target.label} start x`);
      inside(target.point.y,viewport.top,viewport.bottom,`${ref.id} ${target.label} start y`);
    }
    for(const target of projectFourPointGuides(ref,null,aspect,frame).filter(g=>g.valid)){
      inside(target.end.x,viewport.left,viewport.right,`${ref.id} ${target.label} finish x`);
      inside(target.end.y,viewport.top,viewport.bottom,`${ref.id} ${target.label} finish y`);
    }
    origins.push(frame.hip.x-ref.teacherFrame.hip.x*factor);
    report.geometry.push({id:ref.id,nativeAspect:aspect,previewAspect:7/8,headY:layout.mappedHeadY,soleY:layout.mappedSoleY,factor,startCount:8});
  }
  for(const origin of origins)close(origin,origins[0],'Shared lesson horizontal origin');
}
report.checks.push('The eight-point layout preserves uniform standing-body scale in the 7:8 crop for 16:9, 4:3, and 9:16 inputs; all supported start/finish centers remain inside the visible preview.');

for(const original of manifest.steps){
  const metadata=manifest.sources.find(s=>s.id===original.sourceId),legacyData=await read('public'+metadata.poseSrc);
  const legacy=prepareAnchoredReference(prepareFirstThreeReference(original,legacyData),original,legacyData);
  assert.deepEqual(prepareStartPosition(legacy).targets.map(p=>p.index),[15,16,27,28]);assert.equal(legacy.guides.length,4);
  const step=withCenterFocus(original),centerData=withCenterReferenceData(sources.get(step.sourceId));
  const center=prepareAnchoredReference(prepareFirstThreeReference(step,centerData,CENTER_REFERENCE_OPTIONS),step,centerData);
  assert.deepEqual(prepareStartPosition(center).targets.map(p=>p.index),CENTER_INDICES);assert.equal(center.guides.length,4);
  report.legacy.push({id:original.id,anatomicalDefaults:4,palmFootMode:4});
}
assert.equal(digest([...sources]),sourceBefore,'Recorded source JSON objects changed during the eight-point checks.');
report.checks.push('All six legacy anatomical four-point and palm/foot four-point modes keep their original indices, control count, and recorded source data.');
const reviewDirectory=new URL(`../${process.env.MOTIONTRIAL_REVIEW_DIR??'artifacts/eight-points-review'}/`,import.meta.url);
await mkdir(reviewDirectory,{recursive:true});
await writeFile(new URL('summary.json',reviewDirectory),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
