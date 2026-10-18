/** Real local video decode/MediaPipe + UI integration. No physical camera,
 * Arduino, speech or paid Factory requests. AI replies are explicit fixtures. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createDualViewServer} from './serve-dual-view.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/instructor-upload-review');await mkdir(out,{recursive:true});
const relay={async handle(req,res){if(!req.url.startsWith('/api/arduino'))return false;res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({connected:false,configured:false,state:'idle',message:'QA hardware disconnected'}));return true;},async close(){}};
const server=createDualViewServer({relay,feedback:null});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const base=`http://127.0.0.1:${server.address().port}`;
const checks=[],errors=[],requests=[];let browser,report={passed:false};
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.qaCameraRequests=0;
    navigator.mediaDevices.getUserMedia=async()=>{window.qaCameraRequests++;throw new Error('Physical cameras are blocked in upload QA.');};
  });
  await page.route('**/api/practice-feedback**',async route=>{
    const req=route.request(),body=req.postDataJSON();
    requests.push({path:new URL(req.url()).pathname,body});
    await route.fulfill({json:{configured:true,ready:true,provider:'factory',source:'local',...body}});
  });
  await page.route('**/api/practice-summary',async route=>{
    const body=route.request().postDataJSON();requests.push({path:'/api/practice-summary',body});
    await route.fulfill({json:{source:'factory',sessionId:body.sessionId,messages:[
      'You continued this step manually. This transition was not verified as a matching movement.',
      'No measured learner attempts were recorded. Keep your hands and feet visible when practising.',
      'Next time, start live practice and follow your uploaded instructor to each ending target.'
    ]}});
  });
  await page.goto(`${base}/first-three.html?step=1`);
  await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready&&!window.firstThreeDiagnostics.loading);
  assert.equal((await page.evaluate(()=>window.firstThreeDiagnostics)).stepCount,5);
  await page.locator('#visibility-settings').click();
  await page.locator('#spoken-feedback').uncheck();
  await page.locator('#visibility-settings').click();
  await page.locator('#upload-instructor').click();
  await page.locator('#instructor-video-file').setInputFiles({name:'not-video.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});
  await page.waitForFunction(()=>!document.getElementById('instructor-upload-error').hidden);
  assert.match(await page.locator('#instructor-upload-error').textContent(),/video/i);
  checks.push('Invalid files are rejected with a recoverable message before pose analysis.');
  console.log('PASS: file validation and initial lesson.');
  await page.locator('#instructor-video-file').setInputFiles(path.join(root,'public/practice-media/recut-six/step-03.mp4'));
  await page.waitForFunction(()=>!document.getElementById('instructor-upload-editor').hidden&&window.instructorUploadDiagnostics.duration>0);
  await page.locator('#instructor-upload-count').selectOption('1');
  await page.locator('[data-field="title"]').fill('My uploaded arm movement');
  await page.locator('#instructor-upload-analyze').click();
  console.log('Analyzing actual uploaded instructor clip with MediaPipe.');
  await page.waitForFunction(()=>!window.instructorUploadDiagnostics.busy&&window.instructorUploadDiagnostics.sampleCount>0,{},{timeout:180000});
  const prepared=await page.evaluate(()=>({state:window.instructorUploadDiagnostics,error:document.getElementById('instructor-upload-error').textContent,quality:document.getElementById('instructor-upload-quality').textContent}));
  assert.equal(prepared.error,'');assert.equal(prepared.state.prepared,true,prepared.quality);
  assert.ok(prepared.state.sampleCount>20);assert.match(prepared.quality,/ready for live practice/);
  checks.push('An actual uploaded MP4 is decoded and processed by the real pinned local MediaPipe model.');
  console.log('PASS: real uploaded-video inference.');
  await page.screenshot({path:path.join(out,'upload-prepared-desktop.png')});
  await page.locator('#instructor-upload-use').click();
  await page.waitForFunction(()=>window.instructorUploadDiagnostics.lessonKind==='uploaded'&&!window.firstThreeDiagnostics.loading);
  let d=await page.evaluate(()=>window.firstThreeDiagnostics);
  assert.equal(d.stepCount,1);assert.equal(d.selection.title,'My uploaded arm movement');assert.ok(d.teacherVideo.src.startsWith('blob:'));
  assert.equal(d.camera.running,false);assert.ok(d.references[0].uploaded);assert.ok(d.references[0].framingCalibration);
  assert.equal(await page.locator('#toggle-teacher-3d').isVisible(),true);
  await page.locator('#toggle-teacher-3d').click();
  await page.waitForFunction(()=>window.lesson3DDiagnostics?.ready||window.lesson3DDiagnostics?.error);
  const uploaded3D=await page.evaluate(()=>window.lesson3DDiagnostics);
  assert.equal(uploaded3D.error,null);assert.ok(uploaded3D.ready);assert.ok(uploaded3D.drawnPoints>0);
  assert.equal(uploaded3D.poseSrc,null);assert.match(uploaded3D.provenance,/uploaded instructor video/);
  await page.locator('#close-teacher-3d').click();
  checks.push('The uploaded instructor has a synchronized 3D skeleton from its own genuine in-memory world observations.');
  const layout=await page.evaluate(async()=>{
    const {createFullHeightLayout}=await import('/full-height-layout.js');
    const d=window.startPositionDiagnostics;return createFullHeightLayout(d.guidanceReferences[0],d.guidanceReferences,4/3,window.movementPathDiagnostics.pathReferences);
  });
  assert.equal(layout.calibration.source,'uploaded-instructor');
  checks.push('The same lesson controller installs the uploaded video, targets and source-specific framing with the camera off.');
  await page.locator('#visibility-settings').click();await page.locator('#speed').selectOption('1');
  await page.locator('#replay').click();
  await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='watching');
  await page.waitForFunction(()=>window.firstThreeDiagnostics.teacherTime>window.firstThreeDiagnostics.selection.practiceStartSeconds+.2);
  assert.ok((await page.evaluate(()=>window.firstThreeDiagnostics)).teacherJoints.length>0);
  await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='positioning'&&!window.firstThreeDiagnostics.active,{},{timeout:20000});
  checks.push('Watch demo replays the actual uploaded instructor with genuine pose overlays and no camera access.');
  await page.locator('#next').click();
  await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='finished'&&!window.sessionSummaryDiagnostics.pendingAi);
  const summaryRequest=requests.find(request=>request.path==='/api/practice-summary');
  assert.equal(summaryRequest.body.lessonStepCount,1);assert.equal(summaryRequest.body.attempts.length,0);
  assert.equal(summaryRequest.body.results[0].status,'manual');
  assert.equal(await page.locator('#summary-matched').textContent(),'0 / 1');
  assert.match(await page.locator('#summary-sections').textContent(),/not verified/);
  assert.equal((await page.evaluate(()=>window.sessionSummaryDiagnostics)).summary.source,'factory');
  assert.doesNotMatch(JSON.stringify(summaryRequest.body),/landmarks|video\/|base64|blob:/);
  checks.push('Custom step counts reach the existing Factory summary client, manual navigation stays unverified and source media is excluded.');
  await page.locator('#visibility-settings').click();
  await page.screenshot({path:path.join(out,'uploaded-summary-desktop.png')});
  await page.locator('#upload-instructor').click();await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('#instructor-upload-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.screenshot({path:path.join(out,'upload-mobile.png')});
  await page.locator('#instructor-upload-restore').click();
  await page.waitForFunction(()=>window.instructorUploadDiagnostics.lessonKind==='built-in'&&!window.firstThreeDiagnostics.loading);
  d=await page.evaluate(()=>window.firstThreeDiagnostics);assert.equal(d.stepCount,5);assert.equal(d.index,0);
  assert.ok(!d.teacherVideo.src.startsWith('blob:'));assert.equal(await page.locator('#toggle-teacher-3d').isVisible(),true);
  assert.equal(await page.locator('#instructor-video-file').inputValue(),'');
  checks.push('Mobile upload controls fit, and restoring preserves the original five-step lesson and its optional 3D preview.');
  assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);assert.deepEqual(errors,[]);
  report={passed:true,checks,prepared,requests:requests.map(({path,body})=>({path,lessonStepCount:body?.lessonStepCount,attemptCount:body?.attempts?.length})),errors,
    provenance:'Actual uploaded instructor MP4 and local MediaPipe inference; Factory response explicitly mocked; physical camera, audio and USB unused.'};
}catch(error){report={passed:false,checks,errors,error:error.stack};console.error(error);process.exitCode=1;}
finally{await browser?.close();await server.shutdown();await writeFile(path.join(out,'browser-verification.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,checks:checks.length,evidence:out}));
