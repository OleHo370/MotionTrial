// Real model + original recorded video fixture. This is not a physical learner test.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/follow-teacher-review');
const base=process.env.FOLLOW_TEACHER_TEST_URL||'http://127.0.0.1:8766';
const browser=await chromium.launch({channel:'chrome',headless:true,args:[
  '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${path.join(out,'qa-prerecorded-front-with-black-gap.y4m')}`,
]});
const page=await browser.newPage({viewport:{width:1512,height:1180}});
page.setDefaultTimeout(30000);
const checks=[],errors=[],remoteResponses=[];
page.on('pageerror',(error)=>errors.push(error.message));
page.on('response',(response)=>{if(!response.url().startsWith(base))remoteResponses.push(response.url());});
try{
  await page.goto(`${base}/follow-teacher.html?step=2`);
  await page.waitForFunction(()=>window.followTeacherDiagnostics?.ready&&window.followTeacherDiagnostics.stepId==='dual-01-02');
  await page.locator('#seek').evaluate((slider)=>{
    slider.value='1000';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.getElementById('front-video').currentTime>10.46&&!document.getElementById('front-video').seeking);
  await page.click('#start-camera');
  await page.waitForFunction(()=>document.getElementById('feedback').dataset.state==='match');
  const match=await page.evaluate(()=>({diagnostics:window.followTeacherDiagnostics,message:document.getElementById('feedback-message').textContent}));
  assert.deepEqual(match.diagnostics.focus.joints,[27]);
  assert.match(match.message,/left foot/);
  assert.match(match.message,/Movement observed/);
  assert.equal(match.diagnostics.stepId,'dual-01-02');
  checks.push('Actual production page: genuine MediaPipe on labelled original-front replay observes left ankle27 movement near the held left-step-out target.');
  const invariant=await page.evaluate(()=>{
    const before=JSON.stringify(window.followTeacherDiagnostics.feedback);
    const checkbox=document.getElementById('mirror-preview');checkbox.checked=!checkbox.checked;checkbox.dispatchEvent(new Event('change'));
    return {same:before===JSON.stringify(window.followTeacherDiagnostics.feedback),joints:window.followTeacherDiagnostics.focus.joints};
  });
  assert.equal(invariant.same,true);assert.deepEqual(invariant.joints,[27]);
  checks.push('Changing preview mirroring synchronously preserves the computed feedback and anatomical left-foot focus.');
  await page.evaluate(()=>{
    const banner=document.createElement('div');banner.textContent='QA RECORDED REPLAY — actual MediaPipe on front.mp4; no human learner acceptance';
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:1000;background:#fff0b8;color:#4d3510;padding:8px;text-align:center;font:13px Arial';document.body.appendChild(banner);
  });
  await page.screenshot({path:path.join(out,'actual-left-foot-match-recorded-replay-labelled.png'),fullPage:true});
  await page.waitForFunction(()=>window.followTeacherDiagnostics?.camera.tracking==='no_pose');
  await page.waitForFunction(()=>document.getElementById('feedback').dataset.state==='unknown');
  const missing=await page.evaluate(()=>window.followTeacherDiagnostics);
  assert.equal(missing.feedback,null);assert.equal(missing.camera.hasSample,false);
  assert.equal(missing.stepId,'dual-01-02');
  checks.push('Actual black fixture frames clear the prior match to unknown; no automatic next step occurs.');
  await page.click('#stop-camera');
  await page.click('#step-next');
  await page.waitForFunction(()=>window.followTeacherDiagnostics?.stepId==='dual-01-03');
  assert.deepEqual(remoteResponses,[]);assert.deepEqual(errors,[]);
  checks.push('Manual Next remains available after tracking loss and camera Stop; no remote responses or page exceptions.');
  await writeFile(path.join(out,'feedback-integration-qa.json'),JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),provenance:'Explicitly labelled prerecorded front.mp4 camera replay with generated black no-pose frames. Genuine local MediaPipe and actual production-page matching. Not a distinct learner or human-camera acceptance.',checks,match,afterMissing:missing,pageErrors:errors,remoteResponses},null,2)+'\n');
  for(const check of checks)console.log(`PASS: ${check}`);
}catch(error){
  await writeFile(path.join(out,'feedback-integration-qa.json'),JSON.stringify({result:'FAIL',checkedAt:new Date().toISOString(),checks,error:error.message,diagnostics:await page.evaluate(()=>window.followTeacherDiagnostics).catch(()=>null),pageErrors:errors},null,2)+'\n');throw error;
}finally{await browser.close();}
