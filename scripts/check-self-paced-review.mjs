// Deterministic software QA. The teacher contracts are genuine preserved
// observations; every learner trace below is CONSTRUCTED, never live inference.
// No webcam, microphone, speech engine, or Arduino is activated by this script.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {REVIEW_RULES,createAttemptReview,observeAttemptReview,finalizeAttemptReview} from '../public/practice-attempt-review.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {preparePracticeTubes} from '../public/practice-tube.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';

const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const manifest=await read('../public/practice-media/recut-six/manifest.json');
const raw=await read('../public/practice-media/recut-six/master.poses.json');
const source={...manifest.sources[0],data:LESSON_CONTROLS.referenceAdapter(raw)};
const sources=new Map([[source.id,source]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const refs=lesson.guidanceReferences.slice(0,5);
const paths=refs.map((reference,i)=>preparePracticeTubes(reference,lesson.steps[i],sources));
const inputBefore=JSON.stringify({raw,manifest,lesson,paths});
const startAtMs=20000,playbackRate=.5,aspect=4/3;
const between=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const clamp=n=>Math.max(0,Math.min(1,n));
const checks=[];
const check=(name,fn)=>{fn();checks.push(name);console.log(`PASS: ${name}`);};

// Offline rubric-to-fixture conversion: calibrate recorded route endpoints to
// the actual displayed square/triangle. It does not alter teacher observations
// or create production camera evidence. Planted feet remain at their target.
function teachingPoint(guide,path,time){
  if(guide.targetGeometry?.mode==='hold')return {...guide.start};
  const observations=path?.observations??[];
  if(!observations.length)return between(guide.start,guide.end,
    clamp((time-guide.startSourceSeconds)/(guide.endSourceSeconds-guide.startSourceSeconds)));
  const first=observations[0],last=observations.at(-1);
  const calibrated=observations.map(observation=>{
    const t=(observation.sourceTimeSeconds-first.sourceTimeSeconds)/(last.sourceTimeSeconds-first.sourceTimeSeconds);
    return {time:observation.sourceTimeSeconds,point:{
      x:observation.point.x+(guide.start.x-first.point.x)*(1-t)+(guide.end.x-last.point.x)*t,
      y:observation.point.y+(guide.start.y-first.point.y)*(1-t)+(guide.end.y-last.point.y)*t}};
  });
  if(time<=first.sourceTimeSeconds)return calibrated[0].point;
  if(time>=last.sourceTimeSeconds)return calibrated.at(-1).point;
  const i=calibrated.findIndex(observation=>observation.time>=time),a=calibrated[i-1],b=calibrated[i];
  return between(a.point,b.point,(time-a.time)/(b.time-a.time));
}

function run(index,{motionMs,completionMode='self-paced',endpointsComplete=true,omit=null,
  interrupted=false,wrongEnd=false,stale=false,heldEndpointMs=300,limbMotionMs={}}={}){
  const step=lesson.steps[index],reference=refs[index],path=paths[index];
  const durationMs=(step.teacherFreezeSeconds-step.practiceStartSeconds)*1000;
  const expectedMs=durationMs/playbackRate,motionDuration=motionMs??expectedMs;
  const totalMs=motionDuration+heldEndpointMs;
  const frame=createFullHeightLayout(reference,refs,aspect,paths).frame;
  const session=createAttemptReview(reference,path,{bodyFrame:frame,aspect,startAtMs,durationMs,
    playbackRate,...(completionMode==='default'?{}:{completionMode})});
  const times=Array.from({length:Math.floor(totalMs/50)+1},(_,i)=>i*50);
  if(times.at(-1)!==totalMs)times.push(totalMs);
  for(const elapsedMs of times){
    const landmarks=reference.guides.flatMap(guide=>{
      if(guide.index===omit||interrupted&&guide.index<=34&&elapsedMs>motionDuration*.25&&elapsedMs<motionDuration*.75)return [];
      const sourceTime=step.practiceStartSeconds+durationMs/1000*clamp(elapsedMs/(limbMotionMs[guide.index]??motionDuration));
      const point=teachingPoint(guide,path.paths.find(candidate=>candidate.index===guide.index),sourceTime);
      if(wrongEnd&&guide.index===33&&elapsedMs>motionDuration*.8)point.x+=.9;
      return [{index:guide.index,x:(point.x*frame.scale+frame.hip.x)/aspect,
        y:point.y*frame.scale+frame.hip.y,visibility:.99,presence:.99}];
    });
    const collected=observeAttemptReview(session,{sample:{status:'pose',tMs:startAtMs+elapsedMs,landmarks,
      provenance:'CONSTRUCTED target-following software learner trace, not webcam inference'},aspectRatio:aspect,
      observedAtMs:startAtMs+elapsedMs-(stale?600:0)},{nowMs:startAtMs+elapsedMs,elapsedMs});
    assert.equal(collected.status,'collecting');assert.equal(collected.passed,false);
    assert.equal(session.finalized,false,'Observed elapsed time never finalizes a review');
  }
  const result=finalizeAttemptReview(session,{nowMs:startAtMs+totalMs,elapsedMs:totalMs,endpointsComplete});
  return {session,result,expectedMs,totalMs};
}

check('All five target-following traces pass after the explicit endpoint gate at normal pace',()=>{
  for(let index=0;index<5;index++){
    const {result}=run(index);
    assert.equal(result.status,'match',`Step ${index+1}: ${JSON.stringify(result.issues)}`);
    assert.equal(result.completionMode,'self-paced');assert.equal(result.endpointsComplete,true);
    assert.ok(result.limbs.every(limb=>limb.endpointReached&&limb.coverage>.98));
  }
});

check('All five 30-second attempts keep collecting and report actual slow limbs rather than fixed-time incompleteness',()=>{
  for(let index=0;index<5;index++){
    const {result,totalMs,expectedMs}=run(index,{motionMs:29700});
    assert.equal(totalMs,30000);assert.ok(totalMs>expectedMs);
    assert.equal(result.status,'mismatch',`Step ${index+1}: ${JSON.stringify(result.issues)}`);
    assert.ok(result.issues.some(issue=>issue.code==='too_slow'&&Number.isInteger(issue.index)));
    assert.ok(result.issues.every(issue=>!['attempt_incomplete','tracking_unknown'].includes(issue.code)));
    assert.ok(result.limbs.every(limb=>limb.endpointReached&&limb.coverage>.98));
    assert.equal(result.elapsedMs,30000);
  }
});

check('Finishing before the source timeline is reviewed as genuine fast movement, while legacy mode is still incomplete',()=>{
  for(let index=0;index<5;index++){
    const baseline=run(index),motionMs=baseline.expectedMs*.30;
    const fast=run(index,{motionMs});
    assert.ok(fast.totalMs<fast.expectedMs);assert.equal(fast.result.status,'mismatch');
    assert.ok(fast.result.issues.some(issue=>issue.code==='too_fast'));
    assert.ok(!fast.result.issues.some(issue=>issue.code==='attempt_incomplete'));
    const fixed=run(index,{motionMs,completionMode:'clip'}).result;
    assert.equal(fixed.status,'unknown');assert.equal(fixed.issues[0].code,'attempt_incomplete');
  }
});

check('Elapsed time alone cannot grant self-paced completion without the all-triangles gate',()=>{
  for(const motionMs of [2000,29700]){
    const {result}=run(0,{motionMs,endpointsComplete:false});
    assert.equal(result.status,'unknown');assert.equal(result.passed,false);
    assert.equal(result.issues[0].code,'attempt_incomplete');assert.equal(result.endpointsComplete,false);
  }
});

check('Speed corrections identify the individual palm and retain the earlier palm finish while waiting for the other',()=>{
  const baseline=run(2),expectedMs=baseline.expectedMs;
  const fast=run(2,{limbMotionMs:{33:expectedMs*.3}}).result;
  assert.equal(fast.status,'mismatch');
  assert.deepEqual(fast.issues.filter(issue=>issue.code==='too_fast').map(issue=>issue.index),[33]);
  assert.equal(fast.limbs.find(limb=>limb.index===34).status,'match');
  const slow=run(2,{motionMs:29700,limbMotionMs:{34:expectedMs,35:expectedMs,36:expectedMs}}).result;
  assert.equal(slow.status,'mismatch');
  assert.deepEqual(slow.issues.filter(issue=>issue.code==='too_slow').map(issue=>issue.index),[33]);
  assert.equal(slow.limbs.find(limb=>limb.index===34).status,'match');
  assert.ok(slow.limbs.every(limb=>limb.endpointReached));
});

check('A claimed endpoint gate cannot manufacture missing, stale, interrupted, or wrong-side evidence',()=>{
  for(const options of [{omit:33},{omit:35},{interrupted:true},{stale:true}]){
    const {result}=run(2,{motionMs:29700,...options});
    assert.equal(result.status,'unknown');assert.equal(result.passed,false);
    assert.ok(result.issues.some(issue=>issue.code==='tracking_unknown'));
  }
  const {result}=run(2,{wrongEnd:true});
  assert.equal(result.status,'mismatch');assert.equal(result.passed,false);
  assert.ok(result.issues.some(issue=>issue.index===33&&issue.code==='endpoint_unreached'));
});

check('Full-clip mode and its complete-review outcome remain identical to the default API',()=>{
  for(let index=0;index<5;index++){
    const explicit=run(index,{completionMode:'clip'}).result;
    const defaultResult=run(index,{completionMode:'default'}).result;
    assert.deepEqual(explicit,defaultResult);
    assert.equal(explicit.completionMode,undefined);assert.equal(explicit.endpointsComplete,undefined);
  }
});

check('Self-paced finalization stays stable and preserves all original numerical thresholds and input records',()=>{
  const {session,result,totalMs}=run(1);
  assert.equal(finalizeAttemptReview(session,{nowMs:startAtMs+99999,elapsedMs:99999,endpointsComplete:true}),result);
  assert.equal(observeAttemptReview(session,null,{nowMs:startAtMs+totalMs+50,elapsedMs:totalMs+50}),result);
  assert.equal(REVIEW_RULES.minimumTimingRatio,.55);assert.equal(REVIEW_RULES.maximumTimingRatio,1.70);
  assert.equal(REVIEW_RULES.endpointSupportMs,60);assert.equal(REVIEW_RULES.endpointRadius,.34);
  assert.equal(REVIEW_RULES.minimumCoverage,.65);assert.equal(REVIEW_RULES.maximumObservedGapMs,300);
  assert.equal(JSON.stringify({raw,manifest,lesson,paths}),inputBefore);
});

console.log(`${checks.length} self-paced reviewer groups passed. Learner traces are CONSTRUCTED; no physical camera or hardware acceptance.`);
