/**
 * Genuine teacher records and explicit reviewed targets feed the REAL reviewer.
 * Every learner trace below is CONSTRUCTED software input, not webcam inference
 * or acceptance of a person's movement. No camera or audio is activated.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {prepareSixthAssessmentReference} from '../public/sixth-assessment-reference.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {preparePracticeTubes} from '../public/practice-tube.js';
import {prepareStartPosition} from '../public/start-position.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';
import {finishTargetSize} from '../public/first-three-attempt.js';
import {createAttemptReview,observeAttemptReview,finalizeAttemptReview,REVIEW_RULES} from '../public/practice-attempt-review.js';

const root=new URL('../',import.meta.url),directory=new URL('artifacts/all-six-assessment-review/',root);
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const archivePath=new URL('public/practice-media/recut-six/master.poses.json',root);
const archiveText=await readFile(archivePath,'utf8'),raw=JSON.parse(archiveText);
const manifest=JSON.parse(await readFile(new URL('public/practice-media/recut-six/manifest.json',root),'utf8'));
const specText=await readFile(new URL('public/practice-media/recut-six/clip-06-assessment-targets.json',root),'utf8'),spec=JSON.parse(specText);
const source={...manifest.sources[0],data:LESSON_CONTROLS.referenceAdapter(raw)},sources=new Map([[source.id,source]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const fiveBefore=JSON.stringify(lesson.guidanceReferences.slice(0,5)),observedBefore=JSON.stringify(lesson.references),sourceBefore=JSON.stringify(source),lessonBefore=JSON.stringify(lesson),specBefore=JSON.stringify(spec);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
freeze(source);freeze(lesson);freeze(spec);
const mixed=prepareSixthAssessmentReference(lesson,source,spec);
const refs=[...lesson.guidanceReferences.slice(0,5),mixed.guidanceReference];
const paths=[...refs.slice(0,5).map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources)),mixed.pathReference];
const checks=[],metrics={};
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const between=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const summarize=result=>({status:result.status,passed:result.passed,referenceUsable:result.referenceUsable,
  issues:result.issues.map(issue=>({code:issue.code,index:issue.index})),messages:result.messages,
  limbs:result.limbs.map(limb=>({index:limb.index,status:limb.status,moving:limb.moving,coverage:limb.coverage,
    endpointReached:limb.endpointReached,timingAssessed:limb.timingAssessed,timingRatio:limb.timingRatio,
    onsetMs:limb.onsetMs,finishMs:limb.finishMs,movementDurationMs:limb.movementDurationMs,expectedOnsetMs:limb.expectedOnsetMs,
    expectedMovementDurationMs:limb.expectedMovementDurationMs}))});
async function save(result){await mkdir(directory,{recursive:true});await writeFile(new URL('evaluator-summary.json',directory),JSON.stringify({result,
  groups:checks.length,checks,version:mixed.version,sourceArchiveSha256:sha(archiveText),assessmentSpecSha256:sha(specText),metrics,
  provenance:'Genuine archived MediaPipe teacher records plus separate reviewed authored practice targets. Every learner trace is explicitly CONSTRUCTED software input to the real production reviewer; no live camera, physical learner accuracy, or audibility acceptance is claimed.',
  limitations:['The rule tolerances, camera tracking accuracy and comfort of following these targets still require human follow-along trials.']},null,2)+'\n');}
async function check(name,run){try{await run();checks.push({name,passed:true});console.log(`PASS: ${name}`);}catch(error){checks.push({name,passed:false,error:error.stack??String(error)});await save('FAIL');console.error(`FAIL: ${name}: ${error.message}`);}}

function timedGuidePoint(guide,path,time){
  if(guide.targetGeometry?.mode==='hold')return {...guide.start};
  if(!path?.available){
    const duration=guide.endSourceSeconds-guide.startSourceSeconds;
    return between(guide.start,guide.end,duration>0?clamp((time-guide.startSourceSeconds)/duration):0);
  }
  const vertices=path?.observations?.length?path.observations:path?.teachingKeyframes??[];
  assert.ok(vertices.length>=3,`${guide.index}: moving control needs explicit timed evidence`);
  const first=vertices[0],last=vertices.at(-1);
  const calibrated=vertices.map(vertex=>{
    const fraction=(vertex.sourceTimeSeconds-first.sourceTimeSeconds)/(last.sourceTimeSeconds-first.sourceTimeSeconds);
    return {time:vertex.sourceTimeSeconds,point:{
      x:vertex.point.x+(guide.start.x-first.point.x)*(1-fraction)+(guide.end.x-last.point.x)*fraction,
      y:vertex.point.y+(guide.start.y-first.point.y)*(1-fraction)+(guide.end.y-last.point.y)*fraction}};
  });
  if(time<=calibrated[0].time)return calibrated[0].point;
  if(time>=calibrated.at(-1).time)return calibrated.at(-1).point;
  const upper=calibrated.findIndex(vertex=>vertex.time>=time),a=calibrated[upper-1],b=calibrated[upper];
  return between(a.point,b.point,(time-a.time)/(b.time-a.time));
}

function runTrace(index,{offset=.0,omit=()=>false,adjust=(index,time,point)=>point,stale=false,aspect=4/3,sampleRateHz=30}={}){
  const ref=refs[index],path=paths[index],step=lesson.steps[index],speed=.5,startAtMs=20000;
  const body=createFullHeightLayout(ref,refs,aspect,paths)?.frame;assert.ok(body,'A real full-height projection exists');
  const sourceDurationMs=(step.teacherFreezeSeconds-step.practiceStartSeconds)*1000,expected=sourceDurationMs/speed,total=expected+1000;
  const session=createAttemptReview(ref,path,{bodyFrame:body,aspect,startAtMs,durationMs:sourceDurationMs,playbackRate:speed});
  const times=Array.from({length:Math.floor(total*sampleRateHz/1000)+1},(_,frame)=>frame*1000/sampleRateHz);
  if(times.at(-1)<total-1e-6)times.push(total);
  for(const elapsedMs of times){
    const sourceTime=step.practiceStartSeconds+Math.min(elapsedMs,expected)*speed/1000;
    const landmarks=ref.guides.flatMap(guide=>{
      if(omit(guide.index,elapsedMs,{total,expected,session}))return [];
      const point=adjust(guide.index,elapsedMs,timedGuidePoint(guide,path.paths.find(p=>p.index===guide.index),sourceTime),
        {total,expected,session,guide,ref,path,sourceTime});
      return [{index:guide.index,x:((point.x+offset)*body.scale+body.hip.x)/aspect,
        y:point.y*body.scale+body.hip.y,visibility:.99,presence:.99}];
    });
    const observedAtMs=startAtMs+elapsedMs-(stale?600:0);
    observeAttemptReview(session,{sample:{status:'pose',tMs:startAtMs+elapsedMs,landmarks,
      provenance:'CONSTRUCTED software learner trace; not webcam inference'},observedAtMs,aspectRatio:aspect},
      {nowMs:startAtMs+elapsedMs,elapsedMs});
  }
  return {session,result:finalizeAttemptReview(session,{nowMs:startAtMs+total,elapsedMs:total})};
}

await check('All six references have four usable starts, endpoints, routes and actual evaluator contracts',()=>{
  for(let index=0;index<6;index++){
    const ref=refs[index],path=paths[index];assert.equal(ref.referenceUsable,true,`Step ${index+1} reference`);
    assert.equal(prepareStartPosition(ref).usable,true,`Step ${index+1} starts`);assert.equal(path.referenceUsable,true,`Step ${index+1} routes`);
    assert.deepEqual(ref.guides.map(g=>g.index),[33,34,35,36]);assert.ok(ref.guides.every(g=>g.valid));
    const review=createAttemptReview(ref,path,{bodyFrame:ref.teacherFrame,aspect:raw.width/raw.height,durationMs:1000});
    assert.equal(review.referenceUsable,true);assert.equal(review.controls.length,4);
  }
});

await check('The sixth left-foot route retains all 31 genuine source observations while reviewed hands remain separately authored',()=>{
  const ref=refs[5],lf=paths[5].paths.find(p=>p.index===35);assert.ok(lf?.available);assert.equal(lf.observations.length,31);
  for(const observation of lf.observations){
    const original=source.data.samples.find(sample=>Math.abs(sample.tMs-observation.tMs)<1e-6);
    assert.ok(original);assert.equal(observation.sourceTimeSeconds,original.sourceTimeSeconds);
    assert.deepEqual(observation.raw,original.landmarks.find(point=>point.index===35));assert.ok(observation.raw.visibility>=.65);
  }
  for(const index of [33,34]){
    const guide=ref.guides.find(g=>g.index===index),path=paths[5].paths.find(p=>p.index===index);
    assert.ok(path?.available);assert.equal(path.observations.length,0);assert.ok(path.teachingKeyframes.length>=3);
    assert.equal(guide.endRaw,null);assert.equal(guide.endObservation,null);assert.deepEqual(guide.support.endTimesMs,[]);
    assert.ok(path.teachingKeyframes.every(key=>!('visibility' in key)&&!('presence' in key)
      &&!('visibility' in key.point)&&!('presence' in key.point)));
    assert.ok(guide.targetEvidence.end.evidenceKind.includes('reviewed'));
  }
  const rf=ref.guides.find(g=>g.index===36);assert.equal(rf.targetGeometry.mode,'hold');assert.deepEqual(rf.end,rf.start);
  assert.equal(paths[5].paths.some(p=>p.index===36),false);assert.match(rf.targetEvidence.end.evidenceKind,/hold/);
  metrics.evidence={leftFootObservedFrames:lf.observations.length,authoredHandFrames:paths[5].paths.filter(p=>[33,34].includes(p.index)).map(p=>({index:p.index,count:p.teachingKeyframes.length})),rightFootMode:rf.targetGeometry.mode};
});

await check('Previous finish and sixth start foot positions are identical at three camera aspects, including planted-foot target sizes',()=>{
  const seams=[];
  for(const aspect of [16/9,4/3,7/8]){
    const previous=refs[4],next=refs[5],a=createFullHeightLayout(previous,refs,aspect,paths).frame,b=createFullHeightLayout(next,refs,aspect,paths).frame;
    for(const index of [35,36]){
      const outgoing=previous.guides.find(g=>g.index===index),incoming=next.guides.find(g=>g.index===index);
      const end={x:(outgoing.end.x*a.scale+a.hip.x)/aspect,y:outgoing.end.y*a.scale+a.hip.y};
      const start={x:(incoming.start.x*b.scale+b.hip.x)/aspect,y:incoming.start.y*b.scale+b.hip.y};
      close(end.x,start.x);close(end.y,start.y);
      const outgoingSize=finishTargetSize(previous,index)*a.scale,incomingSquare=prepareStartPosition(next).radius*b.scale;
      assert.ok(outgoingSize<=incomingSquare+1e-9,'The prior finish triangle fits the incoming starting square');
      if(incoming.targetGeometry?.mode==='hold')assert.ok(outgoingSize<=finishTargetSize(next,index)*b.scale+1e-9,'The incoming planted hold contains the prior finish triangle');
      seams.push({aspect,index,end,start,outgoingSize,incomingSquare,incomingHold:incoming.targetGeometry?.mode==='hold'});
    }
  }
  metrics.seams=seams;
});

await check('All six accept exact and close-enough 0.1-body-unit constructed learner traces after the full clip',()=>{
  metrics.positiveTraces=[];
  for(const offset of [0,.1])for(let index=0;index<6;index++){
    const {result}=runTrace(index,{offset});metrics.positiveTraces.push({step:index+1,offset,...summarize(result)});
    assert.equal(result.percent,null);assert.ok(result.limbs.every(limb=>limb.endpointReached));
  }
  for(const result of metrics.positiveTraces)
    assert.equal(result.status,'match',`Step ${result.step} offset ${result.offset}: ${JSON.stringify(result.issues)}`);
});

await check('The same correctly timed sixth movement remains acceptable across ordinary learner observation cadences',()=>{
  metrics.cadenceTraces=[];
  for(const sampleRateHz of [7.5,10,15,30]){
    const {result}=runTrace(5,{sampleRateHz});metrics.cadenceTraces.push({sampleRateHz,...summarize(result)});
  }
  for(const result of metrics.cadenceTraces)assert.equal(result.status,'match',`${result.sampleRateHz} Hz: ${JSON.stringify(result.issues)}`);
});

await check('Missing left hand, stale tracking or a missing active left-foot interval never passes the sixth movement',()=>{
  const cases=[['missing-left-hand',{omit:index=>index===33}],['stale',{stale:true}],
    ['missing-left-foot-finish',{omit:(index,time,{total})=>index===35&&time>total-1200}],
    ['missing-active-left-foot',{omit:(index,time,{session})=>{
      const expected=session.controls.find(control=>control.index===35).expectedTiming;
      return index===35&&time>(expected?.onsetMs??1700)-50&&time<(expected?.finishMs??3600)+50;
    }}]];
  metrics.unknownTraces=[];
  for(const [name,options]of cases){const {result}=runTrace(5,options);metrics.unknownTraces.push({name,...summarize(result)});
    assert.equal(result.status,'unknown',name);assert.equal(result.passed,false);assert.ok(result.issues.some(issue=>issue.code==='tracking_unknown'));}
});

await check('Swapping left and right feet or keeping the left foot stationary cannot pass',()=>{
  const stationary=runTrace(5,{adjust:(index,time,point,{guide})=>index===35?guide.start:point}).result;
  assert.equal(stationary.status,'mismatch');assert.ok(stationary.issues.some(issue=>issue.index===35&&['endpoint_unreached','movement_incomplete'].includes(issue.code)));
  const wrongSide=runTrace(5,{adjust:(index,time,point,{ref,path,sourceTime})=>{
    if(index<35)return point;const opposite=index===35?36:35,guide=ref.guides.find(g=>g.index===opposite);
    return timedGuidePoint(guide,path.paths.find(p=>p.index===opposite),sourceTime);
  }}).result;
  assert.notEqual(wrongSide.status,'match');assert.equal(wrongSide.passed,false);
  assert.notEqual(wrongSide.limbs.find(limb=>limb.index===35).status,'match');
  metrics.anatomicalNegatives={stationary:summarize(stationary),wrongSide:summarize(wrongSide)};
});

await check('Substantially fast, slow and far-off-guide left-foot movement receives specific post-clip feedback',()=>{
  metrics.movementNegatives=[];
  for(const [name,duration,code]of [['too-fast',200,'too_fast'],['too-slow',4200,'too_slow']]){
    const {result}=runTrace(5,{adjust:(index,time,point,{guide})=>index===35?between(guide.start,guide.end,clamp((time-100)/duration)):point});
    metrics.movementNegatives.push({name,...summarize(result)});assert.equal(result.status,'mismatch',name);
    assert.ok(result.issues.some(issue=>issue.index===35&&issue.code===code),`${name}: ${JSON.stringify(result.issues)}`);
  }
  const off=runTrace(5,{adjust:(index,time,point,{total})=>index===35&&time>500&&time<total-1000?{x:point.x,y:point.y-.9}:point}).result;
  metrics.movementNegatives.push({name:'off-guide',...summarize(off)});assert.equal(off.status,'mismatch');
  assert.ok(off.issues.some(issue=>issue.index===35&&issue.code==='off_guide'));
});

await check('Invalid target metadata or image hashes, dropped left-foot samples and missing torso proof are rejected',()=>{
  const metadataCases=[['original source hash',s=>s.sourceSha256='0'.repeat(64)],['master source hash',s=>s.sourceClipSha256='1'.repeat(64)],
    ['width',s=>s.width++],['height',s=>s.height++],['fps',s=>s.fps=12],['schema',s=>s.schemaVersion='unsupported-v1'],
    ['step identity',s=>s.stepId='first-six-05'],['starting frame',s=>s.startFrame=464],['ending frame',s=>s.endFrame=522]];
  const firstTrack=node=>{if(node&&typeof node==='object'){if(Array.isArray(node.keyframes)&&node.keyframes.length)return node;
    for(const child of Object.values(node)){const found=firstTrack(child);if(found)return found;}}return null;};
  if(firstTrack(spec))metadataCases.push(['decoded input hash',s=>firstTrack(s).keyframes[0].inputPngSha256='2'.repeat(64)],
    ['out-of-frame authored key',s=>firstTrack(s).keyframes[0].x=-.1],
    ['unsorted authored keys',s=>firstTrack(s).keyframes.reverse()]);
  for(const [name,mutate]of metadataCases){const invalid=structuredClone(spec);mutate(invalid);
    assert.throws(()=>prepareSixthAssessmentReference(lesson,source,invalid),undefined,name);}
  for(const [name,index]of [['left-foot observation',35],['torso observation',11],['raw left heel supporting the derived foot',29]]){
    const broken=structuredClone(source);const sample=broken.data.samples.find(s=>s.sourceFrameIndex===500);
    sample.landmarks=sample.landmarks.filter(point=>point.index!==index);
    assert.throws(()=>prepareSixthAssessmentReference(lesson,broken,spec),undefined,name);
  }
  metrics.rejectedMetadataCases=metadataCases.map(([name])=>name);
});

await check('The first five references, original observation archive, authored spec and source-side identities are unchanged',async()=>{
  assert.equal(JSON.stringify(lesson.guidanceReferences.slice(0,5)),fiveBefore);
  assert.equal(JSON.stringify(lesson.references),observedBefore);assert.equal(JSON.stringify(lesson),lessonBefore);
  assert.equal(JSON.stringify(source),sourceBefore);assert.equal(JSON.stringify(spec),specBefore);
  assert.equal(await readFile(archivePath,'utf8'),archiveText);
  assert.equal(lesson.references[5].referenceUsable,false,'Invalid observed sixth data remains explicitly invalid in its original audit record');
  assert.equal(refs[5].referenceUsable,true,'The separate reviewed target contract enables genuine learner assessment');
  assert.deepEqual(refs[5].guides.map(g=>g.index),[33,34,35,36]);
});

const failed=checks.filter(check=>!check.passed);await save(failed.length?'FAIL':'PASS');
assert.equal(failed.length,0,`${failed.length} all-six assessment groups failed; see evaluator-summary.json`);
console.log(`PASS: ${checks.length} all-six assessment groups; constructed learner inputs only.`);
