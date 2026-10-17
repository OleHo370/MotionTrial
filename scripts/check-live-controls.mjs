// Genuine saved teacher inference + explicitly constructed software controls.
// This does not claim webcam or physical learner acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CENTER_INDICES,CENTER_POINT_DEFINITIONS,withPracticeCenters,withCenterFocus} from '../public/practice-centers.js';
import {LIVE_CONTROL_RULES,createLiveControlGuard} from '../public/live-practice-controls.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {prepareContinuousLesson} from '../public/first-three-continuity.js';
import {prepareAnchoredReference,createStartPositionSession,evaluateStartPosition} from '../public/start-position.js';
import {preparePracticeTubes,createTubeMatcher} from '../public/practice-tube.js';

const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids=sample=>sample.landmarks.filter(p=>CENTER_INDICES.includes(p.index)).map(p=>p.index);
const clone=structuredClone;
const report={provenance:'Offline software checks. Source replay uses genuine saved MediaPipe teacher observations. Adversarial and matching learner samples are explicitly constructed software controls, not live inference or human acceptance.',
  rules:LIVE_CONTROL_RULES,checks:[],recordedReplay:[],limitations:['No physical webcam, permission, human stability or lighting acceptance.','Rejected points disappear; no visual smoothing, interpolation or retained coordinates are used.']};

function rawFixture(tMs=1000){
  const points=Array.from({length:33},(_,index)=>({index,x:.5,y:.2,z:0,visibility:1,presence:1}));
  const set=(index,x,y)=>Object.assign(points[index],{x,y});
  set(11,.43,.3);set(12,.57,.3);set(23,.45,.6);set(24,.55,.6);
  set(15,.37,.55);set(17,.36,.57);set(19,.38,.57);
  set(16,.63,.55);set(18,.62,.57);set(20,.64,.57);
  set(27,.45,.89);set(29,.445,.92);set(31,.455,.94);
  set(28,.55,.89);set(30,.545,.92);set(32,.555,.94);
  return {status:'pose',tMs,landmarks:points};
}
function sampleAt(tMs=1000){return withPracticeCenters(rawFixture(tMs));}
function warm(guard,aspect=1){
  assert.deepEqual(ids(guard.apply(sampleAt(1000),{aspectRatio:aspect})),[],'One new observation cannot establish a live control.');
  const confirmed=guard.apply(sampleAt(1090),{aspectRatio:aspect});assert.deepEqual(ids(confirmed),CENTER_INDICES);return confirmed;
}
function moveControl(sample,index,dx,dy){
  const definition=CENTER_POINT_DEFINITIONS.find(p=>p.index===index);
  const parts=new Set([...definition.sources,definition.sourceIndex,index]);
  for(const point of sample.landmarks)if(parts.has(point.index)){point.x+=dx;point.y+=dy;}
  return sample;
}
function unchangedRaw(input,output){assert.deepEqual(output.landmarks.filter(p=>p.index<33),input.landmarks.filter(p=>p.index<33));}

let guard=createLiveControlGuard(),sample=sampleAt(),before=digest(sample);
guard.apply(sample,{aspectRatio:1});const confirmed=guard.apply(sampleAt(1090),{aspectRatio:1});
assert.equal(digest(sample),before);unchangedRaw(sampleAt(1090),confirmed);
for(const p of confirmed.landmarks.filter(p=>p.index>=33))assert.deepEqual(p,sampleAt(1090).landmarks.find(v=>v.index===p.index));
assert.deepEqual(ids(confirmed),CENTER_INDICES);
report.checks.push('Initial controls need two fresh consistent observations; accepted coordinates and all SDK raw landmarks are preserved exactly without averaging.');

guard=createLiveControlGuard();warm(guard);
const face=rawFixture(1180);for(const index of [29,30,31,32])Object.assign(face.landmarks[index],{x:.5,y:.2});
sample=withPracticeCenters(face);let filtered=guard.apply(sample,{aspectRatio:1});
assert.deepEqual(ids(filtered),[33,34]);unchangedRaw(sample,filtered);
assert.deepEqual(guard.getState().suppressed.map(p=>p.index),[35,36]);
assert.ok(guard.getState().suppressed.every(p=>p.reason.includes('foot')));
guard=createLiveControlGuard();warm(guard);
sample=sampleAt(1180);sample.landmarks.find(p=>p.index===33).y=.2;
filtered=guard.apply(sample,{aspectRatio:1});assert.deepEqual(ids(filtered),[34,35,36]);unchangedRaw(sample,filtered);
report.checks.push('Feet falsely detected near the face and a palm detached from its same-side wrist are omitted, while unrelated hands/feet and raw observations stay intact.');

function faceGhost(tMs,{collapsed=false}={}){
  const raw=rawFixture(tMs),set=(index,x,y)=>Object.assign(raw.landmarks[index],{x,y});
  for(let i=0;i<=10;i++)set(i,.43+i*.014,.17+(i%3)*.01);
  if(collapsed){
    set(11,.48,.205);set(12,.52,.205);set(23,.49,.245);set(24,.51,.245);
    for(const i of [15,17,19])set(i,.475,.26);
    for(const i of [16,18,20])set(i,.525,.26);
    for(const i of [27,29,31])set(i,.48,.275);
    for(const i of [28,30,32])set(i,.52,.275);
  }else{
    // This deliberately malformed SOFTWARE pose has a valid-length torso and
    // phantom hips/ankles at face height. Old foot-below-hip/ankle checks alone
    // would accept it after warmup; the explicit observed face box must reject.
    set(11,.43,.5);set(12,.57,.5);set(23,.45,.2);set(24,.55,.2);
    for(const i of [27,29,31])set(i,.48,.18);
    for(const i of [28,30,32])set(i,.52,.18);
  }
  return withPracticeCenters(raw);
}
for(const collapsed of [false,true]){
  guard=createLiveControlGuard();
  for(const tMs of [1000,1090]){
    sample=faceGhost(tMs,{collapsed});before=digest(sample);filtered=guard.apply(sample,{aspectRatio:1});
    unchangedRaw(sample,filtered);assert.equal(digest(sample),before);
  }
  assert.deepEqual(ids(filtered),collapsed?[]:[33,34]);
  assert.ok(guard.getState().suppressed.every(p=>/face|head|body/i.test(p.reason)));
}
report.checks.push('A phantom whole body collapsed around the head is hidden even with locally consistent palms/feet; feet inside the observed face are rejected even when hallucinated hips and ankles would satisfy older local checks. Raw SDK observations remain unchanged.');

for(const index of CENTER_INDICES){
  guard=createLiveControlGuard();warm(guard);
  sample=sampleAt(1180);sample.landmarks=sample.landmarks.filter(p=>p.index!==index);
  filtered=guard.apply(sample,{aspectRatio:1});assert.deepEqual(ids(filtered),CENTER_INDICES.filter(i=>i!==index));
  const low=sampleAt(1270);low.landmarks.find(p=>p.index===index).visibility=.1;
  filtered=guard.apply(low,{aspectRatio:1});assert.ok(!ids(filtered).includes(index));
  const next=guard.apply(sampleAt(1360),{aspectRatio:1});assert.ok(!ids(next).includes(index),'Missing or low-confidence input requires fresh reacquisition.');
  filtered=guard.apply(sampleAt(1450),{aspectRatio:1});assert.deepEqual(ids(filtered),CENTER_INDICES);
}
report.checks.push('Each absent or low-confidence named hand/foot remains unknown without opposite-side substitution and requires two fresh observations to reacquire.');

guard=createLiveControlGuard();warm(guard);
const jump=moveControl(sampleAt(1180),33,.17,0);before=digest(jump);
filtered=guard.apply(jump,{aspectRatio:1});assert.ok(!ids(filtered).includes(33));assert.equal(digest(jump),before);unchangedRaw(jump,filtered);
const stableJump=moveControl(sampleAt(1270),33,.17,0);
filtered=guard.apply(stableJump,{aspectRatio:1});assert.ok(ids(filtered).includes(33));
assert.deepEqual(filtered.landmarks.find(p=>p.index===33),stableJump.landmarks.find(p=>p.index===33),'Reacquisition uses the fresh point, never an intermediate coordinate.');
const jitter=moveControl(sampleAt(1360),33,-.10,0);filtered=guard.apply(jitter,{aspectRatio:1});assert.ok(!ids(filtered).includes(33));
const other=moveControl(sampleAt(1450),33,.02,0);filtered=guard.apply(other,{aspectRatio:1});assert.ok(!ids(filtered).includes(33),'Inconsistent candidates cannot form a new stable point.');
report.checks.push('A sudden palm teleport is neither rendered nor retained as a stale dot. Two fresh consistent points can reacquire its actual location; alternating jump candidates stay hidden.');

for(const invalid of ['gap','repeat','reverse','aspect','torso']){
  guard=createLiveControlGuard();warm(guard);
  sample=sampleAt(invalid==='gap'?1640:invalid==='repeat'?1090:invalid==='reverse'?1089:1180);
  if(invalid==='torso')sample.landmarks.find(p=>p.index===11).visibility=.1;
  filtered=guard.apply(sample,{aspectRatio:invalid==='aspect'?1.1:1});assert.deepEqual(ids(filtered),[],invalid);
}
guard=createLiveControlGuard();warm(guard);guard.reset();assert.deepEqual(guard.getState().acceptedIndices,[]);
assert.deepEqual(ids(guard.apply(sampleAt(2000),{aspectRatio:1})),[]);
assert.deepEqual(ids(guard.apply(sampleAt(2090),{aspectRatio:1})),CENTER_INDICES);
report.checks.push('Long gaps, repeated/out-of-order frames, changed camera aspect, missing torso and explicit camera reset clear current controls and require reacquisition.');

guard=createLiveControlGuard();
for(const tMs of [1000,1090]){sample=sampleAt(tMs);for(const i of [13,14,25,26])sample.landmarks[i].visibility=0;filtered=guard.apply(sample,{aspectRatio:1});}
assert.deepEqual(ids(filtered),CENTER_INDICES);
report.checks.push('Disabled elbows/knees do not impose confidence requirements on the four active palm/foot controls.');

const manifest=await read('public/practice-media/next-three/manifest.json'),sources=new Map();
for(const source of manifest.sources){
  const data=await read(`public/practice-media/first-three-centers/${source.id}.poses.json`),saved=digest(data),aspect=data.width/data.height;
  guard=createLiveControlGuard();let candidates=0,accepted=0,suppressedFrames=0;
  for(const original of data.samples){
    sample=withPracticeCenters(original);candidates+=ids(sample).length;filtered=guard.apply(sample,{aspectRatio:aspect});accepted+=ids(filtered).length;
    if(ids(filtered).length<ids(sample).length)suppressedFrames++;unchangedRaw(sample,filtered);
    for(const p of filtered.landmarks.filter(p=>p.index>=33))assert.deepEqual(p,sample.landmarks.find(v=>v.index===p.index));
  }
  assert.equal(digest(data),saved);assert.ok(accepted>0);
  report.recordedReplay.push({sourceId:source.id,actualObservedSamples:data.samples.length,candidateControls:candidates,acceptedControls:accepted,acceptedPercentage:Number((100*accepted/candidates).toFixed(2)),suppressedFrames});
  sources.set(source.id,{...source,data:LESSON_CONTROLS.referenceAdapter(data)});
}
report.checks.push('Both genuine recorded source archives replay through the live-only guard with exact surviving coordinates and unchanged archives. Suppression rates are recorded rather than hidden.');

const sourceDigest=digest([manifest,[...sources]]),lesson=prepareContinuousLesson(manifest.steps.map(withCenterFocus),sources,LESSON_CONTROLS.referenceOptions);
const step=lesson.steps[1],ref=prepareAnchoredReference(lesson.references[1],step,sources.get(step.sourceId).data),tube=preparePracticeTubes(ref,step,sources);
const anchor=sources.get(step.sourceId).data.samples.find(s=>s.tMs===ref.teacherFrameTMs),body=ref.teacherFrame,aspect=body.aspect;
function fixtureFor(selectedRef,selectedTube,selectedAnchor,phase,tMs){
  const frame=selectedRef.teacherFrame,project=p=>({x:(p.x*frame.scale+frame.hip.x)/frame.aspect,y:p.y*frame.scale+frame.hip.y});
  const result=clone(selectedAnchor);result.tMs=tMs;
  for(const guide of selectedRef.guides){
    const path=selectedTube.paths.find(p=>p.index===guide.index),goal=path?phase*path.totalLength:0;
    const upper=path?path.points.findIndex(p=>p.arcLength>=goal):-1;
    const a=path?.points[Math.max(0,upper-1)],b=path?.points[Math.max(0,upper)];
    const fraction=a&&b&&b.arcLength>a.arcLength?(goal-a.arcLength)/(b.arcLength-a.arcLength):0;
    const normalized=path?{x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction}:guide.valid
      ?{x:guide.start.x+(guide.end.x-guide.start.x)*phase,y:guide.start.y+(guide.end.y-guide.start.y)*phase}:guide.start;
    const target=project(normalized),original=result.landmarks.find(p=>p.index===guide.index);
    moveControl(result,guide.index,target.x-original.x,target.y-original.y);
  }
  return result;
}
const fixture=(phase,tMs)=>fixtureFor(ref,tube,anchor,phase,tMs);
guard=createLiveControlGuard();let start=fixture(0,1000);guard.apply(start,{aspectRatio:aspect});
start=guard.apply(fixture(0,1090),{aspectRatio:aspect});assert.deepEqual(ids(start),CENTER_INDICES);
const placement=createStartPositionSession(ref);placement.bodyFrame=clone(body);placement.aspect=aspect;
const unknown=clone(start);unknown.tMs=1180;unknown.landmarks=unknown.landmarks.filter(p=>p.index!==33);
const position=evaluateStartPosition(ref,unknown,{attemptAspectRatio:aspect,nowMs:1180,observedAtMs:1180,session:placement});
assert.equal(position.status,'unknown');assert.equal(position.holdReady,false);
const matcher=createTubeMatcher(),session=matcher.createSession(ref,tube,start,body,aspect);
const scoreAt=(live,time)=>matcher.evaluate(ref,tube,live,{attemptAspectRatio:aspect,bodyFrame:body,nowMs:time,observedAtMs:time,session});
let time=1090,score;
for(let i=1;i<=20;i++){time+=90;filtered=guard.apply(fixture(.15*i/20,time),{aspectRatio:aspect});score=scoreAt(filtered,time);}
const beforeArcs=Object.fromEntries(tube.paths.map(path=>[path.index,session.paths[path.index].arc]));
time+=90;filtered=guard.apply(fixture(1,time),{aspectRatio:aspect});
assert.ok(tube.paths.some(path=>!ids(filtered).includes(path.index)),'A sudden endpoint teleport should be hidden.');
score=scoreAt(filtered,time);assert.equal(score.status,'unknown');assert.notEqual(score.pathComplete,true);
for(const path of tube.paths)assert.equal(session.paths[path.index].arc,beforeArcs[path.index]);
time+=90;filtered=guard.apply(fixture(1,time),{aspectRatio:aspect});score=scoreAt(filtered,time);assert.notEqual(score.status,'match');
for(const path of tube.paths)assert.equal(session.paths[path.index].arc,beforeArcs[path.index]);
assert.equal(digest([manifest,[...sources]]),sourceDigest);
report.checks.push('The exact guarded observation used for dots also leaves positioning unknown when a control is hidden and earns no route progress from a rejected jump or reacquisition teleport.');

report.guardedConstructedTrace=[];
for(let i=0;i<lesson.steps.length;i++){
  const itemStep=lesson.steps[i],itemData=sources.get(itemStep.sourceId).data;
  const itemRef=prepareAnchoredReference(lesson.references[i],itemStep,itemData),itemTube=preparePracticeTubes(itemRef,itemStep,sources);
  const itemAnchor=itemData.samples.find(s=>s.tMs===itemRef.teacherFrameTMs),itemAspect=itemRef.teacherFrame.aspect;
  const make=(phase,tMs)=>fixtureFor(itemRef,itemTube,itemAnchor,phase,tMs),itemGuard=createLiveControlGuard();
  itemGuard.apply(make(0,1000),{aspectRatio:itemAspect});
  const itemStart=itemGuard.apply(make(0,1090),{aspectRatio:itemAspect});assert.deepEqual(ids(itemStart),CENTER_INDICES);
  const itemSession=matcher.createSession(itemRef,itemTube,itemStart,itemRef.teacherFrame,itemAspect);let result;
  for(let frame=1;frame<=160;frame++){
    const tMs=1090+frame*90,input=itemGuard.apply(make(frame/160,tMs),{aspectRatio:itemAspect});
    result=matcher.evaluate(itemRef,itemTube,input,{attemptAspectRatio:itemAspect,bodyFrame:itemRef.teacherFrame,nowMs:tMs,observedAtMs:tMs,session:itemSession});
  }
  assert.equal(result.status,'match',`${itemRef.id}: guarded constructed trace: ${result.reason}`);
  report.guardedConstructedTrace.push({id:itemRef.id,status:result.status,requiredRouteComplete:result.pathComplete});
}
report.checks.push('All six lesson routes still complete using fine constructed learner traces through the same live guard, without relaxing route or endpoint rules.');

await mkdir(new URL('../artifacts/tracker-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/tracker-review/summary.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:report.checks.length,recordedReplay:report.recordedReplay,limitations:report.limitations},null,2));
