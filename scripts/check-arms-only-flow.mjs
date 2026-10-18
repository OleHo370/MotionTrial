/**
 * Deterministic controller QA. Actual production controller declarations run
 * with constructed clock, video, learner evidence, camera and evaluator inputs.
 * This is orchestration verification, not live inference or learner acceptance.
 * No camera, speech engine, Arduino connection or physical output is activated.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {REVIEW_RULES} from '../public/practice-attempt-review.js';

const require=createRequire(import.meta.url),{parse}=require('next/dist/compiled/acorn');
const source=await readFile(new URL('../public/first-three.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/first-three.html',import.meta.url),'utf8');
const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),slice=node=>source.slice(node.start,node.end);
const definitions=new Map(tree.body.filter(node=>node.type==='FunctionDeclaration').map(node=>[node.id.name,slice(node)]));
const declarations=new Map(tree.body.filter(node=>node.type==='VariableDeclaration').flatMap(statement=>
  statement.declarations.filter(node=>node.id.type==='Identifier').map(node=>[node.id.name,node.init&&slice(node.init)])));
const clickHandlers=new Map(tree.body.filter(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression')
  .map(node=>node.expression).filter(node=>node.callee.type==='MemberExpression'&&node.callee.property.name==='addEventListener'
    &&node.callee.object.type==='CallExpression'&&node.callee.object.callee.name==='$'&&node.arguments[0]?.value==='click')
  .map(node=>[node.callee.object.arguments[0].value,slice(node.arguments[1])]));
const checks=[];
async function save(result){
  const directory=new URL('../artifacts/arms-only-flow/',import.meta.url);await mkdir(directory,{recursive:true});
  await writeFile(new URL('controller-qa.json',directory),JSON.stringify({result,checkedAt:new Date().toISOString(),
    controllerSha256:createHash('sha256').update(source).digest('hex'),groups:checks.length,checks,
    provenance:'Actual production controller declarations executed with explicitly constructed clock, video, camera and evaluator controls. Optional browser checks deny camera access and intercept all Arduino API requests. No live camera, physical learner, speech or hardware acceptance is claimed.',
  },null,2)+'\n');
}
async function check(name,run){
  try{await run();checks.push({name,passed:true});console.log(`PASS: ${name}`);}
  catch(error){checks.push({name,passed:false,error:error.stack??String(error)});await save('FAIL');throw error;}
}
function element(){
  const attributes=new Map(),children=[];
  return {hidden:false,disabled:false,textContent:'',value:'',checked:true,src:'',alt:'',children,
    style:{width:'',setProperty(){}},dataset:{},nextElementSibling:{textContent:''},
    parentElement:{dataset:{},style:{setProperty(){}}},classList:{toggle(){},contains:()=>false},
    setAttribute(name,value){attributes.set(name,String(value));},getAttribute:name=>attributes.get(name),
    querySelector(){return this.pointState??=element();},querySelectorAll:()=>children,
    replaceChildren(...nodes){children.splice(0,children.length,...nodes);},append(...nodes){children.push(...nodes);},
    addEventListener(){},click(){throw new Error('Unexpected implicit device start.');}};
}
function harness({index=5,active=false}={}){
  const elements=new Map(),selectors=new Map(),clock={now:1000},events=[],cameraState={running:active,generation:1};
  const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const frame={hip:{x:.5,y:.5},scale:.5,aspect:1},indices=[...LESSON_CONTROLS.indices];
  const refs=Array.from({length:6},(_,i)=>({id:`step-${i+1}`,referenceUsable:true,usable:true,
    guides:indices.map(index=>({index,valid:true,start:{x:0,y:0},end:{x:0,y:0}}))}));
  const steps=Array.from({length:6},(_,i)=>({id:`step-${i+1}`,title:`Movement ${i+1}`,sourceId:'master',
    startSeconds:.5+i,endSeconds:1.5+i,practiceStartSeconds:.5+i,teacherFreezeSeconds:1.5+i,
    screenshots:{start:'start.png',end:'end.png'}}));
  const video={currentTime:steps[index].practiceStartSeconds,readyState:4,seeking:false,ended:false,paused:true,
    videoWidth:450,videoHeight:360,playbackRate:.5,
    pause(){this.paused=true;events.push({kind:'video-pause',at:clock.now});},
    async play(){this.paused=false;events.push({kind:'video-play',at:clock.now});},getAttribute:()=>'/constructed/master.mp4'};
  const review={created:[],observed:[],finalized:[],result:{status:'match',passed:true,percent:null,messages:['Close enough'],reason:'Close enough'}};
  const readiness={created:[],evaluated:[],heldMs:0},speech={busy:false,cancelCount:0,speakCount:0};
  const context={console,Map,Set,Date,Math,Number,Promise,structuredClone,URLSearchParams,location:{search:'?step=6'},
    performance:{now:()=>clock.now},setTimeout,clearTimeout,requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    document:{getElementById:$,createElement:()=>element(),
      querySelector(selector){if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector);},
      querySelectorAll:()=>[],documentElement:{classList:{toggle(){},contains:()=>false}}},
    $,video,INDICES:indices,POINT_COUNT:LESSON_CONTROLS.countWord,LESSON_CONTROLS,FOUR_POINT_COLORS:LESSON_CONTROLS.colors,
    REVIEW_RULES,START_POSITION_RULES:LESSON_CONTROLS.startRules,
    feedbackSpeech:{cancel(){speech.cancelCount++;speech.busy=false;},isBusy:()=>speech.busy,
      speakReview(){speech.speakCount++;},unlock(){events.push({kind:'speech-unlock'});}},
    hardwareFeedback:{neutral(){events.push({kind:'hardware-neutral'});},update(){},destroy(){}},
    render(){events.push({kind:'render',phase:context.state?.phase});},drawTeacher(){},drawGuides(){},seedScreenTargets(){},
    fitPortraitCamera(){},fitVisibilityTeacher(){},teacherDisplaySmoother:{reset(){}},
    createDisplaySmoother:()=>({reset(){}}),teacherDisplayVisibility:.45,
    cameraFeedAvailable:()=>cameraState.running,
    put(id,text){$(id).textContent=text;},visible:p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y),
    createStartPositionSession(reference,options={}){
      readiness.created.push({reference,options});return {bodyFrame:frame,aspect:1,heldMs:0,holdReady:false};},
    prepareStartPosition(reference,options={}){return {usable:true,targets:(options.controlIndices??indices).map(index=>({index,valid:true}))};},
    evaluateStartPosition(reference,observation,options){readiness.evaluated.push({reference,observation,options});
      return {status:'match',allNear:true,holdReady:readiness.heldMs>=1500,heldMs:readiness.heldMs,bodyFrame:frame,limbs:[]};},
    createAttemptReview(reference,pathReference,options){const session={controls:(options.controlIndices??indices).map(index=>({index})),
      expectedDurationMs:options.durationMs/options.playbackRate,finalized:false};review.created.push({reference,pathReference,options,session});return session;},
    observeAttemptReview(session,observation,options){review.observed.push({session,observation,options});return {status:'collecting',limbs:[]};},
    finalizeAttemptReview(session,options){review.finalized.push({session,options});session.finalized=true;return structuredClone(review.result);},
    async loadRecording(){context.state.sourceId='master';return true;},
    async seek(time,token){video.currentTime=time;return token===context.state.operation;},
  };
  vm.createContext(context);
  for(const name of ['RULES','displayReason','state'])vm.runInContext(`globalThis.${name}=${declarations.get(name)}`,context);
  Object.assign(context.state,{manifest:{steps},ready:true,active,phase:'positioning',loading:false,refs,guidanceRefs:refs,pathRefs:refs,
    index,sourceId:'master',speed:.5,placement:{bodyFrame:frame,aspect:1},fixedFrame:null,
    camera:{getState:()=>({...cameraState}),stop(){cameraState.running=false;events.push({kind:'camera-stop'});},
      setPointIndices(selected){events.push({kind:'camera-indices',indices:[...selected]});},
      setControlIndices(selected){events.push({kind:'camera-indices',indices:[...selected]});}},
  });
  Object.assign(context,{step:()=>context.state.manifest.steps[context.state.index],
    guidance:()=>context.state.guidanceRefs[context.state.index],pathReference:()=>context.state.pathRefs[context.state.index],
    reference:()=>context.state.refs[context.state.index],total:()=>context.state.manifest.steps.length,
    practiceStart:()=>context.state.manifest.steps[context.state.index].practiceStartSeconds,
    recording:()=>({video:{frameCount:525,fps:30}})});
  const excluded=new Set(['controls','render','renderPosition','renderProgress','renderFlowStatus',
    'nearestSample','drawTeacher','drawGuides','readJson','validateData','frameRecording','fitVisibilityTeacher','fitPortraitCamera',
    'loadRecording','boot','seek','screenGuides','screenPaths','seedScreenTargets','cameraFeedAvailable']);
  for(const [name,definition]of definitions)if(!excluded.has(name))vm.runInContext(definition,context);
  // These callbacks retain the exact production click wiring.
  for(const id of ['practice-full-body','practice-arms-only'])if(clickHandlers.has(id))
    vm.runInContext(`globalThis.${id==='practice-full-body'?'fullBodyClick':'armsOnlyClick'}=${clickHandlers.get(id)}`,context);
  const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
  return {env:context,state:context.state,elements,clock,events,cameraState,frame,video,review,readiness,speech,flush,
    async call(name,...args){assert.equal(typeof context[name],'function',`Actual function ${name} exists`);
      const result=context[name](...args);if(result?.then)await result;await flush();return result;},
    useActual(name){assert.ok(definitions.has(name),name);vm.runInContext(definitions.get(name),context);}};
}
function observation(h){return {observedAtMs:h.clock.now,aspectRatio:1,sample:{status:'pose',tMs:h.clock.now,
  provenance:'CONSTRUCTED controller QA observation; not webcam inference',
  landmarks:[33,34].map(index=>({index,x:.5,y:.5,visibility:1,presence:1}))}};}
const currentIndices=h=>Array.from(h.env.activeControlIndices());
async function readyAttempt(h){h.state.active=true;h.cameraState.running=true;h.state.watched=true;h.state.phase='positioning';
  h.state.fixedFrame=h.frame;h.state.positioning={holdReady:true,heldMs:1500,bodyFrame:h.frame};await h.call('startAttempt');
  assert.equal(h.state.phase,'demonstrating');}
async function reviewBoundary(h){h.clock.now=h.state.attemptStartedAtMs+2000;h.video.currentTime=h.state.manifest.steps[h.state.index].teacherFreezeSeconds;
  await h.call('tick');assert.equal(h.state.phase,'grace');}

await check('Step 6 offers an additional arms button and full body remains the default',async()=>{
  for(const id of ['practice-full-body','practice-arms-only']){assert.match(html,new RegExp(`id=["']${id}["']`));assert.ok(clickHandlers.has(id));}
  const h=harness();assert.equal(h.state.stepSixMode,'full-body');assert.deepEqual(currentIndices(h),[33,34,35,36]);
  await h.call('armsOnlyClick');assert.equal(h.state.stepSixMode,'arms-only');assert.deepEqual(currentIndices(h),[33,34]);
  assert.deepEqual(h.elements.get('position-points').children.map(chip=>Number(chip.dataset.joint)),[33,34]);
  await h.call('fullBodyClick');assert.equal(h.state.stepSixMode,'full-body');assert.deepEqual(currentIndices(h),[33,34,35,36]);
  assert.deepEqual(h.elements.get('position-points').children.map(chip=>Number(chip.dataset.joint)),[33,34,35,36]);
  assert.equal(h.events.filter(event=>event.kind==='video-play'||event.kind==='camera-stop').length,0);
});

await check('Arms-only cannot change the controls on steps 1 through 5',async()=>{
  for(let index=0;index<5;index++){const h=harness({index});await h.call('armsOnlyClick');assert.deepEqual(currentIndices(h),[33,34,35,36]);
    assert.equal(h.state.results.size,0);assert.equal(h.review.created.length,0);}
});

await check('Arms mode resets an interrupted attempt, readiness, pending review and the previous step 6 result',async()=>{
  const h=harness({active:true});await readyAttempt(h);h.state.positioning={heldMs:1499,holdReady:false};
  h.state.feedback={status:'match',passed:true};h.state.reviewAction='advance';h.state.results.set('step-6',{status:'matched',practiceMode:'full-body'});
  h.speech.busy=true;const operation=h.state.operation;await h.call('armsOnlyClick');
  assert.ok(h.state.operation>operation);assert.equal(h.state.stepSixMode,'arms-only');
  assert.equal(h.state.results.has('step-6'),false);assert.equal(h.state.movement,null);assert.equal(h.state.feedback,null);
  assert.equal(h.state.reviewAction,null);assert.equal(h.state.fixedFrame,null);assert.equal(h.state.positioning,null);
  assert.equal(h.speech.busy,false);assert.equal(h.review.finalized.length,0);
  assert.ok(h.events.some(event=>event.kind==='hardware-neutral'));
  h.clock.now+=20000;await h.call('tick');assert.equal(h.state.results.size,0);
});

await check('Watching arms-only remains unscored and readiness still waits for the 1.5 second hold',async()=>{
  const h=harness({active:true});await h.call('armsOnlyClick');await h.call('watchDemonstration','lesson');
  assert.equal(h.state.phase,'watching');await h.call('observe',observation(h));assert.equal(h.review.created.length,0);
  assert.equal(h.review.observed.length,0);h.video.currentTime=6.5;await h.call('finishWatch');
  assert.equal(h.state.phase,'positioning');assert.equal(h.state.watched,true);
  h.readiness.heldMs=1499;await h.call('observe',observation(h));assert.equal(h.state.phase,'positioning');
  h.clock.now++;h.readiness.heldMs=1500;await h.call('observe',observation(h));assert.equal(h.state.phase,'demonstrating');
  assert.equal(h.review.created.length,1);assert.deepEqual(Array.from(h.review.created[0].options.controlIndices),[33,34]);
  assert.equal(h.review.created[0].options.durationMs,1000);assert.equal(h.review.created[0].options.playbackRate,.5);
});

await check('Both practice modes use the unchanged clip-timeline progress renderer',async()=>{
  for(const mode of ['full-body','arms-only']){const h=harness();if(mode==='arms-only')await h.call('armsOnlyClick');h.useActual('renderProgress');
    h.state.phase='demonstrating';h.video.currentTime=6;await h.call('renderProgress');
    assert.equal(h.elements.get('progress-fill').style.width,'50%');assert.equal(h.elements.get('flow-path-fill').style.width,'50%');
    assert.equal(h.elements.get('progress-meter').getAttribute('aria-valuenow'),'50');
    assert.equal(h.elements.get('progress-meter').getAttribute('aria-valuetext'),'50 percent of clip playback; this is not a movement score');
    h.video.currentTime=6.5;await h.call('renderProgress');assert.equal(h.elements.get('progress-fill').style.width,'100%');}
});

await check('Both modes wait for the full clip, one second grace and three seconds review before recording their tagged result',async()=>{
  for(const mode of ['full-body','arms-only']){const h=harness();if(mode==='arms-only')await h.call('armsOnlyClick');
    await readyAttempt(h);h.clock.now+=500;h.video.currentTime=5.75;await h.call('observe',observation(h));
    assert.equal(h.review.finalized.length,0);assert.equal(h.state.results.size,0);assert.equal(h.state.phase,'demonstrating');
    await reviewBoundary(h);h.clock.now+=999;await h.call('tick');assert.equal(h.state.phase,'grace');
    h.clock.now++;await h.call('tick');assert.equal(h.state.phase,'feedback');assert.equal(h.review.finalized.length,1);
    assert.equal(h.env.RULES.graceMs,1000);assert.equal(h.env.RULES.feedbackMs,3000);
    h.clock.now+=2999;await h.call('tick');assert.equal(h.state.phase,'feedback');assert.equal(h.state.results.size,0);
    h.clock.now++;await h.call('tick');assert.equal(h.state.phase,'finished');assert.equal(h.state.results.size,1);
    const result=h.state.results.get('step-6');assert.equal(result.status,'matched');assert.equal(result.practiceMode,mode);}
});

await check('Unknown and mismatch arms reviews retry without recording an arms completion',async()=>{
  for(const status of ['unknown','mismatch']){const h=harness();await h.call('armsOnlyClick');
    h.review.result={status,passed:false,percent:null,messages:['Constructed tracking issue'],reason:'Constructed tracking issue'};
    await readyAttempt(h);await reviewBoundary(h);h.clock.now+=1000;await h.call('tick');
    h.clock.now+=3000;await h.call('tick');assert.equal(h.state.phase,'positioning');assert.equal(h.state.results.size,0);
    assert.deepEqual(currentIndices(h),[33,34]);assert.equal(h.state.watched,true);}
});

// This entire camera replacement belongs to QA. It deliberately creates no
// MediaStream or pose model, and labels every supplied point as constructed.
function createSyntheticArmsCamera({video,canvas,startButton,stopButton,statusElement,mirrorCheckbox,onObservation,onState}){
  let running=false,generation=0,last=null;
  const getState=()=>({running,generation,phase:running?'running':'idle',tracking:running?'constructed-qa':'off',
    message:'CONSTRUCTED software camera fixture; no physical camera or inference.',
    overlayJoints:last?.sample.landmarks.map(point=>point.index)??[],provenance:'CONSTRUCTED QA input'});
  const stop=()=>{running=false;generation++;last=null;onObservation(null);onState(getState());};
  const mirror=()=>{const transform=mirrorCheckbox.checked?'scaleX(-1)':'none';video.style.transform=transform;canvas.style.transform=transform;};
  mirrorCheckbox.addEventListener('change',mirror);mirror();
  startButton.addEventListener('click',()=>{
    running=true;generation++;
    Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>640});
    Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>480});
    Object.defineProperty(video,'srcObject',{configurable:true,get:()=>running?{provenance:'CONSTRUCTED software fixture'}:null});
    statusElement.textContent='CONSTRUCTED QA palms; no live camera.';onState(getState());
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  stopButton.addEventListener('click',stop);
  window.syntheticArmsCamera={push(landmarks){
    if(!running)return;
    const now=performance.now();last={observedAtMs:now,aspectRatio:640/480,
      sample:{status:'pose',tMs:now,landmarks,provenance:'CONSTRUCTED software palm trace; not webcam inference'}};
    const ctx=canvas.getContext('2d');canvas.width=640;canvas.height=480;
    ctx.clearRect(0,0,640,480);ctx.font='12px sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';
    ctx.save();ctx.translate(320,22);if(mirrorCheckbox.checked)ctx.scale(-1,1);
    ctx.fillText('CONSTRUCTED QA TRACE - NO LIVE CAMERA',0,0);ctx.restore();
    for(const point of landmarks){ctx.beginPath();ctx.arc(point.x*640,point.y*480,7,0,2*Math.PI);
      ctx.fillStyle=point.index===33?'#5ef2dc':'#ffcb64';ctx.fill();}
    onObservation(last);
  },getState};
  onState(getState());
  return {getState,stop,getDisplayObservation:()=>last,destroy:stop};
}

if(process.argv.includes('--browser')){
  await check('Browser buttons switch step 6 trackers and framing without requesting camera or USB access',async()=>{
    const {chromium}=await import('@playwright/test');
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try{
      const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],usbRequests=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/arduino/**',route=>{usbRequests.push(route.request().url());return route.fulfill({status:503,contentType:'application/json',
        body:JSON.stringify({ok:false,error:'Constructed QA response; no physical USB request.'})});});
      await page.addInitScript(()=>{
        window.armsOnlyQACameraRequests=0;
        navigator.mediaDevices.getUserMedia=async()=>{window.armsOnlyQACameraRequests++;
          throw new DOMException('Camera always denied by this software QA fixture.','NotAllowedError');};
      });
      const base=process.env.MOTIONTRIAL_STATIC_QA_URL??'http://127.0.0.1:8766';
      await page.goto(`${base}/first-three.html?step=6`);
      await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready&&!window.firstThreeDiagnostics.loading);
      assert.equal(await page.locator('#practice-mode-controls').isVisible(),true);
      assert.equal(await page.locator('#practice-full-body').getAttribute('aria-pressed'),'true');
      let state=await page.evaluate(()=>window.firstThreeDiagnostics);
      assert.equal(state.practiceMode,'full-body');assert.deepEqual(state.controlIndices,[33,34,35,36]);
      const source=state.teacherVideo.src,selection=state.selection;
      await page.locator('#practice-arms-only').click();
      state=await page.evaluate(()=>window.firstThreeDiagnostics);
      assert.equal(state.practiceMode,'arms-only');assert.deepEqual(state.controlIndices,[33,34]);
      assert.equal(state.teacherVideo.src,source);assert.deepEqual(state.selection,selection);
      assert.equal(await page.locator('#practice-arms-only').getAttribute('aria-pressed'),'true');
      assert.match(await page.locator('#practice-framing').textContent(),/Head at the top.*waist at the bottom/);
      assert.deepEqual(await page.locator('#position-points [data-joint]').evaluateAll(chips=>chips.map(chip=>Number(chip.dataset.joint))),[33,34]);
      assert.ok(state.teacherJoints.every(index=>index===33||index===34));
      const directory=new URL('../artifacts/arms-only-flow/',import.meta.url);await mkdir(directory,{recursive:true});
      await page.screenshot({path:new URL('step-6-arms-only.png',directory).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
      await page.locator('#practice-full-body').click();
      assert.deepEqual((await page.evaluate(()=>window.firstThreeDiagnostics)).controlIndices,[33,34,35,36]);
      assert.equal(await page.evaluate(()=>window.armsOnlyQACameraRequests),0);
      assert.ok(usbRequests.every(url=>!url.includes('/connect')&&!url.includes('/signal')));
      await page.goto(`${base}/first-three.html?step=5`);
      await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready&&!window.firstThreeDiagnostics.loading);
      assert.equal(await page.locator('#practice-mode-controls').isVisible(),false);
      assert.equal((await page.evaluate(()=>window.firstThreeDiagnostics)).practiceMode,'full-body');
      assert.equal(await page.evaluate(()=>window.armsOnlyQACameraRequests),0);assert.deepEqual(errors,[]);
      await context.close();
    }finally{await browser.close();}
  });

  await check('Real browser drawing, readiness and reviewer complete step 6 using only explicitly constructed palm traces',async()=>{
    const {chromium}=await import('@playwright/test');
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try{
      const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],usbRequests=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/arduino/**',route=>{usbRequests.push(route.request().url());return route.fulfill({status:503,
        contentType:'application/json',body:JSON.stringify({ok:false,error:'Constructed QA response; no physical USB request.'})});});
      await page.route('**/first-three-center-camera.js',route=>route.fulfill({status:200,contentType:'application/javascript',
        body:`export const createFollowCamera=${createSyntheticArmsCamera.toString()};`}));
      await page.addInitScript(()=>{
        window.armsOnlyQACameraRequests=0;
        navigator.mediaDevices.getUserMedia=async()=>{window.armsOnlyQACameraRequests++;
          throw new DOMException('Physical camera forbidden in this constructed QA fixture.','NotAllowedError');};
      });
      const base=process.env.MOTIONTRIAL_STATIC_QA_URL??'http://127.0.0.1:8766';
      await page.goto(`${base}/first-three.html?step=6`);
      await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready&&!window.firstThreeDiagnostics.loading);
      await page.locator('#practice-arms-only').click();
      // Mute the actual speech controller only for this labelled software trace.
      await page.evaluate(()=>{const box=document.getElementById('spoken-feedback');box.checked=false;box.dispatchEvent(new Event('change'));});
      await page.evaluate(()=>{
        const reference=window.startPositionDiagnostics.guidanceReference,pathReference=window.movementPathDiagnostics.pathReference;
        const selection=window.firstThreeDiagnostics.selection;
        window.armsTraceQA={events:[],firstPositionAt:null,attemptAt:null,graceAt:null,reviewAt:null,finishedAt:null,observations:0,
          sourceKinds:pathReference.paths.filter(path=>[33,34].includes(path.index)).map(path=>path.timingEvidenceKind??path.evidenceKind),
          provenance:'Real production guides and reviewer; learner landmarks are CONSTRUCTED software points only.'};
        const between=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
        function guidePoint(guide,time){
          const path=pathReference.paths.find(path=>path.index===guide.index),vertices=path.teachingKeyframes??path.observations;
          const first=vertices[0],last=vertices.at(-1);
          const calibrated=vertices.map(vertex=>{const fraction=(vertex.sourceTimeSeconds-first.sourceTimeSeconds)/(last.sourceTimeSeconds-first.sourceTimeSeconds);
            return {time:vertex.sourceTimeSeconds,point:{
              x:vertex.point.x+(guide.start.x-first.point.x)*(1-fraction)+(guide.end.x-last.point.x)*fraction,
              y:vertex.point.y+(guide.start.y-first.point.y)*(1-fraction)+(guide.end.y-last.point.y)*fraction}};});
          if(time<=calibrated[0].time)return calibrated[0].point;
          if(time>=calibrated.at(-1).time)return calibrated.at(-1).point;
          const upper=calibrated.findIndex(vertex=>vertex.time>=time),a=calibrated[upper-1],b=calibrated[upper];
          return between(a.point,b.point,(time-a.time)/(b.time-a.time));
        }
        window.armsTraceQA.timer=setInterval(()=>{
          const state=window.firstThreeDiagnostics,diagnostics=window.startPositionDiagnostics,qa=window.armsTraceQA;
          const now=performance.now();
          if(qa.events.at(-1)?.phase!==state.phase){qa.events.push({phase:state.phase,at:now,teacherTime:state.teacherTime,results:state.results.length});
            if(state.phase==='positioning')qa.firstPositionAt=now;
            if(state.phase==='demonstrating')qa.attemptAt=now;
            if(state.phase==='grace')qa.graceAt=now;
            if(state.phase==='feedback')qa.reviewAt=now;
            if(state.phase==='finished')qa.finishedAt=now;}
          const frame=diagnostics.fixedFrame??diagnostics.screenLayout?.frame;
          if(!frame||!['positioning','demonstrating','grace'].includes(state.phase))return;
          const landmarks=reference.guides.filter(guide=>[33,34].includes(guide.index)).map(guide=>{
            const point=state.phase==='positioning'?guide.start:guidePoint(guide,state.teacherTime);
            return {index:guide.index,x:(point.x*frame.scale+frame.hip.x)/frame.aspect,y:point.y*frame.scale+frame.hip.y,
              visibility:.99,presence:.99};
          });
          qa.observations++;window.syntheticArmsCamera.push(landmarks);
        },1000/15);
      });
      await page.locator('#start-practice').click();
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='positioning',{},{timeout:15000});
      await page.waitForFunction(()=>window.startPositionDiagnostics.squareJoints.length===2);
      const squares=await page.evaluate(()=>({joints:window.startPositionDiagnostics.squareJoints,
        starts:window.startPositionDiagnostics.projectedStarts,layout:window.startPositionDiagnostics.screenLayout}));
      assert.deepEqual(squares.joints,[33,34]);assert.equal(squares.starts.length,2);
      assert.ok(squares.starts.every(target=>target.point.x>=0&&target.point.x<=1&&target.point.y>=0&&target.point.y<=1));
      assert.equal(squares.layout.mappedHeadY,squares.layout.viewport.top);
      assert.equal(squares.layout.mappedWaistY,squares.layout.viewport.bottom);
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='demonstrating');
      const drawing=await page.evaluate(()=>({triangles:window.startPositionDiagnostics.triangleJoints,
        routes:window.movementPathDiagnostics.projectedPaths.map(path=>path.index),
        session:window.movementPathDiagnostics.session,ready:window.startPositionDiagnostics.positioning,
        events:window.armsTraceQA.events}));
      assert.deepEqual(drawing.triangles,[33,34]);assert.deepEqual(drawing.routes,[33,34]);
      assert.equal(drawing.ready.holdReady,true);assert.ok(drawing.ready.heldMs>=1500);
      assert.deepEqual(drawing.session.controls.map(control=>control.index),[33,34]);
      assert.equal(drawing.session.referenceUsable,true);
      const directory=new URL('../artifacts/arms-only-flow/',import.meta.url);await mkdir(directory,{recursive:true});
      await page.screenshot({path:new URL('step-6-constructed-palm-targets.png',directory).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='feedback',{},{timeout:15000});
      const reviewed=await page.evaluate(()=>({state:window.firstThreeDiagnostics,session:window.movementPathDiagnostics.session,qa:window.armsTraceQA}));
      assert.equal(reviewed.state.results.length,0);assert.equal(reviewed.state.feedback.status,'match');
      assert.equal(reviewed.state.feedback.passed,true);assert.deepEqual(reviewed.state.feedback.limbs.map(limb=>limb.index),[33,34]);
      await page.screenshot({path:new URL('step-6-constructed-palm-review.png',directory).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='finished',{},{timeout:6000});
      const completed=await page.evaluate(()=>{clearInterval(window.armsTraceQA.timer);return {state:window.firstThreeDiagnostics,qa:window.armsTraceQA,
        cameraRequests:window.armsOnlyQACameraRequests};});
      // The observer runs at 15 Hz. Allow one sampling interval at transitions,
      // while the actual controller thresholds remain exactly 1s and 3s.
      const qa=completed.qa,events=qa.events;
      const at=phase=>events.find(event=>event.phase===phase)?.at;
      assert.ok(at('demonstrating')-at('positioning')>=1500-1000/15);
      const expectedClipMs=(completed.state.selection.teacherFreezeSeconds-completed.state.selection.practiceStartSeconds)*1000/completed.state.speed;
      assert.ok(at('grace')-at('demonstrating')>=expectedClipMs-150);
      assert.ok(at('feedback')-at('grace')>=1000-1000/15);
      // waitForFunction can observe completion before the next 15 Hz recorder.
      const finishedAt=qa.finishedAt??await page.evaluate(()=>performance.now());
      assert.ok(finishedAt-at('feedback')>=3000-1000/15);
      assert.equal(completed.state.results.length,1);assert.equal(completed.state.results[0].practiceMode,'arms-only');
      assert.equal(completed.state.results[0].status,'matched');assert.ok(qa.observations>60);
      assert.equal(completed.cameraRequests,0);assert.ok(usbRequests.every(url=>!url.includes('/connect')&&!url.includes('/signal')));
      assert.deepEqual(errors,[]);
      await writeFile(new URL('constructed-palm-browser-qa.json',directory),JSON.stringify({result:'PASS',
        provenance:qa.provenance,events:qa.events,observations:qa.observations,readiness:drawing.ready,
        layout:squares.layout,feedback:reviewed.state.feedback,completedResult:completed.state.results[0]},null,2)+'\n');
      await context.close();
    }finally{await browser.close();}
  });
}

await save('PASS');
console.log(`Arms-only flow: ${checks.length} controller groups passed (constructed controls; no physical devices activated).`);
