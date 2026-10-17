// Real archived teacher data is evidence for reference/geometry checks only.
// ALL learner samples below are constructed software controls, not a webcam or
// human-practice acceptance test. No recording is replayed as live inference.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {prepareStartPosition,createStartPositionSession,projectStartPositionTargets} from '../public/start-position.js';
import {projectFourPointGuides} from '../public/four-point-game-runtime.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';
import {finishTargetSize,finishTargetContains} from '../public/first-three-attempt.js';
import {practiceTubeIndices,preparePracticeTubes,createTubeMatcher,TUBE_RULES} from '../public/practice-tube.js';
import {canAdvanceOnTargets} from '../public/practice-instant-advance.js';

const root=new URL('../',import.meta.url),read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const close=(a,b,label,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<=epsilon,`${label}: ${a} != ${b}`);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const manifest=await read('public/practice-media/recut-six/manifest.json');
const metadata=manifest.sources[0],raw=await read(`public${metadata.poseSrc}`);
const adapted=LESSON_CONTROLS.referenceAdapter(raw),sources=new Map([[metadata.id,{...metadata,data:adapted}]]);
const inputDigest=digest([manifest,raw,[...sources]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const refs=lesson.guidanceReferences,paths=refs.map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources));
const report={
  provenance:'Reference checks use genuine saved MediaPipe teacher observations. Every learner frame is an explicitly constructed deterministic software input. No physical webcam or human acceptance is claimed.',
  rules:TUBE_RULES,checks:[],steps:[],footSeams:[],synthetic:[],limitations:[
    'No actual person, device permissions, camera switch or tracking-in-motion acceptance.',
    'Foot anchors are versioned teaching geometry, not newly inferred teacher observations.',
  ],
};
const check=(name,run)=>{run();report.checks.push(name);};
const matcher=createTubeMatcher();
const project=(point,body)=>({x:(point.x*body.scale+body.hip.x)/body.aspect,y:point.y*body.scale+body.hip.y});
const pointAt=(path,phase)=>{
  if(phase<=0)return {...path.points[0]};if(phase>=1)return {...path.points.at(-1)};
  const arc=phase*path.totalLength,k=path.points.findIndex(point=>point.arcLength>=arc);
  const a=path.points[k-1],b=path.points[k],t=(arc-a.arcLength)/(b.arcLength-a.arcLength);
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
};
function makeCase(ref,pathRef,base){
  const body=ref.teacherFrame,aspect=body.aspect;
  const fixture=(phase,tMs,{starts=false,overrides=new Map(),missing=[]}={})=>{
    const sample=structuredClone(base);sample.tMs=tMs;sample.status='pose';
    for(const guide of ref.guides){
      const path=pathRef.paths.find(path=>path.index===guide.index&&path.available);
      const target=overrides.get(guide.index)??(starts?guide.start:path?pointAt(path,phase):guide.end);
      if(!target)continue;
      let point=sample.landmarks.find(point=>point.index===guide.index);
      if(!point){point={index:guide.index};sample.landmarks.push(point);}
      Object.assign(point,project(target,body),{visibility:1,presence:1});
    }
    sample.landmarks=sample.landmarks.filter(point=>!missing.includes(point.index));return sample;
  };
  const begin=()=>matcher.createSession(ref,pathRef,fixture(0,1000,{starts:true}),body,aspect);
  const evaluate=(sample,session,extra={})=>matcher.evaluate(ref,pathRef,sample,{session,bodyFrame:body,
    attemptAspectRatio:aspect,nowMs:sample.tMs,observedAtMs:sample.tMs,...extra});
  const walk=(session=begin(),startTime=1000,startPhase=0,endPhase=1,options={})=>{
    const count=Math.max(120,...pathRef.paths.map(path=>Math.ceil(path.totalLength/.015)));
    let sample,result,time=startTime;
    for(let i=1;i<=count;i++){time+=25;sample=fixture(startPhase+(endPhase-startPhase)*i/count,time,options);result=evaluate(sample,session);}
    return {session,result,sample,time};
  };
  return {ref,pathRef,body,aspect,fixture,begin,evaluate,walk};
}

check('Only meaningful endpoint movement creates progress sections; named focus does not force tiny routes',()=>{
  const ref=structuredClone(refs[1]);ref.focusJoints=[33,34,35,36];
  for(const guide of ref.guides){guide.valid=true;guide.end={x:guide.start.x+.1,y:guide.start.y};guide.distance=.1;guide.stationary=false;delete guide.targetGeometry;}
  assert.deepEqual(practiceTubeIndices(ref),[],'Tiny focused hands and feet are hold targets, not progress routes');
  for(const guide of ref.guides){guide.distance=[35,36].includes(guide.index)?.451:.351;guide.end={x:guide.start.x+guide.distance,y:guide.start.y};}
  assert.deepEqual(practiceTubeIndices(ref),[33,34,35,36]);
});

check('Real recorded lesson assesses steps 1–5; missing step 6 evidence stays unknown',()=>{
  assert.deepEqual(paths.map(path=>path.referenceUsable),[true,true,true,true,true,false]);
  assert.equal(refs[5].referenceUsable,false);
  for(let i=0;i<refs.length;i++){
    const required=practiceTubeIndices(refs[i]);assert.deepEqual(paths[i].paths.map(path=>path.index),required);
    assert.ok(paths[i].paths.filter(path=>path.available).every(path=>distance(refs[i].guides.find(g=>g.index===path.index).start,
      refs[i].guides.find(g=>g.index===path.index).end)>=([35,36].includes(path.index)?.45:.35)-1e-8));
    report.steps.push({id:refs[i].id,referenceUsable:refs[i].referenceUsable,pathUsable:paths[i].referenceUsable,
      requiredProgress:paths[i].paths.map(path=>({index:path.index,available:path.available,totalLength:path.totalLength})),
      unknownReason:paths[i].unknownReason??refs[i].unknownReason});
  }
});

check('Foot teaching anchors preserve archived coordinates and stationary footing across clip cuts',()=>{
  for(let i=0;i<refs.length;i++)for(const index of [35,36]){
    const guide=refs[i].guides.find(g=>g.index===index),original=lesson.references[i].guides.find(g=>g.index===index);
    assert.deepEqual(guide.startRaw,original.startRaw);assert.deepEqual(guide.endRaw,original.endRaw);
    assert.deepEqual(guide.startObservation,original.startObservation);assert.deepEqual(guide.endObservation,original.endObservation);
    if(!guide.valid)continue;
    assert.equal(guide.targetGeometry.kind,'anchored-foot');
    if(guide.targetGeometry.mode==='hold'){
      close(guide.start.x,guide.end.x,'Held foot normalized x');close(guide.start.y,guide.end.y,'Held foot normalized y');
      assert.ok(!practiceTubeIndices(refs[i]).includes(index),'Held foot must not receive a progress bar');
    }
  }
  for(const aspect of [16/9,4/3,9/16]){
    const layouts=refs.map(ref=>createFullHeightLayout(ref,refs,aspect,paths));
    for(let i=0;i<refs.length-1;i++){
      const end=projectFourPointGuides(refs[i],null,aspect,layouts[i].frame);
      const session=createStartPositionSession(refs[i+1]);session.bodyFrame=layouts[i+1].frame;session.aspect=aspect;
      const start=projectStartPositionTargets(refs[i+1],session);
      for(const index of [35,36]){
        const a=end.find(g=>g.index===index),b=start.find(g=>g.index===index);
        assert.ok(a.valid&&b.valid);close(a.end.x,b.point.x,'Foot cut screen x');close(a.end.y,b.point.y,'Foot cut screen y');
        report.footSeams.push({from:i+1,to:i+2,index,aspect,projectedJump:0});
      }
    }
  }
});

check('Each progress corridor retains actual source evidence and joins its designated square and triangle exactly',()=>{
  for(let i=0;i<refs.length;i++)for(const path of paths[i].paths.filter(path=>path.available)){
    const ref=refs[i],guide=ref.guides.find(guide=>guide.index===path.index),frame=ref.teacherFrame;
    close(path.points[0].x,guide.start.x,'Visible corridor start x');close(path.points[0].y,guide.start.y,'Visible corridor start y');
    close(path.points.at(-1).x,guide.end.x,'Visible corridor end x');close(path.points.at(-1).y,guide.end.y,'Visible corridor end y');
    assert.ok(path.observations.length>=3);
    for(const observation of path.observations){
      const source=sources.get(observation.sourceId),actual=source?.data.samples.find(sample=>Math.abs(sample.tMs-observation.tMs)<1e-6);
      assert.ok(actual);const point=actual.landmarks.find(point=>point.index===path.index);assert.ok(point);
      assert.deepEqual(observation.raw,point,'Same-side same-frame original observed point');
      close(observation.sourceTimeSeconds,actual.sourceTimeSeconds,'Exact original timestamp');
      close(observation.point.x,(point.x*frame.aspect-frame.hip.x)/frame.scale,'Original observation normalized x');
      close(observation.point.y,(point.y-frame.hip.y)/frame.scale,'Original observation normalized y');
    }
  }
});

check('An accepted foot triangle fits wholly inside the next planted hold triangle and its starting square',()=>{
  const summary={holdHandoffs:0,aspectCases:0,vertices:0,maximumCenterJump:0,
    maximumHoldViolation:0,maximumStartViolation:0};
  for(const aspect of [16/9,4/3,9/16]){
    const layouts=refs.map(ref=>createFullHeightLayout(ref,refs,aspect,paths));
    for(let i=0;i<refs.length-1;i++)for(const index of [35,36]){
      const a=refs[i],b=refs[i+1],out=a.guides.find(guide=>guide.index===index),incoming=b.guides.find(guide=>guide.index===index);
      if(!out.valid||!incoming.valid||incoming.targetGeometry?.mode!=='hold')continue;
      const outFrame=layouts[i].frame,inFrame=layouts[i+1].frame;
      const intoIncoming=point=>{
        const screen=project(point,outFrame);
        return {x:(screen.x*inFrame.aspect-inFrame.hip.x)/inFrame.scale,y:(screen.y-inFrame.hip.y)/inFrame.scale};
      };
      const center=intoIncoming(out.end),outSize=finishTargetSize(a,index),inSize=finishTargetSize(b,index);
      const radius=prepareStartPosition(b).radius;
      summary.maximumCenterJump=Math.max(summary.maximumCenterJump,distance(center,incoming.end));
      const vertices=[{x:out.end.x,y:out.end.y-outSize},
        {x:out.end.x-outSize*.9,y:out.end.y+outSize*.65},
        {x:out.end.x+outSize*.9,y:out.end.y+outSize*.65}];
      for(const vertex of vertices){
        const point=intoIncoming(vertex),dx=Math.abs(point.x-incoming.end.x),dy=point.y-incoming.end.y;
        const holdViolation=Math.max(0,-inSize-dy,dy-inSize*.65,dx-.9/1.65*(dy+inSize));
        const startViolation=Math.max(0,Math.abs(point.x-incoming.start.x)-radius,Math.abs(point.y-incoming.start.y)-radius);
        summary.maximumHoldViolation=Math.max(summary.maximumHoldViolation,holdViolation);
        summary.maximumStartViolation=Math.max(summary.maximumStartViolation,startViolation);
        assert.equal(finishTargetContains(point,incoming.end,b,index),true,`Clip ${i+1} foot ${index} triangle vertex remains inside next hold under aspect ${aspect}`);
        assert.ok(startViolation<=1e-8,`Clip ${i+1} foot ${index} triangle vertex remains inside next starting square`);
        summary.vertices++;
      }
      summary.aspectCases++;if(aspect===16/9)summary.holdHandoffs++;
    }
  }
  assert.ok(summary.holdHandoffs>0);assert.ok(summary.maximumCenterJump<=1e-8);
  assert.ok(summary.maximumHoldViolation<=1e-8);assert.ok(summary.maximumStartViolation<=1e-8);
  report.footHoldContainment=summary;
});

const recorded=[];
for(let i=0;i<5;i++){
  const base=adapted.samples.find(sample=>sample.sourceFrameIndex===lesson.steps[i].referenceStartFrame);
  const c=makeCase(refs[i],paths[i],base),done=c.walk();
  assert.equal(done.result.status,'match',`Recorded step ${i+1}: ${done.result.reason}`);
  assert.equal(done.result.pathComplete,true);
  assert.equal(canAdvanceOnTargets({result:done.result,observation:{sample:done.sample,observedAtMs:done.time},
    nowMs:done.time,active:true,paused:false,phase:'demonstrating'}),true);
  recorded.push(c);
}
report.checks.push('All five assessed real-reference clips pass constructed inside-corridor controls and advance instantly with all four fresh endpoint targets.');

// A path with an up-and-back branch. Traversing the horizontal corridor stays
// inside the visible union but intentionally skips the ordered branch vertices.
const body={hip:{x:.625,y:.5},scale:.2,aspect:1.25};
const guides=[
  {index:33,label:'Left hand',start:{x:-1,y:-1},end:{x:1,y:-1}},
  {index:34,label:'Right hand',start:{x:1,y:.1},end:{x:1,y:.1}},
  {index:35,label:'Left foot',start:{x:-.4,y:1.6},end:{x:-.4,y:1.6}},
  {index:36,label:'Right foot',start:{x:.4,y:1.6},end:{x:.4,y:1.6}},
].map(guide=>({...guide,valid:true,available:true,required:true,color:'#fff',startRaw:project(guide.start,body),
  endRaw:project(guide.end,body),support:{startTimesMs:[0,50],endTimesMs:[950,1000]},startSourceSeconds:0,
  endSourceSeconds:1,stationary:guide.index!==33}));
const syntheticRef={...structuredClone(refs[1]),id:'constructed-corridor-policy',referenceUsable:true,teacherFrame:body,
  focusJoints:[33],guides};
const syntheticBase={status:'pose',tMs:1000,landmarks:[
  {index:11,x:.4,y:.3},{index:12,x:.6,y:.3},{index:23,x:.44,y:.5},{index:24,x:.56,y:.5},
].map(point=>({...point,visibility:1,presence:1}))};
function syntheticPath(vertices,id){
  let arc=0;
  const points=vertices.map((point,i)=>{if(i)arc+=distance(vertices[i-1],point);return {...point,arcLength:arc};});
  for(const point of points)point.phase=point.arcLength/arc;
  return {referenceId:syntheticRef.id,referenceUsable:true,key:id,teacherFrame:body,rulesVersion:TUBE_RULES.version,
    paths:[{index:33,label:'Left hand',color:'#fff',available:true,points,totalLength:arc,halfWidth:TUBE_RULES.halfWidth,
      finishEntryArc:arc-.05,observations:[],stationary:false}]};
}
const branchPath=syntheticPath([{x:-1,y:-1},{x:0,y:-1},{x:0,y:-2},{x:0,y:-1},{x:1,y:-1}],'constructed-branch');
const branch=makeCase(syntheticRef,branchPath,syntheticBase);
const linear=(c,session,startMs=1000,startX=-1,endX=1,y=-1,count=100)=>{
  let result,sample,time=startMs;
  for(let i=1;i<=count;i++){
    time+=25;sample=c.fixture(0,time,{overrides:new Map([[33,{x:startX+(endX-startX)*i/count,y}]])});result=c.evaluate(sample,session);
  }
  return {result,sample,time,session};
};
check('Unordered whole-corridor containment permits in-area branch shortcuts and backtracking',()=>{
  const session=branch.begin();let done=linear(branch,session,1000,-1,.2);
  done=linear(branch,session,done.time,.2,-.3);done=linear(branch,session,done.time,-.3,1);
  assert.equal(done.result.status,'match',done.result.reason);assert.equal(done.result.pathComplete,true);
  report.synthetic.push({case:'Inside-area branch shortcut and backtracking',status:done.result.status});
});

check('Leaving the area prevents completion; any previous progress is not an invisible bridge',()=>{
  const session=branch.begin();let state=linear(branch,session,1000,-1,0);
  let time=state.time+25;
  const off=branch.fixture(0,time,{overrides:new Map([[33,{x:.2,y:-.5}]])});
  let score=branch.evaluate(off,session);assert.notEqual(score.status,'match');assert.equal(score.pathComplete,false);
  time+=25;score=branch.evaluate(branch.fixture(1,time),session);assert.notEqual(score.status,'match');
  // Return to start in a fresh observed frame; reacquisition itself earns no
  // movement. The following observed motion through the area can count again.
  time+=25;score=branch.evaluate(branch.fixture(0,time,{starts:true}),session);assert.notEqual(score.status,'match');
  const done=linear(branch,session,time);assert.equal(done.result.status,'match',done.result.reason);
  report.synthetic.push({case:'Off-corridor rearm',status:done.result.status});
});

check('Missing or stale tracking remains unknown and cannot complete unobserved movement',()=>{
  for(const kind of ['missing','stale','low-confidence']){
    const session=branch.begin();let state=linear(branch,session,1000,-1,0),time=state.time+25;
    const sample=branch.fixture(0,time,{overrides:new Map([[33,{x:0,y:-1}]])});
    if(kind==='missing')sample.landmarks=sample.landmarks.filter(point=>point.index!==33);
    if(kind==='low-confidence')sample.landmarks.find(point=>point.index===33).visibility=.1;
    const score=branch.evaluate(sample,session,kind==='stale'?{nowMs:time+451}:{});assert.equal(score.status,'unknown');
    time+=kind==='stale'?500:25;
    const endpoint=branch.evaluate(branch.fixture(1,time),session);assert.notEqual(endpoint.status,'match');assert.equal(endpoint.pathComplete,false);
    time+=25;branch.evaluate(branch.fixture(0,time,{starts:true}),session);
    assert.equal(linear(branch,session,time).result.status,'match');
  }
  const session=branch.begin();let state=linear(branch,session,1000,-1,.8);
  // Both samples are individually fresh, but there is no evidence for the long
  // interval between them. It must not silently become an observed finish.
  const time=state.time+500;
  const afterGap=branch.evaluate(branch.fixture(1,time),session);
  assert.notEqual(afterGap.status,'match');assert.equal(afterGap.pathComplete,false);
});

check('Curved region rejects dense straight shortcuts that leave its visible designated area',()=>{
  const curvePath=syntheticPath([{x:-1,y:-1},{x:-1,y:-2},{x:1,y:-2},{x:1,y:-1}],'constructed-curve');
  const curved=makeCase(syntheticRef,curvePath,syntheticBase);
  const shortcut=linear(curved,curved.begin());assert.notEqual(shortcut.result.status,'match');assert.equal(shortcut.result.pathComplete,false);
  assert.equal(curved.walk().result.status,'match');
});

check('A missing stationary foot blocks passing without freezing independent observed hand progress',()=>{
  const session=branch.begin();let time=1000,result;
  for(let i=1;i<=100;i++){
    time+=25;result=branch.evaluate(branch.fixture(0,time,{missing:[35],overrides:new Map([[33,{x:-1+2*i/100,y:-1}]])}),session);
    assert.equal(result.status,'unknown');
  }
  assert.equal(result.paths.find(path=>path.index===33).complete,true);
  time+=25;result=branch.evaluate(branch.fixture(1,time),session);assert.equal(result.status,'match');
});

check('Initial hold alone cannot complete a moving section, and large tracker jumps are rejected',()=>{
  let session=branch.begin(),score;
  for(let i=1;i<=30;i++)score=branch.evaluate(branch.fixture(0,1000+i*25,{starts:true}),session);
  assert.equal(score.pathComplete,false);assert.notEqual(score.status,'match');
  session=branch.begin();score=branch.evaluate(branch.fixture(1,1050),session);
  assert.equal(score.pathComplete,false);assert.notEqual(score.status,'match');
});

check('A hold-only clip has no progress sections but still requires four fresh observed targets',()=>{
  const ref=structuredClone(syntheticRef);ref.id='constructed-hold-only';
  for(const guide of ref.guides){guide.end={...guide.start};guide.endRaw={...guide.startRaw};guide.stationary=true;}
  const path={...branchPath,referenceId:ref.id,key:'constructed-hold-only',paths:[]};
  const c=makeCase(ref,path,syntheticBase),session=c.begin();
  let score=c.evaluate(c.fixture(1,1050),session);assert.equal(score.status,'match',score.reason);
  assert.equal(score.pathComplete,true);assert.equal(score.paths.length,0);
  score=c.evaluate(c.fixture(1,1100,{missing:[35]}),session);assert.equal(score.status,'unknown');
  score=c.evaluate(c.fixture(1,1150,{overrides:new Map([[35,{x:0,y:0}]])}),session);assert.notEqual(score.status,'match');
  score=c.evaluate(c.fixture(1,1200),session,{nowMs:1651});assert.equal(score.status,'unknown');
});

check('Reference preparation, foot anchoring and matching do not mutate any archived teacher input',()=>{
  assert.equal(digest([manifest,raw,[...sources]]),inputDigest);
});
await mkdir(new URL('artifacts/corridor-practice-review/',root),{recursive:true});
await writeFile(new URL('artifacts/corridor-practice-review/check-summary.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:report.checks.length,steps:report.steps,footSeams:report.footSeams.length,
  footHoldContainment:report.footHoldContainment,synthetic:report.synthetic},null,2));
