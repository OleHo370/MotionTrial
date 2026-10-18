/** Genuine preserved teaching references exercise the production rules.
 * Every learner trace is explicitly CONSTRUCTED software input. These checks
 * never activate a camera, speech, Arduino connection, or physical learner.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as review from '../public/practice-attempt-review.js';
import {prepareStartPosition,createStartPositionSession,evaluateStartPosition,projectStartPositionTargets,
  START_POSITION_RULES} from '../public/start-position.js';
import {createHardwareGuidance,HARDWARE_GUIDANCE_RULES} from '../public/practice-hardware-guidance.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {prepareSixthAssessmentReference} from '../public/sixth-assessment-reference.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {preparePracticeTubes} from '../public/practice-tube.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';
import {createUpperBodyLayout} from '../public/upper-body-layout.js';
import {projectPracticeGuideGeometry} from '../public/practice-guide-geometry.js';

const root=new URL('../',import.meta.url),read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const raw=await read('public/practice-media/recut-six/master.poses.json');
const manifest=await read('public/practice-media/recut-six/manifest.json');
const source={...manifest.sources[0],data:LESSON_CONTROLS.referenceAdapter(raw)},sources=new Map([[source.id,source]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const mixed=prepareSixthAssessmentReference(lesson,source,await read('public/practice-media/recut-six/clip-06-assessment-targets.json'));
const refs=[...lesson.guidanceReferences.slice(0,5),mixed.guidanceReference];
const paths=[...refs.slice(0,5).map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources)),mixed.pathReference];
const before=JSON.stringify({raw,lesson,mixed,refs,paths});
const selected={controlIndices:[33,34]},aspect=4/3,startAtMs=20000,speed=.5;
const clamp=n=>Math.max(0,Math.min(1,n));
const between=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const checks=[];
const check=(name,fn)=>{fn();checks.push(name);console.log(`PASS: ${name}`);};

function guidePoint(guide,path,time){
  if(guide.targetGeometry?.mode==='hold')return {...guide.start};
  const vertices=path?.observations?.length?path.observations:path?.teachingKeyframes??[];
  if(!vertices.length)return between(guide.start,guide.end,clamp((time-guide.startSourceSeconds)/(guide.endSourceSeconds-guide.startSourceSeconds)));
  const first=vertices[0],last=vertices.at(-1),calibrated=vertices.map(vertex=>{
    const fraction=(vertex.sourceTimeSeconds-first.sourceTimeSeconds)/(last.sourceTimeSeconds-first.sourceTimeSeconds);
    return {time:vertex.sourceTimeSeconds,point:{
      x:vertex.point.x+(guide.start.x-first.point.x)*(1-fraction)+(guide.end.x-last.point.x)*fraction,
      y:vertex.point.y+(guide.start.y-first.point.y)*(1-fraction)+(guide.end.y-last.point.y)*fraction}};
  });
  if(time<=first.sourceTimeSeconds)return calibrated[0].point;
  if(time>=last.sourceTimeSeconds)return calibrated.at(-1).point;
  const i=calibrated.findIndex(vertex=>vertex.time>=time),a=calibrated[i-1],b=calibrated[i];
  return between(a.point,b.point,(time-a.time)/(b.time-a.time));
}

// Keeping this export allows the pre-change production reviewer to generate
// the full-body regression digest without copying any implementation into QA.
export function runTrace(index,scenario='normal',options={},module=review){
  const ref=refs[index],path=paths[index],step=lesson.steps[index];
  const cameraAspect=options.aspect??aspect,frame=options.bodyFrame??createFullHeightLayout(ref,refs,cameraAspect,paths).frame;
  const durationMs=(step.teacherFreezeSeconds-step.practiceStartSeconds)*1000,expected=durationMs/speed;
  const total=scenario==='incomplete'?expected*.5:expected+1000;
  const session=module.createAttemptReview(ref,path,{bodyFrame:frame,aspect:cameraAspect,startAtMs,durationMs,playbackRate:speed,...options});
  const times=Array.from({length:Math.floor(total/50)+1},(_,k)=>k*50);if(times.at(-1)!==total)times.push(total);
  for(const elapsedMs of times){
    const sourceTime=step.practiceStartSeconds+Math.min(elapsedMs*(scenario==='fast'?3:1),expected)*speed/1000;
    const landmarks=ref.guides.flatMap(guide=>{
      if(scenario==='no-feet'&&guide.index>=35||scenario==='no-palms'&&guide.index<=34
        ||scenario==='gap'&&elapsedMs>expected*.3&&elapsedMs<expected*.7)return [];
      const point=guidePoint(guide,path.paths.find(path=>path.index===guide.index),sourceTime);
      if(scenario==='wrong-end'&&guide.index===33&&elapsedMs>expected*.7)point.x+=.9;
      return [{index:guide.index,x:(point.x*frame.scale+frame.hip.x)/cameraAspect,
        y:point.y*frame.scale+frame.hip.y,visibility:scenario==='low-confidence'&&guide.index===34?.1:.99,presence:.99}];
    });
    module.observeAttemptReview(session,{sample:{status:'pose',tMs:startAtMs+elapsedMs,landmarks,
      provenance:'CONSTRUCTED software learner trace; not webcam inference'},aspectRatio:cameraAspect,
      observedAtMs:startAtMs+elapsedMs-(scenario==='stale'?600:0)},
      {nowMs:startAtMs+elapsedMs,elapsedMs});
  }
  return {session,result:module.finalizeAttemptReview(session,{nowMs:startAtMs+total,elapsedMs:total})};
}

export const scenarios=['normal','no-feet','no-palms','low-confidence','gap','stale','fast','wrong-end','incomplete'];
export function fullBodyDigest(module=review){
  return createHash('sha256').update(JSON.stringify(refs.flatMap((ref,index)=>scenarios.map(scenario=>
    runTrace(index,scenario,{},module).result)))).digest('hex');
}

// Set from the original reviewer on the same genuine six-clip contracts and
// labelled traces before adding the opt-in option. Includes all limb metrics.
const ORIGINAL_FULL_BODY_DIGEST='9ed1d84bf4801a25430d4f066dc637723b452e34f2922176eb673c69e93234bd';
if(process.env.ARMS_REVIEW_BASELINE_ONLY!=='1'){
  check('All 54 default full-body outcomes retain the exact original metrics and messages',()=>{
    assert.equal(fullBodyDigest(),ORIGINAL_FULL_BODY_DIGEST);
  });
  check('Selected palm reviews use the exact original per-palm evidence and elapsed clip duration',()=>{
    for(let index=0;index<6;index++)for(const scenario of scenarios){
      const full=runTrace(index,scenario),arms=runTrace(index,scenario,selected);
      assert.deepEqual(arms.result.limbs,full.result.limbs.filter(limb=>[33,34].includes(limb.index)),`Clip ${index+1}: ${scenario}`);
      assert.equal(arms.result.expectedDurationMs,full.result.expectedDurationMs);
      assert.equal(arms.result.elapsedMs,full.result.elapsedMs);
      assert.equal(arms.result.rulesVersion,full.result.rulesVersion);
      assert.equal(arms.result.acceptedSamples,full.result.acceptedSamples);
      assert.equal(arms.result.rejectedSamples,full.result.rejectedSamples);
      assert.deepEqual(arms.session.controls.map(control=>control.index),[33,34]);
    }
  });
  check('Step 6 can match without feet only after the complete unchanged attempt',()=>{
    const full=runTrace(5,'no-feet').result,arms=runTrace(5,'no-feet',selected).result;
    assert.equal(full.status,'unknown');assert.equal(arms.status,'match');assert.equal(arms.passed,true);
    assert.ok(arms.issues.every(issue=>[33,34].includes(issue.index)));
    const incomplete=runTrace(5,'incomplete',selected).result;
    assert.equal(incomplete.status,'unknown');assert.equal(incomplete.passed,false);
    assert.equal(incomplete.issues[0].code,'attempt_incomplete');
  });
  check('The actual head-to-waist frame supports palm readiness and the unchanged reviewer',()=>{
    const ref=refs[5],layout=createUpperBodyLayout(ref,refs,1,paths),bodyFrame=layout.frame;
    const result=runTrace(5,'no-feet',{...selected,bodyFrame,aspect:1}).result;
    assert.equal(result.status,'match');assert.equal(result.passed,true);
    assert.deepEqual(result.limbs.map(limb=>limb.index),[33,34]);
    const session=createStartPositionSession(ref,selected),targets=prepareStartPosition(ref,selected).targets;
    let positioning;
    for(let t=1000;t<=2500;t+=100){
      const live={status:'pose',tMs:t,landmarks:targets.map(target=>({index:target.index,
        x:(target.normalizedStart.x*bodyFrame.scale+bodyFrame.hip.x)/bodyFrame.aspect,
        y:target.normalizedStart.y*bodyFrame.scale+bodyFrame.hip.y,visibility:.99,presence:.99})),
        provenance:'CONSTRUCTED palms projected into the actual head-to-waist layout; not webcam inference'};
      positioning=evaluateStartPosition(ref,live,{attemptAspectRatio:1,nowMs:t,observedAtMs:t,session,bodyFrame,...selected});
    }
    assert.equal(positioning.holdReady,true);assert.equal(positioning.heldMs,1500);
    assert.ok(projectStartPositionTargets(ref,session,selected).every(target=>target.valid));
    const geometry=projectPracticeGuideGeometry(ref,paths[5],session,{fixedFrame:bodyFrame,...selected});
    assert.deepEqual(geometry.starts.map(target=>target.index),[33,34]);
    assert.ok(geometry.starts.every(target=>target.valid&&target.point),'Selected referenceKey keeps both start squares valid');
    assert.deepEqual(geometry.starts,projectStartPositionTargets(ref,session,selected));
  });
  check('Low-confidence, missing or interrupted palms remain unknown and mismatch remains a correction',()=>{
    for(const scenario of ['no-palms','low-confidence','gap','stale']){
      const result=runTrace(5,scenario,selected).result;assert.equal(result.status,'unknown',scenario);assert.equal(result.passed,false);
    }
    const result=runTrace(5,'wrong-end',selected).result;assert.equal(result.status,'mismatch');assert.equal(result.passed,false);
  });
  check('The explicit two-palm option never makes arbitrary incomplete or duplicate controls assessable',()=>{
    const reference={...refs[5],guides:refs[5].guides.filter(guide=>guide.index<=34)};
    const opts={bodyFrame:refs[5].teacherFrame,aspect:raw.width/raw.height,durationMs:2000};
    assert.equal(review.createAttemptReview(reference,paths[5],opts).referenceUsable,false);
    assert.equal(review.createAttemptReview(reference,paths[5],{...opts,...selected}).referenceUsable,true);
    for(const controlIndices of [[],[33],[33,33],[35,36],[33,34,35],null]){
      assert.equal(review.createAttemptReview(refs[5],paths[5],{...opts,controlIndices}).referenceUsable,false);
      assert.equal(prepareStartPosition(refs[5],{controlIndices}).usable,false);
    }
    const duplicate={...reference,guides:[...reference.guides,reference.guides[0]]};
    assert.equal(review.createAttemptReview(duplicate,paths[5],{...opts,...selected}).referenceUsable,false);
  });

  const ref=refs[5],frame=createFullHeightLayout(ref,refs,aspect,paths).frame;
  const starting=prepareStartPosition(ref,selected);
  const startingSample=(tMs,{omit=null,far=false}={})=>({status:'pose',tMs,
    provenance:'CONSTRUCTED two-palm software observation; no torso or lower-body landmarks',
    landmarks:starting.targets.filter(target=>target.index!==omit).map(target=>({index:target.index,
      x:(target.normalizedStart.x*frame.scale+frame.hip.x)/aspect+(far&&target.index===33?.4*frame.scale/aspect:0),
      y:target.normalizedStart.y*frame.scale+frame.hip.y,visibility:.99,presence:.99}))});
  const readiness=(session,tMs,extra={})=>evaluateStartPosition(ref,startingSample(tMs,extra),{
    attemptAspectRatio:aspect,nowMs:tMs,observedAtMs:tMs,session,bodyFrame:frame,...selected,...extra});
  check('Arms-only readiness requires both genuine palms and exactly the original 1500 ms hold',()=>{
    const session=createStartPositionSession(ref,selected);let result;
    for(const t of [1000,1300,1600,1900,2200,2499]){
      result=readiness(session,t);assert.equal(result.allNear,true);assert.equal(result.holdReady,false);
    }
    assert.equal(result.heldMs,1499);result=readiness(session,2500);assert.equal(result.holdReady,true);
    assert.equal(result.heldMs,START_POSITION_RULES.holdMs);
    assert.deepEqual(result.limbs.map(limb=>limb.index),[33,34]);
    assert.deepEqual(projectStartPositionTargets(ref,session,selected).map(target=>target.index),[33,34]);
    assert.equal(prepareStartPosition(ref).targets.length,4);
    const defaultSession=createStartPositionSession(ref);
    const defaultResult=evaluateStartPosition(ref,startingSample(2600),{attemptAspectRatio:aspect,nowMs:2600,observedAtMs:2600,session:defaultSession});
    assert.equal(defaultResult.status,'unknown');assert.equal(defaultResult.holdReady,false);
  });
  check('Hidden palms, repeated frames, stale observations and changed framing cannot unlock positioning',()=>{
    for(const extra of [{omit:33},{far:true},{observedAtMs:500},{observedAtMs:1300}]){
      const session=createStartPositionSession(ref,selected);readiness(session,1000);readiness(session,1300);
      const result=readiness(session,1500,extra);assert.equal(result.holdReady,false);assert.equal(result.heldMs,0);
    }
    const session=createStartPositionSession(ref,selected);readiness(session,1000);readiness(session,1300);
    const result=readiness(session,1500,{bodyFrame:{...frame,scale:frame.scale*1.01}});
    assert.equal(result.status,'unknown');assert.equal(result.heldMs,0);assert.equal(session.bodyFrame,null);
  });
  check('Two-palm hardware feedback reuses debounce and remains neutral when palms are unknown or inactive',()=>{
    const helper=createHardwareGuidance();let result;
    const observation=t=>({sample:startingSample(10000+t),aspectRatio:aspect,observedAtMs:10000+t});
    const update=(t,extra={})=>helper.update(ref,paths[5],observation(t),frame,
      {nowMs:10000+t,active:true,contextKey:'arms-only',...selected,...extra});
    assert.equal(update(0).state,'idle');assert.equal(update(199).state,'idle');result=update(200);
    assert.equal(result.state,'good');assert.deepEqual(result.limbs.map(limb=>limb.index),[33,34]);assert.match(result.reason,/Both palms/);
    result=helper.update(ref,paths[5],{...observation(300),sample:startingSample(10300,{omit:33})},frame,
      {nowMs:10300,active:true,...selected});assert.equal(result.state,'idle');assert.match(result.reason,/both palms/);
    result=update(400,{active:false});assert.equal(result.state,'idle');assert.equal(result.limbs.length,2);
    // Selecting full body cannot reuse successful upper-body debounce.
    result=helper.update(ref,paths[5],observation(500),frame,{nowMs:10500,active:true});
    assert.equal(result.state,'idle');assert.equal(result.limbs.length,4);assert.match(result.reason,/feet/);
    assert.equal(HARDWARE_GUIDANCE_RULES.warningRadius,review.REVIEW_RULES.broadGuideRadius);
    assert.equal(HARDWARE_GUIDANCE_RULES.maximumAgeMs,review.REVIEW_RULES.maximumAgeMs);
  });
  check('Arms-only warnings and recovery retain the original 250 ms and 200 ms hysteresis',()=>{
    const helper=createHardwareGuidance();
    const update=(t,outside=false)=>{
      const sample=startingSample(10000+t);
      if(outside)Object.assign(sample.landmarks.find(point=>point.index===33),{x:.01,y:.01});
      return helper.update(ref,paths[5],{sample,aspectRatio:aspect,observedAtMs:10000+t},frame,
        {nowMs:10000+t,active:true,contextKey:'arms-only',...selected});
    };
    for(const t of [0,100,200])update(t);
    assert.equal(update(300,true).state,'idle');assert.equal(update(549,true).state,'idle');
    const warning=update(550,true);assert.equal(warning.state,'off');
    assert.deepEqual(warning.limbs.filter(limb=>limb.status==='outside').map(limb=>limb.index),[33]);
    assert.equal(update(650).state,'off');assert.equal(update(849).state,'off');assert.equal(update(850).state,'good');
    assert.equal(HARDWARE_GUIDANCE_RULES.warningDelayMs,250);assert.equal(HARDWARE_GUIDANCE_RULES.recoveryDelayMs,200);
  });
  check('Teacher source records, authored teaching targets and raw learner inputs stay untouched',()=>{
    assert.equal(JSON.stringify({raw,lesson,mixed,refs,paths}),before);
    const sample=startingSample(1000),beforeSample=JSON.stringify(sample),session=createStartPositionSession(ref,selected);
    evaluateStartPosition(ref,sample,{attemptAspectRatio:aspect,nowMs:1000,observedAtMs:1000,session,bodyFrame:frame,...selected});
    assert.equal(JSON.stringify(sample),beforeSample);
  });
  console.log(`${checks.length} arms-only rule groups passed. Learner traces are CONSTRUCTED, not physical camera/hardware acceptance.`);
}
