/** Independently infer all 33 real Pose landmarks on the preserved teaching clips.
 * Builds the page-local full-landmark client. Never overwrites archived observations.
 * node scripts/extract-first-three-centers.mjs [http://127.0.0.1:8766]
 */
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseUrl=(process.argv[2]||'http://127.0.0.1:8766').replace(/\/$/,'');
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(baseUrl).hostname))throw new Error('Use a local loopback server.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const modelOptions={baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,
  minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5,outputSegmentationMasks:false};
const clientSource=`import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
// Raw image coordinates and anatomical identities: derived centers belong to the caller.
export async function createCenterPoseClient(){
  const vision=await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const model=await PoseLandmarker.createFromOptions(vision,${JSON.stringify(modelOptions)});
  return {estimate(video,frameTimeMs){
    let result;
    try{
      result=model.detectForVideo(video,frameTimeMs);
      const pose=result.landmarks[0];
      if(!pose)return {status:'no_pose',landmarks:[]};
      if(pose.length!==33)return {status:'inference_error',landmarks:[]};
      const landmarks=pose.map((p,index)=>({index,x:p.x,y:p.y,z:p.z,visibility:p.visibility,
        ...(p.presence===undefined?{}:{presence:p.presence})}));
      if(landmarks.some(p=>![p.x,p.y,p.z,p.visibility].every(Number.isFinite)||p.visibility<0||p.visibility>1
        ||(p.presence!==undefined&&(!Number.isFinite(p.presence)||p.presence<0||p.presence>1))))
        return {status:'inference_error',landmarks:[]};
      return {status:'pose',landmarks};
    }finally{result?.close();}
  },close(){model.close();}};
}
`;
const packageInfo=JSON.parse(await readFile(path.join(root,'node_modules/@mediapipe/tasks-vision/package.json'),'utf8'));
if(packageInfo.version!=='1.1.1')throw new Error('Expected pinned MediaPipe Tasks Vision 1.1.1.');
const assets=JSON.parse(await readFile(path.join(root,'public/mediapipe/manifest.json'),'utf8'));
for(const asset of assets.assets){
  const bytes=await readFile(path.join(root,'public',asset.path));
  if(hash(bytes)!==asset.sha256||bytes.length!==asset.bytes)throw new Error(`Pinned asset changed: ${asset.path}`);
}
const modelSha256=hash(await readFile(path.join(root,'public/models/pose_landmarker_lite.task')));
const buildOptions={stdin:{contents:clientSource,resolveDir:root,loader:'js'},bundle:true,write:false,platform:'browser',target:'es2022',legalComments:'none'};
const esm=await build({...buildOptions,format:'esm'});
await writeFile(path.join(root,'public/first-three-pose-runtime.js'),esm.outputFiles[0].text);
const iife=await build({...buildOptions,format:'iife',globalName:'FirstThreeCenterPose'});
const sources=[{id:'opening',archive:'/practice-media/first-three/opening.poses.json',video:'/practice-media/first-three/opening.mp4'},
  {id:'parting',archive:'/practice-media/next-three/parting.poses.json',video:'/practice-media/next-three/parting.mp4'}];
const directory=path.join(root,'public/practice-media/first-three-centers');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const source of sources){
    const archiveBytes=await readFile(path.join(root,'public',source.archive));
    const archive=JSON.parse(archiveBytes),videoBytes=await readFile(path.join(root,'public',source.video));
    if(hash(videoBytes)!==archive.sourceClipSha256)throw new Error(`Preserved source changed: ${source.id}`);
    const served=await fetch(baseUrl+source.video);
    if(!served.ok||hash(Buffer.from(await served.arrayBuffer()))!==archive.sourceClipSha256)throw new Error(`Served source differs: ${source.id}`);
    const page=await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.route('**/__first_three_centers_extract',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Recorded teacher full-landmark extraction</title>'}));
    await page.goto(baseUrl+'/__first_three_centers_extract');
    await page.addScriptTag({content:iife.outputFiles[0].text});
    console.log(`Inferring ${source.id}: ${archive.samples.length} recorded frames.`);
    const result=await page.evaluate(async ({src,schedule,width,height})=>{
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';document.body.append(video);
      const wait=event=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(new Error('Decode timeout: '+event));},30000);
        const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',fail);};
        const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('Recorded video decode failed.'));};
        video.addEventListener(event,done,{once:true});video.addEventListener('error',fail,{once:true});
      });
      const loaded=wait('loadeddata');video.src=src;video.load();await loaded;
      if(video.videoWidth!==width||video.videoHeight!==height)throw new Error('Unexpected teacher dimensions.');
      const client=await FirstThreeCenterPose.createCenterPoseClient(),samples=[];
      try{
        for(const original of schedule){
          const requestedSeekSeconds=Math.min(original.tMs/1000+.001,video.duration-.0001);
          if(Math.abs(video.currentTime-requestedSeekSeconds)>1e-7){const sought=wait('seeked');video.currentTime=requestedSeekSeconds;await sought;}
          const {tMs,sourceTimeSeconds,frameIndex,sourceFrameIndex}=original;
          const observation=client.estimate(video,tMs+1);
          samples.push({tMs,sourceTimeSeconds,frameIndex,sourceFrameIndex,requestedSeekSeconds,
            videoCurrentTimeSeconds:video.currentTime,inferenceTimestampMs:tMs+1,...observation});
        }
        return {samples,decoded:{width:video.videoWidth,height:video.videoHeight,durationMs:video.duration*1000}};
      }finally{client.close();video.remove();}
    },{src:source.video,schedule:archive.samples.map(({tMs,sourceTimeSeconds,frameIndex,sourceFrameIndex})=>({tMs,sourceTimeSeconds,frameIndex,sourceFrameIndex})),width:archive.width,height:archive.height});
    const statusCounts=result.samples.reduce((a,s)=>(a[s.status]=(a[s.status]||0)+1,a),{});
    for(const sample of result.samples)if(sample.status==='pose'&&(sample.landmarks.length!==33||sample.landmarks.some((p,i)=>p.index!==i)))throw new Error('Invalid full-landmark output.');
    const output={...archive,originalObservationSrc:source.archive,originalObservationSha256:hash(archiveBytes),
      schemaVersion:'first-three-recorded-pose-v1',sampleRateHz:12,modelSha256,packageVersion:packageInfo.version,modelOptions,
      provenance:'Actual independent local MediaPipe Pose Landmarker Lite float16 v1 CPU inference on preserved 24.mp4 teaching clips. All 33 observed Pose landmarks retained. Recorded teacher data, not a live camera result. No interpolation, synthetic endpoints or wrist/ankle extrapolation. Derived palm/foot centers are calculated separately by the practice page.',
      extractionVersion:'first-three-full-pose-v1',samplingPolicy:'Infer each original 12 Hz presentation timestamp in ascending order after seeking its decoded source frame (+0.001 seconds; final request clamped before clip end). Each source uses a fresh model. Frame indices retain the archived estimated provenance; they are not new exact decoded-frame IDs.',
      presencePolicy:'Preserved only when actually supplied by MediaPipe; omitted otherwise.',
      complete:true,completedAt:new Date().toISOString(),browserVersion:browser.version(),decoded:result.decoded,statusCounts,samples:result.samples};
    await writeFile(path.join(directory,source.id+'.poses.json'),JSON.stringify(output)+'\n');
    console.log(`${source.id}: ${JSON.stringify(statusCounts)}; saved genuine full-landmark observations.`);
    await page.close();
  }
}finally{await browser.close();}
