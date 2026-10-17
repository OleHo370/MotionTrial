// Genuine archived teacher observations; learner positions are CONSTRUCTED
// software controls. These checks do not claim physical webcam acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareContinuousLesson} from '../public/first-three-continuity.js';
import {prepareAnchoredReference,prepareStartPosition,createStartPositionSession,evaluateStartPosition,projectStartPositionTargets} from '../public/start-position.js';
import {finishTargetContains,finishTriangleSize} from '../public/first-three-attempt.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';
import {preparePracticeTubes,createTubeMatcher} from '../public/practice-tube.js';

const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-8,`${message}: ${a} versus ${b}`);
const project=(point,frame)=>({x:(point.x*frame.scale+frame.hip.x)/frame.aspect,y:point.y*frame.scale+frame.hip.y});
const captureBefore=process.argv.includes('--capture-before');
const manifest=await read('public/practice-media/next-three/manifest.json'),sources=new Map();
for(const source of manifest.sources)sources.set(source.id,{...source,
  data:LESSON_CONTROLS.referenceAdapter(await read(`public/practice-media/first-three-centers/${source.id}.poses.json`))});
const lesson=prepareContinuousLesson(manifest.steps.map(withCenterFocus),sources,LESSON_CONTROLS.referenceOptions);
const baseRefs=lesson.references.map((ref,i)=>prepareAnchoredReference(ref,lesson.steps[i],sources.get(lesson.steps[i].sourceId).data));
const originalSnapshot=JSON.stringify({manifest,sources:[...sources],baseRefs});
const {prepareHandoffReferences}=captureBefore?{}:await import('../public/practice-handoff.js');
const refs=captureBefore?baseRefs:prepareHandoffReferences(baseRefs);
const tubes=refs.map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources));
const matcher=createTubeMatcher();
const report={provenance:'Real archived MediaPipe teacher observations and explicit constructed learner positions. Offline geometry and matcher regression only; no physical webcam or human practice acceptance.',
  mode:captureBefore?'before-fix-reproduction':'regression',seams:[],checks:[],limitations:['No physical webcam or actual human reachability acceptance.']};
const indices=LESSON_CONTROLS.indices;
assert.deepEqual(indices,[33,34,35,36]);

function pointAt(path,phase){
  const arc=Math.max(0,Math.min(1,phase))*path.totalLength;
  for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i];if(b.arcLength<arc)continue;
    const t=(arc-a.arcLength)/(b.arcLength-a.arcLength||1);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  }
  return {...path.points.at(-1)};
}
function fixture(ref,frame,time,positions){
  const source=sources.get(lesson.steps.find(step=>step.id===ref.id).sourceId);
  const sample=structuredClone(source.data.samples.find(p=>Math.abs(p.tMs-ref.teacherFrameTMs)<1e-6));
  sample.tMs=time;
  for(const index of indices){
    const point=positions.get(index)??ref.guides.find(g=>g.index===index).start;
    Object.assign(sample.landmarks.find(p=>p.index===index),project(point,frame),{visibility:1,presence:1});
  }
  return sample;
}
function completeRoutes(ref,tube,frame){
  let time=1000;
  const start=new Map(ref.guides.map(g=>[g.index,g.start]));
  const session=matcher.createSession(ref,tube,fixture(ref,frame,time,start),frame,frame.aspect);
  const count=Math.max(100,...tube.paths.map(path=>Math.ceil(path.totalLength/.015)));
  let result;
  for(let k=1;k<=count;k++){
    time+=50;
    const points=new Map(ref.guides.map(g=>[g.index,tube.paths.some(p=>p.index===g.index)
      ?pointAt(tube.paths.find(p=>p.index===g.index),k/count):g.end]));
    const sample=fixture(ref,frame,time,points);
    result=matcher.evaluate(ref,tube,sample,{attemptAspectRatio:frame.aspect,bodyFrame:frame,
      nowMs:time,observedAtMs:time,session});
  }
  assert.equal(result.status,'match',`${ref.id}: baseline constructed tube completion`);
  return {session,time};
}

for(const aspect of [16/9,4/3,9/16])for(let cut=0;cut<refs.length-1;cut++){
  const previous=refs[cut],next=refs[cut+1],outgoing=createFullHeightLayout(previous,refs,aspect,tubes),incoming=createFullHeightLayout(next,refs,aspect,tubes);
  const startSession=createStartPositionSession(next);startSession.bodyFrame=incoming.frame;startSession.aspect=aspect;
  const starts=projectStartPositionTargets(next,startSession),bounds=prepareStartPosition(next),radius=bounds.radius;
  const previousSizes=new Map(indices.map(index=>[index,finishTriangleSize(outgoing.frame,1,previous,index)/outgoing.frame.scale]));
  const triangleOffsets=[{name:'center',x:0,y:0},{name:'top-interior',x:0,y:-.99},
    {name:'right-base-interior',x:.87,y:.64},{name:'left-base-interior',x:-.87,y:.64}];
  const seam={from:previous.id,to:next.id,aspect,outgoingScale:outgoing.frame.scale,incomingScale:incoming.frame.scale,
    triangleSizesPixelsAt720:Object.fromEntries([...previousSizes].map(([index,size])=>[index,size*outgoing.frame.scale*720])),
    nextSquareHalfSizePixelsAt720:radius*incoming.frame.scale*720,
    centers:[],finishToStart:[],startToTube:[],boundarySamples:0};
  for(const index of indices){
    const end=previous.guides.find(g=>g.index===index).end,rawEnd=project(end,outgoing.frame),rawStart=starts.find(p=>p.index===index).point;
    close(rawEnd.x,rawStart.x,'Shared observed seam center x');close(rawEnd.y,rawStart.y,'Shared observed seam center y');
    seam.centers.push({index,x:rawEnd.x,y:rawEnd.y});
    if(!captureBefore){
      // Barycentric lattice includes the top and both base vertices. Every
      // visible accepted finish point must also fit the next square and, for a
      // moving next limb, its actual corridor entrance circle.
      const size=previousSizes.get(index),vertices=[{x:end.x,y:end.y-size},
        {x:end.x+size*.9,y:end.y+size*.65},{x:end.x-size*.9,y:end.y+size*.65}];
      const nextGuide=next.guides.find(g=>g.index===index),nextPath=tubes[cut+1].paths.find(p=>p.index===index);
      for(let a=0;a<=8;a++)for(let b=0;b<=8-a;b++){
        const weights=[a/8,b/8,1-(a+b)/8],point={x:vertices.reduce((sum,p,k)=>sum+p.x*weights[k],0),
          y:vertices.reduce((sum,p,k)=>sum+p.y*weights[k],0)};
        assert.ok(finishTargetContains(point,end,previous,index));
        const raw=project(point,outgoing.frame),mapped={x:(raw.x*aspect-incoming.frame.hip.x)/incoming.frame.scale,
          y:(raw.y-incoming.frame.hip.y)/incoming.frame.scale};
        assert.ok(Math.abs(mapped.x-nextGuide.start.x)<=radius+1e-8&&Math.abs(mapped.y-nextGuide.start.y)<=radius+1e-8,
          `${previous.id}: entire visible finish triangle fits next square`);
        if(nextPath)assert.ok(Math.hypot(mapped.x-nextPath.points[0].x,mapped.y-nextPath.points[0].y)<=nextPath.halfWidth+1e-8,
          `${previous.id}: entire visible finish triangle fits the next required tube entrance`);
        seam.boundarySamples++;
      }
    }
  }
  const completed=completeRoutes(previous,tubes[cut],outgoing.frame);
  for(const offset of triangleOffsets){
    const outgoingPoints=new Map(previous.guides.map(g=>[g.index,{x:g.end.x+offset.x*previousSizes.get(g.index),y:g.end.y+offset.y*previousSizes.get(g.index)}]));
    assert.ok(previous.guides.every(g=>finishTargetContains(outgoingPoints.get(g.index),g.end,previous,g.index)),`${offset.name} is within visible finish triangle`);
    completed.time+=50;
    const endSample=fixture(previous,outgoing.frame,completed.time,outgoingPoints);
    const finish=matcher.evaluate(previous,tubes[cut],endSample,{attemptAspectRatio:aspect,bodyFrame:outgoing.frame,nowMs:completed.time,observedAtMs:completed.time,session:completed.session});
    assert.equal(finish.status,'match',`${offset.name}: accepted after actual constructed route completion`);
    const nextSession=createStartPositionSession(next);nextSession.bodyFrame=incoming.frame;nextSession.aspect=aspect;
    const heldSample=structuredClone(endSample);heldSample.tMs+=50;
    const initial=evaluateStartPosition(next,heldSample,{attemptAspectRatio:aspect,nowMs:heldSample.tMs,observedAtMs:heldSample.tMs,session:nextSession});
    const incomingMovement=matcher.createSession(next,tubes[cut+1],heldSample,incoming.frame,aspect);
    const unexpectedRejoins=tubes[cut+1].paths.filter(path=>incomingMovement.paths[path.index].needsRejoin).map(path=>path.index);
    seam.finishToStart.push({location:offset.name,previousStatus:finish.status,nextStatus:initial.status,allNear:initial.allNear,
      outsideSquare:initial.limbs.filter(l=>!l.near).map(l=>l.index),unexpectedRejoins});
    if(!captureBefore){
      assert.equal(initial.status,'match',`${previous.id} -> ${next.id}: accepted finish ${offset.name} stays within next starting square`);
      assert.deepEqual(unexpectedRejoins,[],`${next.id}: accepted previous finish enters next tubes without a reset`);
    }
  }
  // An accepted square corner must not secretly demand returning to its center
  // before tube mode can even begin. The moving route itself stays ordered.
  for(const offset of [{name:'upper-right-corner',x:radius*.99,y:-radius*.99},{name:'lower-left-corner',x:-radius*.99,y:radius*.99}]){
    const positions=new Map(next.guides.map(g=>[g.index,{x:g.start.x+offset.x,y:g.start.y+offset.y}]));
    const sample=fixture(next,incoming.frame,20000,positions),placement=createStartPositionSession(next);
    placement.bodyFrame=incoming.frame;placement.aspect=aspect;
    const start=evaluateStartPosition(next,sample,{attemptAspectRatio:aspect,nowMs:sample.tMs,observedAtMs:sample.tMs,session:placement});
    assert.equal(start.status,'match',`${offset.name}: constructed input is within the drawn starting square`);
    const movement=matcher.createSession(next,tubes[cut+1],sample,incoming.frame,aspect);
    const need=tubes[cut+1].paths.filter(path=>movement.paths[path.index].needsRejoin).map(path=>path.index);
    let entranceResult;
    for(let frame=1;frame<=20;frame++){
      const fraction=frame/20,time=20000+50*frame;
      const entrance=new Map(next.guides.map(g=>{
        const initial=positions.get(g.index),path=tubes[cut+1].paths.find(p=>p.index===g.index);
        const target=path?pointAt(path,.03):g.end??g.start;
        return [g.index,{x:initial.x+(target.x-initial.x)*fraction,y:initial.y+(target.y-initial.y)*fraction}];
      }));
      entranceResult=matcher.evaluate(next,tubes[cut+1],fixture(next,incoming.frame,time,entrance),{
        attemptAspectRatio:aspect,bodyFrame:incoming.frame,nowMs:time,observedAtMs:time,session:movement});
      if(!captureBefore)assert.ok(entranceResult.paths.every(p=>!p.needsRejoin&&!p.offPath),
        `${next.id}: continuous entry from an accepted square should not demand returning to its center`);
    }
    seam.startToTube.push({location:offset.name,startStatus:start.status,needsRejoin:need,
      afterEntrance:entranceResult.paths.map(({index,needsRejoin,offPath,entryPending,progress})=>({index,needsRejoin,offPath,entryPending,progress}))});
    if(!captureBefore)assert.deepEqual(need,[],`${next.id}: square-accepted initial positions need no unexpected tube rejoin`);
    if(!captureBefore)assert.ok(entranceResult.paths.every(p=>!p.entryPending),`${next.id}: continuous entrance reaches every required corridor`);
  }
  report.seams.push(seam);
}
assert.equal(report.seams.length,15);
if(!captureBefore){
  const ref=refs[1],tube=tubes[1],frame=createFullHeightLayout(ref,refs,16/9,tubes).frame,radius=prepareStartPosition(ref).radius;
  const corner=new Map(ref.guides.map(g=>[g.index,{x:g.start.x+radius*.99,y:g.start.y-radius*.99}]));
  report.invalidEntry=[];
  for(const kind of ['no-pose','low-confidence','stale','duplicate-frame']){
    const first=fixture(ref,frame,30000,corner),session=matcher.createSession(ref,tube,first,frame,frame.aspect);
    assert.ok(tube.paths.every(path=>session.paths[path.index].entryPending));
    const invalid=fixture(ref,frame,30050,corner);let now=invalid.tMs;
    if(kind==='no-pose')invalid.status='no_pose';
    if(kind==='low-confidence')for(const path of tube.paths)invalid.landmarks.find(p=>p.index===path.index).visibility=.1;
    if(kind==='stale')now+=451;
    if(kind==='duplicate-frame')invalid.tMs=first.tMs;
    const result=matcher.evaluate(ref,tube,invalid,{attemptAspectRatio:frame.aspect,bodyFrame:frame,nowMs:now,observedAtMs:invalid.tMs,session});
    assert.equal(result.status,'unknown');
    assert.ok(tube.paths.every(path=>session.paths[path.index].arc===0&&!session.paths[path.index].entryPending&&session.paths[path.index].needsRejoin));
    const finishPositions=new Map(ref.guides.map(g=>[g.index,g.end??g.start]));
    const jumped=fixture(ref,frame,31000,finishPositions);
    const recovery=matcher.evaluate(ref,tube,jumped,{attemptAspectRatio:frame.aspect,bodyFrame:frame,nowMs:jumped.tMs,observedAtMs:jumped.tMs,session});
    assert.notEqual(recovery.status,'match');assert.equal(recovery.pathComplete,false);
    assert.ok(tube.paths.every(path=>session.paths[path.index].arc===0&&!session.paths[path.index].complete));
    report.invalidEntry.push({kind,status:result.status,recoveryStatus:recovery.status,earnedArc:0,rejoinRequired:true});
  }
  report.checks.push('No-pose, low confidence, stale and repeated corner-entry observations award no route credit; an endpoint reappearance cannot bridge missing travel.');
}
assert.equal(JSON.stringify({manifest,sources:[...sources],baseRefs}),originalSnapshot,'Handoff sizing and matching preserve source archives, manifest and original prepared references.');
report.checks.push('All 5 observed cuts have exactly equal four-control centers across 3 camera aspects.');
report.checks.push('Accepted triangle interior controls are evaluated at the same raw positions against the next start squares.');
report.checks.push('Accepted start-square corners are checked for hidden initial tube rejoin demands.');
report.checks.push('Handoff references are cloned; genuine source observations, manifest and original prepared reference coordinates are unchanged.');
report.failures={finishToStart:report.seams.reduce((sum,seam)=>sum+seam.finishToStart.filter(p=>!p.allNear).length,0),
  startToTube:report.seams.reduce((sum,seam)=>sum+seam.startToTube.filter(p=>p.needsRejoin.length).length,0)};
const folder=new URL('../artifacts/handoff-review/',import.meta.url);await mkdir(folder,{recursive:true});
await writeFile(new URL(captureBefore?'before.json':'summary.json',folder),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode:report.mode,seams:report.seams.length,checks:report.checks,failures:report.failures},null,2));
