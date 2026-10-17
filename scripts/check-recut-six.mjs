// New extraction: actual local MediaPipe observations on exact source PNGs.
// Learner fixtures below are CONSTRUCTED software inputs, never live acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {CENTER_POINT_DEFINITIONS,withCenterFocus} from '../public/practice-centers.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {prepareStartPosition,createStartPositionSession,projectStartPositionTargets} from '../public/start-position.js';
import {projectFourPointGuides} from '../public/four-point-game-runtime.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';
import {preparePracticeTubes,createTubeMatcher,practiceTubeIndices,TUBE_RULES} from '../public/practice-tube.js';
import {canAdvanceOnTargets} from '../public/practice-instant-advance.js';

const root=new URL('../',import.meta.url);
const read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const hashFile=async path=>sha(await readFile(new URL(path,root)));
const close=(a,b,label,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} != ${b}`);
const local=src=>'public'+src;
const manifest=await read('public/practice-media/recut-six/manifest.json');
const schedule=await read(local(manifest.scheduleSrc));
const raw=await read(local(manifest.sources[0].poseSrc));
const adapted=LESSON_CONTROLS.referenceAdapter(raw);
const metadata=manifest.sources[0];
const sources=new Map([[metadata.id,{...metadata,data:adapted}]]);
const activeManifest={...manifest,steps:manifest.steps.map(withCenterFocus)};
const before=digest([activeManifest,[...sources],raw]);
const lesson=prepareRecutLesson(activeManifest,sources,LESSON_CONTROLS.referenceOptions);
const refs=lesson.guidanceReferences;
const paths=refs.map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources));
const checks=[];
const check=(name,run)=>{run();checks.push(name);};
const report={
  provenance:'Teacher evidence is fresh local MediaPipe on exact original 24.mp4 cropped PNG frames. Every learner fixture in this script is explicitly constructed software input, not live webcam inference or human acceptance.',
  version:lesson.version,checks,coverage:lesson.coverage,seams:[],geometry:[],steps:[],
  limitations:['No physical webcam, user motion, camera permissions or marker reachability acceptance.','Unobserved source points remain unknown. Neither source nor learner missing tracking is invented.'],
};

check('Only sufficiently displaced endpoints require movement areas; planted clip 4 feet hold and missing clip 6 endpoints remain unassessed',()=>{
  assert.deepEqual(paths.map((path,i)=>path.referenceUsable?i:null).filter(index=>index!==null),[0,1,2,3,4]);
  for(let i=0;i<refs.length;i++){
    const ref=refs[i],required=practiceTubeIndices(ref);
    assert.deepEqual(paths[i].paths.map(path=>path.index),required,`Step ${i+1}: match versioned displacement selection`);
    for(const guide of ref.guides.filter(guide=>guide.valid)){
      const foot=[27,28,35,36].includes(guide.index);
      const displacement=guide.targetGeometry?.observedDisplacement??guide.distance;
      const meaningful=guide.targetGeometry?.mode!=='hold'
        &&displacement>=(foot?TUBE_RULES.minimumFootDisplacement:TUBE_RULES.minimumHandDisplacement);
      assert.equal(required.includes(guide.index),meaningful,'Small endpoint jitter must not create mandatory progress');
    }
  }
  for(const i of [1,2,3])for(const index of [35,36]){
    assert.equal(refs[i].guides.find(guide=>guide.index===index).targetGeometry.mode,'hold');
    assert.equal(paths[i].paths.some(path=>path.index===index),false);
  }
  assert.equal(paths[5].referenceUsable,false);
});

check('Six contiguous half-open demonstration clips cover original frames 15–524 exactly once, excluding only the opening title card',()=>{
  assert.deepEqual(manifest.cutFrames,[15,195,285,399,435,465,525]);
  assert.equal(lesson.steps.length,6);assert.equal(lesson.seams.length,5);
  const count=new Uint8Array(525);
  for(const step of lesson.steps){
    for(let frame=step.sourceStartFrame;frame<step.sourceEndFrameExclusive;frame++)count[frame]++;
    assert.equal(step.clipFrameCount,step.sourceEndFrameExclusive-step.sourceStartFrame);
    close(step.durationSeconds,step.clipFrameCount/30,'Natural clip duration');
  }
  assert.ok([...count.slice(0,15)].every(value=>value===0),'Only original title frames 0–14 are excluded');
  assert.ok([...count.slice(15)].every(value=>value===1),'Every demonstration frame is retained exactly once');
  assert.equal(lesson.coverage.gapFrames,0);assert.equal(lesson.coverage.overlapFrames,0);
  assert.equal(lesson.coverage.firstFrame,15);assert.equal(lesson.coverage.endFrameExclusive,525);
  assert.equal(lesson.coverage.frameCount,510);close(lesson.coverage.startSeconds,.5,'Demonstration begins after title');
  close(lesson.coverage.endSeconds,17.5,'Full excerpt end');
  assert.equal(lesson.steps[0].sourceStartFrame,15);assert.equal(lesson.steps[0].referenceStartFrame,15);
  close(lesson.steps[0].startSeconds,.5,'Active first clip begins on initial teacher pose');
  assert.equal(lesson.steps[0].clipFrameCount,180);close(lesson.steps[0].durationSeconds,6,'Trimmed first clip duration');
  close(manifest.rules.sourceTeachingStartSeconds,.5,'Declared teaching range excludes title');
  close(lesson.steps[0].practiceStartSeconds,.5,'Initial non-title pose');
  assert.equal(lesson.steps.at(-1).referenceEndFrame,524);
});

// Hash I/O is kept outside the synchronous group helper.
assert.equal(await hashFile(local(metadata.video.src)),metadata.video.sha256);
for(const step of manifest.steps)assert.equal(await hashFile(local(step.clipSrc)),step.clipSha256,`${step.id}: encoded clip SHA`);
for(const frame of schedule.frames)assert.equal(await hashFile(local(frame.pngSrc)),frame.pngSha256,`PNG frame ${frame.frameIndex}`);
checks.push('Continuous master, all six new clip files and every scheduled exact inference PNG match their recorded SHA-256 hashes.');

check('Raw observations retain exact scheduled source frame identities/timestamps; every palm and foot uses only its same-frame anatomical components',()=>{
  assert.equal(raw.sourceSha256,manifest.source.sha256);assert.equal(raw.sourceClipSha256,metadata.video.sha256);
  assert.equal(raw.width,450);assert.equal(raw.height,360);
  assert.equal(raw.modelSha256,'59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a');
  const indexed=new Map(schedule.frames.map(frame=>[frame.sourceFrameIndex,frame]));
  const actualIds=raw.samples.map(sample=>sample.sourceFrameIndex);
  const requiredIds=schedule.frames.filter(frame=>frame.inferenceEligible!==false).map(frame=>frame.sourceFrameIndex);
  assert.ok(requiredIds.every(frame=>actualIds.includes(frame)),'Every requested motion PNG has an actual observation status');
  assert.equal(new Set(actualIds).size,actualIds.length);
  for(let i=0;i<raw.samples.length;i++){
    const sample=raw.samples[i],frame=indexed.get(sample.sourceFrameIndex),centerSample=adapted.samples[i];
    assert.ok(frame,`Unexpected inferred frame ${sample.sourceFrameIndex}`);
    close(sample.tMs,frame.tMs,'Exact observation milliseconds');
    close(sample.sourceTimeSeconds,frame.sourceTimeSeconds,'Exact observation source seconds');
    assert.deepEqual(centerSample.landmarks.filter(point=>point.index<=32),sample.landmarks.filter(point=>point.index<=32),'Raw SDK coordinates remain unmodified');
    const byId=new Map(sample.landmarks.map(point=>[point.index,point]));
    for(const def of CENTER_POINT_DEFINITIONS){
      const center=centerSample.landmarks.find(point=>point.index===def.index);
      if(!center)continue;
      const inputs=def.sources.map(index=>byId.get(index));assert.ok(inputs.every(Boolean));
      for(const key of ['x','y'])close(center[key],inputs.reduce((sum,point,k)=>sum+point[key]*def.weights[k],0),`Same-frame ${def.index} ${key}`);
      assert.equal(center.visibility,Math.min(...inputs.map(point=>point.visibility)));
    }
  }
  report.observationCount=raw.samples.length;report.poseCount=raw.samples.filter(sample=>sample.status==='pose').length;
});

check('Every retained raw endpoint observation uses one exact declared frame; designated foot geometry remains separate',()=>{
  for(let i=0;i<refs.length;i++){
    const ref=refs[i],step=lesson.steps[i];
    assert.equal(ref.guides.length,4);assert.deepEqual(ref.guides.map(guide=>guide.index),[33,34,35,36]);
    if(ref.teacherFrame)close(ref.teacherFrameTMs,step.referenceStartFrame*1000/30,'Teacher anchor frame');
    for(const guide of ref.guides){
      for(const side of ['start','end']){
        const observed=guide[`${side}Observation`],point=guide[`${side}Raw`];
        if(!point){assert.equal(observed,null);continue;}
        assert.ok(observed);assert.equal(observed.sourceId,'master');
        const frame=step[side==='start'?'referenceStartFrame':'referenceEndFrame'];
        close(observed.tMs,frame*1000/30,'Exact endpoint time');
        const actual=adapted.samples.find(sample=>sample.sourceFrameIndex===frame)?.landmarks.find(p=>p.index===guide.index);
        assert.ok(actual);assert.deepEqual(point,{x:actual.x,y:actual.y});
        assert.ok(observed.supportTimesMs.length>=2);
      }
    }
  }
});

for(let i=0;i<lesson.seams.length;i++){
  const seam=lesson.seams[i],a=refs[i],b=refs[i+1],out=lesson.steps[i],incoming=lesson.steps[i+1];
  assert.equal(seam.sourceFrameIndex,out.sourceEndFrameExclusive);
  assert.equal(out.referenceEndFrame,incoming.referenceStartFrame);
  close(out.teacherFreezeSeconds,incoming.practiceStartSeconds,'Teacher held boundary time');
  assert.equal(await hashFile(local(out.screenshots.end)),await hashFile(local(incoming.screenshots.start)),'Both cut screenshots are identical PNG bytes');
  for(const index of [33,34,35,36]){
    const end=a.guides.find(g=>g.index===index),start=b.guides.find(g=>g.index===index);
    assert.deepEqual(end.endRaw,start.startRaw,'Shared source coordinates');
    assert.deepEqual(end.endObservation,start.startObservation,'Shared exact frame provenance');
  }
  report.seams.push({from:a.id,to:b.id,frame:seam.sourceFrameIndex,seconds:seam.sourceTimeSeconds,available:seam.available,maximumRawJump:0,identicalBoundaryPNGs:true});
}
checks.push('Every one of the five triangle-to-next-square cuts shares the same four source observations and byte-identical screenshots.');

for(const aspect of [16/9,4/3,9/16]){
  const layouts=refs.map(ref=>createFullHeightLayout(ref,refs,aspect,paths));
  for(let i=0;i<lesson.seams.length;i++){
    if(!lesson.seams[i].available)continue;
    assert.ok(layouts[i]);assert.ok(layouts[i+1]);
    const ends=projectFourPointGuides(refs[i],null,aspect,layouts[i].frame);
    const session=createStartPositionSession(refs[i+1]);session.bodyFrame=layouts[i+1].frame;session.aspect=aspect;
    const starts=projectStartPositionTargets(refs[i+1],session);
    for(const index of [33,34,35,36]){
      const end=ends.find(point=>point.index===index),start=starts.find(point=>point.index===index);
      assert.ok(end.valid&&start.valid);
      close(end.end.x,start.point.x,'Projected cut x');close(end.end.y,start.point.y,'Projected cut y');
    }
    report.geometry.push({aspect,cutFrame:lesson.seams[i].sourceFrameIndex,sharedCenters:4,maximumProjectedJump:0});
  }
}
checks.push('Available shared cuts have identical projected centers under 16:9, 4:3 and 9:16 native camera inputs and the actual portrait display layout.');

const matcher=createTubeMatcher();
const pointAt=(path,phase)=>{
  if(phase<=0)return path.points[0];if(phase>=1)return path.points.at(-1);
  const arc=phase*path.totalLength,k=path.points.findIndex(point=>point.arcLength>=arc);
  const a=path.points[k-1],b=path.points[k],f=(arc-a.arcLength)/(b.arcLength-a.arcLength);
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};
};
for(let i=0;i<refs.length;i++){
  const ref=refs[i],pathRef=paths[i],step=lesson.steps[i];
  const exactEnd=adapted.samples.find(sample=>sample.sourceFrameIndex===step.referenceEndFrame);
  const endQuality=CENTER_POINT_DEFINITIONS.map(def=>{
    const center=exactEnd?.landmarks.find(point=>point.index===def.index);
    const components=def.sources.map(index=>{
      const point=exactEnd?.landmarks.find(point=>point.index===index);
      return {index,visibility:point?.visibility??null,presence:point?.presence??null};
    });
    const threshold=step.referenceVisibilityThreshold??.45;
    return {index:def.index,label:def.label,derivedCenterAvailable:!!center,
      visibility:center?.visibility??null,presence:center?.presence??null,threshold,
      referenceSupported:!!center&&center.visibility>=threshold&&(center.presence??1)>=threshold,components};
  });
  const row={id:ref.id,startFrame:step.referenceStartFrame,endFrame:step.referenceEndFrame,referenceUsable:ref.referenceUsable,
    startUsable:prepareStartPosition(ref).usable,pathUsable:pathRef.referenceUsable,unknownReason:ref.unknownReason??pathRef.unknownReason,
    paths:pathRef.paths.map(path=>({index:path.index,available:path.available,reason:path.reason,observations:path.observations.length})),
    endQuality};
  row.assessmentUsable=ref.referenceUsable&&row.startUsable&&pathRef.referenceUsable&&ref.guides.every(guide=>guide.valid);
  for(const path of pathRef.paths.filter(path=>path.available)){
    const guide=ref.guides.find(guide=>guide.index===path.index);
    for(const key of ['x','y']){
      close(path.points[0][key],guide.start[key],'Tube begins exactly on square');
      close(path.points.at(-1)[key],guide.end[key],'Tube ends exactly on triangle');
    }
    for(const observation of path.observations){
      const actual=adapted.samples.find(sample=>Math.abs(sample.tMs-observation.tMs)<1e-6);
      assert.ok(actual);assert.deepEqual(observation.raw,actual.landmarks.find(point=>point.index===path.index));
    }
  }
  if(row.assessmentUsable){
    const body=ref.teacherFrame,aspect=body.aspect;
    const base=adapted.samples.find(sample=>Math.abs(sample.tMs-ref.teacherFrameTMs)<1e-6);assert.ok(base);
    const fixture=(phase,tMs,starts=false)=>{
      const sample=structuredClone(base);sample.tMs=tMs;
      for(const guide of ref.guides){
        const path=pathRef.paths.find(path=>path.index===guide.index&&path.available);
        const point=starts?guide.start:path?pointAt(path,phase):guide.valid?guide.end:guide.start;
        if(!point)continue;
        Object.assign(sample.landmarks.find(p=>p.index===guide.index),{
          x:(point.x*body.scale+body.hip.x)/aspect,y:point.y*body.scale+body.hip.y,visibility:1,presence:1});
      }
      return sample;
    };
    const initial=fixture(0,1000,true),session=matcher.createSession(ref,pathRef,initial,body,aspect);
    const evaluate=(sample,nowMs=sample.tMs)=>matcher.evaluate(ref,pathRef,sample,{session,bodyFrame:body,
      attemptAspectRatio:aspect,nowMs,observedAtMs:sample.tMs});
    const count=Math.max(160,...pathRef.paths.map(path=>Math.ceil(path.totalLength/.012)));
    let result,sample;
    for(let k=1;k<=count;k++){sample=fixture(k/count,1000+k*50);result=evaluate(sample);}
    assert.equal(result.status,'match',`${ref.id}: constructed trace ${result.reason}`);
    assert.equal(result.pathComplete,true);
    const advance={result,observation:{sample,observedAtMs:sample.tMs,aspectRatio:aspect},nowMs:sample.tMs,active:true,paused:false,phase:'demonstrating'};
    assert.equal(canAdvanceOnTargets(advance),true,'All four current endpoints plus actual route logic advance immediately');
    assert.equal(canAdvanceOnTargets({...advance,result:{...result,status:'unknown'}}),false);
    assert.equal(canAdvanceOnTargets({...advance,nowMs:sample.tMs+451}),false);
    row.constructedTrace='match';row.instantAllFourAdvance=true;
  }else{
    row.constructedTrace='not assessed: unsupported actual source reference';
    assert.equal(canAdvanceOnTargets({result:{status:'unknown',pathComplete:false},observation:null,nowMs:0,active:true,phase:'demonstrating'}),false);
  }
  report.steps.push(row);
}
checks.push('Available movement areas begin at designated squares, end at designated triangles and pass constructed valid-area traces; unsupported source endpoints remain explicitly unassessed and cannot auto-pass.');

check('One constant teacher master/crop covers all categories; no old independently cropped clips or pre-cut model resets are loaded',()=>{
  assert.equal(manifest.sources.length,1);assert.equal(manifest.sources[0].id,'master');
  assert.deepEqual(manifest.sources[0].video.sourceCropPixels,{x:50,y:0,width:450,height:360});
  for(const step of lesson.steps)assert.equal(step.sourceId,'master');
  assert.equal(manifest.rules.constantDisplayCrop,true);assert.equal(manifest.rules.singleSourceTimeline,true);
});

check('A missing exact source joint cannot be replaced by a nearby or opposite-side frame; preparing references leaves original data immutable',()=>{
  const broken=structuredClone(sources),data=broken.get('master').data;
  for(const sample of data.samples)sample.landmarks=sample.landmarks.filter(point=>point.index!==33);
  const lessonMissing=prepareRecutLesson(activeManifest,broken,LESSON_CONTROLS.referenceOptions);
  for(const ref of lessonMissing.references){
    const guide=ref.guides.find(point=>point.index===33);
    assert.equal(guide.startRaw,null);assert.equal(guide.endRaw,null);assert.equal(guide.valid,false);
  }
  assert.ok(lessonMissing.seams.every(seam=>seam.available===false));
  assert.equal(digest([activeManifest,[...sources],raw]),before);
});

await mkdir(new URL('artifacts/corridor-practice-review/',root),{recursive:true});
await writeFile(new URL('artifacts/corridor-practice-review/recut-check-summary.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,checks:checks.length,coverage:report.coverage,observationCount:report.observationCount,
  seams:report.seams,geometryCases:report.geometry.length,steps:report.steps},null,2));
