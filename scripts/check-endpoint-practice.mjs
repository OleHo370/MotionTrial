// Offline software regression. Constructed controls are NOT webcam or human acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {CENTER_REFERENCE_OPTIONS,withCenterReferenceData,withCenterFocus} from '../public/practice-centers.js';
import {prepareFirstThreeReference} from '../public/first-three-reference.js';
import {prepareAnchoredReference,POSITIONED_MOVEMENT_RULES} from '../public/start-position.js';
import {prepareMovementPaths} from '../public/movement-path.js';
import {createPracticeMatcher,finishTriangleSize} from '../public/first-three-attempt.js';
const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const manifest=await read('public/practice-media/next-three/manifest.json');
const endpoint=createPracticeMatcher(),route=createPracticeMatcher({requireRoute:true}),sources=new Map();
const report={provenance:'Genuine archived teacher observations supply references and torso geometry. All live inputs below are explicitly constructed software controls, not MediaPipe inference or physical learner acceptance.',
  mode:endpoint.mode,checks:[],steps:[],limitations:['No webcam, model, browser, or human practice test. The UI fresh 700 ms completion hold is outside this matcher regression.']};
assert.ok(Object.isFrozen(endpoint));assert.equal(endpoint.requiresRoute,false);assert.equal(endpoint.mode,'endpoints');
assert.equal(route.mode,'route');assert.equal(route.requiresRoute,true);
for(const source of manifest.sources)sources.set(source.id,withCenterReferenceData(await read(`public/practice-media/first-three-centers/${source.id}.poses.json`)));
const cases=[];
for(const original of manifest.steps){
  const step=withCenterFocus(original),data=sources.get(step.sourceId),aspect=data.width/data.height;
  const ref=prepareAnchoredReference(prepareFirstThreeReference(step,data,CENTER_REFERENCE_OPTIONS),step,data);
  const path=prepareMovementPaths(ref,step,data),body=ref.teacherFrame;
  assert.equal(ref.referenceUsable,true);assert.equal(path.referenceUsable,true);
  const anchor=data.samples.find(s=>s.tMs===ref.teacherFrameTMs);
  const project=p=>({x:(p.x*body.scale+body.hip.x)/aspect,y:p.y*body.scale+body.hip.y});
  // Keep the actual observed torso; place virtual center IDs at explicit target coordinates.
  const fixture=(which,tMs)=>{
    const sample=structuredClone(anchor);sample.tMs=tMs;
    for(const guide of ref.guides.filter(g=>which==='start'||g.valid)){
      const point=sample.landmarks.find(p=>p.index===guide.index);assert.ok(point);
      Object.assign(point,project(guide[which]),{visibility:1,presence:1});
    }
    return sample;
  };
  const start=fixture('start',1000),end=fixture('end',1100);
  const options=(sample,session,extra={})=>({attemptAspectRatio:aspect,nowMs:sample.tMs,observedAtMs:sample.tMs,bodyFrame:body,session,...extra});
  const session=()=>endpoint.createSession(ref,path,start,body,aspect);
  const finish=endpoint.evaluate(ref,path,end,options(end,session()));
  assert.equal(finish.status,'match',`${step.id}: ${finish.reason}`);
  assert.equal(finish.endpointStatus,'match');assert.equal(finish.pathRequired,false);assert.deepEqual(finish.paths,[]);
  assert.equal(Object.hasOwn(finish,'pathComplete'),false);
  report.steps.push({id:step.id,constructedEndpointResult:finish.status,focusJoints:ref.focusJoints});
  cases.push({step,ref,path,body,aspect,start,end,fixture,options,session,finish});
}
report.checks.push('All six supported endpoint controls match without visiting intermediate checkpoints; no route-completion claim is returned.');
const {ref,path,body,aspect,start,end,fixture,options,session}=cases[0];
assert.deepEqual(ref.focusJoints,[35]);
const routeSession=route.createSession(ref,path,start,body,aspect);
const blocked=route.evaluate(ref,path,end,options(end,routeSession));
assert.equal(blocked.endpointStatus,'match');assert.equal(blocked.status,'mismatch');assert.equal(blocked.pathComplete,false);
assert.equal(blocked.pathRequired,true);
report.checks.push('Step 1 reproduces the old hidden-checkpoint block: endpoints match, but route mode correctly waits for unvisited squares. Endpoint mode removes that hidden requirement.');
const partial=structuredClone(end),other=partial.landmarks.find(p=>p.index===34);
other.x+=(other.x>.5?-1:1)*.6*body.scale/aspect;
assert.ok(other.x>=0&&other.x<=1);
const pending=endpoint.evaluate(ref,path,partial,options(partial,session()));
assert.equal(pending.status,'mismatch');assert.equal(pending.limbs.find(p=>p.index===35).targetReached,true);
assert.equal(pending.limbs.find(p=>p.index===34).targetReached,false);
report.checks.push('The left-foot target registers independently while a different available endpoint remains pending; overall success still requires every available endpoint.');
const missing=structuredClone(end);missing.landmarks=missing.landmarks.filter(p=>p.index!==35);
const missingResult=endpoint.evaluate(ref,path,missing,options(missing,session()));
assert.equal(missingResult.status,'unknown');assert.equal(missingResult.requiresPositioning,true);
const stale=endpoint.evaluate(ref,path,end,options(end,session(),{nowMs:2000}));
assert.equal(stale.status,'unknown');
const still=fixture('start',1100),noTravel=endpoint.evaluate(ref,path,still,options(still,session()));
assert.notEqual(noTravel.status,'match');assert.equal(noTravel.limbs.find(p=>p.index===35).movementObserved,false);
const wrong=structuredClone(end),left=wrong.landmarks.find(p=>p.index===35),right=wrong.landmarks.find(p=>p.index===36);
Object.assign(right,{x:left.x,y:left.y});Object.assign(left,fixture('start',1100).landmarks.find(p=>p.index===35));
const wrongSide=endpoint.evaluate(ref,path,wrong,options(wrong,session()));
assert.notEqual(wrongSide.status,'match');assert.equal(wrongSide.limbs.find(p=>p.index===35).movementObserved,false);
report.checks.push('Missing, stale, stationary, and opposite-foot-only controls never pass. A fresh actual left-foot displacement from the unlocked start is required.');
let geometries=0;
for(const scale of [.025,.05,.1,.2])for(const height of [360,480,720]){
  const size=finishTriangleSize({scale},height),radius=POSITIONED_MOVEMENT_RULES.endRadius*scale*height;
  for(const [x,y]of [[0,-size],[size*.9,size*.65],[-size*.9,size*.65]])assert.ok(Math.hypot(x,y)<=radius+1e-9);
  geometries++;
}
report.checks.push(`Finish triangle vertices fit inside the actual endpoint hit radius in all ${geometries} scale/resolution controls; no minimum visual size inflates the target.`);
report.step1={oldRouteResult:blocked.status,oldEndpointResult:blocked.endpointStatus,newEndpointResult:cases[0].finish.status,
  leftFootReachedWithOtherPending:pending.limbs.find(p=>p.index===35).targetReached,overallWithOtherPending:pending.status,
  missing:missingResult.status,stale:stale.status,stationary:noTravel.status,wrongSide:wrongSide.status};
await mkdir(new URL('../artifacts/endpoint-practice-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/endpoint-practice-review/summary.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
