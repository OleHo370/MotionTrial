/** Optional lesson 3D viewer QA against actual saved teacher observations.
 * Isolated loopback server, no physical camera, Arduino or paid Factory calls.
 * Browser seeks/playback test orchestration only, never learner correctness. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createDualViewServer} from './serve-dual-view.mjs';
import {validateLesson3DData,selectLesson3DSample} from '../public/first-three-study-3d.js';
import {transformSample,COORDINATE_TRANSFORMS,HIP_DISPLAY_HEIGHT} from '../public/study-3d-scene.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'artifacts/lesson-3d-review');
const checks=[],errors=[],snapshots={},blockedRequests=[],requests=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async filename=>JSON.parse(await readFile(path.join(root,filename),'utf8'));
const manifest=await json('public/practice-media/recut-six/manifest.json');
const steps=manifest.steps.slice(0,5),source=manifest.sources[0];
const unchangedFiles=['public/practice-media/recut-six/master.poses.json','public/practice-media/recut-six/manifest.json',
  'public/practice-attempt-review.js','public/practice-tube.js','public/dual-view.html','public/study-3d.html','public/study-3d.js',
  `public${source.video.src}`,
  ...steps.map(step=>`public${step.clipSrc}`)];
const baseline=Object.fromEntries(await Promise.all(unchangedFiles.map(async filename=>[filename,hash(await readFile(path.join(root,filename)))])));
await mkdir(output,{recursive:true});
async function check(name,run){await run();checks.push(name);console.log(`PASS: ${name}`);}
const blockedService={async handle(req,res){if(!req.url.startsWith('/api/'))return false;
  blockedRequests.push({url:req.url,method:req.method});
  res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({connected:false,configured:false,source:'local',message:'QA blocks camera, hardware and paid services.'}));
  return true;},async close(){}};
const server=createDualViewServer({relay:blockedService,feedback:blockedService});
let browser,base,result='PASS',failure=null;

function assertActualSample(snapshot,data,teacherTime){
  const scene=snapshot.scene,render=scene.views.front;
  assert.ok(scene.ready&&!scene.error,'Existing Three.js renderer produces a real WebGL scene.');
  const sample=data.samples.find(item=>(item.sourceFrameIndex??item.frameIndex)===render.frameIndex);
  assert.ok(sample,'Rendered frame belongs to the independently extracted teacher archive.');
  assert.equal(render.status,sample.status);
  const ageMs=(teacherTime-sample.sourceTimeSeconds)*1000;
  assert.ok(ageMs>=-.01&&ageMs<=100.01,
    `Recorded 3D frame ${sample.sourceTimeSeconds}s must be a recent actual observation preceding teacher ${teacherTime}s, with no future-frame substitution.`);
  if(sample.status!=='pose'){
    assert.equal(render.drawnPoints,0);assert.equal(render.drawnBones,0);return;
  }
  const image=new Map(sample.landmarks.map(point=>[point.index,point]));
  const world=new Map(sample.worldLandmarks.map(point=>[point.index,point]));
  const trusted=index=>{const p=image.get(index),q=world.get(index);return !!p&&!!q
    &&[p.x,p.y,p.z,q.x,q.y,q.z,p.visibility,p.presence,q.visibility,q.presence].every(Number.isFinite)
    &&Math.min(p.visibility,p.presence,q.visibility,q.presence)>=scene.visibilityThreshold;};
  const valid=trusted(23)&&trusted(24)?[...world.keys()].filter(trusted):[];
  assert.deepEqual([...render.validIndices].sort((a,b)=>a-b),valid.sort((a,b)=>a-b),
    'Confidence gaps remain absent rather than being interpolated or filled.');
  if(!valid.length){assert.equal(render.drawnPoints,0);return;}
  const hips=[world.get(23),world.get(24)];
  const center=['x','y','z'].map(key=>(hips[0][key]+hips[1][key])/2);
  const yaw=scene.coordinateTransforms.front.yawRadians;
  for(const index of valid){const p=world.get(index),x=p.x-center[0],y=-p.y+center[1]+scene.hipDisplayHeight,z=-p.z+center[2];
    const expected=[(scene.mirrorFront?-1:1)*(Math.cos(yaw)*x+Math.sin(yaw)*z),y,-Math.sin(yaw)*x+Math.cos(yaw)*z];
    assert.ok(expected.every((value,axis)=>Math.abs(value-render.points[index][axis])<1e-6),
      `Point ${index} uses genuine saved world coordinates and only the documented rigid display transform.`);
  }
  assert.equal(scene.views.back.drawnPoints,0,'Unrelated back-view observations are never substituted.');
}

async function configurePage(page){
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  await page.addInitScript(()=>{
    window.qaCameraRequests=0;
    if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.qaCameraRequests++;
      throw new DOMException('QA forbids physical camera access.','NotAllowedError');};
  });
  await page.route('**/api/**',route=>{
    const request=route.request();blockedRequests.push({url:new URL(request.url()).pathname,method:request.method()});
    return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({connected:false,configured:false,
      source:'local',message:'QA disconnected services; no physical hardware or paid SDK calls.'})});
  });
}
const diag=page=>page.evaluate(()=>window.lesson3DDiagnostics);
async function lessonReady(page,index=0){await page.waitForFunction(index=>window.firstThreeDiagnostics?.ready
  &&!window.firstThreeDiagnostics.loading&&window.firstThreeDiagnostics.index===index,index);}
async function viewerReady(page,stepId){await page.waitForFunction(stepId=>window.lesson3DDiagnostics?.ready
  &&!window.lesson3DDiagnostics.loading&&window.lesson3DDiagnostics.stepId===stepId&&window.lesson3DDiagnostics.scene?.ready,stepId);}
async function seek(page,time){
  await page.locator('#teacher-video').evaluate((video,time)=>{video.pause();video.currentTime=time;},time);
  await page.waitForFunction(time=>{const video=document.getElementById('teacher-video');return !video.seeking
    &&Math.abs(video.currentTime-time)<0.005;},time);
  await page.waitForTimeout(100);
}
async function choose(page,index){
  await page.locator(`#step-list button[data-index="${index}"]`).evaluate(button=>button.click());
  await lessonReady(page,index);await viewerReady(page,steps[index].id);
}
async function evidence(page){return page.evaluate(()=>{const d=window.firstThreeDiagnostics;return {
  reference:d.reference,references:d.references,controlIndices:d.controlIndices,reviewRules:d.reviewRules,
  feedback:d.feedback,results:d.results,active:d.active,phase:d.phase,index:d.index,cameraRunning:d.camera.running,
  paths:window.movementPathDiagnostics.pathReferences};});}
async function rectangle(page,selector){return page.locator(selector).evaluate(element=>{
  const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};});}

try{
  await check('Original five clips and raw grading observations retain their exact archived identities',async()=>{
    assert.equal(steps.length,5);
    for(const step of steps)assert.equal(baseline[`public${step.clipSrc}`],step.clipSha256,step.id);
    assert.equal(hash(await readFile(path.join(root,`public${source.video.src}`))),source.video.sha256);
    const raw=await json(`public${source.poseSrc}`);
    assert.equal(raw.sourceSha256,manifest.source.sha256);assert.equal(raw.sourceClipSha256,source.video.sha256);
    assert.equal(raw.samples.filter(sample=>sample.worldLandmarks?.length).length,0,
      'Legacy image landmarks remain legacy image landmarks, never relabeled as world coordinates.');
  });
  await check('Existing standalone 3D coordinates retain their original default unmirrored transform',async()=>{
    for(const sourceName of ['front','back']){
      const existing=await json(`public/practice-media/dual-view/${sourceName}-01.poses.json`);
      const actual=existing.samples.find(sample=>sample.status==='pose');
      const displayed=transformSample(actual,sourceName),points=new Map(actual.worldLandmarks.map(point=>[point.index,point]));
      const hips=[points.get(23),points.get(24)],center=['x','y','z'].map(key=>(hips[0][key]+hips[1][key])/2);
      const yaw=COORDINATE_TRANSFORMS[sourceName].yawRadians;
      assert.ok(displayed.drawnPoints>0);
      for(const index of displayed.validIndices){const p=points.get(index),x=p.x-center[0],y=-p.y+center[1]+HIP_DISPLAY_HEIGHT,z=-p.z+center[2];
        const expected=[Math.cos(yaw)*x+Math.sin(yaw)*z,y,-Math.sin(yaw)*x+Math.cos(yaw)*z];
        assert.ok(expected.every((value,axis)=>Math.abs(value-displayed.points[index][axis])<1e-6));
      }
    }
  });
  const worldData=await json('public/practice-media/recut-six/master.study-3d.poses.json');
  await check('The new sidecar matches actual source/model identities and rejects mismatched or fabricated coordinate inputs',async()=>{
    assert.equal(validateLesson3DData(worldData,source,manifest.source.sha256),worldData);
    assert.equal(worldData.samples[0].sourceFrameIndex,steps[0].sourceStartFrame);
    assert.equal(worldData.samples.at(-1).sourceFrameIndex,steps.at(-1).referenceEndFrame);
    assert.ok(worldData.samples.length>100&&worldData.samples.length<=steps.at(-1).referenceEndFrame-steps[0].sourceStartFrame+1);
    assert.ok(worldData.sampleRateHz>0&&worldData.sampleRateHz<=source.video.fps);
    assert.ok(Number.isFinite(worldData.displayYawRadians));
    for(const [key,value]of [['sourceSha256','wrong-source'],['sourceClipSha256','wrong-clip'],['modelSha256','wrong-model'],['width',source.video.width+1]]){
      assert.throws(()=>validateLesson3DData({...worldData,[key]:value},source,manifest.source.sha256),/match/);
    }
    const legacy=await json(`public${source.poseSrc}`);
    assert.throws(()=>validateLesson3DData(legacy,source,manifest.source.sha256),/match|world landmarks/,
      'The helper refuses to repurpose normalized image depth as world coordinates.');
    const actual=worldData.samples.find(sample=>sample.status==='pose');
    assert.throws(()=>validateLesson3DData({...worldData,samples:[{...actual,worldLandmarks:undefined}]},source,manifest.source.sha256),/world landmarks/);
    assert.throws(()=>validateLesson3DData({...worldData,samples:[{...actual,status:'no_pose'}]},source,manifest.source.sha256),/retained landmarks/);
    assert.throws(()=>validateLesson3DData({...worldData,samples:[actual,actual]},source,manifest.source.sha256),/frame identities/);
  });
  await check('Actual per-clip sampling has no future-frame substitution, cross-clip bleed or stale-gap interpolation',async()=>{
    for(const step of steps){
      const start=selectLesson3DSample(worldData,step,source,step.practiceStartSeconds);
      assert.equal(start.sourceFrameIndex,step.sourceStartFrame);
      const end=selectLesson3DSample(worldData,step,source,step.teacherFreezeSeconds);
      assert.equal(end.sourceFrameIndex,step.referenceEndFrame);
      assert.equal(selectLesson3DSample(worldData,step,source,step.practiceStartSeconds-.01).sample,null);
      assert.equal(selectLesson3DSample(worldData,step,source,step.teacherFreezeSeconds+.05).sample,null);
      const time=step.practiceStartSeconds+.01,between=selectLesson3DSample(worldData,step,source,time);
      assert.equal(between.sourceFrameIndex,step.sourceStartFrame);assert.ok(between.sourceTimeSeconds<=time);
      const onlyStart={...worldData,samples:[start.sample]};
      assert.equal(selectLesson3DSample(onlyStart,step,source,step.practiceStartSeconds+.2).sample,null,
        'A genuine old observation cannot fill a missing interval.');
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});await configurePage(page);
  await page.goto(`${base}/first-three.html?step=1`);await lessonReady(page);
  let world;
  await check('Optional button loads a real estimated 3D model without changing practice evidence',async()=>{
    assert.equal(await page.locator('#teacher-3d-panel').isVisible(),false);
    assert.equal(await page.locator('#toggle-teacher-3d').getAttribute('aria-expanded'),'false');
    const before=await evidence(page);await page.click('#toggle-teacher-3d');await viewerReady(page,steps[0].id);
    assert.equal(await page.locator('#toggle-teacher-3d').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#teacher-3d-panel').isVisible(),true);
    assert.match(await page.locator('#teacher-3d-panel').innerText(),/estimated.*3D|3D.*estimated/i);
    const d=await diag(page);assert.ok(d.poseSrc&&d.poseSrc!==source.poseSrc);
    world=await json(`public${d.poseSrc}`);
    assert.equal(world.sourceSha256,manifest.source.sha256);assert.equal(world.sourceClipSha256,source.video.sha256);
    assert.equal(world.modelSha256,'59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a');
    assert.ok(world.samples.some(sample=>sample.status==='pose'&&sample.worldLandmarks?.length===33));
    assert.ok(await page.locator('#teacher-3d-view canvas').evaluate(canvas=>!!(canvas.getContext('webgl2')||canvas.getContext('webgl'))));
    assertActualSample(d,world,await page.locator('#teacher-video').evaluate(video=>video.currentTime));
    assert.deepEqual(await evidence(page),before,'Opening the viewer cannot alter tracking rules, target geometry, progress or result evidence.');
    snapshots.initial=d;
  });
  await check('Every clip start, middle and held endpoint selects its corresponding genuine source frame',async()=>{
    const entries=[];
    for(let index=0;index<steps.length;index++){
      await choose(page,index);const step=steps[index];
      for(const time of [step.practiceStartSeconds,(step.practiceStartSeconds+step.teacherFreezeSeconds)/2,step.teacherFreezeSeconds]){
        await seek(page,time);const d=await diag(page);assert.equal(d.stepId,step.id);assert.equal(d.sourceId,source.id);
        assertActualSample(d,world,time);const frame=d.scene.views.front.frameIndex;
        assert.ok(frame>=step.sourceStartFrame&&frame<=step.referenceEndFrame,
          `${step.id} shows only its own teaching frame interval, including its declared shared endpoint.`);
        entries.push({stepId:step.id,teacherTime:time,frame,status:d.scene.views.front.status});
      }
    }
    snapshots.frameSelections=entries;
  });
  await check('Teacher playback, four speeds, pause and a new clip keep the 3D model on the same clock',async()=>{
    const speeds=[];
    for(const rate of ['0.25','0.5','0.75','1']){
      await choose(page,0);
      await page.locator('#speed').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},rate);
      await page.locator('#replay').evaluate(button=>button.click());
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='watching');
      await page.waitForTimeout(500);
      await page.locator('#teacher-video').evaluate(video=>video.pause());
      await page.waitForTimeout(100);
      const before=await diag(page),clock=await page.locator('#teacher-video').evaluate(video=>video.currentTime);
      assertActualSample(before,world,clock);
      assert.equal(await page.locator('#teacher-video').evaluate(video=>video.playbackRate),Number(rate));
      await page.waitForTimeout(180);const after=await diag(page);
      assert.equal(after.scene.views.front.frameIndex,before.scene.views.front.frameIndex,'Pausing teacher pauses the corresponding skeleton frame.');
      assert.ok(clock>steps[0].practiceStartSeconds);
      speeds.push({rate:Number(rate),teacherTime:clock,frame:before.scene.views.front.frameIndex});
    }
    await choose(page,1);assert.equal((await diag(page)).stepId,steps[1].id);
    assertActualSample(await diag(page),world,steps[1].practiceStartSeconds);snapshots.playback=speeds;
  });
  await check('Desktop and phone keep 3D beside the corresponding Teacher clip without overflow',async()=>{
    await page.setViewportSize({width:1440,height:900});await choose(page,1);
    const teacher=await rectangle(page,'#teacher-card'),model=await rectangle(page,'#teacher-3d-panel'),camera=await rectangle(page,'#learner-card');
    snapshots.desktopLayout={teacher,model,camera};
    await page.screenshot({path:path.join(output,'lesson-3d-desktop.png')});
    assert.ok(model.x>=teacher.right-2&&camera.x>=model.right-2,'Three panels are adjacent in Teacher → model → You order.');
    assert.ok(Math.abs(teacher.y-model.y)<2,'Model remains beside its corresponding clip.');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
    const mobileTeacher=await rectangle(page,'#teacher-card'),mobileModel=await rectangle(page,'#teacher-3d-panel'),mobileCamera=await rectangle(page,'#learner-card');
    snapshots.mobileLayout={teacher:mobileTeacher,model:mobileModel,camera:mobileCamera};
    await page.screenshot({path:path.join(output,'lesson-3d-mobile.png'),fullPage:true});
    assert.ok(mobileModel.x>=mobileTeacher.right-2&&Math.abs(mobileModel.y-mobileTeacher.y)<2,
      'On phones the Teacher and its matching 3D model remain adjacent.');
    assert.ok(mobileCamera.y>=Math.max(mobileTeacher.bottom,mobileModel.bottom)-2,
      'The learner panel occupies the next mobile row.');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.setViewportSize({width:1440,height:900});
  });
  await check('Orbit/reset work, and closing restores the original teacher/webcam layout and evidence',async()=>{
    const canvas=page.locator('#teacher-3d-view canvas'),box=await canvas.boundingBox(),initial=await diag(page);
    await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.72,box.y+box.height*.62,{steps:12});await page.mouse.up();await page.waitForTimeout(200);
    const orbited=await diag(page);assert.ok(orbited.scene.cameraPosition.some((value,axis)=>Math.abs(value-initial.scene.cameraPosition[axis])>.05));
    await page.click('#reset-teacher-3d');await page.waitForTimeout(120);
    assert.ok((await diag(page)).scene.cameraPosition.every(Number.isFinite));
    const before=await evidence(page);await page.click('#close-teacher-3d');await page.waitForTimeout(80);
    assert.equal(await page.locator('#teacher-3d-panel').isVisible(),false);
    assert.equal(await page.locator('#toggle-teacher-3d').getAttribute('aria-expanded'),'false');
    assert.deepEqual(await evidence(page),before);
    const teacher=await rectangle(page,'#teacher-pixels'),camera=await rectangle(page,'#camera-pixels');
    assert.ok(camera.x>=teacher.right-2&&camera.y<teacher.bottom,'Two original panels are restored.');
    await page.click('#toggle-teacher-3d');await viewerReady(page,steps[1].id);
    assertActualSample(await diag(page),world,await page.locator('#teacher-video').evaluate(video=>video.currentTime));
    snapshots.reopened=await diag(page);
  });
  await check('Missing 3D data and a late load after close remain isolated from lesson playback',async()=>{
    const p=await browser.newPage({viewport:{width:1280,height:900}});await configurePage(p);
    const archivePattern='**/practice-media/recut-six/master.study-3d.poses.json';
    await p.route(archivePattern,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await p.goto(`${base}/first-three.html?step=1`);await lessonReady(p);await p.click('#toggle-teacher-3d');
    await p.waitForFunction(()=>!!window.lesson3DDiagnostics?.error);
    assert.equal((await diag(p)).drawnPoints,0);assert.equal((await diag(p)).ready,false);
    assert.equal(await p.locator('#teacher-video').evaluate(video=>video.readyState>=2),true);
    assert.equal(await p.evaluate(()=>window.firstThreeDiagnostics.feedback),null);
    await p.click('#close-teacher-3d');await p.unroute(archivePattern);
    let markRequested;const requested=new Promise(resolve=>{markRequested=resolve;});
    await p.route(archivePattern,async route=>{
      markRequested();await new Promise(resolve=>setTimeout(resolve,250));
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(world)});
    });
    await p.click('#toggle-teacher-3d');
    let timeout;try{await Promise.race([requested,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Reopening must retry a failed 3D archive load.')),3000);})]);}
    finally{clearTimeout(timeout);}
    await p.click('#close-teacher-3d');await p.waitForTimeout(350);
    assert.equal((await diag(p)).visible,false);assert.equal((await diag(p)).ready,false);
    assert.equal(await p.locator('#teacher-3d-panel').isVisible(),false);
    assert.equal(await p.locator('#teacher-3d-view canvas').count(),0,'Closing disposes the WebGL scene even if recorded data arrives late.');
    await p.click('#toggle-teacher-3d');await viewerReady(p,steps[0].id);
    assertActualSample(await diag(p),world,steps[0].practiceStartSeconds);
    assert.equal(await p.evaluate(()=>window.qaCameraRequests),0);await p.close();
  });
  await check('A real WebGL-disabled browser reports unavailability while the tutorial still works',async()=>{
    const fallback=await chromium.launch({channel:'chrome',headless:true,args:['--disable-webgl','--disable-webgl2']});
    try{
      const p=await fallback.newPage({viewport:{width:1280,height:900}});await configurePage(p);
      await p.goto(`${base}/first-three.html?step=1`);await lessonReady(p);await p.click('#toggle-teacher-3d');
      await p.waitForFunction(()=>window.lesson3DDiagnostics?.error||window.lesson3DDiagnostics?.scene?.error);
      assert.match(await p.locator('#teacher-3d-panel').innerText(),/unavailable|could not|unable/i);
      assert.equal(await p.locator('#teacher-video').evaluate(video=>video.readyState>=2),true);
      await p.locator('#replay').evaluate(button=>button.click());await p.waitForFunction(()=>window.firstThreeDiagnostics.phase==='watching');
      await p.waitForFunction(()=>document.getElementById('teacher-video').currentTime>.7);
      assert.equal(await p.evaluate(()=>window.qaCameraRequests),0);await p.click('#close-teacher-3d');
    }finally{await fallback.close();}
  });
  await check('The optional viewer makes no camera, remote-service or physical hardware requests and preserves archives',async()=>{
    assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);
    assert.deepEqual(requests.filter(url=>!url.startsWith(base)&&!url.startsWith('data:')&&!url.startsWith('blob:')),[]);
    assert.deepEqual(errors,[]);
    for(const [filename,expected]of Object.entries(baseline))assert.equal(hash(await readFile(path.join(root,filename))),expected,filename);
  });
}catch(error){result='FAIL';failure=error.stack??String(error);console.error(failure);process.exitCode=1;}
finally{
  if(browser)await browser.close();await server.shutdown();
  await writeFile(path.join(output,'verification.json'),JSON.stringify({result,checkedAt:new Date().toISOString(),checks,errors,
    blockedRequests,snapshots,unchangedFiles:baseline,failure,
    provenance:'Real saved teacher world-landmark data and real WebGL, isolated headless browser. Camera access is forbidden, API routes are disconnected software fixtures; no learner, physical USB or paid SDK acceptance is claimed.'},null,2)+'\n');
}
