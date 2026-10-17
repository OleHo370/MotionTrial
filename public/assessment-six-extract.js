import {createCenterPoseClient} from './first-three-pose-runtime.js';

const $=id=>document.getElementById(id),directory='/practice-media/recut-six/';
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const read=async src=>{const response=await fetch(src);if(!response.ok)throw Error(`Missing source: ${src}`);return response;};
const json=async src=>(await read(src)).json();
const definitions=[
  {index:33,name:'LH',sources:[15,17,19],weights:[.5,.25,.25],color:'#14b8a6'},
  {index:34,name:'RH',sources:[16,18,20],weights:[.5,.25,.25],color:'#edaa36'},
  {index:35,name:'LF',sources:[29,31],weights:[.5,.5],color:'#4298f5'},
  {index:36,name:'RF',sources:[30,32],weights:[.5,.5],color:'#c56bcf'},
];
const round=value=>Number.isFinite(value)?Number(value.toFixed(5)):null;
let manifest,schedule,archive,assetManifest,activeClient=null,running=false,disposed=false,downloadUrl=null;
const pngCache=new Map();
function summary(sample){
  const raw=new Map((sample?.landmarks||[]).map(p=>[p.index,p]));
  const location=point=>({x:round(point?.x),y:round(point?.y),xPixels:round(point?.x*450),yPixels:round(point?.y*360),visibility:round(point?.visibility),presence:round(point?.presence)});
  return {sourceFrameIndex:sample?.sourceFrameIndex,status:sample?.status,
    body:[11,12,23,24].map(index=>({index,...location(raw.get(index))})),
    controls:definitions.map(def=>{
      const points=def.sources.map(index=>raw.get(index)),complete=points.every(p=>p&&[p.x,p.y,p.visibility].every(Number.isFinite));
      const confidence=complete?Math.min(...points.map(p=>p.visibility)):null;
      const presence=complete&&points.every(p=>Number.isFinite(p.presence))?Math.min(...points.map(p=>p.presence)):null;
      const inFrame=complete&&points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);
      const usable=threshold=>inFrame&&confidence>=threshold&&(presence===null||presence>=threshold);
      const weighted=complete?{x:round(points.reduce((sum,p,i)=>sum+p.x*def.weights[i],0)),y:round(points.reduce((sum,p,i)=>sum+p.y*def.weights[i],0))}:null;
      return {index:def.index,name:def.name,minVisibility:round(confidence),minPresence:round(presence),supportedAt45:usable(.45),supportedAt65:usable(.65),
        diagnosticWeightedLocation:weighted?{...weighted,xPixels:round(weighted.x*450),yPixels:round(weighted.y*360)}:null,
        rawSupports:def.sources.map(index=>({index,...location(raw.get(index))}))};
    })};
}
function paintDiagnostic(canvas,sourceCanvas,endpoint){
  canvas.width=450;canvas.height=360;const ctx=canvas.getContext('2d');ctx.drawImage(sourceCanvas,0,0);
  for(const control of endpoint.controls){
    const p=control.diagnosticWeightedLocation;if(!p)continue;
    const def=definitions.find(def=>def.index===control.index);
    ctx.fillStyle=def.color;ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.xPixels,p.yPixels,5,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.font='bold 12px Segoe UI';ctx.lineWidth=3;ctx.strokeStyle='#102d38';ctx.strokeText(def.name,p.xPixels+8,p.yPixels-8);ctx.fillStyle='#fff';ctx.fillText(def.name,p.xPixels+8,p.yPixels-8);
  }
}
async function sourcePng(frame){
  if(!pngCache.has(frame.sourceFrameIndex))pngCache.set(frame.sourceFrameIndex,(async()=>{
    const bytes=await (await read(frame.pngSrc)).arrayBuffer();
    if(await digest(bytes)!==frame.pngSha256)throw Error(`PNG identity differs at frame ${frame.sourceFrameIndex}.`);
    return bytes;
  })());
  return pngCache.get(frame.sourceFrameIndex);
}
async function verifyAssets(){
  const model=assetManifest.assets.find(asset=>asset.path==='/models/pose_landmarker_lite.task');
  if(assetManifest.packageVersion!=='1.1.1'||!model||model.sha256!==archive.modelSha256)throw Error('Pinned runtime/model identity differs from the archive.');
  for(const asset of assetManifest.assets){
    if(disposed)throw Error('The diagnostic page was closed.');
    const bytes=await (await read(asset.path)).arrayBuffer();
    if(bytes.byteLength!==asset.bytes||await digest(bytes)!==asset.sha256)throw Error(`Pinned asset differs: ${asset.path}`);
  }
  return model.sha256;
}
function showRun(run,sourceCanvas){
  const section=document.createElement('section'),heading=document.createElement('h2');heading.textContent=run.label;
  const caption=document.createElement('p');caption.className='note';caption.textContent='New recorded-teacher inference. Dots are diagnostic same-frame weighted locations; inspect their actual placement as well as confidence.';
  const canvas=document.createElement('canvas');canvas.setAttribute('aria-label',`${run.label} final source image with diagnostic locations`);
  const endpoint=summary(run.samples.at(-1));paintDiagnostic(canvas,sourceCanvas,endpoint);
  const details=document.createElement('pre');details.id=`summary-${run.id}`;details.textContent=JSON.stringify({runId:run.id,frames:run.frameIndices.length,endpoint},null,2);
  const label=document.createElement('p');label.textContent='New full 33-landmark observations for available frames 520 / 522 / 524:';
  const data=document.createElement('textarea');data.id=`samples-${run.id}`;data.className='data';data.readOnly=true;data.setAttribute('aria-label',`${run.label} selected real source observations`);
  data.value=JSON.stringify({runId:run.id,provenance:run.provenance,samples:run.samples.filter(s=>[520,522,524].includes(s.sourceFrameIndex))});
  section.append(heading,caption,canvas,details,label,data);$('results').append(section);
}
try{
  [manifest,schedule,archive,assetManifest]=await Promise.all([
    json(directory+'manifest.json'),json(directory+'schedule.json'),json(directory+'master.poses.json'),json('/mediapipe/manifest.json'),
  ]);
  if(schedule.sourceSha256!==manifest.source.sha256||archive.sourceSha256!==manifest.source.sha256
    ||schedule.masterSha256!==manifest.sources[0].video.sha256||archive.sourceClipSha256!==schedule.masterSha256
    ||schedule.width!==450||schedule.height!==360||schedule.fps!==30)throw Error('Recorded source identities do not agree.');
  for(const frame of schedule.frames){
    if(frame.sourceFrameIndex>=465&&frame.sourceFrameIndex<=524
      &&(!frame.inferenceEligible||frame.frameIndex!==frame.sourceFrameIndex||Math.abs(frame.tMs-frame.sourceFrameIndex*1000/30)>1e-6))throw Error('An exact inference frame identity is invalid.');
  }
  $('baseline').textContent=JSON.stringify(summary(archive.samples.find(s=>s.sourceFrameIndex===524)),null,2);
  $('status').textContent='Ready. Three fresh local model sessions will process the recorded teacher only.';$('run').disabled=false;
}catch(error){$('status').textContent=`Cannot prepare diagnostic: ${error.message}`;}

$('run').addEventListener('click',async()=>{
  if(running||disposed)return;running=true;$('run').disabled=true;$('download').hidden=true;$('results').replaceChildren();$('progress').value=0;
  if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}
  try{
    $('status').textContent='Verifying local pinned model/WASM assets…';const modelSha256=await verifyAssets();
    const lookup=new Map(schedule.frames.map(frame=>[frame.sourceFrameIndex,frame]));
    const plans=[
      {id:'fresh-final',label:'Fresh frame 524 only',frameIndices:[524]},
      {id:'fresh-short',label:'Fresh short sequence 516–524',frameIndices:[516,518,520,522,524]},
      {id:'fresh-step',label:'Fresh complete clip-6 sequence 465–524',frameIndices:schedule.frames.filter(frame=>frame.sourceFrameIndex>=465&&frame.sourceFrameIndex<=524).map(frame=>frame.sourceFrameIndex)},
    ];
    if(plans.some(plan=>plan.frameIndices.some(frame=>!lookup.has(frame))))throw Error('An exact requested frame is unavailable.');
    const count=plans.reduce((sum,plan)=>sum+plan.frameIndices.length,0),results=[];
    const canvas=$('frame'),context=canvas.getContext('2d');let completed=0;
    for(const plan of plans){
      if(disposed)throw Error('The diagnostic page was closed.');
      $('status').textContent=`Starting a fresh local CPU VIDEO client: ${plan.label}`;
      const client=await createCenterPoseClient();activeClient=client;
      const samples=[];
      try{
        for(const index of plan.frameIndices){
          if(disposed)throw Error('The diagnostic page was closed.');
          const frame=lookup.get(index),bytes=await sourcePng(frame),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
          if(bitmap.width!==450||bitmap.height!==360){bitmap.close();throw Error(`Unexpected frame size: ${index}`);}
          context.clearRect(0,0,450,360);context.drawImage(bitmap,0,0);bitmap.close();
          const result=client.estimate(canvas,frame.tMs+1);
          samples.push({tMs:frame.tMs,sourceTimeSeconds:frame.sourceTimeSeconds,sourceFrameIndex:index,frameIndex:index,
            inputPngSha256:frame.pngSha256,inferenceTimestampMs:frame.tMs+1,...result});
          completed++;$('progress').value=completed/count;$('status').textContent=`${plan.label}: source frame ${index} · ${completed} / ${count}`;
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }finally{if(activeClient===client)activeClient=null;try{client.close();}catch{}}
      const run={...plan,modelSha256,modelOptions:archive.modelOptions,
        provenance:'NEW genuine recorded-teacher MediaPipe inference on hash-verified exact source PNGs. A fresh local pinned Lite CPU VIDEO client is used for this run and closed afterwards. Not a live learner result. No landmark filling, mirrored input, authored targets or display annotations.',samples};
      results.push(run);showRun(run,canvas);
    }
    const result={schemaVersion:'assessment-six-fresh-diagnostic-v1',createdAt:new Date().toISOString(),sourceSha256:archive.sourceSha256,
      sourceClipSha256:archive.sourceClipSha256,modelSha256,width:450,height:360,fps:30,packageVersion:'1.1.1',
      assessmentEligible:false,provenance:'Recorded-teacher extraction QA only. This file does not modify existing observations, define scoring eligibility, or validate a human learner.',runs:results};
    downloadUrl=URL.createObjectURL(new Blob([JSON.stringify(result)+'\n'],{type:'application/json'}));$('download').href=downloadUrl;$('download').hidden=false;
    $('status').textContent=`Complete: ${results.length} fresh sessions, ${completed} genuine recorded frames. Existing source data is unchanged. Inspect position correctness before considering assessment use.`;
  }catch(error){if(!disposed)$('status').textContent=`Diagnostic failed: ${error.message}`;}
  finally{running=false;if(!disposed)$('run').disabled=false;}
});
window.addEventListener('pagehide',()=>{
  disposed=true;try{activeClient?.close();}catch{}activeClient=null;
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);
},{once:true});
