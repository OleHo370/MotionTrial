/** Software QA: recorded observations / prerecorded camera fixtures are labelled;
 * none of these checks constitutes a physical learner or camera acceptance. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts/four-point-game-review');
const base = process.env.FOLLOW_TEACHER_TEST_URL || 'http://127.0.0.1:8766';
const cameraReplay = path.join(root, 'artifacts/follow-teacher-review/qa-prerecorded-front-with-black-gap.y4m');
const manifest = JSON.parse(await readFile(path.join(root, 'public/practice-media/dual-view/manifest.json')));
const checks = [], snapshots = {}, errors = [], remoteResponses = [];
const add = (message) => { checks.push(message); console.log(`PASS: ${message}`); };
const sha = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const diag = (page) => page.evaluate(() => window.followTeacherDiagnostics);
await mkdir(out, { recursive: true });

async function preservation() {
  const baseline = JSON.parse(await readFile(path.join(out, 'protected-before.json')));
  const files = [];
  for (const entry of baseline.files) {
    const actual = await sha(path.join(root, entry.path));
    files.push({ path: entry.path, beforeSha256: entry.sha256, afterSha256: actual });
    assert.equal(actual, entry.sha256, entry.path);
    assert.equal(actual, entry.originalSha256, `${entry.path} original baseline`);
  }
  const originals = [];
  for (const view of ['front', 'back']) {
    const source = path.resolve(root, '../../', `${view}.mp4`), actual = await sha(source);
    assert.equal(actual, manifest.sources[view].sha256); originals.push({ path: source, sha256: actual });
  }
  const modelManifest = JSON.parse(await readFile(path.join(root, 'public/mediapipe/manifest.json')));
  for (const asset of modelManifest.assets) assert.equal(await sha(path.join(root, 'public', asset.path)), asset.sha256);
  await writeFile(path.join(out, 'protected-after.json'), JSON.stringify({ result: 'PASS', checkedAt: new Date().toISOString(), files, originals, modelAssets: modelManifest.assets }, null, 2));
  add(`${files.length} protected files, both original videos and pinned model assets match before/after and original hashes.`);
}

async function recordedTargetAudit() {
  const runtime = await import(pathToFileURL(path.join(root, 'public/four-point-game-runtime.js')));
  const forms = [], pointIndices = [15, 16, 27, 28];
  for (const form of manifest.forms) {
    const data = JSON.parse(await readFile(path.join(root, 'public', form.front.poseSrc)));
    const entries = [];
    for (const step of form.steps) {
      const ref = runtime.prepareFourPointStep(form, step, data);
      assert.deepEqual(ref.guides.map((g) => g.index), pointIndices);
      for (const guide of ref.guides) {
        for (const type of ['start', 'end']) {
          if (!guide[type]) { assert.equal(guide.valid, false); continue; }
          assert.ok(guide.support[`${type}Frames`].length >= 2);
          const original = data.samples.find((s) => s.sourceTimeSeconds === guide[`${type}SourceSeconds`]);
          assert.ok(original && original.sourceTimeSeconds >= step.front.startSeconds && original.sourceTimeSeconds < step.front.endSeconds);
          const actual = original.landmarks.find((p) => p.index === guide.index);
          assert.deepEqual(guide[`${type}Raw`], { x: actual.x, y: actual.y });
        }
      }
      const samples = data.samples.filter((s) => s.sourceTimeSeconds >= step.front.startSeconds && s.sourceTimeSeconds < step.front.endSeconds);
      const session = runtime.createFourPointSession(ref);
      let result = null;
      for (const sample of samples) result = runtime.evaluateFourPointObservation(ref, sample, { attemptAspectRatio: data.width / data.height, liveAgeMs: 0, session });
      if (!ref.referenceUsable) assert.equal(result.status, 'unknown');
      const stale = runtime.evaluateFourPointObservation(ref, samples.at(-1), { attemptAspectRatio: data.width / data.height, liveAgeMs: 451, session });
      assert.equal(stale.status, 'unknown'); assert.equal(stale.percent, null);
      entries.push({ id: step.id, eligible: ref.referenceUsable, finalReplayStatus: result.status, focusJoints: ref.focusJoints,
        validGuides: ref.guides.filter((g) => g.valid).map((g) => g.index), stationaryGuides: ref.guides.filter((g) => g.stationary).map((g) => g.index), unknownReason: ref.unknownReason });
    }
    forms.push({ formNumber: form.formNumber, formId: form.id, steps: entries });
  }
  assert.equal(forms.length, 24); assert.equal(forms.reduce((n, f) => n + f.steps.length, 0), 172);
  snapshots.recordedTargetAudit = { forms: forms.length, steps: 172, eligible: forms.flatMap((f) => f.steps).filter((s) => s.eligible).length,
    finalReplayMatches: forms.flatMap((f) => f.steps).filter((s) => s.finalReplayStatus === 'match').length };
  await writeFile(path.join(out, 'recorded-target-audit.json'), JSON.stringify({ result: 'PASS', provenance: 'Actual archived front-view MediaPipe observations replayed through the new four-point matcher. This is teacher-source self replay, not learner accuracy.', summary: snapshots.recordedTargetAudit, forms }, null, 2));
  add('All 24 forms / 172 microsteps provide four anatomically identified guide slots; valid endpoints are actual supported source observations, with stale input unknown.');
  const levels=JSON.parse(await readFile(path.join(root,'public/game-levels.json')));
  assert.equal(levels.forms.length,24);assert.equal(levels.sourceSha256,manifest.sources.front.sha256);
  assert.equal(levels.modelSha256,JSON.parse(await readFile(path.join(root,'public/mediapipe/manifest.json'))).assets.find(a=>a.path.includes('pose_landmarker_lite.task')).sha256);
  for(const form of forms){const catalog=levels.forms.find(f=>f.id===form.formId),eligible=form.steps.filter(s=>s.eligible).map(s=>s.id);assert.deepEqual(catalog.eligibleStepIds,eligible);assert.equal(catalog.totalSteps,form.steps.length);assert.equal(catalog.visualOnlyCount,form.steps.length-eligible.length);assert.equal(catalog.availableStars,eligible.length?3:0);}
  assert.equal(levels.availableStars,66);assert.deepEqual(levels.visualOnlyFormIds,['dual-20','dual-22']);
  add('The tiny game-level catalog exactly matches all real recorded source eligibilities: 66 available stars and two clearly visual-only levels.');
  return forms;
}

// TEST ONLY: raw recorded teacher landmarks are emitted on a labelled synthetic
// camera clock to verify UI orchestration, never represented as real inference.
const recordedCameraFixture = `
export function createFollowCamera(options) {
 const {onObservation=()=>{},onState=()=>{},startButton,stopButton,deviceSelect,statusElement}=options;
 let running=false,timer=null,lastSample=null,inferences=0,starts=0,ended=0,key=null,phaseStart=0;
 const cache=new Map();
 const state=()=>({phase:running?'running':'idle',running,starting:false,tracking:running?(lastSample?'pose':'no_pose'):'off',hasSample:!!lastSample,inferenceCount:inferences,streamStarts:starts,stoppedTracks:ended,overlayJoints:running&&lastSample?[15,16,27,28]:[],tracks:running?[{kind:'video',readyState:'live',deviceId:'qa-recorded-control'}]:[]});
 const notify=()=>{statusElement.textContent='QA RECORDED LANDMARK CONTROL: synthetic timing, not a live learner';onState(state());};
 async function emit(){if(!running)return;const d=window.followTeacherDiagnostics;if(!d?.ready)return;
  if(!cache.has(d.formId))cache.set(d.formId,fetch('/practice-media/dual-view/front-'+d.formId.slice(-2)+'.poses.json').then(r=>r.json()));
  const data=await cache.get(d.formId);if(!running)return;
  const current=d.stepId+':'+d.auto.round+':'+d.auto.attemptId;if(key!==current){key=current;phaseStart=performance.now();}
  if(window.__qaFixtureMode==='unknown'){lastSample=null;onObservation(null);notify();return;}
  const start=d.selection.front.startSeconds,end=d.selection.front.endSeconds-1/data.fps;
  const fraction=window.__qaFixtureMode==='baseline-only'?0:Math.min(1,Math.max(0,(performance.now()-phaseStart-250)/1000));
  const time=start+(end-start)*fraction,recorded=data.samples.find(s=>s.frameIndex===Math.floor(time*data.fps+0.00001));
  if(!recorded||recorded.status!=='pose'){lastSample=null;onObservation(null);notify();return;}
  const now=performance.now();lastSample={...recorded,tMs:now};inferences++;onObservation({sample:lastSample,observedAtMs:now,aspectRatio:data.width/data.height});notify();
 }
 async function start(){stop();running=true;starts++;notify();timer=setInterval(()=>void emit(),80);await emit();}
 function stop(){if(running)ended++;running=false;clearInterval(timer);lastSample=null;onObservation(null);notify();}
 startButton.addEventListener('click',()=>void start());stopButton.addEventListener('click',stop);deviceSelect.addEventListener('change',()=>{if(running)void start();});
 const mirror=()=>{for(const el of[options.video,options.canvas])el.style.transform=options.mirrorCheckbox.checked?'scaleX(-1)':'none';};options.mirrorCheckbox.addEventListener('change',mirror);mirror();notify();
 return{start,stop,getState:state,refreshDevices:async()=>{},destroy:stop};
}`;

async function label(page, text) {
  await page.evaluate((message) => { const el = document.createElement('div'); el.textContent = message;
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:6px;background:#fff1b3;color:#4b3610;text-align:center;font:12px Arial'; document.body.appendChild(el); }, text);
}
async function auditCanvas(page) {
  await page.addInitScript(() => {
    window.__qaCanvas = {};
    for (const method of ['clearRect', 'arc', 'lineTo']) {
      const original = CanvasRenderingContext2D.prototype[method];
      CanvasRenderingContext2D.prototype[method] = function(...args) {
        const id=this.canvas.id;if(id){const entry=window.__qaCanvas[id] ||= {arcs:[],lines:[]};if(method==='clearRect'){entry.arcs=[];entry.lines=[];}if(method==='arc')entry.arcs.push(args);if(method==='lineTo')entry.lines.push(args);}
        return original.apply(this,args);
      };
    }
  });
}
async function launch(args=[]) { return chromium.launch({ channel: 'chrome', headless: true, args }); }
async function lesson(browser, {url='?game=1&form=1',fixtureMode=null,viewport={width:1512,height:1100}}={}) {
  const page = await browser.newPage({viewport}); page.setDefaultTimeout(45000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))remoteResponses.push(r.url()); });
  await auditCanvas(page);
  await page.addInitScript((mode)=>{window.__qaFixtureMode=mode;window.__qaCaptureCount=0;const actual=navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);if(actual)navigator.mediaDevices.getUserMedia=(constraints)=>{window.__qaCaptureCount++;return actual(constraints);};},fixtureMode);
  if(fixtureMode)await page.route('**/follow-teacher-camera.js',(route)=>route.fulfill({status:200,contentType:'text/javascript',body:recordedCameraFixture}));
  await page.goto(`${base}/follow-teacher.html${url}`);
  await page.waitForFunction(()=>window.followTeacherDiagnostics?.ready);
  return page;
}

async function browserChecks(){
 const browser=await launch();let page=null;
 try{
  page=await browser.newPage({viewport:{width:1512,height:1050}});page.setDefaultTimeout(45000);
  await page.goto(`${base}/game.html`);
  await page.waitForFunction(()=>document.querySelectorAll('#level-grid .level-card').length===24);
  const homeStyle=await page.evaluate(()=>({display:getComputedStyle(document.getElementById('level-grid')).display,height:document.documentElement.scrollHeight,starWidth:document.querySelector('.level-stars svg').getBoundingClientRect().width}));
  assert.equal(homeStyle.display,'grid','The existing video server must actually deliver or inline the new home CSS.');
  assert.ok(homeStyle.height<12000&&homeStyle.starWidth<30,'Home cards and SVG stars need their intended dimensions.');
  const cards=await page.locator('#level-grid .level-card').evaluateAll((links)=>links.map(a=>({href:a.getAttribute('href'),text:a.textContent}))) ;
  for(let n=1;n<=24;n++){const link=cards.find(c=>new URL(c.href,base).searchParams.get('form')===`dual-${String(n).padStart(2,'0')}`);assert.ok(link,`form ${n}`);assert.equal(new URL(link.href,base).searchParams.get('game'),'1');}
  assert.equal(await page.locator('.level-stars svg.earned').count(),0);assert.equal(await page.locator('.level-stars svg').count(),72);
  assert.equal(await page.locator('#available-stars').textContent(),'/ 66 available stars');
  for(const id of['dual-20','dual-22']){assert.match(await page.locator(`[data-form-id="${id}"]`).getAttribute('class'),/visual-only-level/);assert.match(await page.locator(`[data-form-id="${id}"] .level-detail`).textContent(),/Visual practice only.*no stars/);}
  snapshots.homeCards=cards;
  await label(page,'QA SOFTWARE SCREENSHOT — fresh local storage; no human learner acceptance');await page.screenshot({path:path.join(out,'home-desktop-labelled.png'),fullPage:true});
  add('New game home exposes 24 real manifest forms, each linked to its own game-mode lesson.');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'home-mobile-labelled.png'),fullPage:true});
  const audit=JSON.parse(await readFile(path.join(out,'recorded-target-audit.json'))),first=audit.forms[0];
  const eligible=first.steps.filter(s=>s.eligible).map(s=>s.id),matched=first.steps.filter(s=>s.finalReplayStatus==='match').map(s=>s.id);
  assert.deepEqual(eligible,matched,'Opening source replay must support all targets used by this explicit storage-only fixture.');
  for(const [count,stars]of[[Math.ceil(eligible.length/3),1],[Math.ceil(eligible.length*2/3),2],[eligible.length,3]]){
    snapshots[`storageFixture${stars}Stars`]=await page.evaluate(async({stepIds,eligibleStepIds,count})=>{const m=await import('/game-progress.js');return m.recordGameFormResult({formId:'dual-01',stepIds,eligibleStepIds,results:eligibleStepIds.slice(0,count).map(stepId=>({stepId,status:'matched'}))});},{stepIds:first.steps.map(s=>s.id),eligibleStepIds:eligible,count});
    assert.equal(await page.locator('[data-form-id="dual-01"] .level-stars svg.earned').count(),stars);
  }
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#level-grid .level-card').length===24);
  assert.equal(await page.locator('[data-form-id="dual-01"] .level-stars svg.earned').count(),3);
  await label(page,'QA STORAGE-ONLY FIXTURE — actual source self-replay IDs; not a completed human session');await page.screenshot({path:path.join(out,'home-persisted-stars-storage-fixture-labelled.png'),fullPage:true});
  add('Explicit storage-only fixture uses actual matched source-replay IDs to verify 1/2/3 star thresholds, live card update and reload persistence; it is not human gameplay.');
  await page.close();
  if(process.argv.includes('--home')){
    for(const [url,enabled,count,form]of[['',true,7,'dual-01'],['?mode=routine&form=24',false,172,'dual-24']]){
      page=await lesson(browser,{url});const d=await diag(page);
      assert.equal(d.game.enabled,enabled);assert.equal(d.stepCount,count);assert.equal(d.formId,form);assert.equal(d.totalMicrosteps,172);
      assert.equal(await page.evaluate(()=>window.__qaCaptureCount),0);await page.click('#end-practice');await page.close();
    }
    add('Plain follow-teacher URL opens the new form-scoped point game; explicit routine mode retains all 172 steps and direct form-24 navigation, without permission on load.');
    return;
  }
  page=await lesson(browser,{fixtureMode:'unknown'});
  let d=await diag(page);snapshots.initial=d;
  assert.equal(d.game.enabled,true);assert.equal(d.formId,'dual-01');assert.equal(await page.evaluate(()=>window.__qaCaptureCount),0);
  assert.equal(await page.locator('#back-overlay').count(),0);
  await page.waitForFunction(()=>window.__qaCanvas['front-overlay']?.arcs.length>0);
  const front=await page.evaluate(()=>window.__qaCanvas['front-overlay']);assert.ok(front.arcs.length<=4);assert.equal(front.lines.length,0);
  assert.equal(d.layout.primary,'back');assert.equal(d.speed,.5);assert.equal(d.auto.phase,'countdown');
  await page.click('#practice-toggle');
  await label(page,'QA SOFTWARE SCREENSHOT — four-point lesson, no human learner acceptance');await page.screenshot({path:path.join(out,'game-lesson-desktop-labelled.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'game-lesson-mobile-labelled.png'),fullPage:true});
  await page.click('#end-practice');await page.close();
  add('Game lesson defaults to countdown, half-speed and unmirrored back view; front draws up to four circles and zero skeleton connections; desktop/mobile layouts fit.');
  page=await lesson(browser,{fixtureMode:'source-motion',url:'?game=1&form=1&step=2'});await page.click('#start-practice');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.results.some(r=>r.stepId==='dual-01-02'&&r.status==='matched'));
  snapshots.recordedMatch=await diag(page);assert.ok(snapshots.recordedMatch.game.saved.matchedStepIds.includes('dual-01-02'));
  await page.click('#practice-toggle');
  const mirror=await page.evaluate(()=>{const before=JSON.stringify(window.followTeacherDiagnostics.feedback),focus=window.followTeacherDiagnostics.focus.joints;document.getElementById('mirror-preview').click();return{same:before===JSON.stringify(window.followTeacherDiagnostics.feedback),focus,after:window.followTeacherDiagnostics.focus.joints};});
  assert.equal(mirror.same,true);assert.deepEqual(mirror.focus,mirror.after);await page.click('#end-practice');await page.close();
  add('Labelled actual recorded point motion automatically earns a real matched microstep; display mirroring leaves anatomical computation unchanged.');
  page=await lesson(browser,{fixtureMode:'source-motion'});await page.click('#start-practice');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.game.formComplete,null,{timeout:90000});
  snapshots.completeOpening=await diag(page);const complete=snapshots.completeOpening;
  assert.equal(complete.formId,'dual-01');assert.equal(complete.stepId,'dual-01-07');assert.equal(complete.game.stars,3);
  assert.equal(complete.game.saved.matchedStepIds.length,7);assert.equal(complete.auto.results.filter(r=>r.status==='matched').length,7);
  assert.equal(complete.camera.running,false);assert.equal(complete.playing,false);assert.equal(complete.auto.enabled,false);
  assert.equal(await page.locator('#game-finish').isVisible(),true);
  await label(page,'QA ACTUAL RECORDED LANDMARK REPLAY + SYNTHETIC CAMERA TIMING — NOT A LIVE LEARNER');
  await page.screenshot({path:path.join(out,'opening-level-complete-recorded-fixture-labelled.png'),fullPage:true});
  await page.locator('#game-finish a[href="/game.html"]').click();await page.waitForFunction(()=>document.querySelectorAll('#level-grid .level-card').length===24);
  assert.equal(await page.locator('[data-form-id="dual-01"] .level-stars svg.earned').count(),3);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#level-grid .level-card').length===24);
  assert.equal(await page.locator('[data-form-id="dual-01"] .level-stars svg.earned').count(),3);await page.close();
  add('A full seven-step Opening from actual recorded landmark control input earns three persisted stars, stops before form 2, releases the camera and returns to the level map.');
  page=await lesson(browser,{fixtureMode:'baseline-only',url:'?game=1&form=1&step=2'});await page.click('#start-practice');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.phase==='feedback');
  snapshots.incomplete=await diag(page);assert.ok(snapshots.incomplete.auto.progress.percent<100);
  assert.equal(snapshots.incomplete.auto.results.length,0);assert.equal(snapshots.incomplete.game.stars,0);
  assert.ok(snapshots.incomplete.game.guideDrawnIndices.length>0&&snapshots.incomplete.game.guideDrawnIndices.every(i=>[15,16,27,28].includes(i)));
  await label(page,'QA BASELINE-ONLY RECORDED LANDMARK CONTROL — NOT A LIVE LEARNER');await page.screenshot({path:path.join(out,'four-point-progress-feedback-labelled.png'),fullPage:true});
  const feedbackAt=performance.now();await page.waitForTimeout(2200);assert.equal((await diag(page)).auto.phase,'feedback');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.phase==='demonstrating'&&window.followTeacherDiagnostics.auto.round===2);
  assert.ok(performance.now()-feedbackAt>=2750);assert.equal((await diag(page)).stepId,'dual-01-02');
  await page.evaluate(()=>{window.__qaFixtureMode='unknown';});await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.phase==='feedback');
  snapshots.unknown=await diag(page);assert.equal(snapshots.unknown.auto.progress?.percent??null,null);assert.equal(snapshots.unknown.game.stars,0);
  assert.equal(snapshots.unknown.game.liveDrawnIndices.length,0);assert.ok(snapshots.unknown.game.trails.every(t=>t.count===0));
  await page.click('#end-practice');await page.close();
  add('Incomplete four-point slides show an estimate/reason for three real seconds then retry; missing input clears all trails and never earns a target or star.');
  page=await lesson(browser,{fixtureMode:'unknown',url:'?game=1&form=2&step=12'});await page.click('#start-practice');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.game.formComplete,null,{timeout:55000});
  snapshots.referenceInsufficient=await diag(page);assert.equal(snapshots.referenceInsufficient.formId,'dual-02');assert.equal(snapshots.referenceInsufficient.game.stars,0);
  assert.deepEqual(snapshots.referenceInsufficient.auto.results,[{stepId:'dual-02-12',status:'unassessed'}]);
  assert.equal(snapshots.referenceInsufficient.auto.round,3);assert.equal(snapshots.referenceInsufficient.camera.running,false);await page.close();
  add('The actual final Part the Wild Horse source-insufficient step demonstrates three rounds and finishes unassessed, with zero stars and no next-form jump.');
  assert.deepEqual(errors,[]);assert.deepEqual(remoteResponses,[]);
 }catch(e){snapshots.browserFailure=await diag(page).catch(()=>null);await page?.screenshot({path:path.join(out,'browser-failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();}
}

async function realModelChecks(){
 const browser=await launch(['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${cameraReplay}`]);let page=null;
 try{
  page=await lesson(browser,{url:'?game=1&form=1&step=2'});
  await label(page,'QA PRERECORDED front.mp4 CAMERA REPLAY + REAL MEDIAPIPE — NOT A LIVE LEARNER');
  await page.click('#start-practice');await page.waitForFunction(()=>window.followTeacherDiagnostics.camera?.inferenceCount>2&&window.followTeacherDiagnostics.camera.hasSample);
  const d=await diag(page);snapshots.realModel=d;
  assert.ok(d.camera.inferenceCount>2);assert.ok(d.camera.overlayJoints.length>0&&d.camera.overlayJoints.every(i=>[15,16,27,28].includes(i)));
  const canvas=await page.evaluate(()=>window.__qaCanvas['camera-overlay']);assert.ok(canvas.arcs.length<=4);assert.equal(canvas.lines.length,0);
  await page.waitForFunction(()=>{const d=window.followTeacherDiagnostics;return d.auto.phase==='demonstrating'&&d.game.guideDrawnIndices.length===4&&d.camera.hasSample&&d.game.liveDrawnIndices.length>=3;});
  snapshots.realModelActiveGuides=await diag(page);
  const guideCanvas=await page.evaluate(()=>window.__qaCanvas['camera-guide-overlay']);assert.ok(guideCanvas.arcs.length>=4);assert.ok(guideCanvas.lines.length>0);
  const mirrors=await page.evaluate(()=>['camera-video','camera-overlay','camera-guide-overlay'].map(id=>getComputedStyle(document.getElementById(id)).transform));
  assert.ok(mirrors.every(value=>/^matrix\(-1,/.test(value)));
  await page.screenshot({path:path.join(out,'real-mediapipe-four-point-labelled.png'),fullPage:true});
  add('Genuine local MediaPipe on explicitly labelled prerecorded front video renders only four anatomical hand/foot points with no body connections.');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.auto.results.some(r=>r.stepId==='dual-01-02'&&r.status==='matched'),null,{timeout:65000});
  snapshots.realModelAdvance=await diag(page);
  add('Genuine MediaPipe prerecorded-camera input automatically collects the left-foot game microstep; this is software replay, not physical learner acceptance.');
  await page.waitForFunction(()=>window.followTeacherDiagnostics.camera.tracking==='no_pose');
  snapshots.realModelMissing=await diag(page);assert.equal(snapshots.realModelMissing.camera.hasSample,false);
  assert.deepEqual(snapshots.realModelMissing.game.liveDrawnIndices,[]);assert.deepEqual(snapshots.realModelMissing.game.guideDrawnIndices,[]);
  assert.ok(snapshots.realModelMissing.game.trails.every(t=>t.count===0));
  add('Generated black replay frames produce genuine MediaPipe no_pose and clear all old learner points, target guides and trails.');
  await page.click('#end-practice');const stopped=await diag(page);assert.equal(stopped.camera.running,false);assert.equal(stopped.camera.hasSample,false);assert.equal(stopped.game.liveDrawnIndices.length,0);
  assert.deepEqual(errors,[]);assert.deepEqual(remoteResponses,[]);
  add('Ending the game releases the actual replay camera and clears stale displayed learner points.');
 }catch(e){snapshots.realModelFailure=await diag(page).catch(()=>null);await page?.screenshot({path:path.join(out,'real-model-failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();}
}

if(process.argv.includes('--summary')){
 const reports=[];
 for(const name of['static-qa.json','home-qa.json','browser-qa.json','real-mediapipe-qa.json']){
  const report=JSON.parse(await readFile(path.join(out,name)));assert.equal(report.result,'PASS',name);
  reports.push({file:name,checkedAt:report.checkedAt,result:report.result,checks:report.checks,sha256:await sha(path.join(out,name))});
 }
 const source=JSON.parse(await readFile(path.join(out,'recorded-target-audit.json')));
 const unitLog=await readFile(path.join(out,'unit-tests.log'),'utf8');
 const unitCounts={tests:Number(unitLog.match(/ℹ tests (\d+)/)?.[1]),passed:Number(unitLog.match(/ℹ pass (\d+)/)?.[1]),failed:Number(unitLog.match(/ℹ fail (\d+)/)?.[1])};
 assert.ok(Number.isInteger(unitCounts.tests)&&unitCounts.tests>0);assert.equal(unitCounts.passed,unitCounts.tests);assert.equal(unitCounts.failed,0);
 const implementation=[];
 for(const file of['public/game.html','public/game.css','public/game.js','public/game-progress.js','public/game-levels.json',
  'public/follow-teacher.html','public/follow-teacher.js','public/follow-teacher-camera.js','public/four-point-game-runtime.js',
  'lib/four-point-game.ts','scripts/build-four-point-game.mjs','scripts/build-game-levels.ts','scripts/check-four-point-game.mjs']){
  implementation.push({path:file,sha256:await sha(path.join(root,file))});
 }
 const summary={result:'PASS',checkedAt:new Date().toISOString(),provenance:'Software QA only. Stored-landmark replay uses explicitly synthetic camera timing. Real MediaPipe inference uses a labelled prerecorded front.mp4/black-frame fixture. Storage-only star examples are separately labelled. No physical learner or physical camera acceptance.',
  checks:[...new Set(reports.flatMap(r=>r.checks))],reports,implementation,unitSuite:{...unitCounts,command:'npm test',result:'PASS',stdoutFile:'unit-tests.log',stdoutSha256:await sha(path.join(out,'unit-tests.log'))},
  sourceEvidence:{...source.summary,availableStars:66,allFourGuidesAvailable:source.forms.flatMap(f=>f.steps).filter(s=>s.validGuides.length===4).length,visualOnlySteps:172-source.summary.eligible,
   visualOnlyForms:source.forms.filter(f=>!f.steps.some(s=>s.eligible)).map(f=>({id:f.formId,title:manifest.forms.find(m=>m.id===f.formId).title})),
   statement:'Source self replay is not learner accuracy. Missing reference endpoints are not reconstructed or filled in.'},
  resolvedIssues:[{problem:'The existing static server serves external CSS without a CSS MIME type, so the first game home lost its styles.',fix:'Inline CSS in the new game home. The existing server and protected pages stay unchanged.',verifiedBy:'Rendered CSS grid, star dimensions, desktop/mobile screenshots and --home checks.'}],
  physicalHumanAcceptance:'NOT PERFORMED',remainingAcceptance:['An actual learner moving the wrong anatomical hand/foot, varied body proportions, clothing and lighting.','Real permission prompts, physical device switching and camera indicator cleanup.','Mobile physical devices, browser autoplay policy and camera positioning at practice distance.','Human assessment of simple game tolerance and visual ring usability; stars are game target collection, not full Tai Chi correctness.']};
 await writeFile(path.join(out,'verification-summary.json'),JSON.stringify(summary,null,2));
 console.log(`PASS: ${summary.checks.length} unique software checks, ${reports.length} passing reports, final implementation hashes and explicit physical-acceptance limits.`);
 process.exit(0);
}

let result='PASS',failure=null;
try{
 if(!process.argv.includes('--browser')&&!process.argv.includes('--camera')){await preservation();await recordedTargetAudit();}
 if(!process.argv.includes('--static')){if(!process.argv.includes('--camera'))await browserChecks();if(!process.argv.includes('--browser')&&!process.argv.includes('--home'))await realModelChecks();}
}catch(e){result='FAIL';failure=e.stack||e.message;console.error(failure);process.exitCode=1;}
await writeFile(path.join(out,process.argv.includes('--static')?'static-qa.json':process.argv.includes('--camera')?'real-mediapipe-qa.json':process.argv.includes('--home')?'home-qa.json':process.argv.includes('--browser')?'browser-qa.json':'verification-summary.json'),JSON.stringify({result,checkedAt:new Date().toISOString(),provenance:'Software only. Teacher-source landmark replay with synthetic timing is distinct from genuine MediaPipe inference on labelled prerecorded video; neither is human acceptance.',checks,snapshots,errors,remoteResponses,failure,physicalHumanAcceptance:'NOT PERFORMED'},null,2));
