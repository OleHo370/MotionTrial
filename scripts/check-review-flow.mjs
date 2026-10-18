// Deterministic orchestration QA. The actual browser-controller declarations
// run against constructed video/camera controls. This is not live inference
// or physical learner acceptance; the separate review evaluator has its own QA.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createAttemptReview as realCreateAttemptReview,observeAttemptReview as realObserveAttemptReview,
  finalizeAttemptReview as realFinalizeAttemptReview} from '../public/practice-attempt-review.js';

const require=createRequire(import.meta.url),{parse}=require('next/dist/compiled/acorn');
const controllerURL=new URL('../public/first-three.js',import.meta.url);
const source=await readFile(controllerURL,'utf8');
const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),slice=node=>source.slice(node.start,node.end);
const definitions=new Map(tree.body.filter(node=>node.type==='FunctionDeclaration').map(node=>[node.id.name,slice(node)]));
const declarations=new Map(tree.body.filter(node=>node.type==='VariableDeclaration').flatMap(statement=>
  statement.declarations.filter(node=>node.id.type==='Identifier').map(node=>[node.id.name,node.init&&slice(node.init)])));
const cameraAssignment=tree.body.find(node=>node.type==='ExpressionStatement'
  &&node.expression.type==='AssignmentExpression'&&slice(node.expression.left)==='state.camera');
const cameraHandler=cameraAssignment?.expression.right.arguments?.[0]?.properties?.find(node=>node.key?.name==='onState')?.value;
const clickHandlers=new Map(tree.body.filter(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression')
  .map(node=>node.expression).filter(node=>node.callee.type==='MemberExpression'&&node.callee.property.name==='addEventListener'
    &&node.callee.object.type==='CallExpression'&&node.callee.object.callee.name==='$'&&node.arguments[0]?.value==='click')
  .map(node=>[node.callee.object.arguments[0].value,slice(node.arguments[1])]));
const speechChangeHandler=tree.body.filter(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression')
  .map(node=>node.expression).find(node=>node.callee.type==='MemberExpression'&&node.callee.property.name==='addEventListener'
    &&node.callee.object.type==='CallExpression'&&node.callee.object.callee.name==='$'
    &&node.callee.object.arguments[0]?.value==='spoken-feedback'&&node.arguments[0]?.value==='change')?.arguments[1];
const speechInitializer=tree.body.filter(node=>node.type==='VariableDeclaration').flatMap(node=>node.declarations)
  .find(node=>node.id.type==='Identifier'&&node.id.name==='feedbackSpeech')?.init;
const speechStateHandler=speechInitializer?.arguments?.[0]?.properties?.find(node=>node.key?.name==='onState')?.value;
const interruptedMediaLoop=tree.body.find(node=>node.type==='ForOfStatement'&&node.right.type==='ArrayExpression'
  &&node.right.elements.some(element=>element.value==='waiting')&&node.right.elements.some(element=>element.value==='stalled'));
const interruptedMediaHandler=interruptedMediaLoop?.body?.expression?.arguments?.[1];
const checks=[];
async function check(name,run){
  try{await run();checks.push({name,passed:true});console.log(`PASS: ${name}`);}
  catch(error){
    checks.push({name,passed:false,error:error.stack??error.message});
    const directory=new URL('../artifacts/attempt-review-flow/',import.meta.url);await mkdir(directory,{recursive:true});
    await writeFile(new URL('controller-qa.json',directory),JSON.stringify({result:'FAIL',checkedAt:new Date().toISOString(),
      provenance:'Actual controller declarations, constructed clock/video/camera/evaluator controls; no live camera acceptance.',
      controllerSha256:createHash('sha256').update(source).digest('hex'),groups:checks.length,checks},null,2)+'\n');
    throw error;
  }
}

function element(){return {hidden:false,disabled:false,textContent:'',value:'',checked:true,
  src:'',alt:'',style:{setProperty(){}},dataset:{},nextElementSibling:{textContent:''},
  parentElement:{dataset:{},style:{setProperty(){}}},
  querySelectorAll:()=>[],setAttribute(){},replaceChildren(){}};}

// Extracting declarations through the installed JavaScript parser avoids a
// copied state machine: edits to the production controller are exercised here.
function controllerHarness({functions=null,overrides={},stateOverrides={},speechOptions={}}={}){
  const elements=new Map(),events=[],clock={now:1000},cameraState={running:true,generation:1};
  const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const video={currentTime:.5,readyState:4,seeking:false,ended:false,paused:true,
    videoWidth:450,videoHeight:360,playbackRate:.5,
    pause(){this.paused=true;events.push({kind:'pause',at:clock.now});},
    async play(){this.paused=false;events.push({kind:'play',at:clock.now,time:this.currentTime});},
    getAttribute:()=>'/practice-media/recut-six/master.mp4'};
  const frame={hip:{x:.5,y:.5},scale:.5,aspect:1};
  const indices=[33,34,35,36];
  const refs=Array.from({length:6},()=>({referenceUsable:true,usable:true,guides:indices.map(index=>({index,valid:true}))}));
  const steps=Array.from({length:6},(_,index)=>({id:`step-${index+1}`,title:`Movement ${index+1}`,
    sourceId:'master',startSeconds:.5+index,endSeconds:1.5+index,
    practiceStartSeconds:.5+index,teacherFreezeSeconds:1.5+index,screenshots:{start:'start.png',end:'end.png'}}));
  const review={result:{status:'match',passed:true,percent:null,messages:['Close enough'],reason:'Close enough'},created:[],observed:[],finalized:[]};
  // Speech is a deterministic fake here. No real audio, browser speech engine,
  // permission request, or physical camera is involved in controller QA.
  const speech={supported:true,enabled:false,unlocked:true,busy:false,calls:[],utterances:[],cancellations:[],unlockCount:0,
    ...speechOptions};
  const feedbackSpeech={
    unlock(){speech.unlockCount++;speech.unlocked=true;return true;},
    setEnabled(enabled){speech.enabled=!!enabled;if(!speech.enabled)this.cancel('disabled');},
    speakReview(...args){speech.calls.push({args,at:clock.now});
      if(!speech.supported||!speech.enabled)return false;
      speech.utterances.push({args,at:clock.now});speech.busy=true;return true;},
    cancel(reason){speech.cancellations.push({reason,at:clock.now});speech.busy=false;},
    isBusy:()=>speech.supported&&speech.enabled&&speech.busy,
    getState:()=>({supported:speech.supported,enabled:speech.enabled,unlocked:speech.unlocked,
      busy:speech.supported&&speech.enabled&&speech.busy,speaking:speech.supported&&speech.enabled&&speech.busy,
      pending:speech.supported&&speech.enabled&&speech.busy}),
    destroy(){this.cancel('destroy');},
  };
  const context={console,Map,Set,Date,Math,Number,Promise,structuredClone,
    performance:{now:()=>clock.now},setTimeout,clearTimeout,
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    $,video,INDICES:indices,POINT_COUNT:'four',feedbackSpeech,
    hardwareFeedback:{neutral(){events.push({kind:'hardware-neutral',at:clock.now});},
      update(){events.push({kind:'hardware-update',at:clock.now});},destroy(){}},
    ATTEMPT_REVIEW_RULES:{completionGraceMs:1000,feedbackMs:3000,maximumAgeMs:450},
    REVIEW_RULES:{completionGraceMs:1000,feedbackMs:3000,maximumAgeMs:450},
    visible:p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y),
    render(){events.push({kind:'render',phase:context.state?.phase,at:clock.now});},
    drawGuides(){},drawTeacher(){},seedScreenTargets(){},syncPracticeModeUI(){},
    cameraFeedAvailable:()=>cameraState.running,
    put(id,text){$(id).textContent=text;},
    teacherReferenceReason:()=> 'Constructed unsupported teacher reference.',
    createAttemptReview(reference,pathReference,options){
      const session={controls:indices.map(index=>({index})),expectedDurationMs:options.durationMs/options.playbackRate,finalized:false};
      review.created.push({reference,pathReference,options,session});return session;
    },
    observeAttemptReview(session,observation,options){review.observed.push({session,observation,options});
      return {status:'collecting',passed:false,percent:null,limbs:[]};},
    finalizeAttemptReview(session,options){review.finalized.push({session,options});session.finalized=true;return structuredClone(review.result);},
    createStartPositionSession:()=>({bodyFrame:frame,aspect:1}),
    prepareStartPosition:()=>({usable:true,targets:indices.map(index=>({index,valid:true}))}),
    evaluateStartPosition:()=>({status:'match',allNear:true,holdReady:true,heldMs:1500,bodyFrame:frame,limbs:[]}),
    screenGuides:()=>[],screenPaths:()=>[],cameraViewportBounds:()=>({left:0,right:1,top:0,bottom:1}),
    async loadRecording(){context.state.sourceId='master';return true;},
    async seek(time,token){video.currentTime=time;return token===context.state.operation;},
    matcher:{requiresRoute:false,retainsStartedTargets:true,mode:'constructed-flow-control',
      createSession:()=>({}),evaluate:()=>({status:'match',percent:100,pathComplete:true,limbs:indices.map(index=>({index,valid:true,targetReached:true}))})}};
  Object.assign(context,overrides);
  vm.createContext(context);
  if(declarations.get('RULES'))vm.runInContext(`globalThis.RULES=${declarations.get('RULES')}`,context);
  if(declarations.get('displayReason'))vm.runInContext(`globalThis.displayReason=${declarations.get('displayReason')}`,context);
  vm.runInContext(`globalThis.state=${declarations.get('state')}`,context);
  Object.assign(context.state,{manifest:{steps},ready:true,active:true,phase:'positioning',loading:false,
    refs,guidanceRefs:refs,pathRefs:refs,index:0,sourceId:'master',speed:.5,
    camera:{getState:()=>({...cameraState}),stop(){cameraState.running=false;events.push({kind:'camera-stop'});}},
    placement:{bodyFrame:frame,aspect:1},fixedFrame:frame,movement:{},
    ...stateOverrides});
  const helpers={step:()=>context.state.manifest.steps[context.state.index],
    guidance:()=>context.state.guidanceRefs[context.state.index],
    pathReference:()=>context.state.pathRefs[context.state.index],
    reference:()=>context.state.refs[context.state.index],total:()=>context.state.manifest.steps.length,
    practiceStart:()=>context.state.manifest.steps[context.state.index].practiceStartSeconds,
    recording:()=>({video:{frameCount:525,fps:30}})};
  Object.assign(context,helpers);
  const presentationAndIO=new Set(['configureControlUI','syncPracticeModeUI','controls','render','renderPosition','renderProgress',
    'nearestSample','renderFlowStatus','drawTeacher','drawGuides','readJson','validateData','frameRecording',
    'fitVisibilityTeacher','fitPortraitCamera','loadRecording','boot','seek','screenGuides','screenPaths',
    'seedScreenTargets','cameraFeedAvailable']);
  const actualFunctions=functions??[...definitions.keys()].filter(name=>!presentationAndIO.has(name));
  for(const name of actualFunctions){assert.ok(definitions.has(name),`Actual controller function ${name} exists`);vm.runInContext(definitions.get(name),context);}
  if(cameraHandler?.body)vm.runInContext(`function cameraOnState(${cameraHandler.params.map(slice).join(',')})${slice(cameraHandler.body)}`,context);
  if(clickHandlers.has('replay'))vm.runInContext(`globalThis.replayAction=${clickHandlers.get('replay')}`,context);
  if(interruptedMediaHandler)vm.runInContext(`globalThis.mediaInterruptionAction=${slice(interruptedMediaHandler)}`,context);
  const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
  return {env:context,state:context.state,events,clock,cameraState,elements,video,frame,indices,review,speech,flush,
    async call(name,...args){const result=context[name](...args);if(result?.then)await result;await flush();return result;},
    async emitCameraState(status){cameraState.running=!!status.running;context.cameraOnState(status);await flush();}};
}

const observed=(time=1000)=>({observedAtMs:time,aspectRatio:1,
  sample:{status:'pose',tMs:time,landmarks:[33,34,35,36].map(index=>({index,x:.5,y:.5,visibility:1,presence:1}))}});
async function attempt(h){
  h.state.watched=true;h.state.phase='positioning';h.state.observation=observed(h.clock.now);
  h.state.positioning={status:'match',holdReady:true,heldMs:1500,allNear:true,bodyFrame:h.frame,limbs:[]};
  h.state.fixedFrame=h.frame;
  await h.call('startAttempt');
  assert.equal(h.state.phase,'demonstrating');
}
async function boundary(h){
  const selected=h.state.manifest.steps[h.state.index];
  h.clock.now+=((selected.teacherFreezeSeconds-selected.practiceStartSeconds)*1000/h.state.speed);
  h.video.currentTime=selected.teacherFreezeSeconds;
  await h.call('tick');
  assert.equal(h.state.phase,'grace');
}
async function review(h){
  await boundary(h);h.clock.now+=h.env.RULES.graceMs;await h.call('tick');
  assert.equal(h.state.phase,'feedback');
}

await check('Production controller exposes watch, full-attempt, boundary and review stages',()=>{
  assert.equal(tree.type,'Program');
  for(const name of ['watchDemonstration','finishWatch','startAttempt','finishAttempt','completeFeedback'])
    assert.ok(definitions.has(name),name);
});

await check('The actual speech checkbox change captures user intent before synchronous unlock state publication',async()=>{
  assert.ok(speechChangeHandler,'Production spoken-feedback change handler exists');
  assert.ok(speechStateHandler,'Production speech constructor state callback exists');
  const h=controllerHarness({functions:[],speechOptions:{enabled:true}}),published=[],setValues=[];
  vm.runInContext(`globalThis.publishActualSpeechState=function(${speechStateHandler.params.map(slice).join(',')})${slice(speechStateHandler.body)}`,h.env);
  vm.runInContext(`globalThis.changeActualSpeechSetting=${slice(speechChangeHandler)}`,h.env);
  const publish=()=>{
    const status={supported:true,enabled:h.speech.enabled,message:h.speech.enabled?'Constructed ready state':'Constructed disabled state'};
    published.push(status.enabled);h.env.publishActualSpeechState(status);
  };
  h.env.feedbackSpeech.unlock=()=>{h.speech.unlockCount++;publish();};
  h.env.feedbackSpeech.setEnabled=enabled=>{setValues.push(enabled);h.speech.enabled=!!enabled;publish();};
  publish();const checkbox=h.elements.get('spoken-feedback');assert.equal(checkbox.checked,true);
  checkbox.checked=false;await h.call('changeActualSpeechSetting');
  assert.equal(h.speech.enabled,false);assert.equal(checkbox.checked,false);
  assert.equal(h.elements.get('speech-status').textContent,'Constructed disabled state');
  checkbox.checked=true;await h.call('changeActualSpeechSetting');
  assert.equal(h.speech.enabled,true);assert.equal(checkbox.checked,true);
  assert.deepEqual(setValues,[false,true]);assert.deepEqual(published,[true,true,false,false,true]);
  assert.equal(h.speech.unlockCount,2);
});

await check('The first lesson demonstration records no learner evidence and ends paused at its starting squares',async()=>{
  const h=controllerHarness();await h.call('watchDemonstration','lesson');
  assert.equal(h.state.phase,'watching');assert.equal(h.video.paused,false);
  await h.call('observe',observed(h.clock.now));
  assert.equal(h.review.created.length,0);assert.equal(h.review.observed.length,0);
  assert.equal(h.review.finalized.length,0);assert.equal(h.state.results.size,0);
  h.video.currentTime=1.5;await h.call('finishWatch');
  assert.equal(h.state.watched,true);assert.equal(h.state.phase,'positioning');
  assert.equal(h.video.currentTime,.5);assert.equal(h.video.paused,true);
});

await check('Reaching every finish target during the clip cannot advance, finalize or restart the attempt',async()=>{
  const h=controllerHarness();await attempt(h);
  assert.equal(h.review.created.length,1);
  const options=h.review.created[0].options;
  assert.equal(options.durationMs,1000);assert.equal(options.playbackRate,.5);
  h.clock.now+=500;h.video.currentTime=.75;
  await h.call('observe',observed(h.clock.now));
  assert.equal(h.review.observed.length,1);
  assert.equal(h.review.finalized.length,0);assert.equal(h.state.index,0);
  assert.equal(h.state.results.size,0);assert.equal(h.state.phase,'demonstrating');
});

await check('The full demonstration and one-second finishing allowance precede a three-second review',async()=>{
  const h=controllerHarness();await attempt(h);await boundary(h);
  assert.equal(h.video.paused,true);assert.equal(h.env.RULES.graceMs,1000);
  h.clock.now+=999;await h.call('tick');assert.equal(h.state.phase,'grace');
  assert.equal(h.review.finalized.length,0);assert.equal(h.state.results.size,0);
  h.clock.now++;await h.call('tick');
  assert.equal(h.state.phase,'feedback');assert.equal(h.review.finalized.length,1);
  assert.equal(h.env.RULES.feedbackMs,3000);assert.equal(h.state.results.size,0);
  h.clock.now+=2999;await h.call('tick');assert.equal(h.state.phase,'feedback');
  assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
  h.clock.now++;await h.call('tick');
  assert.equal(h.state.index,1);assert.equal(h.state.results.get('step-1').status,'matched');
  assert.equal(h.state.phase,'watching','Each new movement is watched before positioning/attempting');
  assert.equal(h.review.created.length,1,'Watching the next clip cannot create a scored attempt');
});

await check('A finalized review requests spoken feedback once; redraws and timer ticks cannot repeat its announcement',async()=>{
  const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
  assert.equal(h.speech.calls.length,1);assert.equal(h.speech.utterances.length,1);
  assert.equal(h.env.feedbackSpeech.isBusy(),true);
  for(const advance of [10,100,500,1000]){h.clock.now+=advance;await h.call('tick');}
  assert.equal(h.speech.calls.length,1);assert.equal(h.speech.utterances.length,1);
  assert.equal(h.review.finalized.length,1);assert.equal(h.state.phase,'feedback');
});

await check('Speech still busy after the three-second minimum holds feedback until it finishes, then advances once',async()=>{
  const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
  h.clock.now+=3000;await h.call('tick');
  assert.equal(h.state.phase,'feedback');assert.equal(h.state.remainingMs,0);
  assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
  h.clock.now+=5000;await h.call('tick');
  assert.equal(h.state.phase,'feedback');assert.equal(h.state.index,0);assert.equal(h.speech.calls.length,1);
  h.speech.busy=false;await h.call('tick');
  assert.equal(h.state.index,1);assert.equal(h.state.results.get('step-1').status,'matched');
  assert.equal(h.state.phase,'watching');assert.equal(h.speech.calls.length,1);
});

await check('The actual feedback renderer displays Speaking after its minimum timer while audio remains busy',async()=>{
  const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
  for(const name of ['controls','renderPosition','renderFlowStatus','renderProgress'])h.env[name]=()=>{};
  vm.runInContext(definitions.get('render'),h.env);
  await h.call('render');assert.equal(h.elements.get('overlay-value').textContent,'3 s');
  assert.equal(h.elements.get('practice-overlay').dataset.speaking,'false');
  h.clock.now+=3000;await h.call('tick');
  assert.equal(h.state.phase,'feedback');assert.equal(h.elements.get('overlay-value').textContent,'Speaking…');
  assert.equal(h.elements.get('practice-overlay').dataset.speaking,'true');
  assert.equal(h.elements.get('practice-overlay').hidden,false);
  h.state.feedback={status:'unknown',passed:false,percent:null,messages:['Your left foot was hidden.']};h.state.reviewAction='retry';
  await h.call('render');
  assert.equal(h.elements.get('feedback-state').textContent,'Tracking unclear');
  assert.equal(h.elements.get('overlay-title').textContent,'Tracking unclear · try again');
  assert.match(h.elements.get('overlay-reason').textContent,/Your left foot was hidden/);
  assert.match(h.elements.get('overlay-reason').textContent,/starting squares/);
  assert.doesNotMatch(h.elements.get('overlay-reason').textContent,/next clip|not assessed|percent|%/i);
  await h.call('pause');assert.equal(h.elements.get('practice-overlay').hidden,true);
});

await check('Finishing speech early cannot shorten the three-second feedback minimum',async()=>{
  const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
  h.speech.busy=false;h.clock.now+=2999;await h.call('tick');
  assert.equal(h.state.phase,'feedback');assert.equal(h.state.index,0);
  h.clock.now++;await h.call('tick');assert.equal(h.state.index,1);
});

await check('Muted or unsupported speech preserves the existing three-second flow without audible announcements',async()=>{
  for(const speechOptions of [{enabled:false,supported:true},{enabled:true,supported:false}]){
    const h=controllerHarness({speechOptions});await attempt(h);await review(h);
    assert.equal(h.speech.utterances.length,0);assert.equal(h.env.feedbackSpeech.isBusy(),false);
    h.clock.now+=2999;await h.call('tick');assert.equal(h.state.index,0);
    h.clock.now++;await h.call('tick');assert.equal(h.state.index,1);
    assert.equal(h.state.results.get('step-1').status,'matched');
  }
});

await check('Unknown and mismatch speech never turn an incomplete attempt into success and retry after their announcement ends',async()=>{
  for(const status of ['unknown','mismatch']){
    const h=controllerHarness({speechOptions:{enabled:true}});
    h.review.result={status,passed:false,percent:null,messages:['Constructed issue'],reason:'Constructed issue'};
    await attempt(h);await review(h);assert.equal(h.speech.calls.length,1);
    h.clock.now+=3000;await h.call('tick');assert.equal(h.state.phase,'feedback');
    assert.equal(h.state.feedback.status,status);assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
    h.speech.busy=false;await h.call('tick');
    assert.equal(h.state.phase,'positioning');assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
    assert.equal(h.state.watched,true,'Retry retains the watched demonstration and returns to fresh squares');
  }
});

await check('Stop, manual navigation and replay cancel active feedback audio and cannot deliver a delayed success',async()=>{
  for(const action of ['stop','choose','replayAction']){
    const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
    const cancelCount=h.speech.cancellations.length;
    await h.call(action,...(action==='choose'?[2,true]:[]));
    assert.equal(h.env.feedbackSpeech.isBusy(),false,`${action} cancels active audio`);
    assert.ok(h.speech.cancellations.length>cancelCount);
    h.clock.now+=10000;await h.call('tick');
    assert.notEqual(h.state.results.get('step-1')?.status,'matched');
    assert.equal(h.speech.utterances.length,1,'No stale feedback is replayed after leaving review');
  }
});

await check('Pausing feedback cancels speech, freezes its timer and does not repeat audio on resume',async()=>{
  const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
  h.clock.now+=1000;const cancellationCount=h.speech.cancellations.length;await h.call('pause');
  assert.equal(h.state.paused,true);assert.equal(h.env.feedbackSpeech.isBusy(),false);
  assert.ok(h.speech.cancellations.length>cancellationCount);assert.equal(h.speech.calls.length,1);
  const remaining=h.state.remainingMs;assert.equal(remaining,2000);
  h.clock.now+=10000;await h.call('tick');assert.equal(h.state.index,0);
  await h.call('pause');assert.equal(h.state.paused,false);assert.equal(h.speech.calls.length,1);
  h.clock.now+=remaining-1;await h.call('tick');assert.equal(h.state.index,0);
  h.clock.now++;await h.call('tick');assert.equal(h.state.index,1);assert.equal(h.speech.calls.length,1);
});

await check('Pausing an extended spoken review with zero remaining time cannot trap the resumed feedback stage',async()=>{
  const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
  h.clock.now+=3000;await h.call('tick');assert.equal(h.state.phase,'feedback');assert.equal(h.state.remainingMs,0);
  await h.call('pause');assert.equal(h.state.paused,true);assert.equal(h.env.feedbackSpeech.isBusy(),false);
  assert.equal(h.state.remainingMs,0);await h.call('pause');h.clock.now++;await h.call('tick');
  assert.equal(h.state.index,1,'Completed minimum timer plus canceled speech must allow advancement on resume');
  assert.equal(h.speech.calls.length,1);
});

await check('Camera loss or generation reset cancels spoken success and requires another attempt',async()=>{
  for(const kind of ['loss','generation']){
    const h=controllerHarness({speechOptions:{enabled:true}});h.state.cameraRunning=true;
    await attempt(h);await review(h);const cancellations=h.speech.cancellations.length;
    if(kind==='generation')h.cameraState.generation++;
    await h.emitCameraState({running:kind!=='loss',phase:kind==='loss'?'idle':'running'});
    assert.equal(h.env.feedbackSpeech.isBusy(),false);assert.ok(h.speech.cancellations.length>cancellations);
    h.clock.now+=10000;await h.call('tick');
    assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
    assert.notEqual(h.state.feedback?.status,'match');
  }
});

await check('Disabling spoken feedback during its extended review releases the pending transition without restarting the timer',async()=>{
  const h=controllerHarness({speechOptions:{enabled:true}});await attempt(h);await review(h);
  h.clock.now+=3500;await h.call('tick');assert.equal(h.state.phase,'feedback');
  h.env.feedbackSpeech.setEnabled(false);assert.equal(h.env.feedbackSpeech.isBusy(),false);
  await h.call('tick');assert.equal(h.state.index,1);assert.equal(h.speech.calls.length,1);
});

await check('Observed mismatch and tracking uncertainty retry from squares without another watch-only round',async()=>{
  for(const status of ['mismatch','unknown']){
    const h=controllerHarness();h.review.result={status,passed:false,percent:null,messages:[status],reason:status};
    await attempt(h);await review(h);
    assert.equal(h.state.feedback.status,status);
    const playCount=h.events.filter(e=>e.kind==='play').length;
    h.clock.now+=3000;await h.call('tick');
    assert.equal(h.state.phase,'positioning');assert.equal(h.state.index,0);
    assert.equal(h.state.watched,true);assert.equal(h.state.results.size,0);
    assert.equal(h.video.currentTime,.5);assert.equal(h.video.paused,true);
    assert.equal(h.events.filter(e=>e.kind==='play').length,playCount,'Retry does not replay the watch round');
    await attempt(h);assert.equal(h.review.created.length,2);
  }
});

await check('Missing or stale tracking does not reset the moving clip or produce an early pass',async()=>{
  const h=controllerHarness();await attempt(h);
  const started=h.state.attemptStartedAtMs;
  await h.call('observe',null);assert.equal(h.state.phase,'demonstrating');assert.equal(h.state.results.size,0);
  h.state.observation=observed(h.clock.now-451);await h.call('tick');
  assert.equal(h.state.phase,'demonstrating');assert.equal(h.state.index,0);
  assert.equal(h.state.attemptStartedAtMs,started);assert.equal(h.review.finalized.length,0);
  h.review.result={status:'unknown',passed:false,percent:null,messages:['Tracking missing'],reason:'Tracking missing'};
  await review(h);h.clock.now+=3000;await h.call('tick');
  assert.equal(h.state.phase,'positioning');assert.equal(h.state.results.size,0);
});

await check('Pause during movement discards the attempt and resumes from fresh starting squares',async()=>{
  const h=controllerHarness();await attempt(h);
  await h.call('pause');assert.equal(h.state.paused,true);assert.equal(h.video.paused,true);
  h.clock.now+=5000;await h.call('tick');assert.equal(h.state.results.size,0);
  await h.call('pause');assert.equal(h.state.paused,false);assert.equal(h.state.phase,'positioning');
  assert.equal(h.state.watched,true);assert.equal(h.video.currentTime,.5);
});

await check('Pause freezes the finalized feedback timer and preserves its outcome',async()=>{
  const h=controllerHarness();await attempt(h);await review(h);
  h.clock.now+=1200;await h.call('pause');
  const feedback=h.state.feedback,remaining=h.state.remainingMs;
  assert.equal(h.state.paused,true);assert.ok(remaining>=1799&&remaining<=1801);
  h.clock.now+=10000;await h.call('tick');assert.equal(h.state.index,0);
  assert.equal(h.state.feedback,feedback);
  await h.call('pause');assert.equal(h.state.paused,false);
  h.clock.now+=remaining-1;await h.call('tick');assert.equal(h.state.index,0);
  h.clock.now++;await h.call('tick');assert.equal(h.state.index,1);
  assert.equal(h.state.results.get('step-1').status,'matched');
});

await check('End cancels a pending successful review and releases the camera',async()=>{
  const h=controllerHarness();await attempt(h);await review(h);
  await h.call('stop');const operation=h.state.operation;
  h.clock.now+=10000;await h.call('tick');
  assert.equal(h.state.active,false);assert.equal(h.state.phase,'stopped');
  assert.equal(h.cameraState.running,false);assert.equal(h.state.results.size,0);
  assert.equal(h.state.index,0);assert.equal(h.state.operation,operation);
});

await check('Manual navigation cancels a prior review and starts the newly selected watch-only demonstration',async()=>{
  const h=controllerHarness();await attempt(h);await review(h);
  await h.call('choose',2,true);assert.equal(h.state.index,2);assert.equal(h.state.phase,'watching');
  h.clock.now+=10000;await h.call('tick');
  assert.equal(h.state.index,2);assert.notEqual(h.state.results.get('step-1')?.status,'matched');
});

await check('Camera loss during review cancels the cached success instead of advancing',async()=>{
  const h=controllerHarness();h.state.cameraRunning=true;await attempt(h);await review(h);
  await h.emitCameraState({running:false,phase:'idle'});
  h.clock.now+=10000;await h.call('tick');
  assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
  assert.notEqual(h.state.phase,'feedback');assert.equal(h.video.paused,true);
});

await check('All six clips use watch once, squares, full attempt and review; only a real completed match advances',async()=>{
  const h=controllerHarness();await h.call('watchDemonstration','lesson');
  for(let index=0;index<6;index++){
    assert.equal(h.state.index,index);assert.equal(h.state.phase,'watching');
    const createdBefore=h.review.created.length;
    h.video.currentTime=h.state.manifest.steps[index].teacherFreezeSeconds;await h.call('finishWatch');
    assert.equal(h.state.phase,'positioning');assert.equal(h.state.watched,true);
    assert.equal(h.review.created.length,createdBefore,'The watch round never creates learner evidence');
    await attempt(h);await review(h);assert.equal(h.state.feedback.status,'match');
    assert.equal(h.state.results.has(`step-${index+1}`),false,'A pending review is not a recorded completion');
    h.clock.now+=3000;await h.call('tick');
    assert.equal(h.state.results.get(`step-${index+1}`).status,'matched');
  }
  assert.equal(h.state.phase,'finished');assert.equal(h.state.results.size,6);
  assert.equal(h.review.created.length,6);assert.equal(h.review.finalized.length,6);
  assert.ok([...h.state.results.values()].every(result=>result.status==='matched'));
});

await check('Repeated watch-only demonstrations cannot skip unsupported references or invent a completed clip',async()=>{
  const h=controllerHarness({speechOptions:{enabled:true}});h.state.guidanceRefs[0].referenceUsable=false;
  h.state.pathRefs[0].referenceUsable=false;
  for(let round=0;round<5;round++){
    if(round===0)await h.call('choose',0,false);else await h.call('watchDemonstration','lesson');
    assert.equal(h.state.phase,'watching');assert.equal(h.state.watchPurpose,'lesson');
    h.video.currentTime=1.5;await h.call('finishWatch');
    assert.equal(h.state.phase,'positioning');assert.equal(h.state.watched,true);
    h.clock.now+=10000;await h.call('tick');
    assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
    assert.equal(h.state.phase,'positioning');
  }
  assert.equal(h.review.created.length,0);assert.equal(h.review.finalized.length,0);
  assert.equal(h.speech.calls.length,0,'Watching alone has no scored-review announcement');
});

await check('Pausing a watch-only round restarts it without collecting learner evidence',async()=>{
  const h=controllerHarness();await h.call('watchDemonstration','lesson');
  h.video.currentTime=.8;await h.call('pause');assert.equal(h.state.paused,true);
  h.clock.now+=10000;await h.call('tick');assert.equal(h.state.watched,false);
  await h.call('pause');assert.equal(h.state.phase,'watching');assert.equal(h.video.currentTime,.5);
  assert.equal(h.review.created.length,0);assert.equal(h.review.observed.length,0);
  h.video.currentTime=1.5;await h.call('finishWatch');
  assert.equal(h.state.watched,true);assert.equal(h.state.phase,'positioning');
});

await check('Unsupported or corrupt target data stays failed or tracking-unclear on repeated attempts instead of auto-skipping',async()=>{
  for(const corruption of ['unsupported','missing-endpoint','missing-path']){
    const h=controllerHarness({overrides:{createAttemptReview:realCreateAttemptReview,
      observeAttemptReview:realObserveAttemptReview,finalizeAttemptReview:realFinalizeAttemptReview}});
    for(const guide of h.state.guidanceRefs[0].guides){guide.start={x:0,y:0};guide.end={x:0,y:0};guide.targetGeometry={mode:'hold'};}
    if(corruption==='unsupported'){h.state.guidanceRefs[0].referenceUsable=false;h.state.pathRefs[0].referenceUsable=false;}
    if(corruption==='missing-endpoint')h.state.guidanceRefs[0].guides[0].end=null;
    if(corruption==='missing-path')h.state.pathRefs[0].referenceUsable=false;
    for(let round=0;round<4;round++){
      await h.call('watchDemonstration','lesson');h.video.currentTime=1.5;await h.call('finishWatch');
      h.state.fixedFrame=h.frame;h.state.positioning={status:'match',holdReady:true,heldMs:1500,allNear:true,bodyFrame:h.frame,limbs:[]};
      await h.call('startAttempt');
      if(h.state.phase==='demonstrating'){
        assert.equal(h.state.movement.referenceUsable,false,'The actual evaluator rejects unsupported/corrupt reference contracts');
        await review(h);assert.equal(h.state.feedback.status,'unknown');assert.notEqual(h.state.feedback.passed,true);
        assert.equal(h.state.reviewAction,'retry');h.clock.now+=3000;await h.call('tick');
      }
      assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
      assert.ok(['positioning','preparing'].includes(h.state.phase),'Corrupt data may fail closed or return to setup');
    }
  }
});

await check('Replay during the first watch restarts its unscored demo instead of trapping the learner in squares',async()=>{
  const h=controllerHarness();await h.call('watchDemonstration','lesson');h.video.currentTime=.8;
  await h.call('replayAction');assert.equal(h.state.phase,'watching');assert.equal(h.state.watched,false);
  h.video.currentTime=1.5;await h.call('finishWatch');assert.equal(h.state.watched,true);
  await attempt(h);assert.equal(h.state.phase,'demonstrating');
});

await check('Ending while an opening seek is pending prevents its delayed playback',async()=>{
  const h=controllerHarness();let release;
  h.env.seek=()=>new Promise(resolve=>{release=resolve;});
  const pending=h.env.watchDemonstration('lesson');assert.equal(h.state.phase,'preparing');
  await h.call('stop');release(true);await pending;await h.flush();
  assert.equal(h.state.phase,'stopped');assert.equal(h.state.active,false);assert.equal(h.video.paused,true);
  assert.equal(h.events.filter(e=>e.kind==='play').length,0);
});

await check('A delayed old boundary seek cannot overwrite a newly selected clip',async()=>{
  const h=controllerHarness();await attempt(h);
  const ordinarySeek=h.env.seek;let release,first=true;
  h.env.seek=(time,token)=>first?(first=false,new Promise(resolve=>{release=resolve;})):ordinarySeek(time,token);
  h.env.holdTeacherAtBoundary();assert.equal(h.state.teacherFreezePending,true);
  await h.call('choose',2,true);assert.equal(h.state.index,2);assert.equal(h.state.phase,'watching');
  release(true);await h.flush();
  assert.equal(h.state.index,2);assert.equal(h.state.phase,'watching');assert.equal(h.state.results.size,1);
  assert.equal(h.review.finalized.length,0);
});

await check('Denied permission or unavailable startup returns to a recoverable camera-off state',async()=>{
  for(const startupPhase of ['error','idle']){
    const h=controllerHarness({stateOverrides:{phase:'camera',awaitingCamera:true,cameraRunning:false}});
    h.cameraState.running=false;const operation=h.state.operation;
    await h.emitCameraState({running:false,phase:startupPhase});
    assert.equal(h.state.awaitingCamera,false);assert.equal(h.state.phase,'positioning');
    assert.equal(h.state.active,true);assert.equal(h.video.paused,true);assert.ok(h.state.operation>operation);
    assert.match(h.state.positionNotice,/permission|device/i);assert.equal(h.review.created.length,0);
    assert.equal(h.events.filter(event=>event.kind==='play').length,0);
    await h.emitCameraState({running:true,phase:'running'});
    assert.equal(h.state.phase,'watching','A later successful camera start still watches the clip first');
    assert.equal(h.state.watched,false);assert.equal(h.review.created.length,0);
  }
});

await check('A genuine media-wait condition invalidates timing and prevents cached successful review',async()=>{
  const h=controllerHarness();await attempt(h);assert.equal(typeof h.env.mediaInterruptionAction,'function');
  h.video.readyState=4;await h.call('mediaInterruptionAction');
  assert.equal(h.state.attemptInterrupted,null,'An unnecessary waiting event while enough frames remain does not invalidate the attempt');
  h.video.readyState=2;await h.call('mediaInterruptionAction');
  assert.match(h.state.attemptInterrupted,/interrupted|timing/i);h.video.readyState=4;
  await review(h);assert.equal(h.review.finalized.length,1);
  assert.equal(h.state.feedback.status,'unknown');assert.equal(h.state.feedback.passed,false);
  assert.match(h.state.feedback.reason,/interrupted|timing/i);
  h.clock.now+=3000;await h.call('tick');
  assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);assert.equal(h.state.phase,'positioning');
});

const directory=new URL('../artifacts/attempt-review-flow/',import.meta.url);await mkdir(directory,{recursive:true});
await writeFile(new URL('controller-qa.json',directory),JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),
  provenance:'Actual production controller declarations and camera-state callback run in a deterministic VM with explicitly constructed video, clock, evaluator and camera controls. No webcam activated, no live inference or physical learner acceptance claimed.',
  controllerSha256:createHash('sha256').update(source).digest('hex'),groups:checks.length,checks,
},null,2)+'\n');
console.log(`Review flow: ${checks.length} controller groups passed (constructed controls; no camera activated).`);

