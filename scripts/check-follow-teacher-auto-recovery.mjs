// Explicit late-animation-frame and delayed-model control faults, not learner acceptance.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/follow-teacher-auto-review');
const base=process.env.FOLLOW_TEACHER_TEST_URL||'http://127.0.0.1:8766';
const browser=await chromium.launch({channel:'chrome',headless:true,args:[
  '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${path.join(root,'artifacts/follow-teacher-review/qa-prerecorded-front-with-black-gap.y4m')}`,
]});
const checks=[],errors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(20000);page.on('pageerror',(e)=>errors.push(e.message));
  await page.addInitScript(()=>{
    const original=window.requestAnimationFrame.bind(window);
    window.qaDelayedAnimationFrames=[];window.qaDelayAnimation=false;
    window.requestAnimationFrame=(callback)=>original((stamp)=>{
      if(window.qaDelayAnimation)window.qaDelayedAnimationFrames.push(callback);else callback(stamp);
    });
  });
  await page.goto(`${base}/follow-teacher.html`);
  await page.waitForFunction(()=>window.followTeacherDiagnostics?.auto.phase==='countdown');
  await page.evaluate(()=>{window.qaDelayAnimation=true;});
  await page.waitForTimeout(3200);
  await page.click('#practice-toggle');
  let d=await page.evaluate(()=>window.followTeacherDiagnostics);
  assert.equal(d.auto.paused,true);assert.equal(d.auto.remainingMs,0);
  await page.click('#practice-toggle');
  await page.evaluate(()=>{window.qaDelayAnimation=false;for(const callback of window.qaDelayedAnimationFrames.splice(0))requestAnimationFrame(callback);});
  await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.phase==='demonstrating');
  checks.push('Explicit delayed-RAF fault: pausing after an expired timer stores zero; Resume consumes the expired phase instead of freezing.');
  await page.click('#end-practice');

  await page.route('**/pose_landmarker_lite.task',async(route)=>{
    await new Promise((resolve)=>setTimeout(resolve,1200));await route.continue().catch(()=>{});
  });
  await page.click('#start-practice');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.camera?.starting);
  await page.locator('#camera-settings').evaluate((details)=>{details.open=true;});
  await page.click('#stop-camera');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.phase==='countdown'&&!window.followTeacherDiagnostics.camera.starting);
  assert.equal(await page.locator('#start-practice').isDisabled(),false);
  checks.push('Explicit delayed-model fault: Stop camera during startup cancels waiting and restores a usable automatic video preview.');
  await page.click('#end-practice');
  await page.waitForTimeout(1800);
  d=await page.evaluate(()=>window.followTeacherDiagnostics);
  assert.equal(d.auto.phase,'stopped');assert.equal(d.auto.enabled,false);assert.equal(d.camera.running,false);
  assert.equal(await page.locator('#practice-overlay').isVisible(),false);
  checks.push('A late canceled camera/model result cannot restart a session after End.');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(out,'automatic-recovery-qa.json'),JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),provenance:'Explicit delayed browser RAF and delayed local-model control fixtures; a labelled prerecorded camera input is used, never a physical learner.',checks,pageErrors:errors},null,2)+'\n');
  for(const check of checks)console.log(`PASS: ${check}`);
}catch(error){
  await writeFile(path.join(out,'automatic-recovery-qa.json'),JSON.stringify({result:'FAIL',checkedAt:new Date().toISOString(),checks,error:error.message,pageErrors:errors},null,2)+'\n');throw error;
}finally{await browser.close();}
