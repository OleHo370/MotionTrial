// Genuine saved teacher observations define the paths below. Every learner
// pose is an explicitly constructed software fixture, never live webcam input.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {canAdvanceOnTargets} from '../public/practice-instant-advance.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareContinuousLesson} from '../public/first-three-continuity.js';
import {prepareAnchoredReference,createStartPositionSession,evaluateStartPosition} from '../public/start-position.js';
import {prepareHandoffReferences} from '../public/practice-handoff.js';
import {preparePracticeTubes,createTubeMatcher} from '../public/practice-tube.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';

const indices=[33,34,35,36],checks=[];
function check(name,run){run();checks.push({name,passed:true});}
const point=index=>({index,x:.4,y:.5,visibility:1,presence:1});
const observation=()=>({observedAtMs:1000,aspectRatio:16/9,
  sample:{status:'pose',tMs:1000,landmarks:indices.map(point)}});
const result=()=>({status:'match',pathComplete:true,percent:100,
  limbs:indices.map(index=>({index,available:true,valid:true,targetReached:true}))});
const fixture=()=>({result:result(),observation:observation(),nowMs:1000,
  active:true,paused:false,phase:'demonstrating'});

check('The first fresh all-four match advances immediately without a hold or video boundary',()=>{
  const args=fixture();
  assert.equal(canAdvanceOnTargets(args),true);
  assert.equal(canAdvanceOnTargets({...args,phase:'grace'}),true);
  // These obsolete fields must not reinstate a delay or teacher cut wait.
  assert.equal(canAdvanceOnTargets({...args,hold:null,heldMs:0,teacherTime:0,
    freezeSeconds:10,videoPaused:false,seeking:false,boundarySettledAtMs:null}),true);
});
check('All four endpoints must be present, observed and reached together',()=>{
  for(const index of indices){
    for(const field of ['available','valid','targetReached']){
      const args=fixture();args.result.limbs.find(limb=>limb.index===index)[field]=false;
      assert.equal(canAdvanceOnTargets(args),false,`${index}: ${field}`);
    }
    const missing=fixture();missing.result.limbs=missing.result.limbs.filter(limb=>limb.index!==index);
    assert.equal(canAdvanceOnTargets(missing),false,`${index}: absent endpoint`);
  }
  const duplicate=fixture();duplicate.result.limbs[3]={...duplicate.result.limbs[0]};
  assert.equal(canAdvanceOnTargets(duplicate),false);
  const onlyDuplicates=fixture();onlyDuplicates.result.limbs.push({...onlyDuplicates.result.limbs[0]});
  assert.equal(canAdvanceOnTargets(onlyDuplicates),false);
});
check('Incomplete ordered paths, mismatch and unknown cannot pass at an endpoint',()=>{
  for(const status of ['unknown','mismatch',undefined])assert.equal(canAdvanceOnTargets({...fixture(),result:{...result(),status}}),false);
  assert.equal(canAdvanceOnTargets({...fixture(),result:{...result(),pathComplete:false}}),false);
  assert.equal(canAdvanceOnTargets({...fixture(),result:null}),false);
});
check('Missing, stale, future and non-pose observations never pass cached match results',()=>{
  for(const age of [451,10000])assert.equal(canAdvanceOnTargets({...fixture(),nowMs:1000+age}),false);
  assert.equal(canAdvanceOnTargets({...fixture(),nowMs:1450}),true);
  assert.equal(canAdvanceOnTargets({...fixture(),nowMs:999}),false);
  assert.equal(canAdvanceOnTargets({...fixture(),observation:null}),false);
  for(const status of ['no_pose','inference_error',undefined]){
    const args=fixture();args.observation.sample.status=status;
    assert.equal(canAdvanceOnTargets(args),false);
  }
  for(const target of ['observedAtMs','tMs'])for(const value of [-1,NaN,Infinity,undefined]){
    const args=fixture();
    if(target==='tMs')args.observation.sample.tMs=value;else args.observation[target]=value;
    assert.equal(canAdvanceOnTargets(args),false,`${target}:${value}`);
  }
});
check('Every anatomical center must retain finite visible live evidence independently of cached result',()=>{
  for(const index of indices){
    const missing=fixture();missing.observation.sample.landmarks=missing.observation.sample.landmarks.filter(p=>p.index!==index);
    assert.equal(canAdvanceOnTargets(missing),false);
    for(const key of ['visibility','presence']){
      const args=fixture();args.observation.sample.landmarks.find(p=>p.index===index)[key]=.449;
      assert.equal(canAdvanceOnTargets(args),false);
      args.observation.sample.landmarks.find(p=>p.index===index)[key]=.45;
      assert.equal(canAdvanceOnTargets(args),true);
    }
    for(const key of ['x','y'])for(const value of [NaN,Infinity,undefined]){
      const args=fixture();args.observation.sample.landmarks.find(p=>p.index===index)[key]=value;
      assert.equal(canAdvanceOnTargets(args),false);
    }
  }
  const duplicate=fixture();duplicate.observation.sample.landmarks.push({...duplicate.observation.sample.landmarks[0]});
  assert.equal(canAdvanceOnTargets(duplicate),false);
});
check('Pause, stop, positioning and preview phases cannot auto advance',()=>{
  assert.equal(canAdvanceOnTargets({...fixture(),active:false}),false);
  assert.equal(canAdvanceOnTargets({...fixture(),paused:true}),false);
  for(const phase of ['loading','camera','preparing','positioning','countdown','feedback','finished','stopped'])
    assert.equal(canAdvanceOnTargets({...fixture(),phase}),false,phase);
});

const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const manifest=await read('public/practice-media/next-three/manifest.json'),sources=new Map();
for(const source of manifest.sources)sources.set(source.id,{...source,
  data:LESSON_CONTROLS.referenceAdapter(await read(`public/practice-media/first-three-centers/${source.id}.poses.json`))});
const lesson=prepareContinuousLesson(manifest.steps.map(withCenterFocus),sources,LESSON_CONTROLS.referenceOptions);
const refs=prepareHandoffReferences(lesson.references.map((ref,i)=>
  prepareAnchoredReference(ref,lesson.steps[i],sources.get(lesson.steps[i].sourceId).data)));
const matcher=createTubeMatcher(),steps=[];
function pointAt(path,phase){
  if(phase<=0)return path.points[0];if(phase>=1)return path.points.at(-1);
  const goal=path.totalLength*phase,upper=path.points.findIndex(p=>p.arcLength>=goal);
  const a=path.points[upper-1],b=path.points[upper],f=(goal-a.arcLength)/(b.arcLength-a.arcLength);
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};
}
for(let index=0;index<refs.length;index++){
  const ref=refs[index],step=lesson.steps[index],pathRef=preparePracticeTubes(ref,step,sources);
  const source=sources.get(step.sourceId),body=ref.teacherFrame;
  const anchor=source.data.samples.find(s=>Math.abs(s.tMs-ref.teacherFrameTMs)<1e-6);assert.ok(anchor);
  const makeFrame=(phase,time,starts=false)=>{
    const live=structuredClone(anchor);live.tMs=time;
    for(const guide of ref.guides){
      const route=pathRef.paths.find(path=>path.index===guide.index&&path.available);
      const target=starts?guide.start:route?pointAt(route,phase):guide.valid?guide.end:guide.start;
      Object.assign(live.landmarks.find(p=>p.index===guide.index),{
        x:(target.x*body.scale+body.hip.x)/body.aspect,y:target.y*body.scale+body.hip.y,visibility:1,presence:1});
    }
    return live;
  };
  const initial=makeFrame(0,1000,true),session=matcher.createSession(ref,pathRef,initial,body,body.aspect);
  let firstMatched=null,firstPassed=null,score;
  const count=Math.max(100,...pathRef.paths.map(path=>Math.ceil(path.totalLength/.012)));
  for(let k=1;k<=count;k++){
    const time=1000+k*50,sample=makeFrame(k/count,time);
    score=matcher.evaluate(ref,pathRef,sample,{attemptAspectRatio:body.aspect,bodyFrame:body,
      nowMs:time,observedAtMs:time,session});
    const matchesAll=score.status==='match'&&indices.every(id=>score.limbs.find(l=>l.index===id)?.targetReached);
    if(matchesAll&&firstMatched===null)firstMatched=time;
    const advances=canAdvanceOnTargets({result:score,observation:{sample,observedAtMs:time,aspectRatio:body.aspect},
      nowMs:time,active:true,paused:false,phase:'demonstrating'});
    if(advances&&firstPassed===null)firstPassed=time;
    if(advances)assert.equal(score.pathComplete,true);
  }
  const allFourSupported=indices.every(id=>ref.guides.find(guide=>guide.index===id)?.valid);
  if(allFourSupported){assert.ok(firstMatched!==null,`${step.id}: supported constructed trace matches all four`);
    assert.equal(firstPassed,firstMatched,`${step.id}: no additional frame or elapsed hold after first all-four match`);
  }else assert.equal(firstPassed,null,`${step.id}: unsupported endpoint must never receive an observed pass`);
  steps.push({id:step.id,allFourSupported,unavailableCenters:indices.filter(id=>!ref.guides.find(g=>g.index===id)?.valid),
    firstAllFourMatchAtMs:firstMatched,firstAdvanceAtMs:firstPassed,addedFinishHoldMs:firstPassed===null?null:firstPassed-firstMatched});
}
check('Real recorded routes completed by constructed learner traces advance on their first all-four match, never before',()=>{
  assert.equal(steps.length,6);assert.ok(steps.some(step=>step.allFourSupported));
  assert.ok(steps.filter(step=>step.allFourSupported).every(step=>step.addedFinishHoldMs===0));
});

// Run the actual small controller entry point, with its genuine start-position
// evaluator and tube matcher. Only camera/clock/video-launch edges are stubs.
const controller=await readFile(new URL('../public/first-three.js',import.meta.url),'utf8');
const beginFunction=controller.indexOf('function continueFromMatchedStart(handoff){');
const endFunction=controller.indexOf('async function choose(',beginFunction);
assert.ok(beginFunction>=0&&endFunction>beginFunction,'Actual controller handoff function exists');
const invokeHandoff=new Function('env',`
  const {state,performance,seedScreenTargets,evaluateStartPosition,guidance,pathReference,matcher,demonstrate}=env;
  ${controller.slice(beginFunction,endFunction)}
  return continueFromMatchedStart(env.handoff);
`);
const tubes=refs.map((ref,index)=>preparePracticeTubes(ref,lesson.steps[index],sources));
const handoffs=[];
function controllerCase(cut=0,aspect=16/9){
  const current=refs[cut],next=refs[cut+1],source=sources.get(lesson.steps[cut].sourceId),time=20000;
  const outgoing=createFullHeightLayout(current,refs,aspect,tubes),incoming=createFullHeightLayout(next,refs,aspect,tubes);
  const sample=structuredClone(source.data.samples.find(s=>Math.abs(s.tMs-current.teacherFrameTMs)<1e-6));
  sample.tMs=time;
  for(const guide of current.guides)Object.assign(sample.landmarks.find(p=>p.index===guide.index),{
    x:(guide.end.x*outgoing.frame.scale+outgoing.frame.hip.x)/aspect,
    y:guide.end.y*outgoing.frame.scale+outgoing.frame.hip.y,visibility:1,presence:1});
  const observed={sample,aspectRatio:aspect,observedAtMs:time};
  const camera={running:true,generation:12},calls=[];
  const state={active:true,paused:false,visualOnly:!indices.every(id=>next.guides.find(g=>g.index===id)?.valid),
    observation:null,observationRevision:1,placement:createStartPositionSession(next),camera:{getState:()=>camera}};
  const env={state,performance:{now:()=>time},handoff:{observation:observed,observationRevision:1,aspectRatio:aspect,cameraGeneration:12},
    seedScreenTargets(){state.placement.bodyFrame=incoming.frame;state.placement.aspect=aspect;},
    evaluateStartPosition,guidance:()=>next,pathReference:()=>tubes[cut+1],matcher,
    demonstrate(fromPlacement){calls.push({fromPlacement,heldMs:state.positioning.heldMs,
      holdReady:state.positioning.holdReady,handoffAccepted:state.positioning.handoffAccepted});}};
  return {env,state,camera,calls,time,observed};
}
check('Actual controller continues a shared observed cut immediately with a zero-ms start hold',()=>{
  for(const aspect of [16/9,4/3,9/16])for(let cut=0;cut<refs.length-1;cut++){
    const c=controllerCase(cut,aspect),accepted=invokeHandoff(c.env);
    if(c.state.visualOnly){assert.equal(accepted,false);assert.equal(c.calls.length,0);}
    else{
      assert.equal(accepted,true,`${cut+1} -> ${cut+2} at ${aspect}: actual controller accepts shared cut`);
      assert.equal(c.calls.length,1);assert.equal(c.calls[0].fromPlacement,true);
      assert.equal(c.calls[0].heldMs,0);assert.equal(c.calls[0].holdReady,false);
      assert.equal(c.calls[0].handoffAccepted,true);assert.ok(c.state.movement);
      assert.ok(Object.values(c.state.movement.paths).every(path=>!path.needsRejoin));
    }
    handoffs.push({from:refs[cut].id,to:refs[cut+1].id,aspect,
      referenceUnavailable:c.state.visualOnly,accepted,demoCalls:c.calls.length,heldMs:c.calls[0]?.heldMs??null});
  }
});
check('Actual controller safely falls back to squares after changed, stale, missing or mismatched capture',()=>{
  const mutations=[
    c=>{c.env.handoff=null;},c=>{c.camera.running=false;},c=>{c.camera.generation++;},
    c=>{c.env.handoff.aspectRatio=4/3;},c=>{c.state.active=false;},c=>{c.state.paused=true;},
    c=>{c.state.visualOnly=true;},c=>{c.observed.observedAtMs-=451;},
    c=>{c.observed.sample.status='no_pose';},
    c=>{c.observed.sample.landmarks=c.observed.sample.landmarks.filter(p=>p.index!==35);},
    c=>{c.observed.sample.landmarks.find(p=>p.index===33).x=0;},
    c=>{c.observed.sample.landmarks.find(p=>p.index===34).visibility=.1;},
  ];
  for(const mutate of mutations){
    const c=controllerCase();mutate(c);
    assert.equal(invokeHandoff(c.env),false);assert.equal(c.calls.length,0);
    assert.equal(c.state.movement,undefined);
  }
});
check('A newer camera delivery overrides the saved finish while the next clip loads',()=>{
  const unknown=controllerCase();unknown.state.observationRevision=2;unknown.state.observation=null;
  assert.equal(invokeHandoff(unknown.env),false,'A delivered null overrides saved supported finish');
  assert.equal(unknown.calls.length,0);
  const moved=controllerCase();moved.state.observationRevision=2;
  moved.state.observation=structuredClone(moved.observed);
  moved.state.observation.sample.landmarks.find(p=>p.index===35).x=0;
  assert.equal(invokeHandoff(moved.env),false,'A newer outside-square point overrides previous successful finish');
  assert.equal(moved.calls.length,0);
  const fresh=controllerCase();fresh.state.observationRevision=2;
  fresh.state.observation=structuredClone(fresh.observed);
  fresh.state.observation.observedAtMs+=50;fresh.state.observation.sample.tMs+=50;
  fresh.env.performance.now=()=>fresh.time+50;
  assert.equal(invokeHandoff(fresh.env),true,'A newer fresh supported start continues immediately');
  assert.equal(fresh.calls.length,1);assert.equal(fresh.calls[0].heldMs,0);
});

const directory=new URL('../artifacts/instant-advance-review/',import.meta.url);await mkdir(directory,{recursive:true});
await writeFile(new URL('instant-advance-summary.json',directory),JSON.stringify({
  provenance:'Genuine saved MediaPipe teacher observations define six source-backed routes. Learner poses and invalid samples are explicitly constructed software inputs. No live inference or human-camera acceptance is claimed.',
  groups:checks.length,checks,steps,handoffs,
},null,2)+'\n');
console.log(`Instant finish: ${checks.length} groups passed; ${steps.filter(step=>step.allFourSupported).length} supported recorded routes require zero additional finish hold.`);
