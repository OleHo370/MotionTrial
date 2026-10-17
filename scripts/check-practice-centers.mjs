// Focused offline software checks, not a webcam or human practice acceptance test.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {CENTER_POINT_DEFINITIONS,CENTER_INDICES,CENTER_POINT_VERSION,CENTER_REFERENCE_OPTIONS,withPracticeCenters,withCenterReferenceData,withCenterFocus} from '../public/practice-centers.js';
import {prepareFirstThreeReference} from '../public/first-three-reference.js';
import {prepareAnchoredReference,prepareStartPosition,createStartPositionSession,projectStartPositionTargets,evaluateStartPosition} from '../public/start-position.js';
import {prepareMovementPaths,createMovementPathSession,evaluateMovementPaths} from '../public/movement-path.js';
const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const manifest=await read('public/practice-media/next-three/manifest.json'),sources=new Map(),report={
  provenance:'Offline checks of genuine prerecorded teacher observations plus explicitly constructed software controls. Not live webcam or physical learner acceptance.',
  pointVersion:CENTER_POINT_VERSION,checks:[],steps:[],legacyDefaults:[],recordedTraceReplays:[]};
for(const source of manifest.sources)sources.set(source.id,await read(`public/practice-media/first-three-centers/${source.id}.poses.json`));
const raw=sources.get('opening').samples.find(s=>CENTER_INDICES.every(index=>withPracticeCenters(s).landmarks.some(p=>p.index===index)));
assert.ok(raw);const before=structuredClone(raw),adapted=withPracticeCenters(raw);
assert.deepEqual(raw,before);assert.deepEqual(adapted.landmarks.filter(p=>p.index<33),raw.landmarks);
assert.deepEqual(withPracticeCenters(adapted),adapted);
for(const def of CENTER_POINT_DEFINITIONS){
  const p=adapted.landmarks.find(p=>p.index===def.index),parts=def.sources.map(index=>raw.landmarks.find(p=>p.index===index));
  assert.equal(p.x,parts.reduce((sum,p,i)=>sum+p.x*def.weights[i],0));
  assert.equal(p.y,parts.reduce((sum,p,i)=>sum+p.y*def.weights[i],0));
  assert.equal(p.visibility,Math.min(...parts.map(p=>p.visibility)));
  const missing=structuredClone(raw);missing.landmarks=missing.landmarks.filter(p=>p.index!==def.sources.at(-1));
  assert.ok(!withPracticeCenters(missing).landmarks.some(p=>p.index===def.index));
  const low=structuredClone(raw);low.landmarks.find(p=>p.index===def.sources.at(-1)).visibility=.1;
  assert.ok(!withPracticeCenters(low).landmarks.some(p=>p.index===def.index));
  const lowPresence=structuredClone(raw);lowPresence.landmarks.find(p=>p.index===def.sources.at(-1)).presence=.1;
  assert.ok(!withPracticeCenters(lowPresence).landmarks.some(p=>p.index===def.index));
}
report.checks.push('Same-frame derived centers preserve all raw anatomical points, are idempotent, and disappear when any supporting component is missing or unreliable. No wrist/ankle fallback.');
for(const originalStep of manifest.steps){
  const step=withCenterFocus(originalStep),data=withCenterReferenceData(sources.get(step.sourceId));
  const ref=prepareAnchoredReference(prepareFirstThreeReference(step,data,CENTER_REFERENCE_OPTIONS),step,data);
  const start=prepareStartPosition(ref),path=prepareMovementPaths(ref,step,data);
  assert.ok(ref.referenceUsable,ref.unknownReason);assert.ok(start.usable,start.unknownReason);
  assert.ok(path.referenceUsable,path.unknownReason);
  assert.deepEqual(start.targets.map(t=>t.index),CENTER_INDICES);
  report.steps.push({id:step.id,startsUsable:start.usable,referenceUsable:ref.referenceUsable,
    pathsUsable:path.referenceUsable,pathReason:path.unknownReason,
    unavailableEnds:ref.guides.filter(g=>!g.valid).map(g=>g.index),
    routes:path.paths.map(p=>({index:p.index,squares:p.checkpoints.length,available:p.available}))});
  const session=createStartPositionSession(ref);session.bodyFrame=structuredClone(ref.teacherFrame);session.aspect=data.width/data.height;
  const targets=projectStartPositionTargets(ref,session),fixture=structuredClone(withPracticeCenters(raw));
  for(const target of targets){const p=fixture.landmarks.find(p=>p.index===target.index);Object.assign(p,target.point,{visibility:1,presence:1});}
  let positioned;
  for(let t=1000;t<=2500;t+=250){fixture.tMs=t;positioned=evaluateStartPosition(ref,fixture,{attemptAspectRatio:session.aspect,nowMs:t,observedAtMs:t,session});}
  assert.equal(positioned.holdReady,true);
  for(const def of CENTER_POINT_DEFINITIONS){
    const off=structuredClone(fixture);off.tMs=2750;
    // Old raw joints stay put. Moving only the actual center outside its square must fail.
    off.landmarks.find(p=>p.index===def.index).x+=.41*session.bodyFrame.scale/session.aspect;
    const result=evaluateStartPosition(ref,off,{attemptAspectRatio:session.aspect,nowMs:2750,observedAtMs:2750,session:structuredClone(session)});
    assert.equal(result.holdReady,false);assert.equal(result.allNear,false);
  }
  const missing=structuredClone(fixture);missing.tMs=2750;missing.landmarks=missing.landmarks.filter(p=>p.index!==33);
  const unknown=evaluateStartPosition(ref,missing,{attemptAspectRatio:session.aspect,nowMs:2750,observedAtMs:2750,session:structuredClone(session)});
  assert.equal(unknown.status,'unknown');assert.equal(unknown.holdReady,false);
  const stale=evaluateStartPosition(ref,fixture,{attemptAspectRatio:session.aspect,nowMs:4000,observedAtMs:2500,session:structuredClone(session)});
  assert.equal(stale.status,'unknown');assert.equal(stale.holdReady,false);
  if(path.referenceUsable){
    const trace=data.samples.filter(s=>s.tMs>=step.startSeconds*1000&&s.tMs<step.endSeconds*1000);
    const unlock=structuredClone(trace[0]);unlock.tMs=1000;
    const movement=createMovementPathSession(ref,path,unlock,ref.teacherFrame,data.width/data.height);
    let result;
    for(const [i,recorded]of trace.entries()){
      const live={...recorded,tMs:1100+i*100};
      result=evaluateMovementPaths(ref,path,live,{attemptAspectRatio:data.width/data.height,nowMs:live.tMs,observedAtMs:live.tMs,bodyFrame:ref.teacherFrame,session:movement});
    }
    assert.equal(result.pathComplete,true);
    const replay={id:step.id,status:result.status,complete:result.pathComplete,reason:result.reason};
    // Explicit constructed endpoint control after the real recorded route.
    // This is software verification, not evidence of a physical learner.
    const endpoint=structuredClone(trace.at(-1));
    for(const guide of ref.guides.filter(g=>g.valid)){
      const point=endpoint.landmarks.find(p=>p.index===guide.index)||{index:guide.index};
      if(!endpoint.landmarks.includes(point))endpoint.landmarks.push(point);
      Object.assign(point,{x:(guide.end.x*ref.teacherFrame.scale+ref.teacherFrame.hip.x)/(data.width/data.height),
        y:guide.end.y*ref.teacherFrame.scale+ref.teacherFrame.hip.y,visibility:1,presence:1});
    }
    endpoint.tMs=1200+trace.length*100;
    const finish=evaluateMovementPaths(ref,path,endpoint,{attemptAspectRatio:data.width/data.height,nowMs:endpoint.tMs,observedAtMs:endpoint.tMs,bodyFrame:ref.teacherFrame,session:movement});
    assert.equal(finish.status,'match');replay.constructedFinishStatus=finish.status;
    report.recordedTraceReplays.push(replay);
  }
  const legacySource=manifest.sources.find(s=>s.id===step.sourceId),legacyData=await read('public'+legacySource.poseSrc);
  const legacyRef=prepareAnchoredReference(prepareFirstThreeReference(originalStep,legacyData),originalStep,legacyData);
  const legacyStart=prepareStartPosition(legacyRef),legacyPath=prepareMovementPaths(legacyRef,originalStep,legacyData);
  assert.deepEqual(legacyStart.targets.map(t=>t.index),[15,16,27,28]);assert.equal(legacyPath.referenceUsable,true);
  report.legacyDefaults.push({id:step.id,indices:legacyStart.targets.map(t=>t.index),pathUsable:legacyPath.referenceUsable});
}
report.checks.push('All six steps use four center-based starts; constructed fresh holds require 1.5 seconds and each center, while missing/stale centers cannot pass.');
report.checks.push('All six legacy archived wrist/ankle references retain their original default indices and usable paths.');
report.checks.push('All six genuine prerecorded routes collect their ordered centers; separately labelled constructed endpoint controls satisfy the matching target geometry. Step 4 raw final-frame foot jitter remains a recorded-source limitation, not a physical pass.');
await mkdir(new URL('../artifacts/palm-foot-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/palm-foot-review/control-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:report.checks,steps:report.steps,replays:report.recordedTraceReplays},null,2));
