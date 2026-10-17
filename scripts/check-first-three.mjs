/** Independent QA for the new first-three prototype. All recorded/control
 * inputs must be labelled; software replay is never human acceptance. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/first-three-review');
const base=process.env.FIRST_THREE_TEST_URL||'http://127.0.0.1:8766';
const checks=[],snapshots={},pageErrors=[],remoteResponses=[];
const sha=async(file)=>createHash('sha256').update(await readFile(file)).digest('hex');
const add=(message)=>{checks.push(message);console.log(`PASS: ${message}`);};
const manifestPath=path.join(root,'public/practice-media/first-three/manifest.json');
const manifest=JSON.parse(await readFile(manifestPath));
const data=JSON.parse(await readFile(path.join(root,'public',manifest.poseSrc)));
const diag=page=>page.evaluate(()=>window.firstThreeDiagnostics);
await mkdir(out,{recursive:true});

async function preservation(){
 const baseline=JSON.parse(await readFile(path.join(out,'protected-before.json'))),files=[],originals=[];
 for(const entry of baseline.files){const actual=await sha(path.join(root,entry.path));assert.equal(actual,entry.sha256,entry.path);files.push({...entry,beforeSha256:entry.sha256,afterSha256:actual});}
 for(const entry of baseline.originals){const actual=await sha(entry.path);assert.equal(actual,entry.sha256,entry.path);originals.push({...entry,beforeSha256:entry.sha256,afterSha256:actual});}
 const pinned=JSON.parse(await readFile(path.join(root,'public/mediapipe/manifest.json')));
 for(const asset of pinned.assets)assert.equal(await sha(path.join(root,'public',asset.path)),asset.sha256);
 await writeFile(path.join(out,'protected-after.json'),JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),oldFileCount:files.length,files,originals,pinnedModelAssets:pinned.assets},null,2));
 add(`${files.length} old public/source/dependency files, all three input videos and pinned MediaPipe assets remain byte-identical.`);
}

async function label(page,message){await page.evaluate(text=>{const el=document.createElement('div');el.className='qa-provenance';el.textContent=text;el.style.cssText='position:relative;padding:7px;background:#fff0b3;color:#4b3610;text-align:center;font:12px Arial';document.body.prepend(el);},message);}
async function launch(args=[]){return chromium.launch({channel:'chrome',headless:true,args});}

async function referenceChecks(){
 const refModule=await import(pathToFileURL(path.join(root,'public/first-three-reference.js'))),runtime=await import(pathToFileURL(path.join(root,'public/four-point-game-runtime.js')));
 assert.equal(manifest.schemaVersion,'first-three-teaching-v1');assert.equal(manifest.steps.length,3);
 assert.equal(manifest.source.file,'24.mp4');assert.equal(manifest.source.sha256,await sha('D:/MotionTrial/24.mp4'));
 assert.equal(await sha(path.join(root,'public',manifest.source.src)),manifest.source.excerptSha256);
 assert.equal(await sha(path.join(root,'public',manifest.video.src)),manifest.video.sha256);
 assert.equal(manifest.video.sha256,await sha(path.join(root,'public/practice-media/24-01.mp4')));
 assert.equal(data.sampleRateHz,12);assert.equal(data.samples.length,149);assert.equal(data.sourceSha256,manifest.source.sha256);assert.equal(data.sourceClipSha256,manifest.video.sha256);
 const original=JSON.parse(await readFile(path.join(root,'public',data.originalObservationSrc)));
 const originals=Array.isArray(original)?original:original.samples;
 assert.equal(originals.length,data.samples.length);
 for(const [i,sample]of data.samples.entries()){assert.equal(sample.tMs,originals[i].tMs);assert.equal(sample.status,originals[i].status);assert.deepEqual(sample.landmarks,originals[i].landmarks);assert.equal(sample.sourceTimeSeconds,1+sample.tMs/1000);}
 assert.deepEqual(manifest.steps.map(s=>[s.sourceStartSeconds,s.sourceEndSeconds]),[[1,6.5],[6.5,9.5],[9.5,13]]);
 assert.deepEqual(manifest.steps.map(s=>s.focusJoints),[[27],[15,16],[15,16]]);
 const refs=manifest.steps.map(step=>refModule.prepareFirstThreeReference(step,data));const replay=[];
 const validPoint=data.samples[0].landmarks.find(p=>p.index===15);
 assert.equal(refModule.visible({...validPoint,presence:null}),false);assert.equal(refModule.visible({...validPoint,presence:NaN}),false);assert.equal(refModule.visible({...validPoint,presence:0.2}),false);assert.equal(refModule.visible({...validPoint}),true);
 function run(ref,samples){const session=runtime.createFourPointSession(ref);let result;for(const sample of samples)result=runtime.evaluateFourPointObservation(ref,sample,{attemptAspectRatio:data.width/data.height,liveAgeMs:0,session});return{result,session};}
 for(const [i,step]of manifest.steps.entries()){
  assert.ok(step.sourceStartSeconds>=0&&step.sourceEndSeconds<=30);assert.equal(step.sourceStartSeconds,1+step.startSeconds);assert.equal(step.sourceEndSeconds,1+step.endSeconds);
  assert.equal(await sha(path.join(root,'public',step.clipSrc)),step.clipSha256);
  for(const file of Object.values(step.screenshots))assert.ok((await readFile(path.join(root,'public',file))).length>1000);
  const ref=refs[i];assert.equal(ref.referenceUsable,true,ref.unknownReason);assert.deepEqual(ref.guides.map(g=>g.index),[15,16,27,28]);
  for(const guide of ref.guides){assert.equal(guide.valid,true);for(const phase of['start','end']){assert.ok(guide.support[`${phase}TimesMs`].length>=2);const sample=data.samples.find(s=>s.sourceTimeSeconds===guide[`${phase}SourceSeconds`]);assert.ok(sample);const p=sample.landmarks.find(p=>p.index===guide.index);assert.deepEqual(guide[`${phase}Raw`],{x:p.x,y:p.y});}}
  const samples=data.samples.filter(s=>s.tMs>=step.startSeconds*1000&&s.tMs<step.endSeconds*1000),observed=run(ref,samples);assert.equal(observed.result.status,'match',step.id);replay.push({stepId:step.id,status:observed.result.status,focus:ref.focusJoints});
  const unknown=runtime.evaluateFourPointObservation(ref,{...samples.at(-1),tMs:samples.at(-1).tMs+83},{attemptAspectRatio:data.width/data.height,liveAgeMs:451,session:observed.session});assert.equal(unknown.status,'unknown');assert.equal(unknown.percent,null);
 }
 snapshots.references=refs;snapshots.recordedReplay=replay;
 for(const sample of data.samples)for(const point of sample.landmarks.filter(p=>[15,16,27,28].includes(p.index)&&refModule.visible(p))){const c=manifest.displayCrop;assert.ok(point.x>=c.x&&point.x<=c.x+c.width&&point.y>=c.y&&point.y<=c.y+c.height,'Teacher display crop must retain all recorded visible hand/foot points.');}
 add('Exactly three opening movements lie within source seconds 1–13; original 12 Hz samples, coordinates and statuses are preserved, with supported real endpoints and all three source self replays matching.');
 const aspect=data.width/data.height;
 function freeze(samples,index,start){return samples.map(sample=>{const body=runtime.getFourPointBodyFrame(sample,aspect);return{...sample,landmarks:sample.landmarks.map(p=>p.index===index?{...p,x:(start.x*body.scale+body.hip.x)/aspect,y:start.y*body.scale+body.hip.y}:p)};});}
 const footSamples=data.samples.filter(s=>s.tMs<5500),leftStart=refs[0].guides.find(g=>g.index===27).start,rightStart=refs[0].guides.find(g=>g.index===28).start;
 const footFrozen=freeze(footSamples,27,leftStart).map((sample,index)=>{const body=runtime.getFourPointBodyFrame(sample,aspect),sourceLeft=footSamples[index].landmarks.find(p=>p.index===27),delta={x:(sourceLeft.x*aspect-body.hip.x)/body.scale-leftStart.x,y:(sourceLeft.y-body.hip.y)/body.scale-leftStart.y};return{...sample,landmarks:sample.landmarks.map(p=>p.index===28?{...p,x:((rightStart.x+delta.x)*body.scale+body.hip.x)/aspect,y:(rightStart.y+delta.y)*body.scale+body.hip.y}:p)};});
 const wrongFoot=run(refs[0],footFrozen).result;assert.equal(wrongFoot.status,'mismatch');assert.equal(wrongFoot.limbs.find(l=>l.index===27).movementObserved,false);
 const armSamples=data.samples.filter(s=>s.tMs>=5500&&s.tMs<8500),oneHand=run(refs[1],freeze(armSamples,15,refs[1].guides.find(g=>g.index===15).start)).result;assert.equal(oneHand.status,'mismatch');
 const altered=structuredClone(data),start=refs[1].guides.find(g=>g.index===15).start;
 altered.samples=freeze(altered.samples,15,start);for(const sample of altered.samples)for(const p of sample.landmarks)p.visibility=1;
 const falseRaise=refModule.prepareFirstThreeReference(manifest.steps[1],altered);assert.equal(falseRaise.referenceUsable,false);assert.match(falseRaise.unknownReason,/raise needs source review/);
 snapshots.counterfactuals={provenance:'Deliberately altered copies of recorded observations, not real teachers/camera attempts.',wrongFoot,oneHand,falseHighVisibilityRaise:falseRaise};
 add('Labelled counterfactual controls cannot replace required left-foot motion with a fixed left foot, omit one raised hand, or turn a high-visibility invalid teacher raise into a usable target; stale data remains unknown.');
}

const cameraControl=`export function createFollowCamera(o){
let running=false,timer=null,key=null,started=0,last=null,count=0,starts=0,stops=0;let cache;
const state=()=>({phase:running?'running':'idle',running,starting:false,tracking:running?(last?'pose':'no_pose'):'off',hasSample:!!last,inferenceCount:count,streamStarts:starts,stoppedTracks:stops,overlayJoints:last?[15,16,27,28]:[],tracks:running?[{kind:'video',readyState:'live',deviceId:'qa-recorded-control'}]:[]});
const notify=()=>{o.statusElement.textContent='QA recorded landmark control, synthetic timing — not a live learner';o.onState(state());};
async function emit(){if(!running)return;const d=window.firstThreeDiagnostics;if(!d?.ready)return;cache??=Promise.all([fetch('/practice-media/first-three/manifest.json').then(r=>r.json()),fetch('/practice-media/first-three/opening.poses.json').then(r=>r.json())]);const[m,p]=await cache;if(!running)return;
const current=d.stepId+':'+d.round;if(key!==current){key=current;started=performance.now();}
if(window.qaMode==='unknown'){last=null;o.onObservation(null);notify();return;}const step=m.steps[d.index],fraction=window.qaMode==='baseline-only'?0:Math.min(1,Math.max(0,(performance.now()-started-250)/1000));
const t=(step.startSeconds+(step.endSeconds-step.startSeconds-.10)*fraction)*1000;const recorded=p.samples.reduce((a,b)=>Math.abs(b.tMs-t)<Math.abs(a.tMs-t)?b:a);const now=performance.now();last={...recorded,tMs:now};count++;o.onObservation({sample:last,observedAtMs:now,aspectRatio:p.width/p.height});notify();}
function start(){stop();running=true;starts++;notify();timer=setInterval(()=>void emit(),80);void emit();}function stop(){if(running)stops++;running=false;clearInterval(timer);last=null;o.onObservation(null);notify();}
o.startButton.addEventListener('click',start);o.stopButton.addEventListener('click',stop);o.deviceSelect.addEventListener('change',()=>{if(running)start();});const mirror=()=>{for(const e of[o.video,o.canvas])e.style.transform=o.mirrorCheckbox.checked?'scaleX(-1)':'none';};o.mirrorCheckbox.addEventListener('change',mirror);mirror();notify();return{start,stop,getState:state,refreshDevices:async()=>{},destroy:stop};}`;
async function pageFor(browser,{mode=null,viewport={width:1512,height:1100},denied=false,badSource=false}={}){
 const page=await browser.newPage({viewport});page.setDefaultTimeout(40000);page.on('pageerror',e=>pageErrors.push(e.message));page.on('response',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))remoteResponses.push(r.url());});
 await page.addInitScript(({mode,denied})=>{window.qaMode=mode;window.qaCaptureRequests=[];window.qaStreams=[];const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{window.qaCaptureRequests.push(c);if(denied)throw new DOMException('QA deliberate permission denial','NotAllowedError');const stream=await capture(c);window.qaStreams.push(stream);return stream;};},{mode,denied});
 if(mode)await page.route('**/follow-teacher-camera.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:cameraControl}));
 if(badSource)await page.route('**/practice-media/first-three/opening.poses.json',r=>{const p=structuredClone(data);for(const s of p.samples)if(s.tMs>=8500)for(const q of s.landmarks)if([15,16].includes(q.index))q.visibility=0;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(p)});});
 await page.goto(`${base}/first-three.html`);await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready);return page;
}
async function openSettings(page){await page.locator('#practice-settings').evaluate(el=>el.open=true);}
async function selectStep(page,index){await page.locator('#movement-details').evaluate(el=>el.open=true);await page.locator(`#step-list button[data-index="${index}"]`).click();await page.waitForFunction(i=>window.firstThreeDiagnostics.index===i,index);}
async function browserChecks(){const browser=await launch();let page;
 try{
  page=await pageFor(browser,{denied:true});let d=await diag(page);assert.equal(d.stepCount,3);assert.equal(d.phase,'countdown');assert.equal(d.speed,.5);assert.equal(d.referenceSampleRateHz,12);assert.equal(await page.evaluate(()=>window.qaCaptureRequests.length),0);
  assert.equal(await page.locator('video').count(),2);assert.equal(await page.locator('#back-video').count(),0);
  await page.click('#practice-toggle');const paused=await diag(page);await page.waitForTimeout(1100);d=await diag(page);assert.equal(d.paused,true);assert.equal(d.phase,'countdown');assert.ok(Math.abs(d.remainingMs-paused.remainingMs)<50);
  for(const viewport of[{width:1512,height:1100},{width:390,height:844}]){await page.setViewportSize(viewport);const g=await page.evaluate(()=>{const v=document.getElementById('teacher-video'),c=document.getElementById('teacher-overlay'),s=document.getElementById('teacher-pixels'),r=e=>{const b=e.getBoundingClientRect();return{left:b.left,top:b.top,width:b.width,height:b.height};};return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,video:r(v),canvas:r(c),videoParent:v.parentElement.id,canvasParent:c.parentElement.id,mirror:getComputedStyle(s).transform,raw:{width:v.videoWidth,height:v.videoHeight},points:window.firstThreeDiagnostics.teacherJoints};});assert.ok(g.scrollWidth<=g.width+1);assert.deepEqual(g.video,g.canvas);assert.equal(g.videoParent,'teacher-source');assert.equal(g.canvasParent,'teacher-source');assert.match(g.mirror,/^matrix\(-1,/);assert.deepEqual(g.raw,{width:450,height:360});assert.ok(g.points.length&&g.points.every(i=>[15,16,27,28].includes(i)));snapshots[viewport.width<500?'mobile':'desktop']=g;await label(page,'QA REAL 24.mp4 TEACHER RECORDING — NO PHYSICAL LEARNER ACCEPTANCE');await page.screenshot({path:path.join(out,viewport.width<500?'first-three-mobile-labelled.png':'first-three-desktop-labelled.png'),fullPage:true});}
  add('Independent single-view page defaults to mirrored four-point teacher, 0.5× and automatic 321 with no camera request; countdown pause and desktop/mobile layout preserve original pixel alignment.');
  await page.click('#start-practice');await page.waitForFunction(()=>window.firstThreeDiagnostics.camera.phase==='error');assert.equal(await page.evaluate(()=>window.qaCaptureRequests.length),1);assert.equal((await diag(page)).results.some(r=>r.status==='matched'),false);assert.match(await page.locator('#camera-status').textContent(),/permission/i);await page.click('#end-practice');await page.close();
  add('Explicit permission-denial control remains recoverable and never creates a matched movement.');
  page=await pageFor(browser,{mode:'source-motion'});await label(page,'QA ACTUAL RECORDED LANDMARKS + SYNTHETIC CAMERA CLOCK — NOT LIVE CAMERA OR A HUMAN LEARNER');await page.click('#start-practice');await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='finished',null,{timeout:60000});snapshots.recordedControlFinished=await diag(page);assert.equal(snapshots.recordedControlFinished.results.length,3);assert.ok(snapshots.recordedControlFinished.results.every(r=>r.status==='matched'));assert.equal(snapshots.recordedControlFinished.camera.running,false);assert.equal(snapshots.recordedControlFinished.active,false);await page.screenshot({path:path.join(out,'recorded-control-three-complete-labelled.png'),fullPage:true});await openSettings(page);assert.equal(await page.locator('#next').isDisabled(),true);await page.close();
  add('Actual archived landmark replay with labelled synthetic timing automatically completes exactly three matching movements, stops its camera and disables out-of-range Next.');
  page=await pageFor(browser,{mode:'baseline-only'});await openSettings(page);await page.selectOption('#speed','1');await selectStep(page,1);await page.click('#start-practice');await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='feedback');d=await diag(page);assert.equal(d.index,1);assert.equal(d.feedback.status,'mismatch');assert.ok(d.feedback.percent<100);assert.equal(d.results.some(r=>r.status==='matched'),false);snapshots.partial=d;await label(page,'QA BASELINE-ONLY RECORDED LANDMARK CONTROL — NO LIVE LEARNER');await page.screenshot({path:path.join(out,'partial-progress-labelled.png'),fullPage:true});const at=performance.now();await page.waitForTimeout(2100);assert.equal((await diag(page)).phase,'feedback');await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='demonstrating'&&window.firstThreeDiagnostics.round===2);assert.ok(performance.now()-at>=2750);assert.equal((await diag(page)).index,1);await page.evaluate(()=>window.qaMode='unknown');await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='feedback');d=await diag(page);assert.equal(d.feedback.status,'unknown');assert.equal(d.feedback.percent,null);assert.deepEqual(d.guideJoints,[]);assert.equal(d.results.some(r=>r.status==='matched'),false);snapshots.unknown=d;await page.click('#end-practice');await page.close();
  add('Incomplete movement shows real estimated progress for three seconds then retries; missing learner observations show unknown without percentage, target guides or a pass.');
  page=await pageFor(browser,{mode:'unknown',badSource:true});await label(page,'QA DELIBERATELY MASKED SOURCE ENDPOINTS + UNKNOWN LEARNER CONTROL — NOT REAL SOURCE QUALITY');await openSettings(page);await page.selectOption('#speed','1');await selectStep(page,2);await page.click('#start-practice');assert.equal((await diag(page)).reference.referenceUsable,false);await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='finished',null,{timeout:50000});d=await diag(page);assert.equal(d.round,3);assert.ok(d.results.some(r=>r.stepId==='first-three-03'&&r.status==='unassessed'));assert.equal(d.results.some(r=>r.status==='matched'),false);snapshots.insufficientSource=d;await page.close();
  add('Explicit masked-reference control demonstrates three complete rounds, then finishes unassessed without inventing a match.');
  page=await pageFor(browser);await page.click('#end-practice');await openSettings(page);for(let i=0;i<3;i++)await page.click('#next');d=await diag(page);assert.equal(d.phase,'finished');assert.equal(d.results.length,3);assert.ok(d.results.every(r=>r.status==='manual'));assert.equal(await page.evaluate(()=>window.qaCaptureRequests.length),0);snapshots.manual=d;await page.close();
  add('All three movements remain manually learnable after End with the camera off, recording manual continuation separately from observed matches.');
  assert.deepEqual(pageErrors,[]);assert.deepEqual(remoteResponses,[]);
 }catch(error){snapshots.browserFailure=page?await diag(page).catch(()=>null):null;await page?.screenshot({path:path.join(out,'browser-failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();}}

function makeReplay(){const target=path.join(out,'qa-prerecorded-new24-opening-with-black.y4m');const source=path.join(root,'public',manifest.video.src);const code=`import av,sys,numpy as np\nsrc,dst=sys.argv[1:]\nframes=0\nwith av.open(src) as container, open(dst,'wb') as output:\n output.write(b'YUV4MPEG2 W450 H360 F10:1 Ip A1:1 C420jpeg\\n')\n for i,frame in enumerate(container.decode(video=0)):\n  if i%3: continue\n  output.write(b'FRAME\\n'); output.write(frame.to_ndarray(format='yuv420p').tobytes()); frames+=1\n blank=av.VideoFrame.from_ndarray(np.zeros((360,450,3),dtype=np.uint8),format='rgb24').to_ndarray(format='yuv420p').tobytes()\n for i in range(20): output.write(b'FRAME\\n');output.write(blank)\nprint(frames)\n`;const count=Number(execFileSync('python',['-c',code,source,target],{encoding:'utf8'}).trim());assert.ok(count>=120);return{target,frames:count,source};}
async function realCameraChecks(){const fixture=makeReplay();snapshots.cameraFixture={file:path.basename(fixture.target),sha256:await sha(fixture.target),sourceClip:manifest.video.src,sourceSha256:manifest.video.sha256,originalFrames:fixture.frames,generatedBlackFrames:20,fps:10,provenance:'Explicit prerecorded new24 opening replay plus generated black frames. Genuine local MediaPipe; not a physical learner.'};const browser=await launch(['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${fixture.target}`]);let page;
 try{page=await pageFor(browser);await label(page,'QA NEW 24.mp4 OPENING CAMERA REPLAY + GENUINE LOCAL MEDIAPIPE — NOT A LIVE LEARNER');await page.click('#start-practice');await page.waitForFunction(()=>window.firstThreeDiagnostics.camera.inferenceCount>=2&&window.firstThreeDiagnostics.camera.hasSample);await page.click('#practice-toggle');let d=await diag(page);assert.equal(d.paused,true);assert.ok(d.camera.overlayJoints.length&&d.camera.overlayJoints.every(i=>[15,16,27,28].includes(i)));snapshots.realFirst=d;await page.screenshot({path:path.join(out,'genuine-mediapipe-four-points-labelled.png'),fullPage:true});
  const raw=await page.locator('#camera-video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight}));assert.deepEqual(raw,{width:450,height:360});
  await page.waitForFunction(()=>window.firstThreeDiagnostics.camera.tracking==='no_pose');d=await diag(page);assert.equal(d.camera.hasSample,false);assert.deepEqual(d.camera.overlayJoints,[]);assert.deepEqual(d.guideJoints,[]);snapshots.realNoPose=d;
  add('Genuine local MediaPipe receives raw new24 opening frames and preserves four anatomical indices; generated black frames clear actual tracking and guide pixels.');
  await page.click('#practice-toggle');await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='finished',null,{timeout:150000});d=await diag(page);snapshots.realFinished=d;assert.equal(d.results.length,3);assert.ok(d.results.every(r=>r.status==='matched'));assert.equal(d.camera.running,false);assert.equal(d.camera.hasSample,false);assert.ok(await page.evaluate(()=>window.qaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));await page.screenshot({path:path.join(out,'genuine-mediapipe-three-complete-labelled.png'),fullPage:true});assert.deepEqual(pageErrors,[]);assert.deepEqual(remoteResponses,[]);
  add('Genuine MediaPipe prerecorded-new24 camera replay completes all three same-side movements and releases every actual replay stream; this is software replay, not human acceptance.');
 }catch(error){snapshots.realFailure=page?await diag(page).catch(()=>null):null;await page?.screenshot({path:path.join(out,'real-mediapipe-failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();}}

if(process.argv.includes('--summary')){
 const reports=[];for(const file of['reference-qa.json','browser-qa.json','real-mediapipe-qa.json']){const report=JSON.parse(await readFile(path.join(out,file)));assert.equal(report.result,'PASS',file);reports.push({file,result:report.result,checkedAt:report.checkedAt,checks:report.checks,sha256:await sha(path.join(out,file))});}
 const camera=JSON.parse(await readFile(path.join(out,'real-mediapipe-qa.json'))),protectedReport=JSON.parse(await readFile(path.join(out,'protected-after.json'))),preparation=JSON.parse(await readFile(path.join(out,'source-preparation.json')));
 const implementation=[];for(const file of['public/first-three.html','public/first-three.js','public/first-three-reference.js','scripts/prepare-first-three.py','scripts/check-first-three.mjs'])implementation.push({path:file,sha256:await sha(path.join(root,file))});
 const assets=[];for(const file of preparation.files){const actual=await sha(path.join(root,'public',file.src));assert.equal(actual,file.sha256,file.src);assets.push({path:`public${file.src}`,sha256:actual,bytes:file.bytes});}
 const summary={result:'PASS',checkedAt:new Date().toISOString(),provenance:'Software QA only. Genuine local MediaPipe runs on explicitly prerecorded new24 opening input; separate labelled landmark-control fixtures test orchestration. No prerecorded input is represented as a physical learner.',checks:[...new Set(reports.flatMap(r=>r.checks))],reports,implementation,assets,
  preservation:{result:'PASS',oldFiles:protectedReport.files.length,originalInputs:protectedReport.originals.length,pinnedModelAssets:protectedReport.pinnedModelAssets.length,report:'protected-after.json'},
  teaching:{sourceFile:'D:/MotionTrial/24.mp4',sourceSha256:manifest.source.sha256,steps:manifest.steps.map(s=>({id:s.id,title:s.title,sourceStartSeconds:s.sourceStartSeconds,sourceEndSeconds:s.sourceEndSeconds,focusJoints:s.focusJoints})),originalSampleCount:data.samples.length,sampleRateHz:data.sampleRateHz,interpolatedSamples:0,oldSourceObservationChanged:false},
  genuineMediaPipe:{result:'PASS',inferenceCount:camera.snapshots.realFinished.camera.inferenceCount,observedMatchedMovements:camera.snapshots.realFinished.results.filter(r=>r.status==='matched').length,totalMovements:3,rawCameraSize:{width:camera.snapshots.realFirst.camera.videoWidth,height:camera.snapshots.realFirst.camera.videoHeight},blackFramesProducedActualNoPose:camera.snapshots.realNoPose.camera.tracking==='no_pose',cameraStopped:!camera.snapshots.realFinished.camera.running,fixture:camera.snapshots.cameraFixture},
  physicalHumanAcceptance:'NOT PERFORMED',remainingAcceptance:['A physical learner, including deliberately wrong left/right movement and omitted hands.','Camera distance, physical permission prompts, actual device switching and mobile hardware.','Different bodies, clothing, lighting and practical tolerance of the four-point game; it does not assess full Tai Chi technique.']};
 await writeFile(path.join(out,'verification-summary.json'),JSON.stringify(summary,null,2));console.log(`PASS: ${summary.checks.length} unique QA groups, three passing reports, ${summary.genuineMediaPipe.observedMatchedMovements}/3 genuine-MediaPipe replay matches, ${summary.genuineMediaPipe.inferenceCount} actual inferences and final SHA bindings.`);process.exit(0);
}
let result='PASS',failure=null;
try{if(!process.argv.includes('--camera')&&!process.argv.includes('--browser')){await preservation();if(!process.argv.includes('--preserve'))await referenceChecks();}if(!process.argv.includes('--static')&&!process.argv.includes('--preserve')){if(!process.argv.includes('--camera'))await browserChecks();if(!process.argv.includes('--browser'))await realCameraChecks();}}catch(error){result='FAIL';failure=error.stack||error.message;console.error(failure);process.exitCode=1;}
const reportFile=process.argv.includes('--preserve')?'preservation-qa.json':process.argv.includes('--static')?'reference-qa.json':process.argv.includes('--camera')?'real-mediapipe-qa.json':process.argv.includes('--browser')?'browser-qa.json':'verification-summary.json';
await writeFile(path.join(out,reportFile),JSON.stringify({result,checkedAt:new Date().toISOString(),provenance:'Software QA only. Real source landmark replay with a labelled synthetic control clock is separate from genuine local MediaPipe inference on explicitly prerecorded new24 video. Neither is physical learner acceptance.',checks,snapshots,pageErrors,remoteResponses,failure,physicalHumanAcceptance:'NOT PERFORMED'},null,2));
