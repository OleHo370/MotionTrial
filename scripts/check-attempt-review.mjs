// All learner fixtures are explicitly CONSTRUCTED or offline recorded replays.
// This script does not use a webcam and is not a human practice acceptance test.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {REVIEW_RULES,createAttemptReview,observeAttemptReview,finalizeAttemptReview} from '../public/practice-attempt-review.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {preparePracticeTubes} from '../public/practice-tube.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';

const root=new URL('../',import.meta.url),checks=[];
const read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clamp=n=>Math.max(0,Math.min(1,n));
const frame={hip:{x:.5,y:.5},scale:.2,aspect:1};
const project=p=>({x:p.x*frame.scale+frame.hip.x,y:p.y*frame.scale+frame.hip.y});
const indices=[33,34,35,36],labels=['Left palm','Right palm','Left foot','Right foot'];
const starts=[{x:-1,y:.3},{x:1,y:.3},{x:-.65,y:1.8},{x:.65,y:1.8}];
const ends=[{x:-1,y:-1.5},{x:1,y:-1.5},starts[2],starts[3]];
const between=(a,b,f)=>({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f});
const teacherPhase=t=>clamp((t/4000-.2)/.6);
const reference={id:'constructed-raise',referenceUsable:true,guides:indices.map((index,i)=>({
  index,label:labels[i],valid:true,start:starts[i],end:ends[i],startSourceSeconds:0,
  targetGeometry:i>1?{mode:'hold'}:undefined}))};
const pathReference={referenceUsable:true,paths:indices.slice(0,2).map((index,i)=>({
  index,available:true,points:[starts[i],ends[i]],observations:Array.from({length:61},(_,k)=>({
    sourceTimeSeconds:k/15,point:between(starts[i],ends[i],teacherPhase(k*1000/15))}))}))};
const metadata={bodyFrame:frame,aspect:1,startAtMs:10000,durationMs:4000,playbackRate:.5};
function fixture(elapsed,{phase=teacherPhase(elapsed/2),offset=()=>({x:0,y:0}),omit=()=>false,
  status='pose',visibility=1}={}){
  return {sample:{tMs:elapsed+10000,status,landmarks:indices.flatMap((index,i)=>{
    if(omit(index,elapsed))return [];
    const p=between(starts[i],ends[i],i<2?phase:0),delta=offset(index,elapsed,phase);
    return [{index,...project({x:p.x+delta.x,y:p.y+delta.y}),visibility,presence:visibility}];
  })},aspectRatio:1,observedAtMs:elapsed+10000};
}
function run(options={},times=Array.from({length:241},(_,k)=>k*100/3)){
  const session=createAttemptReview(reference,pathReference,metadata);
  for(const elapsed of times)observeAttemptReview(session,fixture(elapsed,{
    ...options,phase:options.phaseAt?options.phaseAt(elapsed):teacherPhase(elapsed/2)}),{nowMs:10000+elapsed,elapsedMs:elapsed});
  return {session,result:finalizeAttemptReview(session,{nowMs:18000,elapsedMs:8000})};
}
const check=(name,fn)=>{fn();checks.push(name);};
check('Close-enough spatial differences pass without following exact checkpoints',()=>{
  const {result}=run({offset:(index,t,phase)=>({x:index<35?.20*Math.sin(Math.PI*phase):.15,y:0})});
  assert.equal(result.status,'match');assert.equal(result.passed,true);assert.equal(result.percent,null);
  assert.ok(result.limbs.every(limb=>limb.coverage>.98&&limb.endpointReached));
});
check('Collection cannot pass early and incomplete clips are unknown',()=>{
  const session=createAttemptReview(reference,pathReference,metadata);
  const live=observeAttemptReview(session,fixture(4000,{phase:1}),{nowMs:14000,elapsedMs:4000});
  assert.equal(live.status,'collecting');assert.equal(live.passed,false);
  const result=finalizeAttemptReview(session,{nowMs:14000,elapsedMs:4000});
  assert.equal(result.status,'unknown');assert.ok(result.issues.some(i=>i.code==='attempt_incomplete'));
});
check('30 Hz observations support endpoints without a new hold requirement',()=>{
  const {result}=run();assert.equal(result.status,'match');
  assert.ok(result.limbs.every(limb=>limb.sampleCount===241&&limb.endpointReached));
});
check('Substantially too-fast travel is identified after the full clip',()=>{
  const {result}=run({phaseAt:t=>clamp((t/8000-.2)/.18)});
  assert.equal(result.status,'mismatch');assert.ok(result.issues.some(i=>i.code==='too_fast'));
  assert.ok(result.limbs.filter(limb=>limb.moving).every(limb=>limb.endpointReached));
  assert.ok(result.messages.length<=2);
  assert.equal(result.messages.length,1);assert.match(result.messages[0],/Your hands moved noticeably faster/);
  assert.deepEqual(result.issues.filter(i=>i.code==='too_fast').map(i=>i.index),[33,34]);
});
check('Paired hand feedback leaves room for a second distinct correction',()=>{
  const {result}=run({phaseAt:t=>clamp((t/8000-.2)/.18),
    offset:(index,t)=>({x:index>34&&t>1200&&t<6500?(index===35?-.8:.8):0,y:0})});
  assert.equal(result.status,'mismatch');assert.equal(result.messages.length,2);
  assert.match(result.messages[0],/Your hands moved noticeably faster/);
  assert.match(result.messages[1],/Keep your feet near their starting positions/);
  assert.equal(result.issues.filter(i=>i.code==='too_fast').length,2);
  assert.equal(result.issues.filter(i=>i.code==='hold_drift').length,2);
});
check('A direct one-frame jump to the endpoint is not mistaken for a normal-duration movement',()=>{
  const {result}=run({phaseAt:t=>t<2200?0:1});
  assert.equal(result.status,'mismatch');assert.ok(result.issues.some(i=>i.code==='too_fast'));
});
check('Substantially slow travel is distinct from delayed onset',()=>{
  const fasterTeacher=structuredClone(pathReference);
  for(const path of fasterTeacher.paths)for(const observation of path.observations)
    observation.point=between(reference.guides.find(g=>g.index===path.index).start,
      reference.guides.find(g=>g.index===path.index).end,clamp((observation.sourceTimeSeconds/4-.2)/.3));
  const session=createAttemptReview(reference,fasterTeacher,metadata);
  for(let elapsed=0;elapsed<=8000;elapsed+=50)
    observeAttemptReview(session,fixture(elapsed),{nowMs:10000+elapsed,elapsedMs:elapsed});
  const result=finalizeAttemptReview(session,{nowMs:18000,elapsedMs:8000});
  assert.equal(result.status,'mismatch');assert.ok(result.issues.some(i=>i.code==='too_slow'));
  assert.ok(!result.issues.some(i=>i.code==='late_start'));
});
check('A modest tempo difference is accepted',()=>{
  const {result}=run({phaseAt:t=>clamp((t/8000-.16)/.70)});
  assert.equal(result.status,'match');
});
check('A late start is distinguished from too-fast or too-slow travel',()=>{
  const {result}=run({phaseAt:t=>clamp((t-4800)/2900)});
  assert.equal(result.status,'mismatch');assert.ok(result.issues.some(i=>i.code==='late_start'));
  assert.ok(!result.issues.some(i=>i.code==='too_fast'||i.code==='too_slow'));
});
check('Sustained large deviation is reviewed; brief deviations do not reset or gate',()=>{
  const far=run({offset:(index,t,phase)=>({x:index===33?.90*Math.sin(Math.PI*phase):0,y:0})}).result;
  assert.equal(far.status,'mismatch');assert.ok(far.issues.some(i=>i.code==='off_guide'&&i.index===33));
  const brief=run({offset:(index,t)=>({x:index===33&&t>3600&&t<3800?.9:0,y:0})}).result;
  assert.equal(brief.status,'match');
});
check('Anchored feet allow small variation but flag sustained planted-foot travel',()=>{
  const {result}=run({offset:(index,t)=>({x:index===35&&t>1500&&t<6500?.8:0,y:0})});
  assert.equal(result.status,'mismatch');assert.ok(result.issues.some(i=>i.code==='hold_drift'&&i.index===35));
  assert.ok(result.limbs.find(l=>l.index===35).endpointReached);
});
check('Skipping movement or finishing on the wrong anatomical side cannot pass',()=>{
  const noMotion=run({phaseAt:()=>0}).result;assert.equal(noMotion.status,'mismatch');
  const onlyFinish=run({phaseAt:()=>1}).result;assert.equal(onlyFinish.status,'mismatch');
  const wrongLeft=run({offset:(index,t,phase)=>({x:0,y:index===33?1.8*phase:0})}).result;
  assert.equal(wrongLeft.status,'mismatch');
  assert.ok(wrongLeft.issues.some(i=>i.index===33&&i.code==='endpoint_unreached'));
  assert.equal(wrongLeft.limbs.find(l=>l.index===34).status,'match');
});
check('Missing or low-confidence individual limbs remain unknown, never zero-motion or a pass',()=>{
  for(const options of [{omit:(index,t)=>index===35&&t<6000},{visibility:.3},{status:'missing'}]){
    const {result}=run(options);assert.equal(result.status,'unknown');assert.equal(result.passed,false);
    assert.ok(result.issues.some(i=>i.code==='tracking_unknown'));
  }
});
check('Gaps, stale observations and duplicate timestamps cannot manufacture time coverage',()=>{
  const few=[0,100,200,7400,7500,7600,7700,7800,7900,8000];
  const sparse=run({},few).result;assert.equal(sparse.status,'unknown');
  const session=createAttemptReview(reference,pathReference,metadata),fixed=fixture(0);
  for(let elapsed=0;elapsed<=8000;elapsed+=50)observeAttemptReview(session,fixed,{nowMs:10000+elapsed,elapsedMs:elapsed});
  const replay=finalizeAttemptReview(session,{nowMs:18000,elapsedMs:8000});
  assert.equal(replay.status,'unknown');assert.equal(session.acceptedSamples,1);
  const stale=run({},Array.from({length:201},(_,k)=>k*100/3)).result;
  assert.equal(stale.status,'unknown');assert.ok(stale.limbs.every(l=>!l.fresh));
});
check('Changed camera aspect, missing references, and invalid projection frames cannot pass',()=>{
  const session=createAttemptReview(reference,pathReference,metadata);
  observeAttemptReview(session,{...fixture(0),aspectRatio:1.5},{nowMs:10000,elapsedMs:0});
  assert.equal(finalizeAttemptReview(session,{nowMs:18000,elapsedMs:8000}).status,'unknown');
  for(const input of [{referenceUsable:false},null]){
    const missing=createAttemptReview(reference,input,metadata);
    assert.equal(finalizeAttemptReview(missing,{nowMs:18000,elapsedMs:8000}).status,'unknown');
  }
});
check('Missing pose intervals are not credited as observed movement',()=>{
  const session=createAttemptReview(reference,pathReference,metadata);
  for(let elapsed=0;elapsed<=8000;elapsed+=100){
    observeAttemptReview(session,fixture(elapsed,{status:elapsed%200===0?'pose':'missing'}),{nowMs:10000+elapsed,elapsedMs:elapsed});
  }
  const result=finalizeAttemptReview(session,{nowMs:18000,elapsedMs:8000});
  assert.equal(result.status,'unknown');assert.ok(result.limbs.every(limb=>limb.observedMs===0));
});
check('Material missing movement is unknown despite sufficient whole-clip coverage',()=>{
  const {result}=run({omit:(index,t)=>index<35&&t>2300&&t<4500});
  assert.equal(result.status,'unknown');assert.equal(result.passed,false);
  const hands=result.limbs.filter(limb=>limb.index<35);
  assert.ok(hands.every(limb=>limb.coverage>.65&&limb.materialMovementHidden&&!limb.timingAssessed));
  assert.ok(hands.every(limb=>limb.movementEvidence.coverage<.65&&limb.timingUncertainReason));
  assert.ok(!result.issues.some(i=>i.code==='too_fast'||i.code==='too_slow'));
  assert.equal(result.messages.length,1);assert.match(result.messages[0],/could not clearly track your hands/);
});
check('A short interruption permits spatial acceptance but disables confident tempo feedback',()=>{
  const {result}=run({omit:(index,t)=>index<35&&t>3100&&t<3500});
  assert.equal(result.status,'match');assert.equal(result.passed,true);
  assert.ok(result.limbs.filter(limb=>limb.index<35).every(limb=>!limb.timingAssessed
    &&!limb.materialMovementHidden&&limb.movementEvidence.longestGapMs>300));
  assert.equal(result.messages.length,2);assert.match(result.messages[1],/Timing needs clearer tracking/);
});
check('An unobserved jump cannot generate a confident speed verdict or a pass',()=>{
  const {result}=run({phaseAt:t=>t<3100?0:1,omit:(index,t)=>index<35&&t>2100&&t<4100});
  assert.equal(result.status,'unknown');
  assert.ok(result.limbs.filter(limb=>limb.index<35).every(limb=>!limb.timingAssessed&&limb.materialMovementHidden));
  assert.ok(!result.issues.some(i=>i.code==='too_fast'||i.code==='too_slow'));
});
check('Results are stable after finalization and reference/observation inputs stay unchanged',()=>{
  const before=sha([reference,pathReference]),{session,result}=run();
  assert.equal(finalizeAttemptReview(session,{nowMs:99999,elapsedMs:99999}),result);
  assert.equal(observeAttemptReview(session,fixture(8100),{nowMs:18100,elapsedMs:8100}),result);
  assert.equal(sha([reference,pathReference]),before);
});

const manifest=await read('public/practice-media/recut-six/manifest.json');
const raw=await read('public'+manifest.sources[0].poseSrc),adapted=LESSON_CONTROLS.referenceAdapter(raw);
const metadataSource=manifest.sources[0],sources=new Map([[metadataSource.id,{...metadataSource,data:adapted}]]);
const active={...manifest,steps:manifest.steps.map(withCenterFocus)};
const before=sha([active,[...sources],raw]),lesson=prepareRecutLesson(active,sources,LESSON_CONTROLS.referenceOptions);
const teachingPaths=lesson.guidanceReferences.map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources));
const recorded=[];
for(let i=0;i<lesson.steps.length;i++){
  const step=lesson.steps[i],ref=lesson.guidanceReferences[i],path=preparePracticeTubes(ref,step,sources),speed=.5;
  const session=createAttemptReview(ref,path,{bodyFrame:ref.teacherFrame,aspect:adapted.width/adapted.height,
    startAtMs:10000,durationMs:step.durationSeconds*1000,playbackRate:speed});
  const samples=adapted.samples.filter(s=>s.sourceTimeSeconds>=step.startSeconds-1e-8&&s.sourceTimeSeconds<=step.endSeconds+1e-8);
  for(const original of samples){
    const elapsedMs=(original.sourceTimeSeconds-step.startSeconds)*1000/speed;
    // Coordinates remain the real archived observations. Only learner-clock
    // timestamps are remapped for this explicitly labeled OFFLINE replay.
    const sample={...original,tMs:10000+elapsedMs};
    observeAttemptReview(session,{sample,aspectRatio:adapted.width/adapted.height,observedAtMs:10000+elapsedMs},
      {nowMs:10000+elapsedMs,elapsedMs});
  }
  const elapsedMs=step.durationSeconds*1000/speed;
  const result=finalizeAttemptReview(session,{nowMs:10000+elapsedMs,elapsedMs});
  assert.equal(result.referenceUsable,path.referenceUsable);
  if(!path.referenceUsable){assert.equal(result.status,'unknown');assert.equal(result.passed,false);}
  recorded.push({step:i+1,id:step.id,provenance:'Offline replay of genuine saved MediaPipe teacher observations as a software input; not live student acceptance.',
    teacherPathUsable:path.referenceUsable,sampleCount:samples.length,result});
}
assert.equal(sha([active,[...sources],raw]),before,'Recorded source and reference data must remain unchanged');
checks.push('Six genuine saved MediaPipe reference replays preserve unsupported steps as unknown and leave all raw observations unchanged.');

// These additional learner traces are CONSTRUCTED from designated teaching
// geometry, not the raw teacher replay above. Feet deliberately follow the
// stable teaching anchors. Intermediate coordinates below are software inputs
// generated between actual timed vertices, never fabricated observed evidence.
function calibratedTeachingPoint(guide,path,sourceTime){
  if(guide.targetGeometry?.mode==='hold')return {...guide.start};
  if(!path?.available)return between(guide.start,guide.end,
    clamp((sourceTime-guide.startSourceSeconds)/(guide.endSourceSeconds-guide.startSourceSeconds)));
  const observations=path.observations,first=observations[0],last=observations.at(-1);
  const calibrated=observations.map(o=>{
    const t=(o.sourceTimeSeconds-first.sourceTimeSeconds)/(last.sourceTimeSeconds-first.sourceTimeSeconds);
    return {sourceTimeSeconds:o.sourceTimeSeconds,point:{
      x:o.point.x+(guide.start.x-first.point.x)*(1-t)+(guide.end.x-last.point.x)*t,
      y:o.point.y+(guide.start.y-first.point.y)*(1-t)+(guide.end.y-last.point.y)*t}};
  });
  if(sourceTime<=first.sourceTimeSeconds)return calibrated[0].point;
  if(sourceTime>=last.sourceTimeSeconds)return calibrated.at(-1).point;
  const upper=calibrated.findIndex(o=>o.sourceTimeSeconds>=sourceTime),a=calibrated[upper-1],b=calibrated[upper];
  return between(a.point,b.point,(sourceTime-a.sourceTimeSeconds)/(b.sourceTimeSeconds-a.sourceTimeSeconds));
}
const idealTeaching=[];
for(const endpointOffset of [0,.1]){
  for(let i=0;i<5;i++){
    const step=lesson.steps[i],ref=lesson.guidanceReferences[i],path=teachingPaths[i],speed=.5,aspect=4/3;
    const layout=createFullHeightLayout(ref,lesson.guidanceReferences,aspect,teachingPaths);
    assert.ok(layout?.frame,'Real lesson framing must be available');
    const body=layout.frame,sourceDuration=step.durationSeconds*1000,expected=sourceDuration/speed;
    const session=createAttemptReview(ref,path,{bodyFrame:body,aspect,startAtMs:20000,
      durationMs:sourceDuration,playbackRate:speed});
    const finalElapsed=expected+1000;
    for(let elapsed=0;elapsed<=finalElapsed+.01;elapsed+=50){
      const sourceTime=step.startSeconds+Math.min(elapsed,expected)*speed/1000;
      const landmarks=ref.guides.map(guide=>{
        const p=calibratedTeachingPoint(guide,path.paths.find(p=>p.index===guide.index),sourceTime);
        return {index:guide.index,x:((p.x+endpointOffset)*body.scale+body.hip.x)/aspect,
          y:p.y*body.scale+body.hip.y,visibility:1,presence:1};
      });
      const observation={sample:{status:'pose',tMs:20000+elapsed,landmarks},aspectRatio:aspect,observedAtMs:20000+elapsed};
      observeAttemptReview(session,observation,{nowMs:20000+elapsed,elapsedMs:elapsed});
    }
    const result=finalizeAttemptReview(session,{nowMs:20000+finalElapsed,elapsedMs:finalElapsed});
    idealTeaching.push({step:i+1,endpointOffset,provenance:'CONSTRUCTED software learner trace from genuine reference path timestamps with teaching endpoint calibration, anchored planted feet, 50 ms frames and one second endpoint grace. This is not raw teacher inference or live student acceptance.',result});
    assert.equal(result.status,'match',`Ideal teaching trace step ${i+1}, offset ${endpointOffset}: ${JSON.stringify(result.issues)}`);
    assert.ok(result.limbs.every(limb=>limb.endpointReached));
  }
}
assert.equal(sha([active,[...sources],raw]),before,'Teaching trace generation must not modify raw data');
checks.push('All first five genuine prepared teaching references accept constructed calibrated target traces, anchored feet, selected half-speed and one-second grace.');
checks.push('All first five genuine prepared teaching references also accept a small 0.1 torso-unit endpoint offset.');
await mkdir(new URL('artifacts/end-review/',root),{recursive:true});
await writeFile(new URL('artifacts/end-review/attempt-review.json',root),JSON.stringify({
  rules:REVIEW_RULES,checks,recorded,idealTeaching,provenance:'Deterministic software tests use explicitly constructed learner fixtures and separately labeled offline genuine teacher replays.',
  limitations:['No physical webcam, human imitation, timing comfort or camera permission acceptance.','Rule tolerances require real learner trials.','This is observational practice feedback, not complete Tai Chi technique assessment.'],
},null,2));
console.log(JSON.stringify({passed:checks.length,checks,recorded:recorded.map(r=>({step:r.step,status:r.result.status,issues:r.result.issues.map(i=>i.code)}))},null,2));
