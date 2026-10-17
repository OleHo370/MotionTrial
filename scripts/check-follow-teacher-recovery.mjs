// Labelled HTTP/decode-control fixtures. No model observations or human attempts are fabricated.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.FOLLOW_TEACHER_TEST_URL||'http://127.0.0.1:8766';
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[];
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(30000);
page.on('pageerror',(e)=>errors.push(e.message));
const diagnostics=()=>page.evaluate(()=>window.followTeacherDiagnostics);
const ready=(formId,stepId)=>page.waitForFunction(({formId,stepId})=>{
  const d=window.followTeacherDiagnostics;
  return d?.ready&&(!formId||d.formId===formId)&&(!stepId||d.stepId===stepId)
    &&!document.getElementById('front-video').seeking&&!document.getElementById('back-video').seeking;
},{formId,stepId});
try{
  await page.route('**/front-01.poses.json',(route)=>route.fulfill({status:503,body:'QA deliberately unavailable recorded reference'}));
  await page.goto(`${base}/follow-teacher.html`);
  await ready('dual-01','dual-01-01');
  assert.equal((await diagnostics()).focus,null);
  assert.ok(await page.locator('#load-error').isVisible());
  await page.click('#step-next');
  await ready('dual-01','dual-01-02');
  assert.equal((await diagnostics()).completed.includes('dual-01-01'),true);
  if((await diagnostics()).playing)await page.click('#play');
  checks.push('Explicit HTTP503 reference-data fixture leaves original videos and manual Next usable.');
  await page.unroute('**/front-01.poses.json');
  await page.click('#retry');
  await page.waitForFunction(()=>window.followTeacherDiagnostics?.ready&&!!window.followTeacherDiagnostics.focus);
  assert.equal((await diagnostics()).focus.label,'left foot');
  assert.equal(await page.locator('#load-error').isVisible(),false);
  checks.push('Retry recovers the actual existing front observations and current step, without a fallback pose.');

  await page.route('**/front-02.poses.json',async(route)=>{
    await new Promise((resolve)=>setTimeout(resolve,500));
    await route.continue().catch(()=>{});
  });
  await page.selectOption('#form-select','dual-02');
  await page.selectOption('#form-select','dual-03');
  await ready('dual-03','dual-03-01');
  await page.waitForTimeout(650);
  const after=await diagnostics();
  assert.equal(after.formId,'dual-03');
  assert.ok(Math.abs(after.frontTime-after.selection.front.startSeconds)<.04);
  assert.ok(Math.abs(after.driftSeconds)<.04);
  checks.push('Rapid form changes cancel obsolete reference loading/seeks and keep the selected source phases.');

  await page.selectOption('#form-select','dual-24');
  await ready('dual-24');
  await page.selectOption('#step-select','dual-24-06');
  await ready('dual-24','dual-24-06');
  await page.click('#step-next');
  assert.equal((await diagnostics()).finished,true);
  assert.ok(await page.locator('#step-next').isDisabled());
  assert.match(await page.locator('#status').textContent(),/your confirmation/);
  assert.ok((await diagnostics()).completed.includes('dual-24-06'));
  checks.push('Last step finishes only by learner confirmation; completion is not reported as a model pass.');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(root,'artifacts/follow-teacher-review/recovery-qa.json'),JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),provenance:'Explicit HTTP failure and delayed-network control fixtures, using actual original videos/data; no physical learner acceptance.',checks,pageErrors:errors},null,2)+'\n');
  for(const check of checks)console.log(`PASS: ${check}`);
}catch(error){
  await writeFile(path.join(root,'artifacts/follow-teacher-review/recovery-qa.json'),JSON.stringify({result:'FAIL',checkedAt:new Date().toISOString(),checks,error:error.message,pageErrors:errors,diagnostics:await diagnostics().catch(()=>null)},null,2)+'\n');
  throw error;
}finally{await browser.close();}
