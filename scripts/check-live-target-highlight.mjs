// CONSTRUCTED learner observations exercise real production location feedback.
// Recorded teacher references are genuine archived local MediaPipe observations.
// These are software regressions, not physical-camera or human acceptance tests.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getLiveTargetHighlights} from '../public/practice-target-highlight.js';
import {REVIEW_RULES} from '../public/practice-attempt-review.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';

const root=new URL('../',import.meta.url),directory=new URL('artifacts/live-target-highlight-review/',root);
const require=createRequire(import.meta.url),{parse}=require('next/dist/compiled/acorn');
const source=await readFile(new URL('public/first-three.js',root),'utf8');
const helperSource=await readFile(new URL('public/practice-target-highlight.js',root),'utf8');
const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const drawNode=tree.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='drawGuides');
assert.ok(drawNode,'Production drawGuides declaration exists');
const drawSource=source.slice(drawNode.start,drawNode.end);
const indices=[33,34,35,36],colors=['#20bba4','#e1ad39','#4fa7df','#b276db'];
const frame={hip:{x:.5,y:.5},scale:.25,aspect:4/3};
const reference={referenceUsable:true,guides:indices.map((index,i)=>({index,valid:true,color:colors[i],
  start:{x:i%2?.4:-.4,y:i<2?0:1.2},end:{x:i%2?.55:-.55,y:i<2?-.6:1.3}}))};
const rawPoint=(index,point,body=frame)=>({index,x:(point.x*body.scale+body.hip.x)/body.aspect,
  y:point.y*body.scale+body.hip.y,visibility:.99,presence:.99});
const observation=(ref=reference,body=frame)=>({observedAtMs:1980,aspectRatio:body.aspect,
  sample:{status:'pose',tMs:1780,landmarks:ref.guides.filter(g=>g.end).map(g=>rawPoint(g.index,g.end,body))}});
const copy=value=>structuredClone(value),plain=value=>JSON.parse(JSON.stringify(value));
const highlights=(obs=observation(),ref=reference,body=frame,options={})=>getLiveTargetHighlights(ref,obs,body,{nowMs:2000,...options});
const allDark=values=>assert.ok(values.length===4&&values.every(value=>!value.valid&&!value.reached&&value.distance===null));
const checks=[];
async function save(result){await mkdir(directory,{recursive:true});await writeFile(new URL('qa.json',directory),JSON.stringify({
  result,checkedAt:new Date().toISOString(),groups:checks.length,checks,
  provenance:'Actual production helper and extracted drawGuides; constructed raw learner observations. Genuine archived local MediaPipe teacher references. No live inference or physical acceptance.',
  controllerSha256:createHash('sha256').update(source).digest('hex'),
  helperSha256:createHash('sha256').update(helperSource).digest('hex'),
  limitations:['No physical webcam or human motion acceptance.']},null,2)+'\n');}
async function check(name,run){try{await run();checks.push({name,passed:true});console.log(`PASS: ${name}`);}
  catch(error){checks.push({name,passed:false,error:error.stack??String(error)});await save('FAIL');throw error;}}

await check('All four fresh anatomical palm/foot centers light independently at their endpoints',()=>{
  const result=highlights();assert.deepEqual(result.map(r=>r.index),indices);
  assert.ok(result.every(r=>r.valid&&r.reached&&r.distance<1e-12));
  for(const index of indices){const obs=observation(),p=obs.sample.landmarks.find(p=>p.index===index);p.x+=.18;
    const result=highlights(obs);assert.equal(result.find(r=>r.index===index).reached,false);
    assert.ok(result.filter(r=>r.index!==index).every(r=>r.reached));}
});
await check('Highlight tolerance equals forgiving post-clip endpoint tolerance, with no route requirement',()=>{
  assert.equal(REVIEW_RULES.endpointRadius,.34);
  for(const index of indices){for(const [offset,reached] of [[.3399,true],[.3401,false]]){
    const obs=observation(),p=obs.sample.landmarks.find(p=>p.index===index);p.x+=offset*frame.scale/frame.aspect;
    assert.equal(highlights(obs).find(r=>r.index===index).reached,reached);}}
});
await check('Current location is read-only and non-latching; repeated rendering and moving away work',()=>{
  const obs=observation(),before=JSON.stringify([reference,obs,frame]);
  assert.deepEqual(highlights(obs),highlights(obs));assert.equal(JSON.stringify([reference,obs,frame]),before);
  const away=copy(obs);away.sample.landmarks[0].x+=.2;
  assert.equal(highlights(away)[0].reached,false);assert.equal(highlights(obs)[0].reached,true);
});
await check('Missing, stale, future, invalid timestamp/status and duplicate-index observations never light',()=>{
  allDark(highlights(null));
  for(const change of [o=>o.observedAtMs=1549,o=>o.observedAtMs=2001,o=>o.observedAtMs=-1,
    o=>o.sample.status='no-pose',o=>o.sample.tMs=NaN,o=>o.sample.tMs=-1,
    o=>o.sample.landmarks.push({...o.sample.landmarks[0]}),o=>o.sample.landmarks=null]){
    const obs=observation();change(obs);allDark(highlights(obs));}
  const atLimit=observation();atLimit.observedAtMs=1550;assert.ok(highlights(atLimit).every(r=>r.reached));
});
await check('Low confidence, absent/out-of-frame points and unsupported teacher targets remain unknown per limb',()=>{
  for(const change of [p=>p.visibility=.449,p=>p.presence=.449,p=>p.visibility=NaN,
    p=>p.presence=NaN,p=>p.visibility=1.01,p=>p.presence=1.01,p=>p.x=-.01]){
    const obs=observation();change(obs.sample.landmarks[0]);const result=highlights(obs);
    assert.equal(result[0].valid,false);assert.equal(result[0].reached,false);assert.ok(result.slice(1).every(r=>r.reached));}
  const missing=observation();missing.sample.landmarks.shift();assert.equal(highlights(missing)[0].valid,false);
  const invalid=copy(reference);invalid.guides[0].valid=false;assert.equal(highlights(observation(),invalid)[0].reached,false);
});
await check('Invalid frozen frames and changed camera aspect reject cached location feedback',()=>{
  for(const invalid of [null,{...frame,scale:0},{...frame,aspect:0},{...frame,hip:{x:NaN,y:.5}}])allDark(highlights(observation(),reference,invalid));
  const changed=observation();changed.aspectRatio=9/16;allDark(highlights(changed));
  const recovered=observation();assert.ok(highlights(recovered).every(r=>r.reached));
});
await check('Anatomical left/right comparisons are independent of display mirroring',()=>{
  const obs=observation(),before=highlights(obs);
  obs.displayMirrored=true;assert.deepEqual(highlights(obs),before);
  [obs.sample.landmarks[0].index,obs.sample.landmarks[1].index]=[34,33];
  assert.ok(highlights(obs).slice(0,2).every(r=>!r.reached),'Swapping anatomical hands cannot silently match');
});

function rendererHarness(){
  const clock={now:2000},fills=[],transforms=[],camera={running:true};
  const ctx={fillStyle:null,closed:false,lineWidth:0,globalAlpha:1,
    beginPath(){this.closed=false;},closePath(){this.closed=true;},
    fill(){fills.push({color:this.fillStyle,closed:this.closed,lineWidth:this.lineWidth});},
    save(){},restore(){},translate(){},scale(){},strokeText(){},fillText(){},stroke(){},
    moveTo(){},lineTo(){},fillRect(){},strokeRect(){}};
  const canvas={width:800,height:600,style:{},getContext:()=>ctx};
  const elements={'camera-guide-overlay':canvas,'camera-video':{videoWidth:800,videoHeight:600},
    'mirror-preview':{checked:true},'learner-skeleton':{checked:true}};
  const state={loading:false,active:true,phase:'demonstrating',paused:false,placement:{bodyFrame:frame},fixedFrame:frame,
    feedback:null,movement:{pathComplete:false},observation:observation(),positioning:null,camera:{getState:()=>camera}};
  const projection=p=>({x:(p.x*frame.scale+frame.hip.x)/frame.aspect,y:p.y*frame.scale+frame.hip.y});
  const geometry={frame,starts:reference.guides.map(g=>({...g,point:projection(g.start)})),
    ends:reference.guides.map(g=>({...g,start:projection(g.start),end:projection(g.end)})),
    routes:reference.guides.map(g=>({index:g.index,complete:false}))};
  const context={state,$:id=>elements[id],performance:{now:()=>clock.now},Math,Map,
    START_POSITION_RULES:{radius:.2},seedScreenTargets(){},guidance:()=>reference,
    pathReference:()=>({}),cameraFeedAvailable:()=>true,projectPracticeGuideGeometry:()=>geometry,
    drawPracticeTubes(){},finishTriangleSize:()=>12,getLiveTargetHighlights};
  vm.createContext(context);vm.runInContext(drawSource,context);
  return {state,clock,camera,elements,canvas,draw(){fills.length=0;context.drawGuides();return copy(fills.filter(f=>f.closed));}};
}
await check('Actual drawGuides fills reached triangles immediately with null feedback and incomplete routes',()=>{
  const h=rendererHarness(),fills=h.draw();assert.deepEqual(fills.map(f=>f.color),colors);
  assert.ok(fills.every(f=>f.lineWidth===5));assert.ok(h.state.projectedEnds.every(p=>p.reached));
  assert.equal(h.state.feedback,null);assert.equal(h.state.phase,'demonstrating');assert.equal(h.state.movement.pathComplete,false);
  assert.equal(h.canvas.style.transform,'scaleX(-1)');h.elements['mirror-preview'].checked=false;
  assert.deepEqual(h.draw().map(f=>f.color),colors);assert.equal(h.canvas.style.transform,'none');
});
await check('Actual renderer follows display-filtered camera dots, clears a null display getter, and preserves raw feedback observations',()=>{
  const h=rendererHarness();
  const away=observation();for(const p of away.sample.landmarks)p.x+=.2;
  h.state.observation=away;
  let display=observation(),reads=0;
  h.state.camera.getDisplayObservation=()=>{reads++;return display;};
  const rawAwayBefore=JSON.stringify(h.state.observation),displayBefore=JSON.stringify(display);
  assert.deepEqual(h.draw().map(f=>f.color),colors,'Visible dots at the endpoints light triangles even when raw positions differ');
  assert.equal(reads,1);assert.equal(JSON.stringify(h.state.observation),rawAwayBefore);
  assert.equal(JSON.stringify(display),displayBefore);

  h.state.observation=observation();display=away;
  const rawAtTargetBefore=JSON.stringify(h.state.observation);
  assert.ok(h.draw().every(f=>f.color==='#152d31b8'),'Raw endpoint hits cannot light triangles when displayed dots are away');
  assert.equal(JSON.stringify(h.state.observation),rawAtTargetBefore);

  display=null;
  assert.ok(h.draw().every(f=>f.color==='#152d31b8'),'Null presentation observations clear glow instead of falling back to raw');
  assert.ok(h.state.projectedEnds.every(p=>!p.reached));
  assert.equal(JSON.stringify(h.state.observation),rawAtTargetBefore);

  delete h.state.camera.getDisplayObservation;
  assert.deepEqual(h.draw().map(f=>f.color),colors,'Older camera mocks without the presentation API retain their explicit raw fallback');
  assert.equal(JSON.stringify(h.state.observation),rawAtTargetBefore);
});
await check('Actual renderer unlights moved-away, stale and stopped-camera observations without cached success',()=>{
  const h=rendererHarness();h.draw();h.state.observation.sample.landmarks[0].x+=.2;
  assert.equal(h.draw()[0].color,'#152d31b8');assert.equal(h.state.projectedEnds[0].reached,false);
  h.state.observation=observation();h.clock.now=2500;assert.ok(h.draw().every(f=>f.color==='#152d31b8'));
  h.clock.now=2000;assert.ok(h.draw().every(f=>f.color!=='#152d31b8'));
  h.camera.running=false;assert.ok(h.draw().every(f=>f.color==='#152d31b8'));
});
await check('Only imitation/grace show live triangle feedback; watch/setup/review do not',()=>{
  const h=rendererHarness();h.state.phase='grace';assert.deepEqual(h.draw().map(f=>f.color),colors);
  for(const phase of ['watching','positioning','feedback','stopped']){
    h.state.phase=phase;assert.equal(h.draw().length,0);assert.equal(h.state.projectedEnds.length,0);}
});
await check('All five supported genuine teacher references project endpoint centers correctly; unsupported sixth stays unknown',async()=>{
  const manifest=JSON.parse(await readFile(new URL('public/practice-media/recut-six/manifest.json',root),'utf8'));
  const metadata=manifest.sources[0],raw=JSON.parse(await readFile(new URL('public'+metadata.poseSrc,root),'utf8'));
  const before=JSON.stringify(raw);
  const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},
    new Map([[metadata.id,{...metadata,data:LESSON_CONTROLS.referenceAdapter(raw)}]]),LESSON_CONTROLS.referenceOptions);
  assert.equal(lesson.guidanceReferences.filter(r=>r.referenceUsable).length,5);
  for(const ref of lesson.guidanceReferences.filter(r=>r.referenceUsable)){
    const result=highlights(observation(ref),ref);assert.ok(result.every(r=>r.valid&&r.reached),ref.id);
    const away=observation(ref);for(const p of away.sample.landmarks)p.x+=.08;
    assert.ok(highlights(away,ref).every(r=>!r.reached),`${ref.id}: moving away darkens all four`);
  }
  allDark(highlights(observation(),lesson.guidanceReferences[5]));assert.equal(JSON.stringify(raw),before);
});
await save('PASS');console.log(`PASS: ${checks.length} live target highlight groups`);
