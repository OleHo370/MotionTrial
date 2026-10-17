/**
 * Real archived teacher observations plus explicitly CONSTRUCTED annotation
 * controls exercise presentation-only behavior. No webcam or human acceptance.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareTeacherDisplayGuides,getTeacherDisplayPoints} from '../public/teacher-point-display.js';
import {withPracticeCenters,withCenterFocus} from '../public/practice-centers.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {createAttemptReview,observeAttemptReview,finalizeAttemptReview} from '../public/practice-attempt-review.js';

const root=new URL('../',import.meta.url),directory=new URL('artifacts/teacher-point-visibility-review/',root);
const archiveText=await readFile(new URL('public/practice-media/recut-six/master.poses.json',root),'utf8');
const archive=JSON.parse(archiveText),manifest=JSON.parse(await readFile(new URL('public/practice-media/recut-six/manifest.json',root),'utf8'));
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;};
freeze(archive);
const sourceFrame=frame=>archive.samples.find(s=>s.sourceFrameIndex===frame);
const adapted=frame=>withPracticeCenters(sourceFrame(frame));
const byId=(points,index)=>points.find(p=>p.index===index);
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} differs from ${expected}`);
const fixture={schemaVersion:'teacher-display-guides-v1',sourceSha256:archive.sourceSha256,
  sourceClipSha256:archive.sourceClipSha256,width:archive.width,height:archive.height,fps:archive.fps,
  tracks:[{index:33,provenance:'Constructed annotation coordinates for software testing only; not a visually reviewed source correction.',
    reason:'Exercise an explicit bounded display interval independently of raw observations.',
    keyframes:[{sourceFrameIndex:480,x:.6,y:.5},{sourceFrameIndex:500,x:.5,y:.4},{sourceFrameIndex:524,x:.4,y:.3}]
      .map(key=>({...key,inputPngSha256:sourceFrame(key.sourceFrameIndex).inputPngSha256}))}]};
const fixtureBefore=JSON.stringify(fixture),sourceBefore=JSON.stringify(archive),prepared=prepareTeacherDisplayGuides(archive,freeze(fixture));
const checks=[],metrics={};
const check=async(name,run)=>{await run();checks.push({name,passed:true});console.log(`PASS: ${name}`);};

await check('First frame right foot is visible as uncertain with its original model confidence and exact coordinates',()=>{
  const sample=freeze(adapted(15)),before=JSON.stringify(sample),raw=byId(sample.landmarks,36);
  const cues=getTeacherDisplayPoints(sample,prepared);
  assert.deepEqual(cues.map(p=>p.index),[33,34,35,36]);
  const foot=byId(cues,36);assert.equal(foot.appearance,'uncertain');assert.equal(foot.displayOnly,true);
  close(foot.x,raw.x);close(foot.y,raw.y);assert.equal(foot.visibility,.611197292804718);
  assert.equal(foot.presence,raw.presence);assert.equal(JSON.stringify(sample),before);
  assert.ok(cues.filter(p=>p.index!==36).every(p=>p.appearance==='observed'));
  metrics.initialRightFoot={sourceFrameIndex:15,x:foot.x,y:foot.y,visibility:foot.visibility,presence:foot.presence,appearance:foot.appearance};
});

await check('Only the explicitly annotated left palm is overridden inside the bounded late-clip interval',()=>{
  for(const frame of [480,482,490,500,506,512,524]){
    const sample=freeze(adapted(frame)),snapshot=JSON.stringify(sample),cues=getTeacherDisplayPoints(sample,prepared);
    const guide=byId(cues,33);assert.equal(guide.appearance,'guide');assert.equal(guide.displayOnly,true);
    assert.equal(guide.provenance,fixture.tracks[0].provenance);assert.equal(guide.reason,fixture.tracks[0].reason);
    assert.equal('visibility' in guide,false);assert.equal('presence' in guide,false);
    assert.equal(guide.sourceFrameIndex,frame);assert.ok(guide.supportSourceFrameIndices.length>=1);
    for(const supportedFrame of guide.supportSourceFrameIndices)assert.ok([480,500,524].includes(supportedFrame));
    for(const p of cues.filter(p=>p.index!==33)){
      const raw=byId(sample.landmarks,p.index);close(p.x,raw.x);close(p.y,raw.y);
      assert.equal(p.visibility,raw.visibility);assert.notEqual(p.appearance,'guide');
    }
    assert.equal(JSON.stringify(sample),snapshot);
  }
  const interpolated=byId(getTeacherDisplayPoints(adapted(490),prepared),33);
  close(interpolated.x,.55);close(interpolated.y,.45);
  assert.deepEqual(interpolated.supportSourceFrameIndices,[480,500]);
  assert.deepEqual(interpolated.supportInputPngSha256,[sourceFrame(480).inputPngSha256,sourceFrame(500).inputPngSha256]);
  assert.equal(byId(getTeacherDisplayPoints(adapted(478),prepared),33).appearance,'observed');
});

await check('No extrapolation, no-pose, missing controls and retimed/unrelated frame identities cannot invent guidance',()=>{
  assert.deepEqual(getTeacherDisplayPoints(null,prepared),[]);
  assert.deepEqual(getTeacherDisplayPoints({status:'no_pose',landmarks:[]},prepared),[]);
  const after={...adapted(524),sourceFrameIndex:526,tMs:526*1000/30};
  assert.equal(byId(getTeacherDisplayPoints(after,prepared),33),undefined);
  const missing={...adapted(478),landmarks:adapted(478).landmarks.filter(p=>p.index!==33)};
  assert.equal(byId(getTeacherDisplayPoints(missing,prepared),33),undefined);
  const retimed={...adapted(506),tMs:123};
  assert.equal(byId(getTeacherDisplayPoints(retimed,prepared),33),undefined);
  const noIdentity={...adapted(506)};delete noIdentity.sourceFrameIndex;
  assert.equal(byId(getTeacherDisplayPoints(noIdentity,prepared),33),undefined);
  const unrelated={...adapted(506),inputPngSha256:'3'.repeat(64)};
  assert.equal(byId(getTeacherDisplayPoints(unrelated,prepared),33),undefined);
  const noHash={...adapted(506)};delete noHash.inputPngSha256;
  assert.equal(byId(getTeacherDisplayPoints(noHash,prepared),33),undefined);
  assert.deepEqual(getTeacherDisplayPoints(adapted(506),prepared,{indices:[35,36]}).map(p=>p.index),[35,36]);
  assert.equal(byId(getTeacherDisplayPoints(adapted(506),null),33),undefined);
});

await check('Metadata, decoded-frame hashes, unsupported/duplicate identities and malformed keyframes are rejected',()=>{
  const invalid=[
    a=>a.schemaVersion='different-v1',a=>a.sourceSha256='0'.repeat(64),a=>a.sourceClipSha256='1'.repeat(64),
    a=>a.width++,a=>a.height++,a=>a.fps=12,a=>a.tracks=null,
    a=>a.tracks[0].index=15,a=>a.tracks.push(structuredClone(a.tracks[0])),
    a=>a.tracks[0].provenance='',a=>a.tracks[0].reason='',a=>a.tracks[0].keyframes.length=1,
    a=>a.tracks[0].keyframes.reverse(),a=>a.tracks[0].keyframes[1].sourceFrameIndex=480,
    a=>a.tracks[0].keyframes[0].sourceFrameIndex=481,
    a=>a.tracks[0].keyframes[0].x=-.1,a=>a.tracks[0].keyframes[0].y=1.1,
    a=>a.tracks[0].keyframes[0].x=NaN,a=>a.tracks[0].keyframes[0].inputPngSha256='2'.repeat(64),
    a=>{a.tracks[0].keyframes[0].sourceFrameIndex=14;a.tracks[0].keyframes[0].inputPngSha256=sourceFrame(14).inputPngSha256;},
  ];
  for(const mutate of invalid){const broken=structuredClone(fixture);mutate(broken);assert.throws(()=>prepareTeacherDisplayGuides(archive,broken),/Invalid teacher display guides/);}
  assert.throws(()=>getTeacherDisplayPoints(adapted(15),prepared,{observedThreshold:.8,reliableThreshold:.6}),/thresholds are invalid/);
  metrics.invalidMetadataCases=invalid.length;
});

await check('Raw source, existing reference usability and scoring inputs remain unchanged by display guidance',()=>{
  const source=manifest.sources[0];
  const lesson=()=>prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},
    new Map([[source.id,{...source,data:LESSON_CONTROLS.referenceAdapter(archive)}]]),LESSON_CONTROLS.referenceOptions);
  const before=lesson();assert.equal(before.references[5].referenceUsable,false);
  for(const sample of archive.samples)getTeacherDisplayPoints(withPracticeCenters(sample),prepared);
  assert.deepEqual(lesson(),before);assert.equal(JSON.stringify(archive),sourceBefore);
  assert.equal(JSON.stringify(fixture),fixtureBefore);
  assert.equal(byId(adapted(506).landmarks,33),undefined,'The unobserved raw derived palm remains absent despite its visible teaching guide');
});

await check('Reviewed display guides have no confidence and cannot count as observed learner controls',()=>{
  const sample=adapted(506),cues=getTeacherDisplayPoints(sample,prepared),aspect=archive.width/archive.height;
  const bodyFrame={hip:{x:.6,y:.6},scale:.3,aspect};
  const normalize=p=>({x:(p.x*aspect-bodyFrame.hip.x)/bodyFrame.scale,y:(p.y-bodyFrame.hip.y)/bodyFrame.scale});
  const ref={referenceUsable:true,guides:cues.map(p=>({index:p.index,valid:true,start:normalize(p),end:normalize(p),targetGeometry:{mode:'hold'}}))};
  const review=createAttemptReview(ref,{referenceUsable:true,paths:[]},{bodyFrame,aspect,durationMs:1000});
  observeAttemptReview(review,{sample:{status:'pose',tMs:sample.tMs,landmarks:cues},observedAtMs:1000,aspectRatio:aspect},{nowMs:1000,elapsedMs:0});
  assert.equal(review.controls.find(c=>c.index===33).sampleCount,0);
  assert.equal(finalizeAttemptReview(review,{nowMs:2000,elapsedMs:1000}).status,'unknown');
  assert.equal(byId(sample.landmarks,33),undefined);
});

await check('The actual reviewed sidecar supports all four teacher display cues without modifying recorded observations',async()=>{
  const sidecarText=await readFile(new URL('public/practice-media/recut-six/teacher-display-guides.json',root),'utf8');
  const sidecar=freeze(JSON.parse(sidecarText)),reviewed=prepareTeacherDisplayGuides(archive,sidecar);
  assert.deepEqual(reviewed.tracks.map(t=>t.index).sort(),[33,34]);
  const guideCounts={33:0,34:0},appearanceCounts={observed:0,uncertain:0,guide:0};
  let teachingObservations=0;
  for(const raw of archive.samples){
    const sample=freeze(withPracticeCenters(raw)),snapshot=JSON.stringify(sample);
    const cues=getTeacherDisplayPoints(sample,reviewed);
    if(raw.status==='pose'&&raw.sourceFrameIndex>=15){
      teachingObservations++;assert.deepEqual(cues.map(p=>p.index),[33,34,35,36],`All controls visible at frame ${raw.sourceFrameIndex}`);
      for(const cue of cues){appearanceCounts[cue.appearance]++;
        if(cue.appearance==='guide'){
          assert.ok(raw.sourceFrameIndex>=480&&raw.sourceFrameIndex<=524);
          assert.ok([33,34].includes(cue.index));guideCounts[cue.index]++;
          assert.equal('visibility' in cue,false);assert.equal('presence' in cue,false);
        }
      }
    }else assert.deepEqual(cues,[]);
    assert.equal(JSON.stringify(sample),snapshot);
  }
  for(const track of reviewed.tracks)for(const key of track.keyframes){
    const cue=byId(getTeacherDisplayPoints(adapted(key.sourceFrameIndex),reviewed),track.index);
    assert.equal(cue.appearance,'guide');close(cue.x,key.x);close(cue.y,key.y);
    assert.deepEqual(cue.supportSourceFrameIndices,[key.sourceFrameIndex]);
  }
  assert.equal(JSON.stringify(archive),sourceBefore);
  metrics.reviewedSidecar={path:'public/practice-media/recut-six/teacher-display-guides.json',
    sha256:createHash('sha256').update(sidecarText).digest('hex'),teachingObservations,guideCounts,appearanceCounts,
    interpretation:'The root-authored source-image-reviewed sidecar is source-validated here. Display coverage is not measured tracking accuracy and does not change grading.'};
});

const report={passed:true,groups:checks.length,checks,
  provenance:'Genuine saved MediaPipe teacher archive, actual reviewed annotation sidecar, and separately labeled constructed annotation coordinates for software controls. Constructed fixture coordinates are not source corrections. No live camera or human movement acceptance is claimed.',
  sourceArchiveSha256:createHash('sha256').update(archiveText).digest('hex'),metrics,
  limitations:['The source sidecar must be visually reviewed against its decoded frames. These software checks validate source identity and presentation/scoring separation, not the artistic correctness of annotation positions.']};
await mkdir(directory,{recursive:true});await writeFile(new URL('helper-summary.json',directory),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
