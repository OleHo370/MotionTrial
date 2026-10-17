// Offline regression: archived teacher references with explicitly CONSTRUCTED
// learner controls. This is not webcam inference or physical learner acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {CENTER_REFERENCE_OPTIONS,withCenterReferenceData,withCenterFocus} from '../public/practice-centers.js';
import {prepareFirstThreeReference} from '../public/first-three-reference.js';
import {prepareAnchoredReference} from '../public/start-position.js';
import {prepareMovementPaths} from '../public/movement-path.js';
import {createPracticeMatcher} from '../public/first-three-attempt.js';
const read=async p=>JSON.parse(await readFile(new URL('../'+p,import.meta.url),'utf8'));
const manifest=await read('public/practice-media/next-three/manifest.json');
const step=withCenterFocus(manifest.steps[0]);
const data=withCenterReferenceData(await read(`public/practice-media/first-three-centers/${step.sourceId}.poses.json`));
const aspect=data.width/data.height;
const ref=prepareAnchoredReference(prepareFirstThreeReference(step,data,CENTER_REFERENCE_OPTIONS),step,data);
const paths=prepareMovementPaths(ref,step,data),body=ref.teacherFrame;
assert.equal(ref.referenceUsable,true);assert.deepEqual(ref.focusJoints,[35]);
const source=data.samples.find(s=>s.tMs===ref.teacherFrameTMs);
const fixture=(fraction,tMs)=>{
  const sample=structuredClone(source);sample.tMs=tMs;
  for(const guide of ref.guides.filter(g=>g.valid)){
    const p=sample.landmarks.find(p=>p.index===guide.index);
    const point={x:guide.start.x+(guide.end.x-guide.start.x)*fraction,y:guide.start.y+(guide.end.y-guide.start.y)*fraction};
    Object.assign(p,{x:(point.x*body.scale+body.hip.x)/aspect,y:point.y*body.scale+body.hip.y,visibility:1,presence:1});
  }
  return sample;
};
const kept=createPracticeMatcher({requireRoute:false,retainStartedTargets:true});
const strict=createPracticeMatcher(),route=createPracticeMatcher({requireRoute:true,retainStartedTargets:true});
assert.equal(kept.retainsStartedTargets,true);assert.equal(strict.retainsStartedTargets,false);assert.equal(route.retainsStartedTargets,false);
const begin=()=>kept.createSession(ref,paths,fixture(0,1000),body,aspect);
const evaluate=(sample,session,extra={})=>kept.evaluate(ref,paths,sample,{attemptAspectRatio:aspect,
  nowMs:sample?.tMs??1200,observedAtMs:sample?.tMs??1200,bodyFrame:body,session,...extra});
const report={provenance:'Actual archived teacher reference and torso frame; all learner samples are explicitly constructed deterministic controls. No browser, webcam, model or human acceptance run.',
  checks:[],results:{},limitations:['The UI completion hold and physical tracking remain manual checks.']};
let session=begin(),snapshot=structuredClone(session.bodyFrame);
let result=evaluate(fixture(.1,1100),session);
assert.equal(result.status,'mismatch');assert.equal(result.requiresPositioning,false);assert.deepEqual(session.bodyFrame,snapshot);
result=evaluate(fixture(1,1200),session);assert.equal(result.status,'match');assert.equal(result.requiresPositioning,false);
report.checks.push('Ordinary small movement away from the start keeps the committed targets and can reach the finish directly.');

session=begin();evaluate(fixture(.1,1100),session);
const missing=fixture(.2,1200);missing.landmarks=missing.landmarks.filter(p=>p.index!==35);
result=evaluate(missing,session);assert.equal(result.status,'unknown');assert.equal(result.requiresPositioning,false);
assert.equal(result.percent,null);assert.deepEqual(session.bodyFrame,snapshot);
result=evaluate(fixture(1,1300),session);assert.equal(result.status,'unknown');assert.equal(result.recoveringTracking,true);
assert.equal(result.requiresPositioning,false);
result=evaluate(fixture(1,1400),session);assert.notEqual(result.status,'match');assert.equal(result.requiresPositioning,false);
assert.equal(result.limbs.find(p=>p.index===35).movementObserved,false);
report.results.unseenJump=result.status;
report.checks.push('Missing tracking retains targets but erases motion evidence; first fresh endpoint reacquisition and subsequent still endpoint cannot pass an unseen jump.');

session=begin();evaluate(missing,session);
result=evaluate(fixture(.4,1300),session);assert.equal(result.status,'unknown');assert.equal(result.recoveringTracking,true);
assert.equal(result.requiresPositioning,false);
result=evaluate(fixture(1,1400),session);assert.equal(result.status,'match');assert.equal(result.requiresPositioning,false);
report.results.recoveredFreshMovement=result.status;
report.checks.push('A new fully observed mid-path baseline followed by fresh travel to the finish succeeds without returning to starting squares.');

session=begin();evaluate(missing,session);
result=evaluate(fixture(1,1300),session);assert.equal(result.status,'unknown');
result=evaluate(fixture(.5,1400),session);assert.notEqual(result.status,'match');assert.equal(result.requiresPositioning,false);
result=evaluate(fixture(1,1500),session);assert.equal(result.status,'match');assert.equal(result.requiresPositioning,false);
report.results.reacquiredAtEndpointThenBackAndReturn=result.status;
report.checks.push('Recovery at the endpoint can re-arm from a freshly observed backed-off position and finish on return, without overshooting or visiting the starting squares.');

for(const kind of ['stale','repeated','low-confidence','partial','missing-torso','duplicate']){
  session=begin();evaluate(fixture(.1,1100),session);
  let sample=fixture(.2,kind==='repeated'?1100:1200),extra={};
  if(kind==='stale')extra.nowMs=1800;
  if(kind==='low-confidence')sample.landmarks.find(p=>p.index===35).visibility=.1;
  if(kind==='partial')sample.landmarks=sample.landmarks.filter(p=>p.index!==34);
  if(kind==='missing-torso')sample.landmarks=sample.landmarks.filter(p=>p.index!==11);
  if(kind==='duplicate')sample.landmarks.push({...sample.landmarks[0]});
  result=evaluate(sample,session,extra);assert.equal(result.status,'unknown',kind);assert.equal(result.requiresPositioning,false,kind);
  assert.equal(result.percent,null);assert.deepEqual(session.bodyFrame,snapshot);
  const recoveryTime=kind==='stale'?1900:1300;
  result=evaluate(fixture(1,recoveryTime),session);assert.equal(result.status,'unknown',kind);assert.equal(result.recoveringTracking,true,kind);
  result=evaluate(fixture(1,recoveryTime+100),session);assert.notEqual(result.status,'match',kind);
  report.results[kind]=result.status;
}
report.checks.push('Stale, repeated, partial, low-confidence, missing-torso and duplicate observations cannot pass or preserve previous movement evidence.');

for(const kind of ['reference','aspect','frame']){
  session=begin();const reference=kind==='reference'?{...ref,id:ref.id+'-changed'}:ref;
  const extra=kind==='aspect'?{attemptAspectRatio:aspect+.1}:kind==='frame'?{bodyFrame:{...body,hip:{...body.hip,x:body.hip.x+.01}}}:{};
  result=kept.evaluate(reference,paths,fixture(.1,1100),{attemptAspectRatio:aspect,nowMs:1100,observedAtMs:1100,bodyFrame:body,session,...extra});
  assert.equal(result.status,'unknown',kind);assert.equal(result.requiresPositioning,true,kind);
}
for(const matcher of [strict,route]){
  session=matcher.createSession(ref,paths,fixture(0,1000),body,aspect);
  result=matcher.evaluate(ref,paths,missing,{attemptAspectRatio:aspect,nowMs:1200,observedAtMs:1200,bodyFrame:body,session});
  assert.equal(result.status,'unknown');assert.equal(result.requiresPositioning,true);
}
report.checks.push('Changed reference, aspect or committed frame still require new positioning; legacy endpoint and route modes retain their strict reset behavior.');
await mkdir(new URL('../artifacts/retained-targets-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/retained-targets-review/summary.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
