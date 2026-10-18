// Pure software checks against actual archived MediaPipe WORLD observations.
// No camera, browser, model invocation, Arduino, or Factory API is opened.
// Missing/invalid cases are explicitly constructed test modifications.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildUploadedLesson} from '../public/uploaded-lesson-reference.js';
import {validateUploadedLesson3DData,selectUploadedLesson3DSample,
  validateLesson3DData,selectLesson3DSample} from '../public/first-three-study-3d.js';
import {transformSample,HIP_DISPLAY_HEIGHT} from '../public/study-3d-scene.js';

const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const manifest=await read('../public/practice-media/recut-six/manifest.json');
const world=await read('../public/practice-media/recut-six/master.study-3d.poses.json');
const original=JSON.stringify({manifest,world});
// Simulate the browser upload's timestamp-only observations by preserving the
// same actual image/world points and removing archive-only frame identifiers.
const samples=world.samples.map(sample=>{
  const copy=structuredClone(sample);delete copy.frameIndex;delete copy.sourceFrameIndex;return copy;
});
const built=buildUploadedLesson({samples,width:world.width,height:world.height,durationSeconds:17.5,
  videoUrl:'blob:software-check-uploaded-world',sourceSha256:world.sourceClipSha256,fileName:'Actual archived world fixture.mp4',
  ranges:manifest.steps.slice(0,5).map(step=>({startSeconds:step.startSeconds,endSeconds:step.endSeconds,title:step.title}))});
const source=[...built.sources.values()][0],raw=source.rawData;
const validated=validateUploadedLesson3DData(raw,source,built.manifest.source.sha256);
const select=(data,index,time)=>selectUploadedLesson3DSample(data,built.manifest.steps[index],source,time);
let count=0;
const check=(name,fn)=>{fn();count++;console.log(`PASS: ${name}`);};

check('Uploaded 3D validates actual source/model/dimensions and retains genuine image/world coordinates',()=>{
  assert.equal(validated.displayYawRadians,0);
  assert.equal(validated.displayYawProvenance.kind,'unrotated-native-mediapipe-world');
  assert.equal(validated.samples,raw.samples);
  assert.deepEqual(validated.samples,samples);
  assert.equal(validated.fps,undefined,'A sample rate is never relabeled as encoded-video FPS');
  assert.ok(validated.samples.every(sample=>sample.frameIndex===undefined&&sample.sourceFrameIndex===undefined));
  assert.notEqual(validated.samples[0].worldLandmarks,world.samples[0].worldLandmarks);
  assert.deepEqual(validated.samples[0].worldLandmarks,world.samples[0].worldLandmarks);
});

check('Every uploaded segment selects its exact genuine start and held finish, using source timestamps only',()=>{
  for(let index=0;index<5;index++){
    const step=built.manifest.steps[index];
    for(const time of [step.practiceStartSeconds,step.teacherFreezeSeconds]){
      const selected=select(validated,index,time);
      assert.ok(selected.sample,`${step.id} at ${time}: ${selected.reason}`);
      assert.equal(selected.sample.sourceTimeSeconds,time);
      assert.equal(selected.frameIndex,null);assert.equal(selected.sourceFrameIndex,null);
      assert.equal(selected.sourceTimeSeconds,time);
    }
  }
});

check('Latest observations never show a future or neighboring-clip frame',()=>{
  for(let index=0;index<5;index++){
    const step=built.manifest.steps[index],time=step.practiceStartSeconds+.01;
    const selected=select(validated,index,time);
    assert.ok(selected.sample);assert.ok(selected.sourceTimeSeconds<=time);
    assert.equal(selected.sourceTimeSeconds,step.practiceStartSeconds);
    assert.equal(select(validated,index,step.practiceStartSeconds-.001).sample,null);
    assert.equal(select(validated,index,step.teacherFreezeSeconds+.001).sample,null);
  }
});

check('An uploaded observation older than 150 ms cannot bridge a missing interval',()=>{
  const first=select(validated,0,built.manifest.steps[0].practiceStartSeconds).sample;
  const only={...validated,samples:[first]},time=first.sourceTimeSeconds;
  assert.equal(select(only,0,time+.149).sample,first);
  assert.equal(select(only,0,time+.151).sample,null);
  assert.equal(select(only,0,time+.151).reason,'observation_too_old');
});

check('Missing world evidence at a current image pose clears 3D instead of retaining an older skeleton',()=>{
  const current=validated.samples.find(sample=>sample.status==='pose'&&sample.sourceTimeSeconds>1);
  const previous=validated.samples.findLast(sample=>sample.sourceTimeSeconds<current.sourceTimeSeconds);
  const missing={...current,worldLandmarks:undefined};
  const changed={...validated,samples:[previous,missing]};
  assert.equal(select(changed,0,current.sourceTimeSeconds).sample,null);
  assert.equal(select(changed,0,current.sourceTimeSeconds).reason,'world_landmarks_unavailable');
  const noPose={...current,status:'no_pose',landmarks:[],worldLandmarks:[]};
  assert.equal(select({...validated,samples:[previous,noPose]},0,current.sourceTimeSeconds).reason,'tracking_unavailable');
});

check('A missing exact uploaded finish cannot silently reuse a nearby previous observation',()=>{
  const end=built.manifest.steps[0].teacherFreezeSeconds;
  const last=validated.samples.findLast(sample=>sample.sourceTimeSeconds<end);
  const changed={...validated,samples:[last]};
  assert.equal(select(changed,0,end).sample,null);
  assert.equal(select(changed,0,end).reason,'finish_boundary_observation_unavailable');
});

check('Uploaded 3D renders native world coordinates with documented display transforms only',()=>{
  const sample=validated.samples.find(sample=>sample.status==='pose'&&sample.worldLandmarks?.length===33);
  const before=JSON.stringify(sample),options={coordinateTransforms:{front:{yawRadians:0}},mirrorFront:false};
  const displayed=transformSample(sample,'front',options);
  assert.ok(displayed.drawnPoints>0);
  const worldPoints=new Map(sample.worldLandmarks.map(point=>[point.index,point]));
  const hips=[worldPoints.get(23),worldPoints.get(24)];
  const center=['x','y','z'].map(key=>(hips[0][key]+hips[1][key])/2);
  for(const index of displayed.validIndices){
    const point=worldPoints.get(index),expected=[point.x-center[0],-point.y+center[1]+HIP_DISPLAY_HEIGHT,-point.z+center[2]];
    assert.ok(expected.every((value,axis)=>Math.abs(value-displayed.points[index][axis])<1e-8));
  }
  const mirrored=transformSample(sample,'front',{...options,mirrorFront:true});
  for(const index of displayed.validIndices){
    assert.equal(mirrored.points[index][0],-displayed.points[index][0]);
    assert.deepEqual(mirrored.points[index].slice(1),displayed.points[index].slice(1));
  }
  assert.equal(JSON.stringify(sample),before);
});

check('Low-confidence uploaded world joints and missing hip anchors stay absent',()=>{
  const sample=structuredClone(validated.samples.find(sample=>sample.status==='pose'));
  sample.worldLandmarks[15].visibility=0;
  const options={coordinateTransforms:{front:{yawRadians:0}}};
  assert.equal(transformSample(sample,'front',options).points[15],null);
  sample.worldLandmarks[23].visibility=0;
  const unknown=transformSample(sample,'front',options);
  assert.equal(unknown.drawnPoints,0);assert.equal(unknown.reason,'hip_anchor_unknown');
});

check('Mismatched source, model, dimensions and absent world data are rejected',()=>{
  for(const [key,value]of [['sourceSha256','a'.repeat(64)],['sourceClipSha256','b'.repeat(64)],
    ['modelSha256','c'.repeat(64)],['width',world.width+1],['durationMs',NaN]])
    assert.throws(()=>validateUploadedLesson3DData({...raw,[key]:value},source,built.manifest.source.sha256),/match/);
  const noWorld={...raw,samples:raw.samples.map(sample=>({...sample,worldLandmarks:undefined}))};
  assert.throws(()=>validateUploadedLesson3DData(noWorld,source,built.manifest.source.sha256),/world landmarks/);
  const invalid=structuredClone(raw);invalid.samples.find(sample=>sample.status==='pose').worldLandmarks[0].z=NaN;
  assert.throws(()=>validateUploadedLesson3DData(invalid,source,built.manifest.source.sha256),/world landmarks/);
});

check('Duplicate/nonmedia timestamps and retained unknown-world poses cannot count as observations',()=>{
  const first=raw.samples[0];
  for(const bad of [{...raw,samples:[first,first]},
    {...raw,samples:[{...first,tMs:first.tMs+1000}]},
    {...raw,samples:[{...first,status:'no_pose'}]}])
    assert.throws(()=>validateUploadedLesson3DData(bad,source,built.manifest.source.sha256),/timestamps|retained landmarks/);
});

check('Built-in 3D validation and exact original frame selection remain unchanged',()=>{
  assert.equal(validateLesson3DData(world,manifest.sources[0],manifest.source.sha256),world);
  for(const step of manifest.steps.slice(0,5)){
    assert.equal(selectLesson3DSample(world,step,manifest.sources[0],step.practiceStartSeconds).sourceFrameIndex,step.sourceStartFrame);
    assert.equal(selectLesson3DSample(world,step,manifest.sources[0],step.teacherFreezeSeconds).sourceFrameIndex,step.referenceEndFrame);
  }
  assert.equal(JSON.stringify({manifest,world}),original);
});

console.log(`Uploaded instructor 3D: ${count} software checks passed. Browser WebGL, physical-camera and paid-API validation not claimed.`);
