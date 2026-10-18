/**
 * Deterministic checks for triangle-only hardware guidance. Learner poses below
 * are explicitly CONSTRUCTED software fixtures, never live camera results.
 * Real archived teacher references are read unchanged. USB requests, the DOM
 * and clocks are fixtures; this script never opens a serial device or camera.
 */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createHardwareGuidance,HARDWARE_GUIDANCE_RULES} from '../public/practice-hardware-guidance.js';
import {REVIEW_RULES} from '../public/practice-attempt-review.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {prepareSixthAssessmentReference} from '../public/sixth-assessment-reference.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {preparePracticeTubes,projectPracticeTubes} from '../public/practice-tube.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';
import {createUpperBodyLayout} from '../public/upper-body-layout.js';
import {projectFourPointGuides} from '../public/four-point-game-runtime.js';
import {createArduinoUsbClient} from '../public/arduino-usb-client.js';
import {attachArduinoFeedback} from '../public/arduino-feedback-ui.js';

const root=new URL('../',import.meta.url),indices=[33,34,35,36],checks=[],realMetrics=[];
const frame={hip:{x:.5,y:.5},scale:.15,aspect:1};
const starts=[{x:-1.1,y:-1},{x:1.1,y:-1},{x:-1.1,y:1},{x:1.1,y:1}];
const ends=[{x:-.3,y:-1},{x:.3,y:-1},{x:-.3,y:1},{x:.3,y:1}];
const labels=['Left hand','Right hand','Left foot','Right foot'];
// Deliberately separated hold centers prove that the displayed finish triangle
// replaces the old start-anchor check for a control without a progress beam.
const reference={id:'CONSTRUCTED-no-beam-reference',referenceUsable:true,guides:indices.map((index,i)=>({
  index,label:labels[i],valid:true,start:starts[i],end:ends[i],targetGeometry:{mode:'hold'},distance:.8}))};
const pathReference={referenceId:reference.id,referenceUsable:true,paths:[]};
const beamReference=structuredClone(reference),beamPath={referenceId:reference.id,referenceUsable:true,paths:[]};
for(const i of [0,1]){
  delete beamReference.guides[i].targetGeometry;
  beamPath.paths.push({index:indices[i],available:true,stationary:false,points:[starts[i],ends[i]],halfWidth:.18,totalLength:.8});
}
const clone=value=>structuredClone(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const project=(point,body=frame)=>({x:(point.x*body.scale+body.hip.x)/body.aspect,y:point.y*body.scale+body.hip.y});
const atEnds=ref=>ref.guides.map(guide=>({...guide.end}));
const offset=(points,i,x=0,y=0)=>points.map((point,n)=>n===i?{x:point.x+x,y:point.y+y}:{...point});
function visibleOffset(points,i,body){
  for(const [x,y] of [[.65,0],[-.65,0],[0,.65],[0,-.65]]){
    const candidate=offset(points,i,x,y),raw=project(candidate[i],body);
    if(raw.x>=0&&raw.x<=1&&raw.y>=0&&raw.y<=1)return candidate;
  }
  assert.fail('The constructed deviation must remain a valid in-frame observation');
}
function observation(t,{ref=reference,points=atEnds(ref),body=frame,selected=indices,modify=value=>value}={}){
  return modify({observedAtMs:10000+t,aspectRatio:body.aspect,sample:{tMs:10000+t,status:'pose',
    provenance:'CONSTRUCTED software learner fixture; not webcam inference',
    landmarks:selected.map(index=>({index,...project(points[ref.guides.findIndex(guide=>guide.index===index)],body),
      visibility:.95,presence:.96}))}});
}
function update(helper,t,options={}){
  const ref=options.ref??reference,path=options.path??pathReference,body=options.body??frame;
  return helper.update(ref,path,options.observation===undefined?observation(t,{...options,ref,body}):options.observation,
    body,{nowMs:options.nowMs??10000+t,active:options.active??true,contextKey:options.contextKey??'CONSTRUCTED-attempt',
      ...(Object.hasOwn(options,'triangleOnlyIndices')?{triangleOnlyIndices:options.triangleOnlyIndices}:{}),
      ...(Object.hasOwn(options,'controlIndices')?{controlIndices:options.controlIndices}:{})});
}
function feed(helper,times,options={}){let state;for(const t of times)state=update(helper,t,options);return state;}
async function check(name,fn){await fn();checks.push(name);console.log('PASS: '+name);}

await check('Triangle-only warnings reuse the current radius, confidence, expiry and debounce rules',()=>{
  assert.equal(HARDWARE_GUIDANCE_RULES.warningRadius,.42);
  assert.equal(HARDWARE_GUIDANCE_RULES.recoveryRadius,.34);
  assert.equal(HARDWARE_GUIDANCE_RULES.warningDelayMs,250);
  assert.equal(HARDWARE_GUIDANCE_RULES.recoveryDelayMs,200);
  assert.equal(HARDWARE_GUIDANCE_RULES.visibilityThreshold,REVIEW_RULES.visibilityThreshold);
  assert.equal(HARDWARE_GUIDANCE_RULES.maximumAgeMs,REVIEW_RULES.maximumAgeMs);
  assert.equal(HARDWARE_GUIDANCE_RULES.maximumObservedGapMs,REVIEW_RULES.maximumObservedGapMs);
});

await check('Omitted and empty triangle selections preserve every original beam/hold result',()=>{
  const a=createHardwareGuidance(),b=createHardwareGuidance();
  const events=[{t:0,points:starts},{t:100,points:starts},{t:200,points:starts},
    {t:300,points:offset(starts,0,.7)},{t:400,points:offset(starts,0,.7)},
    {t:550,points:offset(starts,0,.7)},{t:600,observation:null},
    {t:700,points:starts},{t:800,points:starts},{t:900,points:starts},
    {t:1000,active:false},{t:1100,points:starts,contextKey:'CONSTRUCTED-next-attempt'}];
  for(const event of events){const {t,...options}=event;
    assert.deepEqual(update(a,t,options),update(b,t,{...options,triangleOnlyIndices:[]}));}
});

await check('A displayed beam remains acceptable far from its triangle; only no-beam controls check their ends',()=>{
  const helper=createHardwareGuidance(),points=[starts[0],starts[1],ends[2],ends[3]];
  const options={ref:beamReference,path:beamPath,points,triangleOnlyIndices:[35,36]};
  assert.ok(Math.hypot(points[0].x-ends[0].x,points[0].y-ends[0].y)>.42);
  assert.equal(feed(helper,[0,100,200],options).state,'good');
  const off=feed(helper,[300,400,550],{...options,points:offset(points,0,0,.7)});
  assert.equal(off.state,'off','Existing progress-beam deviation still warns');
  assert.equal(off.limbs.find(limb=>limb.status==='outside')?.index,33);
});

await check('Any hand or foot without a beam independently warns at its start and recovers at its triangle',()=>{
  for(let i=0;i<indices.length;i++){
    const helper=createHardwareGuidance(),near=atEnds(reference),away=near.map((point,n)=>n===i?starts[n]:point);
    assert.equal(feed(helper,[0,100,200],{points:near,triangleOnlyIndices:indices}).state,'good');
    assert.equal(update(helper,300,{points:away,triangleOnlyIndices:indices}).state,'idle');
    assert.equal(update(helper,549,{points:away,triangleOnlyIndices:indices}).state,'idle');
    const warning=update(helper,550,{points:away,triangleOnlyIndices:indices});assert.equal(warning.state,'off');
    assert.equal(warning.limbs.find(limb=>limb.status==='outside')?.index,indices[i]);
    assert.equal(update(helper,600,{points:near,triangleOnlyIndices:indices}).state,'off');
    assert.equal(update(helper,799,{points:near,triangleOnlyIndices:indices}).state,'off');
    assert.equal(update(helper,800,{points:near,triangleOnlyIndices:indices}).state,'good');
  }
});

await check('Triangle-only distance uses the finish center and the existing hysteresis band',()=>{
  const helper=createHardwareGuidance(),near=atEnds(reference),options={triangleOnlyIndices:indices};
  assert.equal(feed(helper,[0,100,200],{...options,points:near}).state,'good');
  assert.equal(feed(helper,[300,400,550],{...options,points:offset(near,2,0,.6)}).state,'off');
  assert.equal(feed(helper,[600,700,800],{...options,points:offset(near,2,0,.38)}).state,'off');
  assert.equal(update(helper,900,{...options,points:offset(near,2,0,.30)}).state,'off');
  assert.equal(update(helper,1099,{...options,points:offset(near,2,0,.30)}).state,'off');
  assert.equal(update(helper,1100,{...options,points:offset(near,2,0,.30)}).state,'good');
});

await check('Arms-only practice checks selected palms without needing or warning on hidden feet',()=>{
  const helper=createHardwareGuidance(),options={controlIndices:[33,34],triangleOnlyIndices:[33,34],selected:[33,34]};
  const state=feed(helper,[0,100,200],options);assert.equal(state.state,'good');
  assert.deepEqual(state.limbs.map(limb=>limb.index),[33,34]);
  const warning=feed(helper,[300,400,550],{...options,points:offset(ends,1,0,.7)});
  assert.equal(warning.state,'off');assert.equal(warning.limbs.find(limb=>limb.status==='outside')?.index,34);
});

await check('Invalid, duplicate and non-active triangle selections fail neutral rather than granting success',()=>{
  const invalid=[null,'35',[35,35],[37],[33,undefined],[NaN],[33.5],{},[35,36]];
  for(const triangleOnlyIndices of invalid){
    const helper=createHardwareGuidance();
    const options={triangleOnlyIndices,...(Array.isArray(triangleOnlyIndices)&&triangleOnlyIndices.join(',')==='35,36'
      ?{controlIndices:[33,34],selected:[33,34]}:{})};
    assert.equal(feed(helper,[0,100,250],options).state,'idle',String(triangleOnlyIndices));
  }
  const beam=createHardwareGuidance();
  assert.equal(feed(beam,[0,100,250],{ref:beamReference,path:beamPath,triangleOnlyIndices:[33]}).state,'idle',
    'A caller cannot replace an actual displayed progress beam with triangle-only guidance');
});

await check('A valid finish triangle remains usable without a displayed route even when the control moves',()=>{
  const ref=clone(reference);delete ref.guides[0].targetGeometry;
  const helper=createHardwareGuidance(),options={ref,triangleOnlyIndices:indices};
  assert.equal(feed(helper,[0,100,200],options).state,'good');
  assert.equal(feed(helper,[300,400,550],{...options,points:offset(ends,0,0,.65)}).state,'off');
});

await check('Fresh unknown, stale, missing or mock-status input silences a triangle warning immediately',()=>{
  const modifications=[value=>({...value,sample:{...value.sample,status:'missing'}}),
    value=>({...value,sample:{...value.sample,status:'mock'}}),
    value=>({...value,sample:{...value.sample,landmarks:value.sample.landmarks.slice(1)}}),
    value=>{value.sample.landmarks[1].visibility=.44;return value;},
    value=>{value.sample.landmarks[2].presence=.44;return value;},
    value=>{value.sample.landmarks[3].x=1.01;return value;},
    value=>{value.sample.landmarks.push({...value.sample.landmarks[0]});return value;},
    value=>({...value,observedAtMs:value.observedAtMs-451}),
    value=>({...value,observedAtMs:value.observedAtMs+1}),
  ];
  for(const modify of modifications){
    const helper=createHardwareGuidance(),options={points:starts,triangleOnlyIndices:indices};
    assert.equal(feed(helper,[0,100,250],options).state,'off');
    assert.equal(update(helper,300,{...options,modify}).state,'idle');
  }
  const helper=createHardwareGuidance(),options={points:starts,triangleOnlyIndices:indices};
  assert.equal(feed(helper,[0,100,250],options).state,'off');
  assert.equal(update(helper,300,{...options,observation:null}).state,'idle');
});

await check('Repeated snapshots cannot create warning support; pause, stop and context changes reset it',()=>{
  const helper=createHardwareGuidance(),same=observation(0,{points:starts}),options={triangleOnlyIndices:indices};
  for(const t of [0,100,250,400,451])assert.equal(update(helper,t,{...options,observation:same}).state,'idle');
  assert.equal(feed(helper,[500,600,750],{...options,points:starts}).state,'off');
  assert.equal(update(helper,800,{...options,points:starts,active:false}).state,'idle','Pause/stop is neutral');
  assert.equal(update(helper,900,{...options,points:starts}).state,'idle');
  assert.equal(update(helper,1000,{...options,points:starts,contextKey:'CONSTRUCTED-next-step'}).state,'idle');
  assert.equal(update(helper,1249,{...options,points:starts,contextKey:'CONSTRUCTED-next-step'}).state,'idle');
  assert.equal(update(helper,1250,{...options,points:starts,contextKey:'CONSTRUCTED-next-step'}).state,'off');
  assert.equal(update(helper,1300,{...options,points:starts,triangleOnlyIndices:[35,36]}).state,'idle',
    'Changing the triangle selection starts new debounce evidence');
});

const archiveUrl=new URL('public/practice-media/recut-six/master.poses.json',root);
const archiveText=await readFile(archiveUrl,'utf8'),raw=JSON.parse(archiveText);
const manifest=JSON.parse(await readFile(new URL('public/practice-media/recut-six/manifest.json',root),'utf8'));
const spec=JSON.parse(await readFile(new URL('public/practice-media/recut-six/clip-06-assessment-targets.json',root),'utf8'));
const source={...manifest.sources[0],data:LESSON_CONTROLS.referenceAdapter(raw)},sources=new Map([[source.id,source]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const sixth=prepareSixthAssessmentReference(lesson,source,spec);
const refs=[...lesson.guidanceReferences.slice(0,5),sixth.guidanceReference];
const paths=[...refs.slice(0,5).map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources)),sixth.pathReference];
// Execute the actual controller selector in isolation with its real projection
// dependencies. This checks integration without loading browser/camera code.
const controllerText=await readFile(new URL('public/first-three.js',root),'utf8');
const selectorStart=controllerText.indexOf('function hardwareTriangleOnlyIndices(){');
const selectorEnd=controllerText.indexOf('function seedScreenTargets(',selectorStart);
assert.ok(selectorStart>=0&&selectorEnd>selectorStart,'The production triangle selection function must exist');
const controllerSelector=new Function('state','screenPaths','screenGuides','activeControlIndices',
  'return ('+controllerText.slice(selectorStart,selectorEnd).trim()+')();');
const drawable=route=>route.available&&!route.stationary&&Number.isFinite(route.halfWidth)&&route.halfWidth>0
  &&Array.isArray(route.points)&&route.points.length>=2&&route.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));
function actualTriangleSelection(ref,path,body,selected=indices){
  return controllerSelector({fixedFrame:body},()=>projectPracticeTubes(path,body,null),
    ()=>projectFourPointGuides(ref,null,body.aspect,body),()=>selected);
}

await check('Production controller selects only visible active triangles lacking a drawable beam',()=>{
  const screenGuides=()=>indices.map(index=>({index,valid:true,end:{x:.5,y:.5}}));
  assert.deepEqual(controllerSelector({fixedFrame:null},()=>[],screenGuides,()=>indices),[]);
  const route=index=>({index,available:true,stationary:false,halfWidth:.18,points:[{x:.4,y:.4},{x:.6,y:.6}]});
  const routeCases=[route(33),{...route(34),stationary:true},{...route(35),halfWidth:0},
    {...route(36),points:[{x:NaN,y:.4},{x:.6,y:.6}]}];
  assert.deepEqual(controllerSelector({fixedFrame:frame},()=>routeCases,screenGuides,()=>indices),[34,35,36]);
  assert.deepEqual(controllerSelector({fixedFrame:frame},()=>routeCases,screenGuides,()=>[33,34]),[34]);
  const invisible=()=>[{index:33,valid:true,end:{x:-.01,y:.5}},{index:34,valid:false,end:{x:.5,y:.5}},
    {index:35,valid:true,end:{x:.5,y:1.01}},{index:36,valid:true,end:{x:.5,y:.5}}];
  assert.deepEqual(controllerSelector({fixedFrame:frame},()=>[],invisible,()=>indices),[36]);
  assert.match(controllerText,/triangleOnlyIndices:hardwareTriangleOnlyIndices\(\)/,
    'The actual USB context must consume the production selector');
});

await check('All six real lesson beam sets keep beam behavior and warn independently for every triangle-only control',async()=>{
  const before=digest([refs,paths,raw]);
  for(let clip=0;clip<6;clip++)for(const aspect of [4/3,7/8]){
    const ref=refs[clip],path=paths[clip],body=createFullHeightLayout(ref,refs,aspect,paths)?.frame;
    assert.ok(body);const projected=projectPracticeTubes(path,body,null);
    const beamIndices=projected.filter(drawable).map(route=>route.index);
    const triangleOnlyIndices=ref.guides.filter(guide=>guide.valid&&!beamIndices.includes(guide.index)).map(guide=>guide.index);
    assert.deepEqual(actualTriangleSelection(ref,path,body),triangleOnlyIndices,`Clip ${clip+1}: actual controller selection`);
    const points=atEnds(ref),options={ref,path,body,points,triangleOnlyIndices};
    assert.equal(feed(createHardwareGuidance(),[0,100,200],options).state,'good',`Clip ${clip+1} at ${aspect}: endpoints`);
    for(const index of triangleOnlyIndices){
      const i=ref.guides.findIndex(guide=>guide.index===index),away=visibleOffset(points,i,body);
      const state=feed(createHardwareGuidance(),[0,100,250],{...options,points:away});
      assert.equal(state.state,'off',`Clip ${clip+1}: triangle ${index}: ${state.reason}`);
      assert.equal(state.limbs.find(limb=>limb.status==='outside')?.index,index);
    }
    // Traverse each genuine displayed beam, leaving non-beam controls at their
    // triangles. Being away from the beam's finish remains accepted everywhere.
    const helper=createHardwareGuidance();let accepted=0;
    for(let tick=0;tick<=20;tick++){
      const phase=tick/20,routePoints=ref.guides.map(guide=>{
        if(!beamIndices.includes(guide.index))return guide.end;
        const route=path.paths.find(p=>p.index===guide.index).points;
        const at=phase*(route.length-1),a=route[Math.floor(at)],b=route[Math.min(route.length-1,Math.floor(at)+1)],t=at-Math.floor(at);
        return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      });
      const state=update(helper,tick*100,{...options,points:routePoints});
      if(tick>=2){assert.equal(state.state,'good',`Clip ${clip+1}, aspect ${aspect}, beam tick ${tick}`);accepted++;}
    }
    realMetrics.push({clip:clip+1,aspect,beamIndices,triangleOnlyIndices,acceptedBeamSamples:accepted,
      referenceEvidenceKind:ref.assessmentEvidenceKind??'recorded-teacher-observations'});
  }
  assert.equal(digest([refs,paths,raw]),before,'Guidance and raw archive must not be modified');
  assert.equal(await readFile(archiveUrl,'utf8'),archiveText,'The original archive bytes remain unchanged');
});

await check('Real step-six arms layout uses only displayed palm beams and excludes both foot triangles',()=>{
  const ref=refs[5],path=paths[5],body=createUpperBodyLayout(ref,refs,4/3,paths)?.frame;assert.ok(body);
  const beamIndices=projectPracticeTubes(path,body,null).filter(drawable)
    .map(route=>route.index).filter(index=>[33,34].includes(index));
  const triangleOnlyIndices=[33,34].filter(index=>!beamIndices.includes(index));
  assert.deepEqual(actualTriangleSelection(ref,path,body,[33,34]),triangleOnlyIndices);
  const options={ref,path,body,controlIndices:[33,34],triangleOnlyIndices,selected:[33,34]};
  const state=feed(createHardwareGuidance(),[0,100,200],options);assert.equal(state.state,'good');
  assert.deepEqual(state.limbs.map(limb=>limb.index),[33,34]);
  realMetrics.push({clip:6,mode:'arms-only',beamIndices,triangleOnlyIndices,requiredControls:[33,34]});
});

const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
function fixtureClock(){
  let time=10000,id=0;const timers=new Map();
  return {now:()=>time,setTimer(fn,ms){const key=++id;timers.set(key,{fn,at:time+ms});return key;},
    clearTimer:key=>timers.delete(key),get count(){return timers.size;},
    async tick(ms){const target=time+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=target)
      .sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}
      time=target;await flush();}};
}
function element(){return {disabled:false,hidden:false,textContent:'',dataset:{},events:new Map(),
  setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.events.set(name,fn);},
  removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}};}
await check('Actual hardware UI and USB client forward triangle warnings using the existing off command and neutralize pause',async()=>{
  const time=fixtureClock(),calls=[],elements=new Map();
  const doc={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}};
  const fetchFn=async(url,options)=>{
    const path=url.split('/').at(-1),body=options.body?JSON.parse(options.body):null;calls.push({path,body});
    const data=path==='status'?{transport:'usb',supported:true,connected:false}
      :path==='connect'?{transport:'usb',connected:true,sessionId:'CONSTRUCTED-usb-session',port:'FIXTURE-NO-SERIAL'}
      :path==='signal'?{transport:'usb',connected:true,state:body.state}:{};
    return {ok:true,json:async()=>data};
  };
  const context={reference:beamReference,pathReference:beamPath,frame,active:true,
    triangleOnlyIndices:[35,36],contextKey:'CONSTRUCTED-active-turn'};
  const ui=attachArduinoFeedback({document:doc,getContext:()=>context,now:time.now,
    clientFactory:options=>createArduinoUsbClient({...options,...time,fetchFn})});
  await flush();assert.equal(calls.filter(call=>call.path==='connect').length,0,'No automatic USB connection');
  await doc.getElementById('arduino-connect').events.get('click')();await flush();
  const points=[starts[0],starts[1],starts[2],ends[3]];
  for(const delay of [0,100,150]){
    await time.tick(delay);context.observation=observation(time.now()-10000,{ref:beamReference,points});ui.update();
  }
  assert.equal(ui.getState().guidance.state,'off','UI must forward the no-beam triangle selection');
  await time.tick(50);assert.equal(calls.at(-1).body.state,'off');
  assert.deepEqual(Object.keys(calls.at(-1).body).sort(),['sequence','sessionId','state']);
  context.active=false;ui.update();await flush();assert.equal(calls.at(-1).body.state,'idle','Pause supersedes warning immediately');
  ui.destroy();await flush();assert.equal(time.count,0);assert.equal(calls.at(-1).path,'disconnect');
});

const output=new URL('artifacts/arduino-feedback-review/finish-target-summary.json',root);
await mkdir(new URL('.',output),{recursive:true});
await writeFile(output,JSON.stringify({passed:true,groups:checks.length,checks,realMetrics,
  sourceArchiveSha256:createHash('sha256').update(archiveText).digest('hex'),
  provenance:'Explicit constructed learner poses using unchanged archived teacher references and separately authored step-six targets. Actual guidance, UI and USB client execute with fake DOM, HTTP and timers. No live webcam, serial device, LED or buzzer acceptance is claimed.'},null,2)+'\n');
console.log(`PASS: ${checks.length} triangle-only hardware-guidance groups.`);
