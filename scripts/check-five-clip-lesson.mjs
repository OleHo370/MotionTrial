/** Five-clip lesson QA. Production controller functions run with constructed
 * controls; browser checks never request a physical camera or USB connection.
 * Constructed matches test orchestration only, not a person's movement. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {prepareSixthAssessmentReference} from '../public/sixth-assessment-reference.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {preparePracticeTubes} from '../public/practice-tube.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';

const root=new URL('../',import.meta.url),out=new URL('artifacts/five-clip-lesson-review/',root);
const base=process.env.FIVE_CLIP_TEST_URL||'http://127.0.0.1:8766';
const readJson=async file=>JSON.parse(await readFile(new URL(file,root),'utf8'));
const json=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
const manifest=await readJson('public/practice-media/recut-six/manifest.json');
const raw=await readJson('public/practice-media/recut-six/master.poses.json');
const source={...manifest.sources[0],data:LESSON_CONTROLS.referenceAdapter(raw)};
const sources=new Map([[source.id,source]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const sixth=prepareSixthAssessmentReference(lesson,source,await readJson('public/practice-media/recut-six/clip-06-assessment-targets.json'));
const allRefs=lesson.references.map((ref,i)=>i===5?sixth.guidanceReference:ref);
const allGuidance=lesson.guidanceReferences.map((ref,i)=>i===5?sixth.guidanceReference:ref);
const allPaths=lesson.steps.map((step,i)=>i===5?sixth.pathReference:preparePracticeTubes(allGuidance[i],step,sources));
const originalFirstFive={steps:lesson.steps.slice(0,5),refs:allRefs.slice(0,5),guidance:allGuidance.slice(0,5),paths:allPaths.slice(0,5)};
const controller=await readFile(new URL('public/first-three.js',root),'utf8');
const require=createRequire(import.meta.url),{parse}=require('next/dist/compiled/acorn');
const tree=parse(controller,{ecmaVersion:'latest',sourceType:'module'}),slice=node=>controller.slice(node.start,node.end);
const functions=new Map(tree.body.filter(node=>node.type==='FunctionDeclaration').map(node=>[node.id.name,slice(node)]));
const initializers=new Map(tree.body.filter(node=>node.type==='VariableDeclaration').flatMap(node=>node.declarations)
  .filter(node=>node.id.type==='Identifier').map(node=>[node.id.name,slice(node.init)]));
const nextHandler=tree.body.filter(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression')
  .map(node=>node.expression).find(node=>node.callee.type==='MemberExpression'&&node.callee.property.name==='addEventListener'
    &&node.callee.object.type==='CallExpression'&&node.callee.object.callee.name==='$'
    &&node.callee.object.arguments[0]?.value==='next'&&node.arguments[0]?.value==='click')?.arguments[1];
const checks=[],snapshots={},pageErrors=[];
async function check(name,run){await run();checks.push(name);console.log(`PASS: ${name}`);}

function harness(index=0){
  const elements=new Map(),calls={choose:[],cameraStops:0};
  const $=id=>{
    if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',src:'',alt:'',
      videoWidth:450,videoHeight:360,style:{},attributes:{},nextElementSibling:{textContent:''},
      setAttribute(name,value){this.attributes[name]=value;}});
    return elements.get(id);
  };
  const video={currentTime:lesson.steps[index].practiceStartSeconds,readyState:4,paused:true,pause(){this.paused=true;}};
  const context={console,Map,Set,Number,Math,structuredClone,$,video,INDICES:[...LESSON_CONTROLS.indices],POINT_COUNT:'four',
    performance:{now:()=>1000},feedbackSpeech:{cancel(){},isBusy:()=>false},
    hardwareFeedback:{neutral(){},update(){}},createFullHeightLayout,
    cameraFeedAvailable:()=>true,createStartPositionSession:()=>({bodyFrame:null,aspect:null}),
    drawTeacher(){},drawGuides(){},render(){},syncPracticeModeUI(){},clearEvidence(){},
    put:(id,text)=>{$(id).textContent=text;},displayReason:result=>result?.reason,
    phase(name,duration=0){context.state.phase=name;context.state.remainingMs=duration;},
    async loadRecording(){calls.choose.push(context.state.index);return true;},
    async seek(time){video.currentTime=time;return true;},
    waitAtStart(){context.state.phase='positioning';},watchDemonstration(){context.state.phase='watching';},
    returnToStart(reason){context.state.phase='positioning';context.state.positionNotice=reason;},
  };
  vm.createContext(context);
  vm.runInContext(`globalThis.RULES=(${initializers.get('RULES')})`,context);
  vm.runInContext(`globalThis.state=${initializers.get('state')}`,context);
  Object.assign(context.state,{manifest:{...manifest,steps:originalFirstFive.steps},
    refs:originalFirstFive.refs,guidanceRefs:originalFirstFive.guidance,pathRefs:originalFirstFive.paths,
    ready:true,active:true,index,phase:'feedback',
    feedback:{status:'match',reason:'Constructed controller match; not webcam inference.'},reviewAction:'advance',
    placement:{bodyFrame:null,aspect:null},
    camera:{getState:()=>({running:true,generation:1}),stop(){calls.cameraStops++;}}});
  for(const name of ['step','reference','guidance','pathReference','total','practiceStart'])
    vm.runInContext(`globalThis.${name}=${initializers.get(name)}`,context);
  for(const name of ['practiceMode','activeControlIndices','controlOptions','controlCount','choose',
    'recordAndAdvance','completeFeedback','retryFeedback','stop','finish','renderProgress','seedScreenTargets','holdTeacherAtBoundary'])
    vm.runInContext(functions.get(name),context);
  assert.ok(nextHandler,'Actual Next handler exists');
  vm.runInContext(`globalThis.manualNext=${slice(nextHandler)}`,context);
  return {env:context,state:context.state,calls,elements,video,
    async call(name,...args){await context[name](...args);for(let n=0;n<20;n++)await Promise.resolve();}};
}

async function controllerChecks(){
  await check('The original first five clips retain their exact archived SHA-256 bytes and source boundaries',async()=>{
    assert.equal(manifest.steps.length,6,'The original six-cut source archive is preserved');
    for(const step of originalFirstFive.steps){
      assert.equal(sha(await readFile(new URL(`public${step.clipSrc}`,root))),step.clipSha256,step.id);
      const original=manifest.steps.find(candidate=>candidate.id===step.id);
      for(const key of ['sourceStartFrame','sourceEndFrameExclusive','referenceStartFrame','referenceEndFrame',
        'practiceStartSeconds','teacherFreezeSeconds','clipSrc','clipFrameCount'])assert.equal(step[key],original[key],`${step.id}.${key}`);
    }
    assert.equal(originalFirstFive.steps[4].teacherFreezeSeconds,15.5);
  });
  await check('Each of the five production match advances completes at clip 5 without selecting clip 6',async()=>{
    const h=harness();
    for(let index=0;index<5;index++){
      assert.equal(h.state.index,index);h.state.phase='feedback';h.state.feedback={status:'match'};h.state.reviewAction='advance';
      await h.call('completeFeedback');
      if(index<4)assert.equal(h.state.index,index+1);
    }
    assert.equal(h.state.phase,'finished');assert.equal(h.state.index,4);assert.equal(h.state.active,false);
    assert.equal(h.state.results.size,5);assert.equal(h.calls.cameraStops,1);
    assert.deepEqual(h.calls.choose,[1,2,3,4]);
    assert.match(h.elements.get('completion-description').textContent,/5 \/ 5 movements/);
    assert.equal(h.elements.get('completion').hidden,false);
    await h.call('manualNext');await h.call('completeFeedback');
    assert.equal(h.state.index,4);assert.equal(h.state.results.size,5);assert.equal(h.calls.cameraStops,1);
  });
  await check('Production manual Next finishes the fifth clip and direct clip-6 selection is rejected',async()=>{
    const h=harness(4);await h.call('manualNext');
    assert.equal(h.state.phase,'finished');assert.equal(h.state.index,4);assert.equal(h.calls.choose.length,0);
    assert.equal(h.state.results.get(originalFirstFive.steps[4].id).status,'manual');
    const invalid=harness(4);assert.equal(await invalid.env.choose(5),false);
    assert.equal(invalid.state.index,4);assert.equal(invalid.calls.choose.length,0);
  });
  await check('Clip-5 mismatch or tracking uncertainty still retries without completing the five-clip lesson',async()=>{
    for(const status of ['mismatch','unknown']){
      const h=harness(4);h.state.feedback={status};h.state.reviewAction='retry';await h.call('completeFeedback');
      assert.equal(h.state.phase,'feedback','Next cannot accept a mismatched or unknown attempt');
      await h.call('retryFeedback');
      assert.equal(h.state.phase,'positioning');assert.equal(h.state.index,4);assert.equal(h.state.results.size,0);
      assert.equal(h.calls.cameraStops,0);assert.equal(h.calls.choose.length,0);
    }
  });
  await check('The final retained attempt freezes exactly at 15.5 seconds and permits unlimited finishing time',async()=>{
    const h=harness(4);h.state.phase='demonstrating';h.video.currentTime=15.54;h.video.paused=false;
    await h.call('holdTeacherAtBoundary');
    assert.equal(h.video.currentTime,15.5);assert.equal(h.video.paused,true);
    assert.equal(h.state.phase,'grace');assert.equal(h.state.remainingMs,0);
    assert.equal(h.state.deadline,null,'An unfinished movement has no countdown to feedback');
    assert.equal(h.state.index,4);assert.equal(h.state.results.size,0);assert.equal(h.calls.choose.length,0);
  });
  await check('The first five target layouts retain their former full-lesson geometry at five camera aspects',async()=>{
    for(const aspect of [450/360,16/9,4/3,7/8,9/16])for(let index=0;index<5;index++){
      const h=harness(index);h.env.$('camera-video').videoWidth=aspect*360;h.env.$('camera-video').videoHeight=360;
      await h.call('seedScreenTargets');
      const expected=createFullHeightLayout(allGuidance[index],allGuidance,aspect,allPaths);
      assert.deepEqual(json(h.state.screenLayout),json(expected),`clip ${index+1}, aspect ${aspect}`);
    }
  });
  await check('The production timeline still measures each retained clip playback without imposing review/grace deadlines',async()=>{
    const rules=json(vm.runInNewContext(`(${initializers.get('RULES')})`));
    assert.equal(rules.feedbackMs,0);assert.equal(rules.graceMs,0);assert.equal(rules.maximumAgeMs,450);
    for(let index=0;index<5;index++){
      const h=harness(index),step=originalFirstFive.steps[index];h.state.phase='demonstrating';
      h.video.currentTime=(step.practiceStartSeconds+step.teacherFreezeSeconds)/2;
      await h.call('renderProgress');assert.equal(h.elements.get('progress-meter').attributes['aria-valuenow'],'50');
      assert.ok(Math.abs(parseFloat(h.elements.get('progress-fill').style.width)-50)<1e-9);
      h.video.currentTime=step.teacherFreezeSeconds;await h.call('renderProgress');
      assert.equal(h.elements.get('progress-meter').attributes['aria-valuenow'],'100');
    }
  });
}

async function browserChecks(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(30000);
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.addInitScript(()=>{
      window.qaCameraRequests=0;
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{
        window.qaCameraRequests++;throw new DOMException('QA prohibits physical camera access','NotAllowedError');
      };
    });
    await page.route('**/api/arduino/**',route=>route.fulfill({status:503,contentType:'application/json',
      body:JSON.stringify({connected:false,state:'off',message:'QA disconnected hardware fixture; no USB activity.'})}));
    const loaded=async step=>{
      await page.goto(`${base}/first-three.html?step=${step}`);
      await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready&&!window.firstThreeDiagnostics.loading);
      return page.evaluate(()=>({...window.firstThreeDiagnostics,...window.startPositionDiagnostics,
        paths:window.movementPathDiagnostics.pathReferences,category:window.recutLessonDiagnostics.currentCategory,
        coverage:window.recutLessonDiagnostics.coverage,seams:window.recutLessonDiagnostics.seams}));
    };
    await check('Browser boots with exactly five unchanged teaching/reference/path entries and no camera request',async()=>{
      const d=await loaded(1);assert.equal(d.stepCount,5);assert.equal(d.index,0);assert.equal(d.phase,'positioning');
      assert.equal(await page.locator('#step-list button').count(),5);
      assert.equal(await page.locator('#step-list button[data-index="5"]').count(),0);
      assert.equal(await page.locator('#step-count').textContent(),'1 / 5');
      assert.deepEqual(d.references,json(originalFirstFive.refs));
      assert.deepEqual(d.guidanceReferences,json(originalFirstFive.guidance));
      assert.deepEqual(d.paths,json(originalFirstFive.paths));
      assert.equal(d.seams.length,4);
      for(const [key,value]of Object.entries({firstFrame:15,endFrameExclusive:465,frameCount:450,fps:30,startSeconds:.5,endSeconds:15.5}))
        assert.equal(d.coverage[key],value,`Selected lesson coverage ${key}`);
      assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);
      assert.equal(await page.locator('#practice-mode-controls').isVisible(),false);
      snapshots.firstClip={index:d.index,stepCount:d.stepCount,phase:d.phase,selection:d.selection};
    });
    await check('Every retained browser clip has the original source frame and time bounds and full-body controls',async()=>{
      for(let index=0;index<5;index++){
        await page.locator(`#step-list button[data-index="${index}"]`).evaluate(button=>button.click());
        await page.waitForFunction(index=>window.firstThreeDiagnostics.index===index&&!window.firstThreeDiagnostics.loading,index);
        const d=await page.evaluate(()=>window.firstThreeDiagnostics),expected=originalFirstFive.steps[index];
        for(const key of ['id','sourceStartFrame','sourceEndFrameExclusive','referenceStartFrame','referenceEndFrame',
          'practiceStartSeconds','teacherFreezeSeconds','clipSrc'])assert.equal(d.selection[key],expected[key],key);
        assert.ok(Math.abs(d.teacherTime-expected.practiceStartSeconds)<.06);
        assert.equal(d.practiceMode,'full-body');assert.deepEqual(d.controlIndices,[33,34,35,36]);
        assert.equal(await page.locator('#practice-mode-controls').isVisible(),false);
      }
      assert.equal(await page.locator('#step-count').textContent(),'5 / 5');
    });
    await check('Former step-6 and out-of-range URLs open the final retained clip and cannot expose clip 6',async()=>{
      for(const requested of [6,99]){
        const d=await loaded(requested);assert.equal(d.index,4);assert.equal(d.stepId,originalFirstFive.steps[4].id);
        assert.equal(d.teacherTime,14.5);assert.equal(d.selection.teacherFreezeSeconds,15.5);
        assert.equal(d.stepCount,5);assert.equal(await page.locator('#practice-mode-controls').isVisible(),false);
      }
      snapshots.excludedClipURL=await page.evaluate(()=>({index:window.firstThreeDiagnostics.index,
        stepCount:window.firstThreeDiagnostics.stepCount,selection:window.firstThreeDiagnostics.selection}));
      await page.screenshot({path:fileURLToPath(new URL('fifth-clip.png',out))});
    });
    await check('The real fifth-clip preview stops after its own interval and returns to its start without a camera or sixth clip',async()=>{
      await page.evaluate(()=>{
        window.qaPreviewTimes=[];
        const video=document.getElementById('teacher-video');
        for(const name of ['timeupdate','pause'])video.addEventListener(name,()=>window.qaPreviewTimes.push(video.currentTime));
        window.qaPreviewSampler=setInterval(()=>window.qaPreviewTimes.push(video.currentTime),10);
      });
      await page.click('#visibility-settings');await page.click('#replay');
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='watching');
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='positioning'&&!window.firstThreeDiagnostics.active);
      const d=await page.evaluate(()=>window.firstThreeDiagnostics),times=await page.evaluate(()=>{
        clearInterval(window.qaPreviewSampler);return window.qaPreviewTimes;
      });
      snapshots.finalPreview={index:d.index,phase:d.phase,maximumObservedTime:Math.max(...times),returnedTime:d.teacherTime};
      assert.equal(d.index,4);assert.equal(d.stepCount,5);assert.equal(d.teacherTime,14.5);
      assert.equal(await page.locator('#teacher-video').evaluate(video=>video.paused),true);
      assert.ok(Math.max(...times)>=15.45,`The fifth preview reaches its own finishing frame (${Math.max(...times)} s sampled)`);
      assert.ok(Math.max(...times)<15.6,'Frame-boundary pause occurs before another clip can continue');
      assert.equal(d.results.length,0);assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);
    });
    await check('The browser manual Next finishes clip 5, reports manual continuation, and never begins another clip',async()=>{
      await page.locator('#next').evaluate(button=>button.click());
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='finished');
      const d=await page.evaluate(()=>window.firstThreeDiagnostics);
      assert.equal(d.index,4);assert.equal(d.stepCount,5);assert.equal(d.active,false);
      assert.equal(d.results.length,1);assert.equal(d.results[0].status,'manual');
      assert.equal(await page.locator('#next').isDisabled(),true);
      assert.equal(await page.locator('#completion').isVisible(),true);
      assert.match(await page.locator('#completion-description').textContent(),/0 \/ 5 movements.*1 manually continued/);
      assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);
      snapshots.manualCompletion={index:d.index,phase:d.phase,results:d.results};
    });
    assert.deepEqual(pageErrors,[]);await page.close();
  }finally{await browser.close();}
}

await mkdir(out,{recursive:true});
let result='PASS',failure=null;
try{await controllerChecks();if(!process.argv.includes('--no-browser'))await browserChecks();}
catch(error){result='FAIL';failure=error.stack??String(error);console.error(failure);process.exitCode=1;}
await writeFile(new URL('verification.json',out),JSON.stringify({result,checkedAt:new Date().toISOString(),checks,
  controllerSha256:sha(controller),pageErrors,snapshots,failure,browserPerformed:!process.argv.includes('--no-browser'),
  provenance:'Actual production controller declarations with constructed control outcomes, archived teacher references, and headless browser navigation. No learner evidence is represented as live tracking, and physical camera/USB requests are blocked.'},null,2)+'\n');
