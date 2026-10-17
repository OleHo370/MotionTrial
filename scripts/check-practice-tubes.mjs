// Saved teacher landmarks are genuine MediaPipe observations. Learner controls
// below are deliberately CONSTRUCTED software inputs, never a webcam acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareContinuousLesson} from '../public/first-three-continuity.js';
import {prepareAnchoredReference,prepareStartPosition,positionedMovementRulesFor,createStartPositionSession,projectStartPositionTargets} from '../public/start-position.js';
import {createPracticeMatcher,finishTriangleSize,finishTargetContains} from '../public/first-three-attempt.js';
import {projectFourPointGuides} from '../public/four-point-game-runtime.js';
import {createFullHeightLayout,cameraViewportBounds} from '../public/full-height-layout.js';
import {TUBE_RULES,preparePracticeTubes,createTubeMatcher,projectPracticeTubes} from '../public/practice-tube.js';

const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const close=(a,b,label,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} != ${b}`);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const inside=(v,lo,hi,label)=>assert.ok(v>=lo-1e-8&&v<=hi+1e-8,`${label}: ${v} outside [${lo}, ${hi}]`);
const manifest=await read('public/practice-media/next-three/manifest.json'),sources=new Map();
for(const source of manifest.sources)sources.set(source.id,{...source,
  data:LESSON_CONTROLS.referenceAdapter(await read(`public/practice-media/first-three-centers/${source.id}.poses.json`))});
const rawDigest=digest([manifest,[...sources]]),lesson=prepareContinuousLesson(manifest.steps.map(withCenterFocus),sources,LESSON_CONTROLS.referenceOptions);
const references=lesson.references.map((ref,i)=>prepareAnchoredReference(ref,lesson.steps[i],sources.get(lesson.steps[i].sourceId).data));
const matcher=createTubeMatcher(),legacy=createPracticeMatcher({requireRoute:false,retainStartedTargets:true});
const report={provenance:'Offline regression uses genuine saved teacher MediaPipe observations. Every learner frame is an explicitly constructed deterministic software control, including observed-focus replay. This is not webcam inference or human practice acceptance.',
  rules:TUBE_RULES,checks:[],steps:[],geometry:[],seams:[],progressChecks:[],adversarial:{},limitations:[
    'No physical webcam, permission flow, actual human motion or reachability acceptance.',
    'The UI completion hold and visual rendering require manual browser review.',
    'Tube smoothing is display/assessment geometry derived from observations, not a claim of newly observed teacher tracking.',
  ]};
assert.equal(matcher.requiresRoute,true);assert.equal(matcher.retainsStartedTargets,true);
assert.equal(LESSON_CONTROLS.indices.length,4);assert.deepEqual(LESSON_CONTROLS.indices,[33,34,35,36]);

function pointAt(path,phase){
  if(phase<=0)return {...path.points[0]};if(phase>=1)return {...path.points.at(-1)};
  const goal=phase*path.totalLength;
  let upper=path.points.findIndex(point=>point.arcLength>=goal);
  if(upper<1)return {...path.points[Math.max(0,upper)]};
  const a=path.points[upper-1],b=path.points[upper],span=b.arcLength-a.arcLength,f=span?(goal-a.arcLength)/span:0;
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};
}
function makeCase(ref,step,tube){
  const source=sources.get(step.sourceId),body=ref.teacherFrame,aspect=body.aspect;
  const anchor=source.data.samples.find(sample=>Math.abs(sample.tMs-ref.teacherFrameTMs)<1e-6);assert.ok(anchor);
  const project=p=>({x:(p.x*body.scale+body.hip.x)/aspect,y:p.y*body.scale+body.hip.y});
  const normalize=p=>({x:(p.x*aspect-body.hip.x)/body.scale,y:(p.y-body.hip.y)/body.scale});
  const fixture=(phase,tMs,{starts=false,override=new Map()}={})=>{
    const live=structuredClone(anchor);live.tMs=tMs;
    for(const guide of ref.guides){
      const path=tube.paths.find(path=>path.index===guide.index&&path.available);
      const target=override.get(guide.index)??(starts?guide.start:path?pointAt(path,phase):guide.valid?guide.end:guide.start);
      Object.assign(live.landmarks.find(point=>point.index===guide.index),project(target),{visibility:1,presence:1});
    }
    return live;
  };
  const options=(sample,session,extra={})=>({attemptAspectRatio:aspect,bodyFrame:body,nowMs:sample?.tMs??1100,
    observedAtMs:sample?.tMs??1100,session,...extra});
  const begin=()=>matcher.createSession(ref,tube,fixture(0,1000,{starts:true}),body,aspect);
  const evaluate=(sample,session,extra={})=>matcher.evaluate(ref,tube,sample,options(sample,session,extra));
  const walk=(session=begin(),startPhase=0,startMs=1000)=>{
    const count=Math.max(80,...tube.paths.map(path=>Math.ceil(path.totalLength/.018)));
    let score,time=startMs;
    for(let k=1;k<=count;k++){
      time+=50;score=evaluate(fixture(startPhase+(1-startPhase)*k/count,time),session);
    }
    return {session,score,time};
  };
  return {ref,step,tube,source,body,aspect,anchor,project,normalize,fixture,options,begin,evaluate,walk};
}
const cases=[];
for(let i=0;i<references.length;i++){
  const ref=references[i],step=lesson.steps[i],tube=preparePracticeTubes(ref,step,sources);
  assert.ok(tube.referenceUsable,`${ref.id}: ${tube.unknownReason}`);
  assert.ok(tube.paths.length);assert.ok(tube.paths.every(path=>path.available));
  assert.deepEqual(tube.paths.map(path=>path.index).sort(),ref.focusJoints.filter(index=>{
    const guide=ref.guides.find(g=>g.index===index);return guide?.valid&&!guide.stationary;
  }).sort(),'Only moving anatomical foci receive mandatory tubes.');
  for(const path of tube.paths){
    assert.ok(path.points.length>=3);assert.ok(path.observations.length>=3);assert.ok(path.totalLength>0);
    assert.equal(path.halfWidth,TUBE_RULES.halfWidth);
    close(path.points[0].arcLength,0,'Arc begins at zero');close(path.points.at(-1).arcLength,path.totalLength,'Total arc length');
    close(path.points[0].phase,0,'Phase begins at zero');close(path.points.at(-1).phase,1,'Phase ends at one');
    const guide=ref.guides.find(g=>g.index===path.index);
    close(path.points[0].x,guide.start.x,'Tube starts on source-backed square x');close(path.points[0].y,guide.start.y,'Tube starts on source-backed square y');
    close(path.points.at(-1).x,guide.end.x,'Tube ends on source-backed triangle x');close(path.points.at(-1).y,guide.end.y,'Tube ends on source-backed triangle y');
    for(let k=1;k<path.points.length;k++)assert.ok(path.points[k].arcLength>=path.points[k-1].arcLength);
    for(const observation of path.observations){
      const data=sources.get(observation.sourceId)?.data;assert.ok(data,`${ref.id}: observed native source ID`);
      const sample=data.samples.find(s=>Math.abs(s.tMs-observation.tMs)<1e-6);assert.ok(sample,`${ref.id}: native source timestamp`);
      close(sample.sourceTimeSeconds,observation.sourceTimeSeconds,'Absolute original-video source time');
      const raw=sample.landmarks.find(p=>p.index===path.index);assert.ok(raw);
      close(raw.x,observation.raw.x,'Actual raw anatomical x');close(raw.y,observation.raw.y,'Actual raw anatomical y');
      const normalized={x:(raw.x*ref.teacherFrame.aspect-ref.teacherFrame.hip.x)/ref.teacherFrame.scale,
        y:(raw.y-ref.teacherFrame.hip.y)/ref.teacherFrame.scale};
      close(normalized.x,observation.point.x,'Observed fixed-frame x');close(normalized.y,observation.point.y,'Observed fixed-frame y');
    }
  }
  const c=makeCase(ref,step,tube),followed=c.walk();assert.equal(followed.score.status,'match',`${ref.id}: ${followed.score.reason}`);
  assert.ok(followed.score.pathComplete);assert.ok(followed.score.paths.every(path=>path.complete));
  assert.equal(followed.score.pathRequired,true);
  const jump=c.evaluate(c.fixture(1,1100),c.begin());assert.notEqual(jump.status,'match',`${ref.id}: direct endpoint jump cannot pass`);
  assert.equal(jump.pathComplete,false);
  // This is a constructed learner control replaying ONLY the real observed
  // focus-point trace. Nonfocus controls stay at explicit finish coordinates.
  const observedSession=c.begin(),times=[...new Set(tube.paths.flatMap(path=>path.observations.map(p=>p.sourceTimeSeconds)))].sort((a,b)=>a-b);
  let observedScore,observedMs=1000;
  for(const sourceTime of times.slice(1)){
    const positions=new Map(tube.paths.map(path=>{
      const observed=path.observations.reduce((best,p)=>Math.abs(p.sourceTimeSeconds-sourceTime)<Math.abs(best.sourceTimeSeconds-sourceTime)?p:best,path.observations[0]);
      return [path.index,observed.point];
    }));
    observedMs+=83;observedScore=c.evaluate(c.fixture(1,observedMs,{override:positions}),observedSession);
  }
  assert.equal(observedScore.status,'match',`${ref.id}: recorded focus replay: ${observedScore.reason}; ${JSON.stringify(observedScore.paths)}`);
  report.steps.push({id:ref.id,requiredTubes:tube.paths.map(path=>({index:path.index,length:path.totalLength,
    geometryVertices:path.points.length,observations:path.observations.length,sourceIds:[...new Set(path.observations.map(p=>p.sourceId))]})),
    fineConstructedTrace:followed.score.status,observedFocusReplay:observedScore.status,directEndpoint:jump.status});
  cases.push(c);
}
assert.equal(cases.length,6);
assert.ok(cases[2].tube.paths.some(path=>new Set(path.observations.map(observation=>observation.sourceId)).size===2),
  'Step 3 joins its real outgoing archive to the canonical incoming boundary observation.');
report.checks.push('All six continuous lessons prepare supported focus-only tubes; every raw vertex retains its native source ID, exact timestamp and named anatomical point, including the cross-source step 3 join.');
report.checks.push('Fine constructed traces following all six assessed curves reach their endpoints; jumping straight to any final target does not complete its tube.');
report.checks.push('Replaying each of the six actual archived focus-point traces in constructed learner controls also follows its rounded corridor and completes, including the original-video source join.');

const curvedCandidates=cases.flatMap(c=>c.tube.paths.map(path=>{
  const a=path.points[0],b=path.points.at(-1),dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const deviation=Math.max(...path.points.map(point=>{
    const f=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length));
    return distance(point,{x:a.x+dx*f,y:a.y+dy*f});
  }));return {c,path,deviation};
})).filter(item=>item.deviation>TUBE_RULES.halfWidth+.04);
assert.ok(curvedCandidates.length,'Saved teacher data includes meaningful curved routes for the shortcut regression.');
for(const {c,path}of curvedCandidates){
  const session=c.begin(),a=path.points[0],b=path.points.at(-1);let score;
  for(let k=1;k<=160;k++){
    const phase=k/160,chord={x:a.x+(b.x-a.x)*phase,y:a.y+(b.y-a.y)*phase};
    score=c.evaluate(c.fixture(phase,1000+k*50,{override:new Map([[path.index,chord]])}),session);
  }
  assert.notEqual(score.status,'match',`${c.ref.id}: dense straight chord must not replace curved ${path.index} tube`);
  assert.equal(score.paths.find(p=>p.index===path.index).complete,false);
}
report.checks.push(`${curvedCandidates.length} genuinely curved saved teacher routes reject dense straight start-to-finish shortcuts even when every frame is fresh and the final location is correct.`);

const reverseCase=cases[1];let reverseSession=reverseCase.begin(),reverseScore,reverseTime=1000;
for(let k=1;k<=40;k++){reverseTime+=50;reverseScore=reverseCase.evaluate(reverseCase.fixture(.6*k/40,reverseTime),reverseSession);}
const reverseBefore=Object.fromEntries(reverseCase.tube.paths.map(path=>[path.index,reverseSession.paths[path.index].arc]));
reverseTime+=50;reverseScore=reverseCase.evaluate(reverseCase.fixture(.1,reverseTime),reverseSession);
assert.notEqual(reverseScore.status,'match');
for(const path of reverseCase.tube.paths)close(reverseSession.paths[path.index].arc,reverseBefore[path.index],'Reverse travel cannot credit later tube');
reverseTime+=50;reverseScore=reverseCase.evaluate(reverseCase.fixture(1,reverseTime),reverseSession);assert.notEqual(reverseScore.status,'match');
for(const path of reverseCase.tube.paths)close(reverseSession.paths[path.index].arc,reverseBefore[path.index],'Skipping ahead after reversal cannot credit later tube');
report.checks.push('A reversal of both observed hand routes earns no forward progress; skipping directly to the endpoints afterward remains blocked.');

const c=cases[0],focus=c.tube.paths[0].index,path=c.tube.paths[0],start=pointAt(path,0);
let session=c.begin(),score;
for(let t=1050;t<=4000;t+=50)score=c.evaluate(c.fixture(0,t),session);
assert.notEqual(score.status,'match');assert.equal(score.pathComplete,false);
close(session.paths[focus].arc,0,'Holding still cannot consume tube progress');
const wrongSession=c.begin(),opposite=focus===35?36:focus===33?34:33;
for(let k=1;k<=100;k++)score=c.evaluate(c.fixture(k/100,1000+k*50,{override:new Map([[focus,start],[opposite,pointAt(path,k/100)]])}),wrongSession);
assert.notEqual(score.status,'match');assert.equal(score.pathComplete,false);
report.checks.push('Repeated fresh stationary frames and moving the opposite anatomical limb cannot consume the required named route.');

// Move a controlled short section, then leave the assessed corridor. Rejoining
// the endpoint is not credit: the learner must return to the observed cursor.
session=c.begin();let time=1000;
for(let k=1;k<=20;k++){time+=50;score=c.evaluate(c.fixture(.2*k/20,time),session);}
const beforeArc=session.paths[focus].arc,cursor={...session.paths[focus].lastPoint};
assert.ok(beforeArc>0);const off={x:cursor.x,y:cursor.y};
// Choose a clear in-frame excursion perpendicular to the local direction.
const next=pointAt(path,Math.min(1,beforeArc/path.totalLength+.05)),dx=next.x-cursor.x,dy=next.y-cursor.y,len=Math.hypot(dx,dy)||1;
off.x+=-dy/len*(path.halfWidth+.25);off.y+=dx/len*(path.halfWidth+.25);
if(c.project(off).x<0||c.project(off).x>1||c.project(off).y<0||c.project(off).y>1){off.x=cursor.x+dy/len*(path.halfWidth+.25);off.y=cursor.y-dx/len*(path.halfWidth+.25);}
time+=50;score=c.evaluate(c.fixture(.2,time,{override:new Map([[focus,off]])}),session);
assert.notEqual(score.status,'match');assert.equal(score.pathComplete,false);close(session.paths[focus].arc,beforeArc,'Leaving tube earns no travel');
assert.ok(score.paths.find(p=>p.index===focus).needsRejoin||score.paths.find(p=>p.index===focus).offPath);
time+=50;score=c.evaluate(c.fixture(1,time),session);assert.notEqual(score.status,'match');close(session.paths[focus].arc,beforeArc,'Endpoint cannot bridge excursion');
time+=50;score=c.evaluate(c.fixture(.2,time,{override:new Map([[focus,cursor]])}),session);
const recovered=c.walk(session,beforeArc/path.totalLength,time);assert.equal(recovered.score.status,'match',recovered.score.reason);
report.checks.push('An out-of-tube excursion preserves earned progress but cannot credit a shortcut; return to the last observed cursor and follow the remaining curve to finish.');

session=c.begin();time=1000;
for(let k=1;k<=20;k++){time+=50;score=c.evaluate(c.fixture(.2*k/20,time),session);}
const gapArc=session.paths[focus].arc,gapCursor={...session.paths[focus].lastPoint};
time+=50;const missing=c.fixture(.2,time);missing.landmarks=missing.landmarks.filter(p=>p.index!==focus);
const gapPercent=score.percent;
score=c.evaluate(missing,session);assert.equal(score.status,'unknown');assert.equal(score.requiresPositioning,false);
assert.ok(Number.isFinite(score.percent));assert.equal(score.percent,gapPercent,'Tracking loss displays retained earned route progress.');
close(session.paths[focus].arc,gapArc,'Tracking loss retains only previously observed progress');
time+=50;score=c.evaluate(c.fixture(1,time),session);assert.notEqual(score.status,'match');close(session.paths[focus].arc,gapArc,'No progress from teleporting after gap');
time+=50;score=c.evaluate(c.fixture(.2,time,{override:new Map([[focus,gapCursor]])}),session);assert.notEqual(score.status,'match');
const gapRecovered=c.walk(session,gapArc/path.totalLength,time);assert.equal(gapRecovered.score.status,'match',gapRecovered.score.reason);
report.checks.push('Missing tracking is unknown, retains the already earned route and fixed guides, and requires actual rejoining before any later travel counts.');

session=c.begin();const stale=c.fixture(.1,1100);score=c.evaluate(stale,session,{nowMs:1551});
assert.equal(score.status,'unknown');assert.equal(score.percent,0);assert.equal(score.requiresPositioning,false);
session=c.begin();const low=c.fixture(.1,1100);low.landmarks.find(p=>p.index===focus).visibility=.1;
score=c.evaluate(low,session);assert.equal(score.status,'unknown');assert.equal(score.percent,0);
session=c.begin();const changed=c.fixture(.1,1100);score=c.evaluate(changed,session,{bodyFrame:{...c.body,hip:{...c.body.hip,x:c.body.hip.x+.01}}});
assert.equal(score.status,'unknown');assert.equal(score.requiresPositioning,true);
session=c.begin();score=matcher.evaluate(c.ref,{...c.tube,key:c.tube.key+'changed'},c.fixture(.1,1100),c.options(c.fixture(.1,1100),session));
assert.equal(score.status,'unknown');assert.equal(score.requiresPositioning,true);
report.checks.push('Stale and low-confidence frames remain unknown; changed camera geometry or reference route still invalidates the start and requests fresh positioning.');

// Progress is the mean of observed required routes, never an endpoint bonus.
// Inputs below are deliberately constructed from genuine teacher coordinates.
const hands=cases.find(item=>item.tube.paths.some(p=>p.index===33)&&item.tube.paths.some(p=>p.index===34));
assert.ok(hands,'The saved lessons include a two-hand route regression.');
const leftPath=hands.tube.paths.find(p=>p.index===33);
const remove=(sample,index)=>({...sample,landmarks:sample.landmarks.filter(p=>p.index!==index)});
const pathScore=(result,index)=>result.paths.find(p=>p.index===index);
const expectedPercent=result=>result.pathComplete?100:Math.min(99,Math.round(result.paths.reduce((sum,p)=>sum+p.progress,0)/result.paths.length*100));
const verifyPercent=result=>{
  assert.equal(result.percent,expectedPercent(result),'Displayed progress is only the earned required-route mean.');
};
const partial=(item,end=.25)=>{
  const partialSession=item.begin();let partialScore,partialTime=1000;
  for(let k=1;k<=30;k++){partialTime+=50;partialScore=item.evaluate(item.fixture(end*k/30,partialTime),partialSession);}
  return {session:partialSession,score:partialScore,time:partialTime};
};

let progressSession=hands.begin(),progressTime=1000,progressScore;
for(let k=1;k<=30;k++){
  progressTime+=50;progressScore=hands.evaluate(hands.fixture(0,progressTime),progressSession);
  assert.equal(progressScore.percent,0,'Stationary controls at finish positions grant no route percentage.');
}
const footIndex=hands.ref.guides.find(g=>[35,36].includes(g.index)&&g.valid)?.index;assert.ok(footIndex);
for(let k=1;k<=45;k++){
  progressTime+=50;progressScore=hands.evaluate(remove(hands.fixture(.45*k/45,progressTime),footIndex),progressSession);
  assert.equal(progressScore.status,'unknown','Missing endpoint remains unknown even when hands are well observed.');
  assert.equal(pathScore(progressScore,33).trackingStatus,'observed');assert.equal(pathScore(progressScore,34).trackingStatus,'observed');
  verifyPercent(progressScore);
}
assert.ok(pathScore(progressScore,33).progress>.3,'Missing nonfocus foot does not freeze the left-hand tube.');
assert.ok(pathScore(progressScore,34).progress>.3,'Missing nonfocus foot does not freeze the right-hand tube.');
report.progressChecks.push({name:'missing-nonfocus-foot',status:progressScore.status,percent:progressScore.percent,
  paths:progressScore.paths.map(({index,progress,trackingStatus})=>({index,progress,trackingStatus}))});

// Positioning already fixed the camera frame. Fresh observed controls need no
// new torso detection merely to count their own visible route movement.
const noTorsoSession=hands.begin();let noTorsoScore,noTorsoTime=1000;
for(let k=1;k<=100;k++){
  noTorsoTime+=50;const sample=hands.fixture(k/100,noTorsoTime);
  sample.landmarks=sample.landmarks.filter(p=>![11,12,23,24].includes(p.index));
  noTorsoScore=hands.evaluate(sample,noTorsoSession);verifyPercent(noTorsoScore);
}
assert.ok(noTorsoScore.pathComplete,'Observed controls can finish their routes in the established fixed frame.');
assert.equal(noTorsoScore.percent,100);assert.equal(noTorsoScore.status,'unknown','Final hold still waits for a trustworthy torso observation.');
noTorsoTime+=50;noTorsoScore=hands.evaluate(hands.fixture(1,noTorsoTime),noTorsoSession);
assert.equal(noTorsoScore.status,'match','Fresh torso and endpoints can start the final hold without replaying routes.');
report.progressChecks.push({name:'established-frame-no-torso',status:noTorsoScore.status,percent:noTorsoScore.percent});

let oneMissing=partial(hands,.25),missingArc=oneMissing.session.paths[33].arc;
const missingCursor={...oneMissing.session.paths[33].lastPoint};
const visibleBefore=oneMissing.session.paths[34].arc;
for(let k=1;k<=30;k++){
  oneMissing.time+=50;
  oneMissing.score=hands.evaluate(remove(hands.fixture(.25+.3*k/30,oneMissing.time),33),oneMissing.session);
  assert.equal(oneMissing.score.status,'unknown');assert.equal(pathScore(oneMissing.score,33).trackingStatus,'unknown');
  assert.equal(pathScore(oneMissing.score,34).trackingStatus,'observed');
  close(oneMissing.session.paths[33].arc,missingArc,'Only the hidden hand suspends.');verifyPercent(oneMissing.score);
}
assert.ok(oneMissing.session.paths[34].arc>visibleBefore+.1,'The other visible hand continues independently.');
oneMissing.time+=50;oneMissing.score=hands.evaluate(hands.fixture(.6,oneMissing.time),oneMissing.session);
close(oneMissing.session.paths[33].arc,missingArc,'A hand reappearing ahead earns no unseen gap travel.');
assert.ok(pathScore(oneMissing.score,33).needsRejoin||pathScore(oneMissing.score,33).offPath);
oneMissing.time+=50;oneMissing.score=hands.evaluate(hands.fixture(.6,oneMissing.time,{override:new Map([[33,missingCursor]])}),oneMissing.session);
close(oneMissing.session.paths[33].arc,missingArc,'Reacquisition itself earns no route travel.');
for(let k=1;k<=60;k++){
  oneMissing.time+=50;
  oneMissing.score=hands.evaluate(hands.fixture(.6+(1-.6)*k/60,oneMissing.time,{override:new Map([[33,pointAt(leftPath,missingArc/leftPath.totalLength+(1-missingArc/leftPath.totalLength)*k/60)]])}),oneMissing.session);
}
assert.equal(oneMissing.score.status,'match',oneMissing.score.reason);assert.equal(oneMissing.score.percent,100);
report.progressChecks.push({name:'one-hand-gap-other-continues',restoredStatus:oneMissing.score.status,percent:oneMissing.score.percent});

// A low-confidence single point follows the same independent suspension rule.
let lowHand=partial(hands,.25),lowHandArc=lowHand.session.paths[33].arc,lowOtherArc=lowHand.session.paths[34].arc;
for(let k=1;k<=20;k++){
  lowHand.time+=50;const sample=hands.fixture(.25+.2*k/20,lowHand.time);sample.landmarks.find(p=>p.index===33).visibility=.1;
  lowHand.score=hands.evaluate(sample,lowHand.session);assert.equal(lowHand.score.status,'unknown');
  close(lowHand.session.paths[33].arc,lowHandArc,'Low confidence cannot credit that hand.');
  assert.equal(pathScore(lowHand.score,33).trackingStatus,'unknown');verifyPercent(lowHand.score);
}
assert.ok(lowHand.session.paths[34].arc>lowOtherArc+.05);report.progressChecks.push({name:'per-point-low-confidence',status:lowHand.score.status,percent:lowHand.score.percent});

// Global invalid observations suspend every path, preserving earned progress.
for(const kind of ['stale','duplicate-frame','duplicate-observation-time','no-pose','duplicate-joint','malformed-joint','missing-landmark-array']){
  const invalid=partial(hands,.25),before=invalid.score.percent;
  const arcs=Object.fromEntries(hands.tube.paths.map(p=>[p.index,invalid.session.paths[p.index].arc]));
  const cursors=new Map(hands.tube.paths.map(p=>[p.index,{...invalid.session.paths[p.index].lastPoint}]));
  invalid.time+=50;let sample=hands.fixture(.35,invalid.time),extra={};
  if(kind==='stale')extra.nowMs=invalid.time+451;
  if(kind==='duplicate-frame')sample.tMs-=50;
  if(kind==='duplicate-observation-time')extra.observedAtMs=invalid.time-50;
  if(kind==='no-pose')sample.status='no_pose';
  if(kind==='duplicate-joint')sample.landmarks.push({...sample.landmarks[0]});
  if(kind==='malformed-joint')sample.landmarks.push(null);
  if(kind==='missing-landmark-array')sample.landmarks=null;
  invalid.score=hands.evaluate(sample,invalid.session,extra);
  assert.equal(invalid.score.status,'unknown',`${kind}: invalid data cannot pass.`);
  assert.equal(invalid.score.percent,before,`${kind}: previously earned percentage stays visible.`);
  for(const p of hands.tube.paths){
    close(invalid.session.paths[p.index].arc,arcs[p.index],`${kind}: invalid data earns no travel.`);
    assert.equal(pathScore(invalid.score,p.index).trackingStatus,'unknown');
  }
  if(kind==='stale')invalid.time+=451; // Recovery clock must not precede stale evaluation's nowMs.
  invalid.time+=50;invalid.score=hands.evaluate(hands.fixture(.7,invalid.time),invalid.session);
  for(const p of hands.tube.paths)close(invalid.session.paths[p.index].arc,arcs[p.index],`${kind}: reappearance cannot bridge gap.`);
  invalid.time+=50;invalid.score=hands.evaluate(hands.fixture(.25,invalid.time,{override:cursors}),invalid.session);
  for(const p of hands.tube.paths)close(invalid.session.paths[p.index].arc,arcs[p.index],`${kind}: rejoin earns no unseen travel.`);
  report.progressChecks.push({name:`global-${kind}`,retainedPercent:before,rejoinRequired:true});
}

// Completion is awarded upon ordered arrival inside the visible triangle,
// not an invisible extra demand to touch its exact centerline endpoint.
for(const item of cases){
  const finishSession=item.begin();let finishScore,finishTime=1000;
  const stop=.95;
  for(const p of item.tube.paths){
    assert.ok(finishTargetContains(pointAt(p,stop),p.points.at(-1),item.ref),`${item.ref.id}: last 5% lies in its visible finish region.`);
  }
  for(let k=1;k<=160;k++){
    finishTime+=50;finishScore=item.evaluate(item.fixture(stop*k/160,finishTime),finishSession);
  }
  assert.ok(finishScore.pathComplete,`${item.ref.id}: ordered arrival inside triangle completes the route: ${finishScore.reason}`);
  assert.equal(finishScore.status,'match');assert.equal(finishScore.percent,100);
  finishTime+=50;const missingFinish=remove(item.fixture(stop,finishTime),item.ref.guides.find(g=>g.valid).index);
  const incompleteObservation=item.evaluate(missingFinish,finishSession);
  assert.equal(incompleteObservation.status,'unknown','Earned complete routes never imply fresh endpoints are visible.');
  assert.equal(incompleteObservation.percent,100);assert.ok(incompleteObservation.pathComplete);
  finishTime+=50;const restored=item.evaluate(item.fixture(stop,finishTime),finishSession);
  assert.equal(restored.status,'match','Restoring observed endpoints does not require replaying completed routes.');
  const endpoint=item.ref.guides.find(g=>[35,36].includes(g.index)&&g.valid);assert.ok(endpoint);
  let outside={x:endpoint.end.x+.5,y:endpoint.end.y};
  if(item.project(outside).x>1)outside={x:endpoint.end.x-.5,y:endpoint.end.y};
  finishTime+=50;const away=item.evaluate(item.fixture(stop,finishTime,{override:new Map([[endpoint.index,outside]])}),finishSession);
  assert.equal(away.status,'mismatch','Complete route progress cannot pass while a visible supported foot misses its finish.');
  assert.equal(away.percent,100);assert.ok(away.pathComplete);
  report.progressChecks.push({name:`visible-finish-${item.ref.id}`,finishPhase:stop,status:finishScore.status,missingStatus:incompleteObservation.status,restoredStatus:restored.status});
}
const triangleRef=hands.ref,triangleTarget={x:0,y:0},triangleScale=positionedMovementRulesFor(triangleRef).endRadius*.85;
for(const point of [{x:0,y:0},{x:0,y:-triangleScale*.9},{x:triangleScale*.7,y:triangleScale*.55}])
  assert.equal(finishTargetContains(point,triangleTarget,triangleRef),true,'Visible triangle interiors count.');
for(const point of [{x:0,y:triangleScale*.8},{x:triangleScale*.9,y:0},{x:0,y:-triangleScale*1.01}])
  assert.equal(finishTargetContains(point,triangleTarget,triangleRef),false,'Invisible area beyond triangle edges cannot count.');
report.progressChecks.push({name:'shared-visible-triangle-geometry',inside:3,outside:3});
report.checks.push('The bar starts at zero and uses only the mean earned route progress; stationary endpoint controls add no free percentage. Missing nonfocus feet cannot freeze visible hands.');
report.checks.push('Each missing or low-confidence hand suspends only its own route while the other visible hand continues. Earned progress stays visible and unseen travel still requires rejoining.');
report.checks.push('Stale, repeated, non-pose and structurally invalid frames suspend all routes without awarding travel, erasing percentages or allowing a later bridge across the gap.');
report.checks.push('All six ordered traces finish inside the visible triangle region; completed routes survive a missing endpoint, but completion is unknown until every supported endpoint is freshly observed again.');

const broken=structuredClone(sources),middle=path.observations[Math.floor(path.observations.length/2)],entry=broken.get(middle.sourceId);
entry.data.samples.find(sample=>Math.abs(sample.tMs-middle.tMs)<1e-6).landmarks=
  entry.data.samples.find(sample=>Math.abs(sample.tMs-middle.tMs)<1e-6).landmarks.filter(point=>point.index!==focus);
const unavailable=preparePracticeTubes(c.ref,c.step,broken);assert.equal(unavailable.referenceUsable,false);
assert.ok(unavailable.paths.some(p=>p.index===focus&&!p.available));
const unavailableSession=matcher.createSession(c.ref,unavailable,c.fixture(0,1000,{starts:true}),c.body,c.aspect);
const unavailableResult=matcher.evaluate(c.ref,unavailable,c.fixture(1,1100),c.options(c.fixture(1,1100),unavailableSession));
assert.equal(unavailableResult.status,'unknown');assert.equal(unavailableResult.percent,null);assert.equal(unavailableResult.pathComplete,false);
report.checks.push('Removing a genuine intermediate source point makes that route unavailable rather than drawing or scoring a bridge across unknown tracking.');

for(const aspect of [16/9,4/3,9/16])for(const item of cases){
  const layout=createFullHeightLayout(item.ref,references,aspect,cases.map(c=>c.tube)),viewport=cameraViewportBounds(aspect);
  const routes=projectPracticeTubes(item.tube,layout.frame,null);
  assert.equal(routes.length,item.tube.paths.length);
  for(const route of routes){
    assert.ok(route.available);assert.equal(route.points.length,item.tube.paths.find(p=>p.index===route.index).points.length);
    route.points.forEach((point,index)=>{
      const canonical=item.tube.paths.find(p=>p.index===route.index).points[index];
      close(point.x,(canonical.x*layout.frame.scale+layout.frame.hip.x)/aspect,'Exact assessed/rendered tube x');
      close(point.y,canonical.y*layout.frame.scale+layout.frame.hip.y,'Exact assessed/rendered tube y');
      inside(point.x,viewport.left,viewport.right,'Tube center portrait x');inside(point.y,viewport.top,viewport.bottom,'Tube center portrait y');
      const halfX=route.halfWidth*layout.frame.scale/aspect,halfY=route.halfWidth*layout.frame.scale;
      inside(point.x-halfX,viewport.left,viewport.right,'Tube left edge');inside(point.x+halfX,viewport.left,viewport.right,'Tube right edge');
      inside(point.y-halfY,viewport.top,viewport.bottom,'Tube top edge');inside(point.y+halfY,viewport.top,viewport.bottom,'Tube bottom edge');
    });
  }
  report.geometry.push({id:item.ref.id,nativeAspect:aspect,portraitAspect:7/8,paths:routes.length});
}
report.checks.push('All six curves use identical projected geometry for display and assessment across 16:9, 4:3 and 9:16 source cameras in the portrait preview.');

for(const aspect of [16/9,4/3,9/16])for(let i=0;i<cases.length-1;i++){
  const layoutA=createFullHeightLayout(cases[i].ref,references,aspect,cases.map(c=>c.tube));
  const layoutB=createFullHeightLayout(cases[i+1].ref,references,aspect,cases.map(c=>c.tube));
  const ends=projectFourPointGuides(cases[i].ref,null,aspect,layoutA.frame),next=createStartPositionSession(cases[i+1].ref);
  next.bodyFrame=layoutB.frame;next.aspect=aspect;
  const starts=projectStartPositionTargets(cases[i+1].ref,next);
  for(const index of LESSON_CONTROLS.indices){
    const a=ends.find(p=>p.index===index),b=starts.find(p=>p.index===index);assert.ok(a.valid&&b.valid);
    close(a.end.x,b.point.x,'Tube-aware framing preserves cut continuity x');
    close(a.end.y,b.point.y,'Tube-aware framing preserves cut continuity y');
  }
  report.seams.push({from:cases[i].ref.id,to:cases[i+1].ref.id,nativeAspect:aspect,sharedCenters:4,maximumJump:0});
}
report.checks.push('Tube-aware full-height framing retains exact four-control end-to-next-start continuity at all five cuts and all three camera aspects.');

for(const item of cases){
  assert.equal(prepareStartPosition(item.ref).targets.length,4);assert.equal(prepareStartPosition(item.ref).radius,.20);
  assert.equal(positionedMovementRulesFor(item.ref).endRadius,.28);
  close(finishTriangleSize(item.body,720,item.ref),.28*.85*item.body.scale*720,'Existing small triangle scale');
  const startSample=item.fixture(0,1000,{starts:true}),endSample=item.fixture(1,1100),legacySession=legacy.createSession(item.ref,null,startSample,item.body,item.aspect);
  const result=legacy.evaluate(item.ref,null,endSample,item.options(endSample,legacySession));
  assert.equal(result.status,'match');assert.equal(result.pathRequired,false);assert.deepEqual(result.paths,[]);
}
assert.equal(digest([manifest,[...sources]]),rawDigest,'Tube preparation/matching mutated original archives or manifest.');
report.checks.push('Hands and feet retain the smaller 0.20 start squares and configured 0.28 finish size; tube-mode hit tests use the actual visible triangle. Legacy endpoint matching still works without a route; archived source data and manifest are unchanged.');
report.adversarial={stationary:'blocked',oppositeLimb:'blocked',endpointJump:'blocked',outOfTube:'rejoin required',trackingGap:'unknown; rejoin required',missingSourcePoint:'unavailable'};
await mkdir(new URL('../artifacts/practice-progress-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/practice-progress-review/tube-summary.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:report.checks.length,steps:report.steps,geometryCases:report.geometry.length,seamCases:report.seams.length,progressCases:report.progressChecks.length,adversarial:report.adversarial},null,2));
