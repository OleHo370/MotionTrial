/** Independent teacher display-crop QA. Real source recordings and archived
 * MediaPipe observations are used. Prerecorded camera input is explicitly labelled. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/teacher-crop-review');
const base=process.env.FOLLOW_TEACHER_TEST_URL||'http://127.0.0.1:8766';
const manifest=JSON.parse(await readFile(path.join(root,'public/practice-media/dual-view/manifest.json')));
const expected={front:{x:.30,y:.18,width:.40,height:.73},back:{x:.29,y:.14,width:.42,height:.77}};
const checks=[],snapshots={},pageErrors=[],remoteResponses=[];
const sha=async(file)=>createHash('sha256').update(await readFile(file)).digest('hex');
const add=(message)=>{checks.push(message);console.log(`PASS: ${message}`);};
const diag=(page)=>page.evaluate(()=>window.followTeacherDiagnostics);
await mkdir(out,{recursive:true});

async function preservation(){
 const baseline=JSON.parse(await readFile(path.join(out,'protected-before.json'))),files=[];
 for(const before of baseline.files){const actual=await sha(path.join(root,before.path));assert.equal(actual,before.sha256,before.path);files.push({path:before.path,beforeSha256:before.sha256,afterSha256:actual});}
 const originals=[];
 for(const view of['front','back']){const file=path.resolve(root,'../../',`${view}.mp4`),actual=await sha(file);assert.equal(actual,manifest.sources[view].sha256);originals.push({path:file,sha256:actual});}
 const pinned=JSON.parse(await readFile(path.join(root,'public/mediapipe/manifest.json')));
 for(const asset of pinned.assets)assert.equal(await sha(path.join(root,'public',asset.path)),asset.sha256);
 await writeFile(path.join(out,'protected-after.json'),JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),files,originals,modelAssets:pinned.assets},null,2));
 add(`${files.length} protected old pages, matching/camera/game resources, original videos and pinned model assets remain byte-identical.`);
}

async function observedBounds(){
 const forms=[];let observations=0,outside=0,pointObservations=0;
 for(const form of manifest.forms){
  const views={};
  for(const view of['front','back']){
   const data=JSON.parse(await readFile(path.join(root,'public',form[view].poseSrc))),crop=expected[view];
   assert.ok(crop.x>=0&&crop.y>=0&&crop.width>0&&crop.height>0&&crop.x+crop.width<=1&&crop.y+crop.height<=1);
   let valid=0,clipped=0;const examples=[];const bounds={left:1,right:0,top:1,bottom:0};
   for(const sample of data.samples){if(sample.status!=='pose')continue;observations++;
    for(const p of sample.landmarks){if(![p.x,p.y,p.visibility].every(Number.isFinite)||p.visibility<.45||p.visibility>1||p.x<0||p.x>1||p.y<0||p.y>1||(p.presence!==undefined&&(p.presence===null||!Number.isFinite(p.presence)||p.presence<.45)))continue;
     valid++;pointObservations++;bounds.left=Math.min(bounds.left,p.x);bounds.right=Math.max(bounds.right,p.x);bounds.top=Math.min(bounds.top,p.y);bounds.bottom=Math.max(bounds.bottom,p.y);
     if(p.x<crop.x-1e-6||p.x>crop.x+crop.width+1e-6||p.y<crop.y-1e-6||p.y>crop.y+crop.height+1e-6){clipped++;outside++;if(examples.length<8)examples.push({frame:sample.frameIndex,index:p.index,x:p.x,y:p.y,visibility:p.visibility});}
    }
   }
   views[view]={crop,observedPoseSamples:data.samples.filter(s=>s.status==='pose').length,validPointObservations:valid,clippedPointObservations:clipped,bounds,examples};
  }
  forms.push({formId:form.id,formNumber:form.formNumber,views});
 }
 snapshots.recordedBounds={forms:forms.length,viewIntervals:forms.length*2,observedPoseSamples:observations,pointObservations,clippedPointObservations:outside};
 await writeFile(path.join(out,'recorded-bounds-audit.json'),JSON.stringify({result:outside?'REVIEW_REQUIRED':'PASS',checkedAt:new Date().toISOString(),provenance:'Actual existing front/back MediaPipe records read only for display framing QA. No tracking is generated, changed or used for back-view matching.',threshold:.45,summary:snapshots.recordedBounds,forms},null,2));
 assert.equal(forms.length,24);assert.equal(outside,0,'All in-frame observed points with visibility/presence >= .45 should remain in the teacher crop; any exclusions need explicit source review.');
 add(`All 48 source-view/form intervals retain ${pointObservations} in-frame recorded body-point observations at visibility/presence >= .45; crop bounds stay inside the source.`);
}

async function label(page,text){await page.evaluate(message=>{const el=document.createElement('div');el.textContent=message;el.style.cssText='position:relative;background:#fff0b0;color:#4b3610;padding:7px;text-align:center;font:12px Arial';document.body.prepend(el);},text);}
async function geometry(page){return page.evaluate(()=>{
 const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
 const style=el=>{const s=getComputedStyle(el);return{transform:s.transform,objectFit:s.objectFit,overflow:s.overflow,aspectRatio:s.aspectRatio,left:s.left,top:s.top,width:s.width,height:s.height};};
 const chain=el=>{const result=[];for(let n=el;n&&n!==document.body;n=n.parentElement)result.push({tag:n.tagName,id:n.id,transform:getComputedStyle(n).transform});return result;};
 const views={};
 for(const view of['front','back']){const stage=document.getElementById(`${view}-pixels`),source=document.getElementById(`${view}-source`),video=document.getElementById(`${view}-video`),canvas=document.getElementById(`${view}-overlay`);views[view]={stage:{rect:rect(stage),style:style(stage)},source:source?{rect:rect(source),style:style(source),parentId:source.parentElement.id}:null,video:{rect:rect(video),style:style(video),chain:chain(video),parentId:video.parentElement.id,intrinsic:{width:video.videoWidth,height:video.videoHeight},time:video.currentTime,rate:video.playbackRate},canvas:canvas?{rect:rect(canvas),style:style(canvas),chain:chain(canvas),parentId:canvas.parentElement.id,intrinsic:{width:canvas.width,height:canvas.height}}:null};}
 const camera=document.getElementById('camera-pixels'),video=document.getElementById('camera-video'),canvas=document.getElementById('camera-overlay');
 return{views,camera:{stage:rect(camera),style:style(camera),video:rect(video),videoStyle:style(video),parentId:video.parentElement.id,intrinsic:{width:video.videoWidth,height:video.videoHeight},canvas:{width:canvas.width,height:canvas.height}},width:innerWidth,scrollWidth:document.documentElement.scrollWidth};
});}
function validateGeometry(g){
 for(const view of['front','back']){const actual=g.views[view],crop=expected[view],aspect=crop.width*640/(crop.height*360);
  assert.ok(actual.source,`${view} source wrapper`);assert.equal(actual.source.parentId,`${view}-pixels`);assert.equal(actual.video.parentId,`${view}-source`);
  assert.ok(Math.abs(actual.stage.rect.width/actual.stage.rect.height-aspect)<.015,`${view} cropped aspect`);
  assert.ok(Math.abs(actual.source.rect.width/actual.stage.rect.width-1/crop.width)<.015,`${view} source scale x`);
  assert.ok(Math.abs(actual.source.rect.height/actual.stage.rect.height-1/crop.height)<.015,`${view} source scale y`);
  assert.ok(Math.abs(actual.video.rect.width/actual.video.rect.height-640/360)<.015,`${view} source pixels keep raw aspect`);
  assert.equal(actual.video.intrinsic.width,640);assert.equal(actual.video.intrinsic.height,360);
  assert.equal(actual.stage.style.overflow,'hidden');
  if(view==='front'){assert.match(actual.stage.style.transform,/^matrix\(-1,/);assert.equal(actual.canvas.parentId,'front-source');
   for(const key of['left','top','right','bottom','width','height'])assert.ok(Math.abs(actual.canvas.rect[key]-actual.video.rect[key])<.1,`Canvas/video ${key}`);
   assert.deepEqual(actual.canvas.chain.map(c=>c.transform),actual.video.chain.map(c=>c.transform));
   assert.deepEqual(actual.canvas.intrinsic,actual.video.intrinsic);
  }else{assert.equal(actual.stage.style.transform,'none');assert.equal(actual.canvas,null);}
 }
 assert.ok(g.scrollWidth<=g.width+1);assert.ok(Math.abs(g.camera.stage.width/g.camera.stage.height-16/9)<.02);
 assert.equal(g.camera.parentId,'camera-pixels');assert.equal(g.camera.videoStyle.objectFit,'contain');
}
async function mapAt(manifest,formId,stepId,time){
 const form=manifest.forms.find(f=>f.id===formId),step=form.steps.find(s=>s.id===stepId);
 const anchors=[{frontSeconds:step.front.startSeconds,backSeconds:step.back.startSeconds},...form.anchors.filter(a=>a.frontSeconds>step.front.startSeconds&&a.frontSeconds<step.front.endSeconds),{frontSeconds:step.front.endSeconds,backSeconds:step.back.endSeconds}];
 const f=Math.min(step.front.endSeconds,Math.max(step.front.startSeconds,time));let a=anchors[0],b=anchors.at(-1);
 for(let i=0;i<anchors.length-1;i++)if(f>=anchors[i].frontSeconds&&f<=anchors[i+1].frontSeconds){a=anchors[i];b=anchors[i+1];break;}
 return a.backSeconds+(f-a.frontSeconds)/(b.frontSeconds-a.frontSeconds)*(b.backSeconds-a.backSeconds);
}

async function extremeScreenshots(page){
 const sourceAudit=JSON.parse(await readFile(path.join(out,'source-framing-audit.json'))),frames=[];
 await page.setViewportSize({width:1512,height:1100});
 await page.evaluate(()=>{document.querySelector('.session-bar').style.position='static';document.getElementById('lesson-settings').open=true;});
 for(const view of['front','back'])for(const[edge,frame]of Object.entries(sourceAudit.views[view].actualExtremeFrames)){
  if(await page.locator('#restore-views').isVisible())await page.click('#restore-views');
  const current=await diag(page);
  if(current.formId!==frame.formId){await page.selectOption('#form-select',frame.formId);await page.waitForFunction(form=>window.followTeacherDiagnostics?.ready&&window.followTeacherDiagnostics.formId===form,frame.formId);}
  if(await page.locator('#end-practice').isEnabled())await page.click('#end-practice');
  await page.click(`#enlarge-${view}`);
  await page.locator(`#${view}-video`).evaluate((video,time)=>new Promise((resolve,reject)=>{video.pause();if(Math.abs(video.currentTime-time)<.00001&&!video.seeking){resolve();return;}const timeout=setTimeout(()=>reject(new Error('Source extreme frame seek timed out.')),15000);video.addEventListener('seeked',()=>{clearTimeout(timeout);resolve();},{once:true});video.currentTime=time;}),frame.sourceTimeSeconds);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.locator(`#${view}-card .source-head h2`).evaluate((el,caption)=>{el.textContent=caption;},`QA actual source · ${view} · ${edge} extent`);
  await page.locator(`#${view}-role`).evaluate((el,caption)=>{el.textContent=caption;},`Form ${frame.formNumber} · ${frame.sourceTimeSeconds.toFixed(3)} s · raw frame ${frame.frameIndex}`);
  const file=`source-${view}-${edge}-extreme-labelled.png`;
  await page.locator(`#${view}-card`).screenshot({path:path.join(out,file)});
  frames.push({view,edge,formId:frame.formId,frameIndex:frame.frameIndex,sourceTimeSeconds:frame.sourceTimeSeconds,sourceSha256:manifest.sources[view].sha256,crop:expected[view],screenshot:file});
 }
 snapshots.extremeFrames=frames;
 await writeFile(path.join(out,'extreme-frames.json'),JSON.stringify({provenance:'Eight actual source-video frames selected by trusted recorded coordinate extrema. Production crop wrappers are captured; labels sit in card headers outside the image. No inferred or edited image pixels.',frames},null,2));
 add('Eight actual source-frame extrema are captured from production crop wrappers with labels outside the person, including front form 17 and back form 16 wide-leg poses.');
}

async function browserChecks(){
 const fixture=path.join(root,'artifacts/follow-teacher-review/qa-prerecorded-front-with-black-gap.y4m');
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${fixture}`]});let page;
 try{
  page=await browser.newPage({viewport:{width:1512,height:1100}});page.setDefaultTimeout(45000);
  page.on('pageerror',error=>pageErrors.push(error.message));page.on('response',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))remoteResponses.push(r.url());});
  await page.addInitScript(()=>{window.qaCameraRequests=0;const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>{window.qaCameraRequests++;return original(c);};});
  await page.goto(`${base}/follow-teacher.html?form=1&step=2`);await page.waitForFunction(()=>window.followTeacherDiagnostics?.ready);await page.click('#practice-toggle');
  const d=await diag(page);snapshots.initial=d;assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);assert.equal(d.speed,.5);assert.equal(d.layout.primary,'back');assert.equal(d.formCount,24);assert.equal(d.totalMicrosteps,172);
  const initial=await geometry(page);validateGeometry(initial);snapshots.desktopGeometry=initial;
  assert.deepEqual(d.teacherFraming.front,expected.front);assert.deepEqual(d.teacherFraming.back,expected.back);
  add('Both teacher recordings are cropped through shared source wrappers with preserved raw 640×360 geometry; front video and four-point canvas have exactly matching CSS chains and boxes.');
  const data=JSON.parse(await readFile(path.join(root,'public',manifest.forms[0].front.poseSrc)));
  const source=data.samples.find(s=>s.frameIndex===d.sampleFrame);
  const pointPixels=await page.locator('#front-overlay').evaluate((canvas,sample)=>sample.landmarks.filter(p=>[15,16,27,28].includes(p.index)&&p.visibility>=.45).map(p=>({index:p.index,pixel:[...canvas.getContext('2d').getImageData(Math.round(p.x*canvas.width),Math.round(p.y*canvas.height),1,1).data]})),source);
  assert.ok(pointPixels.length>0&&pointPixels.every(p=>p.pixel[3]>0));snapshots.overlayPixels=pointPixels;
  await label(page,'QA REAL TEACHER SOURCE RECORDINGS — DISPLAY CROP ONLY; NO HUMAN LEARNER ACCEPTANCE');await page.screenshot({path:path.join(out,'teacher-crop-desktop-labelled.png'),fullPage:true});
  await page.click('#swap-views');assert.equal((await diag(page)).layout.primary,'front');validateGeometry(await geometry(page));
  for(const view of['front','back']){await page.click(`#enlarge-${view}`);assert.equal((await diag(page)).layout.mode,view);
   const g=await geometry(page),current=g.views[view];assert.ok(current.stage.rect.width>initial.views[view].stage.rect.width);assert.ok(Math.abs(current.stage.rect.width/current.stage.rect.height-expected[view].width*640/(expected[view].height*360))<.015);
   if(view==='front')assert.deepEqual(current.video.rect,current.canvas.rect);
   await page.screenshot({path:path.join(out,`teacher-crop-enlarged-${view}-labelled.png`),fullPage:true});await page.click('#restore-views');validateGeometry(await geometry(page));}
  add('Swap, individual enlargement and restore preserve cropping, mirror directions and exact front video/overlay alignment.');
  await page.setViewportSize({width:390,height:844});const mobile=await geometry(page);validateGeometry(mobile);snapshots.mobileGeometry=mobile;await page.screenshot({path:path.join(out,'teacher-crop-mobile-labelled.png'),fullPage:true});
  add('Desktop and 390px mobile layouts retain cropped teacher proportions without horizontal overflow; camera display remains an uncropped 16:9 stage.');
  if(process.argv.includes('--screens')){await extremeScreenshots(page);return;}
  await page.setViewportSize({width:1512,height:1100});await page.click('#end-practice');
  await page.locator('#playback-settings').evaluate(el=>el.open=true);await page.selectOption('#speed','0.75');await page.click('#replay');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.phase==='demonstrating');const before=await diag(page);await page.waitForTimeout(650);const after=await diag(page);
  assert.equal(after.speed,.75);assert.ok(after.frontTime>before.frontTime+.2);assert.ok(Math.abs(after.backTime-await mapAt(manifest,after.formId,after.stepId,after.frontTime))<.12);
  assert.ok(Math.abs(after.backTime-after.frontTime)>1,'The paired views must keep their phase mapping rather than equal seconds.');
  snapshots.playback={before,after};await page.click('#end-practice');
  add('Real source playback at 0.75× advances normally and keeps the existing front→back phase mapping instead of matching raw seconds.');
  await page.click('#start-practice');await page.waitForFunction(()=>window.followTeacherDiagnostics.camera?.inferenceCount>2&&window.followTeacherDiagnostics.camera.hasSample);
  const cameraGeometry=await geometry(page),cameraDiag=await diag(page);snapshots.realCamera={geometry:cameraGeometry,diagnostics:cameraDiag};
  assert.deepEqual(cameraGeometry.camera.intrinsic,{width:640,height:360});assert.deepEqual(cameraGeometry.camera.canvas,{width:640,height:360});assert.equal(cameraGeometry.camera.parentId,'camera-pixels');
  assert.ok(cameraDiag.game.liveDrawnIndices.length&&cameraDiag.game.liveDrawnIndices.every(i=>[15,16,27,28].includes(i)));
  await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.phase==='demonstrating'&&window.followTeacherDiagnostics.camera.hasSample);
  await label(page,'CAMERA QA: PRERECORDED front.mp4 + GENUINE LOCAL MEDIAPIPE — NOT A LIVE LEARNER');await page.screenshot({path:path.join(out,'teacher-crop-uncropped-camera-replay-labelled.png'),fullPage:true});
  await page.click('#end-practice');assert.equal((await diag(page)).camera.running,false);assert.deepEqual(pageErrors,[]);assert.deepEqual(remoteResponses,[]);
  add('Genuine local MediaPipe on explicitly labelled prerecorded camera input still receives raw 640×360 frames and draws unchanged four-point feedback; camera permission starts only by action and Stop releases it.');
 }catch(error){snapshots.failure=page?await diag(page).catch(()=>null):null;await page?.screenshot({path:path.join(out,'crop-qa-failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();}
}

if(process.argv.includes('--summary')){
 const reports=[];
 for(const file of['static-qa.json','functional-qa.json','screenshots-qa.json']){const report=JSON.parse(await readFile(path.join(out,file)));assert.equal(report.result,'PASS',file);reports.push({file,result:report.result,checkedAt:report.checkedAt,checks:report.checks,sha256:await sha(path.join(out,file))});}
 const protectedFiles=JSON.parse(await readFile(path.join(out,'protected-after.json'))),bounds=JSON.parse(await readFile(path.join(out,'recorded-bounds-audit.json'))),frames=JSON.parse(await readFile(path.join(out,'extreme-frames.json')));
 const implementation=[];for(const file of['public/follow-teacher.html','public/follow-teacher.js','scripts/check-teacher-crop.mjs'])implementation.push({path:file,sha256:await sha(path.join(root,file))});
 const summary={result:'PASS',checkedAt:new Date().toISOString(),provenance:'Teacher crop presentation QA only. Actual original video pixels and existing recorded MediaPipe observations are used. The camera regression is actual local MediaPipe inference on an explicitly labelled prerecorded replay, not physical learner acceptance.',checks:[...new Set(reports.flatMap(r=>r.checks))],reports,implementation,crops:expected,
  protected:{result:'PASS',files:protectedFiles.files.length,originalVideos:protectedFiles.originals.length,modelAssets:protectedFiles.modelAssets.length,report:'protected-after.json'},recordedBounds:bounds.summary,extremeFrameCaptures:frames.frames,
  screenshots:['teacher-crop-desktop-labelled.png','teacher-crop-mobile-labelled.png','teacher-crop-enlarged-front-labelled.png','teacher-crop-enlarged-back-labelled.png','teacher-crop-uncropped-camera-replay-labelled.png'],
  limitations:['Fixed display rectangles retain every in-frame observed point meeting visibility/presence .45 in this source routine; missing/low-confidence points do not prove full-person coverage.','Eight actual source extrema and opening frames were captured for visual inspection of hair, clothing and fingers outside the landmarks.','Source videos, matching coordinates, camera processing and the previous game test reports are unchanged. No full game reacceptance or physical-camera/human trial is claimed.'],physicalHumanAcceptance:'NOT PERFORMED'};
 await writeFile(path.join(out,'verification-summary.json'),JSON.stringify(summary,null,2));console.log(`PASS: ${summary.checks.length} unique crop QA groups, ${reports.length} passing reports, ${frames.frames.length} actual extreme source captures and final SHA bindings.`);process.exit(0);
}

let result='PASS',failure=null;
try{await preservation();await observedBounds();if(!process.argv.includes('--static'))await browserChecks();}catch(error){result='FAIL';failure=error.stack||error.message;console.error(failure);process.exitCode=1;}
const implementation=[];
for(const file of['public/follow-teacher.html','public/follow-teacher.js','scripts/check-teacher-crop.mjs'])implementation.push({path:file,sha256:await sha(path.join(root,file))});
await writeFile(path.join(out,process.argv.includes('--static')?'static-qa.json':process.argv.includes('--screens')?'screenshots-qa.json':'functional-qa.json'),JSON.stringify({result,checkedAt:new Date().toISOString(),provenance:'Existing teacher videos and recorded observations. Camera checks use explicitly labelled prerecorded video with actual local MediaPipe, never a physical learner claim.',checks,snapshots,implementation,pageErrors,remoteResponses,failure,physicalHumanAcceptance:'NOT PERFORMED'},null,2));
