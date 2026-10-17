/**
 * Camera integration control test. Real saved 33-point MediaPipe observations
 * feed a MOCK pose client and MOCK stream/DOM. This is not live inference,
 * webcam permission acceptance, or human movement/recognition validation.
 * Run: node --experimental-vm-modules scripts/check-first-three-live-camera.mjs
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {getFourPointBodyFrame} from '../public/four-point-game-runtime.js';
import {createStartPositionSession,evaluateStartPosition} from '../public/start-position.js';

assert.equal(typeof vm.SourceTextModule,'function','Run with --experimental-vm-modules');
const publicRoot=new URL('../public/',import.meta.url);
const archive=JSON.parse(await readFile(new URL('practice-media/first-three-centers/opening.poses.json',publicRoot),'utf8'));
const source=archive.samples.find(sample=>sample.status==='pose'&&sample.landmarks.length===33
  &&[11,12,15,16,17,18,19,20,23,24,27,28,29,30,31,32].every(index=>{
    const p=sample.landmarks.find(p=>p.index===index);
    return p&&p.visibility>=.65&&(p.presence===undefined||p.presence>=.65)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  }));
assert.ok(source,'A genuine source observation supports all four derived centers');
const plain=value=>JSON.parse(JSON.stringify(value));
const centers=sample=>sample?.landmarks.filter(p=>p.index>=33&&p.index<=36)??[];
const checks=[],observations=[],inferenceSources=[],models=[],tracks=[],consumerErrors=[];
let clock=1000,nextTask=1,estimateStatus='pose',estimateLandmarks=structuredClone(source.landmarks),estimateDelay=0,throwConsumer=false;
const frames=new Map(),intervals=new Map();
class Element extends EventTarget{
  constructor(){super();this.style={};this.checked=true;this.value='';this.children=[];this.disabled=false;}
  replaceChildren(...children){this.children=children;}
}
class Track extends EventTarget{
  kind='video';readyState='live';muted=false;enabled=true;stops=0;
  getSettings(){return {deviceId:'mock-camera'};}
  stop(){this.readyState='ended';this.stops++;}
}
const doc=new EventTarget();doc.hidden=false;doc.createElement=()=>new Element();
const win=new EventTarget();
const context=vm.createContext({
  console:{...console,error:(...args)=>consumerErrors.push(args.map(String).join(' '))},
  structuredClone,performance:{now:()=>clock},document:doc,window:win,navigator:{mediaDevices:new EventTarget()},
  requestAnimationFrame:callback=>{const id=nextTask++;frames.set(id,callback);return id;},
  cancelAnimationFrame:id=>frames.delete(id),
  setInterval:callback=>{const id=nextTask++;intervals.set(id,callback);return id;},
  clearInterval:id=>intervals.delete(id),
});
const runtime=new vm.SyntheticModule(['listPracticeCameras','requestPracticeCamera'],function(){
  this.setExport('listPracticeCameras',async()=>[{deviceId:'mock-camera',label:'Mock camera (software test)'}]);
  this.setExport('requestPracticeCamera',async()=>{const track=new Track();tracks.push(track);return {getTracks:()=>[track],getVideoTracks:()=>[track]};});
},{context,identifier:'mock:camera-runtime'});
const poseRuntime=new vm.SyntheticModule(['createCenterPoseClient'],function(){
  this.setExport('createCenterPoseClient',async()=>{
    const model={closed:false,estimate(video){inferenceSources.push(video);clock+=estimateDelay;return {status:estimateStatus,
      landmarks:estimateStatus==='pose'?structuredClone(estimateLandmarks):[]};},close(){this.closed=true;}};
    models.push(model);return model;
  });
},{context,identifier:'mock:pose-client'});
const modules=new Map([
  [fileURLToPath(new URL('follow-teacher-runtime.js',publicRoot)),runtime],
  [fileURLToPath(new URL('first-three-pose-runtime.js',publicRoot)),poseRuntime],
]);
async function moduleFor(url){
  const key=fileURLToPath(url);if(modules.has(key))return modules.get(key);
  const module=new vm.SourceTextModule(await readFile(url,'utf8'),{context,identifier:url.href});
  modules.set(key,module);return module;
}
const cameraModule=await moduleFor(new URL('first-three-center-camera.js',publicRoot));
await cameraModule.link((specifier,parent)=>moduleFor(new URL(specifier,parent.identifier)));
await cameraModule.evaluate();
const video=new Element();Object.assign(video,{currentTime:0,videoWidth:450,videoHeight:360,readyState:4,paused:false,
  async play(){this.paused=false;},pause(){this.paused=true;}});
const context2d={arcs:[],labels:[],clearRect(){this.arcs=[];this.labels=[];},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},
  arc(x,y,r){this.arcs.push({x,y,r});},save(){},restore(){},translate(){},scale(){},strokeText(){},fillText(text){this.labels.push(text);}};
const canvas=new Element();Object.assign(canvas,{width:450,height:360,getContext:()=>context2d});
const startButton=new Element(),stopButton=new Element(),deviceSelect=new Element(),mirrorCheckbox=new Element(),skeletonCheckbox=new Element(),statusElement=new Element();
const centerModule=modules.get(fileURLToPath(new URL('practice-centers.js',publicRoot)));
const {CENTER_INDICES,CENTER_COLORS,withPracticeCenters}=centerModule.namespace;
const camera=cameraModule.namespace.createFollowCamera({video,canvas,startButton,stopButton,deviceSelect,
  mirrorCheckbox,skeletonCheckbox,statusElement,pointIndices:CENTER_INDICES,pointColors:CENTER_COLORS,showConnections:false,adaptSample:withPracticeCenters,
  onObservation:observation=>{observations.push(observation);if(throwConsumer&&observation)throw new Error('Deliberate scoring consumer failure');}});
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const start=async()=>{startButton.dispatchEvent(new Event('click'));await flush();assert.equal(camera.getState().running,true);};
const tick=()=>{clock+=100;video.currentTime+=.1;for(const [id,callback]of [...frames]){frames.delete(id);callback(clock);}};
const latest=()=>observations.filter(Boolean).at(-1);
function verifyVisibleAndDelivered(expected){
  const actual=centers(latest()?.sample);
  assert.deepEqual(plain(actual.map(p=>p.index)),expected);
  assert.deepEqual(plain(camera.getState().overlayJoints),expected);
  assert.equal(context2d.arcs.length,expected.length);
  actual.forEach((p,i)=>{assert.equal(context2d.arcs[i].x,p.x*video.videoWidth);assert.equal(context2d.arcs[i].y,p.y*video.videoHeight);});
  return actual;
}
assert.equal(tracks.length,0,'Initialization never starts a camera');
await start();tick();
const accepted=verifyVisibleAndDelivered([33,34,35,36]);
assert.deepEqual(plain(accepted),plain(centers(withPracticeCenters(source))),'Accepted coordinates stay exactly observed; no averaging or substitution');
assert.deepEqual(plain(latest().sample.landmarks.filter(p=>p.index<33)),plain(source.landmarks),'All raw SDK joint IDs and values remain unchanged');
assert.deepEqual(context2d.labels,['LH','RH','LF','RF']);
assert.ok(inferenceSources.every(item=>item===video),'The original raw video is the inference source');
assert.equal(camera.getState().trackingPipeline,'direct-observed-centers-v1');assert.equal('controlQuality' in camera.getState(),false);
checks.push('The FIRST fresh mock frame containing genuine saved raw MediaPipe landmarks immediately renders and delivers four exact observed centers, preserving all raw SDK joints. No added whole-body or warmup gate is used.');

// A deliberately shifted saved observation tests presentation filtering only;
// it is explicitly constructed and is not a real person moving on a webcam.
assert.equal(typeof camera.getDisplayObservation,'function');
estimateLandmarks=structuredClone(source.landmarks).map(p=>({...p,x:p.x+.02,y:p.y+.02}));
tick();
const shiftedRaw=centers(withPracticeCenters({status:'pose',landmarks:estimateLandmarks}));
assert.deepEqual(plain(centers(latest().sample)),plain(shiftedRaw),'Feedback receives exact raw centers, never display-filter coordinates');
const displayObservation=camera.getDisplayObservation();
assert.ok(displayObservation,'A fresh presentation sample is available');
assert.equal(displayObservation.observedAtMs,latest().observedAtMs);
assert.equal(displayObservation.aspectRatio,latest().aspectRatio);
const displayedCenters=centers(displayObservation.sample);
assert.deepEqual(plain(camera.getDisplayObservation().sample),plain(displayObservation.sample),'Repeated presentation reads never advance smoothing');
for(let i=0;i<accepted.length;i++){
  assert.ok(displayedCenters[i].x>accepted[i].x&&displayedCenters[i].x<shiftedRaw[i].x);
  assert.ok(displayedCenters[i].y>accepted[i].y&&displayedCenters[i].y<shiftedRaw[i].y);
  assert.equal(context2d.arcs[i].x,displayedCenters[i].x*video.videoWidth);
  assert.equal(context2d.arcs[i].y,displayedCenters[i].y*video.videoHeight);
  assert.equal(displayedCenters[i].visibility,shiftedRaw[i].visibility);
}
assert.deepEqual(plain(displayObservation.sample.landmarks.filter(p=>p.index<33)),plain(estimateLandmarks));
checks.push('An explicitly shifted genuine saved observation produces smoothed presentation dots/getter values while onObservation still receives exact raw centers and all raw SDK values. No filter values enter feedback.');
estimateStatus='no_pose';tick();assert.equal(camera.getDisplayObservation(),null);
estimateLandmarks=structuredClone(source.landmarks);estimateStatus='pose';tick();verifyVisibleAndDelivered([33,34,35,36]);

const aspect=archive.width/archive.height,body=getFourPointBodyFrame(source,aspect),sourceCenters=centers(withPracticeCenters(source));
const reference={id:'constructed-torso-readiness-control',controlPointVersion:'observed-palm-foot-centers-v1',targetSizeProfile:'compact',guides:sourceCenters.map(p=>({
  index:p.index,start:{x:(p.x*aspect-body.hip.x)/body.scale,y:(p.y-body.hip.y)/body.scale},startRaw:{x:p.x,y:p.y},
  startSourceSeconds:source.sourceTimeSeconds,support:{startTimesMs:[source.tMs,source.tMs+100]},
}))};
estimateLandmarks=structuredClone(source.landmarks).filter(p=>![11,12,23,24].includes(p.index));
tick();verifyVisibleAndDelivered([33,34,35,36]);
assert.deepEqual(plain(latest().sample.landmarks.filter(p=>p.index<33)),plain(estimateLandmarks));
const placement=createStartPositionSession(reference),position=evaluateStartPosition(reference,latest().sample,{
  attemptAspectRatio:aspect,nowMs:clock,observedAtMs:clock,session:placement});
assert.equal(position.status,'unknown');assert.equal(position.holdReady,false);
estimateLandmarks=structuredClone(source.landmarks);tick();verifyVisibleAndDelivered([33,34,35,36]);
checks.push('Removing all four observed torso joints leaves independently valid hand/foot dots visible immediately, while the actual start-position matcher correctly remains unknown and cannot pass readiness.');

throwConsumer=true;tick();verifyVisibleAndDelivered([33,34,35,36]);
let state=camera.getState();assert.equal(state.tracking,'pose');assert.equal(state.lastSampleStatus,'pose');assert.equal(state.hasSample,true);
assert.equal(state.deliveryErrorCount,1);assert.match(state.consumerError,/Deliberate scoring consumer failure/);assert.equal(observations.at(-1),null);
assert.equal(consumerErrors.length,1);throwConsumer=false;tick();assert.equal(camera.getState().consumerError,null);
checks.push('A deliberately throwing scoring callback receives an unknown reset while real live dots remain visible; its error is recorded separately and never mislabeled as an inference failure.');

const beforeMirror=plain(centers(latest().sample));mirrorCheckbox.checked=false;mirrorCheckbox.dispatchEvent(new Event('change'));
assert.equal(video.style.transform,'none');assert.equal(canvas.style.transform,'none');assert.deepEqual(plain(centers(latest().sample)),beforeMirror);
const beforeRedraw=plain(camera.getDisplayObservation().sample);
skeletonCheckbox.dispatchEvent(new Event('change'));skeletonCheckbox.dispatchEvent(new Event('change'));
assert.deepEqual(plain(camera.getDisplayObservation().sample),beforeRedraw,'Overlay redraws never re-filter the same captured observation');
mirrorCheckbox.checked=true;mirrorCheckbox.dispatchEvent(new Event('change'));assert.equal(video.style.transform,'scaleX(-1)');assert.equal(canvas.style.transform,video.style.transform);
checks.push('Toggling preview mirroring changes only video/canvas presentation; observed anatomical identities and calculation coordinates remain unchanged.');

for(const [missingJoint,missingControl]of [[17,33],[18,34],[29,35],[30,36]]){
  estimateLandmarks=structuredClone(source.landmarks).filter(p=>p.index!==missingJoint);
  tick();verifyVisibleAndDelivered([33,34,35,36].filter(index=>index!==missingControl));
  assert.deepEqual(plain(latest().sample.landmarks.filter(p=>p.index<33)),plain(estimateLandmarks));
  estimateLandmarks=structuredClone(source.landmarks);tick();verifyVisibleAndDelivered([33,34,35,36]);
  estimateLandmarks.find(p=>p.index===missingJoint).visibility=.1;
  tick();verifyVisibleAndDelivered([33,34,35,36].filter(index=>index!==missingControl));
  estimateLandmarks=structuredClone(source.landmarks);tick();verifyVisibleAndDelivered([33,34,35,36]);
}
checks.push('A missing or low-confidence supporting joint removes only its dependent palm/foot dot; the other three continue, and the recovered control returns on its FIRST fresh valid frame.');

estimateStatus='no_pose';tick();state=camera.getState();assert.equal(state.tracking,'no_pose');assert.equal(state.hasSample,false);
assert.equal(context2d.arcs.length,0);assert.deepEqual(plain(state.overlayJoints),[]);assert.equal(observations.at(-1),null);
assert.equal(camera.getDisplayObservation(),null);
estimateStatus='pose';tick();verifyVisibleAndDelivered([33,34,35,36]);
checks.push('A real no-pose status from the mock client clears dots and matching evidence; the FIRST fresh valid frame restores its observed controls.');

estimateDelay=500;tick();state=camera.getState();assert.equal(state.tracking,'stale');assert.equal(state.hasSample,false);assert.equal(context2d.arcs.length,0);assert.equal(observations.at(-1),null);
assert.equal(camera.getDisplayObservation(),null);
assert.equal(state.inferenceDurationMs,500);estimateDelay=0;tick();verifyVisibleAndDelivered([33,34,35,36]);
clock+=501;for(const callback of intervals.values())callback();assert.equal(camera.getState().tracking,'stale');assert.equal(camera.getState().hasSample,false);assert.equal(context2d.arcs.length,0);
assert.equal(camera.getDisplayObservation(),null);
checks.push('An over-age inference result and a stalled camera watchdog each clear old dots and matching evidence instead of rendering stale controls.');

video.videoWidth=900;tick();verifyVisibleAndDelivered([33,34,35,36]);
video.videoWidth=450;tick();verifyVisibleAndDelivered([33,34,35,36]);
checks.push('An actual video-aspect change starts a new display history at the fresh observed position rather than blending camera coordinate systems.');

tick();verifyVisibleAndDelivered([33,34,35,36]);camera.stop();
assert.equal(tracks[0].readyState,'ended');assert.equal(tracks[0].stops,1);assert.equal(models[0].closed,true);assert.equal(video.srcObject,null);
assert.equal(camera.getState().trackingPipeline,'direct-observed-centers-v1');assert.equal('controlQuality' in camera.getState(),false);
assert.equal(context2d.arcs.length,0);assert.equal(observations.at(-1),null);assert.equal(frames.size,0);assert.equal(intervals.size,0);
assert.equal(camera.getDisplayObservation(),null);
await start();tick();verifyVisibleAndDelivered([33,34,35,36]);camera.destroy();
assert.equal(camera.getDisplayObservation(),null);
assert.ok(tracks.every(track=>track.readyState==='ended'));assert.ok(models.every(model=>model.closed));
checks.push('Stop releases tracks/model/timers and clears the overlay; a restarted camera renders all four controls on its FIRST fresh valid frame.');

const report={provenance:'Software integration regression only. Genuine saved 33-point MediaPipe teacher observations feed a MOCK pose client and MOCK stream/DOM. Missing/low-confidence joints, time delays, and callback errors are explicitly constructed. No physical webcam, permission, live inference, or human accuracy acceptance is claimed.',
  passed:true,checkGroups:checks.length,checks,sourceObservation:{archive:'public/practice-media/first-three-centers/opening.poses.json',tMs:source.tMs,sourceTimeSeconds:source.sourceTimeSeconds},
  modelInitializations:models.length,modelsClosed:models.filter(model=>model.closed).length,streamsReleased:tracks.filter(track=>track.readyState==='ended').length,
  limitations:['Actual camera lighting, occlusion, person tracking accuracy, and physical hand/foot reachability need manual webcam testing.']};
await mkdir(new URL('../artifacts/display-smoothing-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/display-smoothing-review/camera-summary.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
