// Actual drawGuides controller with a mocked canvas/camera, using genuine saved
// teacher observations. This is software rendering QA, not live follow-along.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {createStartPositionSession} from '../public/start-position.js';
import {preparePracticeTubes,createTubeMatcher} from '../public/practice-tube.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';
import {projectPracticeGuideGeometry} from '../public/practice-guide-geometry.js';
import {finishTriangleSize} from '../public/first-three-attempt.js';
import {drawPracticeTubes} from '../public/practice-tube-drawing.js';
import {getLiveTargetHighlights} from '../public/practice-target-highlight.js';

const root=new URL('../',import.meta.url);
const read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const manifest=await read('public/practice-media/recut-six/manifest.json');
const source=manifest.sources[0];
const sources=new Map([[source.id,{...source,data:LESSON_CONTROLS.referenceAdapter(await read('public'+source.poseSrc))}]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const refs=lesson.guidanceReferences,paths=refs.map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources));
const controller=await readFile(new URL('public/first-three.js',root),'utf8');
const begin=controller.indexOf('function drawGuides(){'),end=controller.indexOf('function observe(',begin);
assert.ok(begin>=0&&end>begin);
const render=new Function('state','$','guidance','pathReference','cameraFeedAvailable','seedScreenTargets',
  'projectPracticeGuideGeometry','START_POSITION_RULES','matcher','drawPracticeTubes','finishTriangleSize','getLiveTargetHighlights',
  controller.slice(begin,end)+'; drawGuides();');
const rows=[];
for(const aspect of [16/9,4/3,9/16])for(let index=0;index<refs.length;index++){
  const ref=refs[index],path=paths[index],layout=createFullHeightLayout(ref,refs,aspect,paths);
  assert.ok(layout);
  const placement=createStartPositionSession(ref);placement.bodyFrame=layout.frame;placement.aspect=aspect;
  const ctx=new Proxy({}, {get:(target,key)=>key in target?target[key]:(()=>{})});
  const canvas={style:{},getContext:()=>ctx},camera={videoHeight:720,videoWidth:720*aspect};
  const elements={'camera-guide-overlay':canvas,'camera-video':camera,'learner-skeleton':{checked:true},'mirror-preview':{checked:true}};
  const state={loading:false,active:true,paused:false,phase:'positioning',placement,fixedFrame:null,movement:null};
  const draw=()=>render(state,id=>elements[id],()=>ref,()=>path,()=>true,()=>{},
    projectPracticeGuideGeometry,LESSON_CONTROLS.startRules,createTubeMatcher(),drawPracticeTubes,finishTriangleSize,getLiveTargetHighlights);
  draw();
  const before=structuredClone(state.projectedStarts);
  assert.equal(before.length,4);
  assert.deepEqual(state.triangleJoints,[],'No ending triangles before readiness');
  assert.deepEqual(state.projectedPaths,[],'No routes before readiness');
  state.phase='demonstrating';state.fixedFrame=structuredClone(layout.frame);
  draw();
  assert.deepEqual(state.projectedStarts.map(point=>point.point),before.map(point=>point.point),'Starting squares keep exact positions when movement begins');
  assert.deepEqual(state.squareJoints,[33,34,35,36],'Keep faint entry squares during movement');
  for(const route of state.projectedPaths.filter(route=>route.available)){
    const start=state.projectedStarts.find(point=>point.index===route.index).point;
    const finish=state.projectedEnds.find(point=>point.index===route.index).point;
    assert.ok(Math.hypot(route.points[0].x-start.x,route.points[0].y-start.y)<1e-10);
    assert.ok(Math.hypot(route.points.at(-1).x-finish.x,route.points.at(-1).y-finish.y)<1e-10);
  }
  if(index===2){
    assert.deepEqual(state.projectedPaths.filter(route=>route.available).map(route=>route.index),[33,34],'Clip 3 only substantial hand movement has progress areas');
    for(const foot of [35,36]){
      const start=state.projectedStarts.find(point=>point.index===foot).point;
      const finish=state.projectedEnds.find(point=>point.index===foot).point;
      assert.ok(Math.hypot(start.x-finish.x,start.y-finish.y)<1e-10,'Clip 3 planted-foot triangles stay at their squares');
    }
  }
  rows.push({step:index+1,aspect,unchangedStartCenters:4,connectedRoutes:state.projectedPaths.filter(route=>route.available).map(route=>route.index),triangleCount:state.projectedEnds.length});
}
await mkdir(new URL('artifacts/end-review/',root),{recursive:true});
await writeFile(new URL('artifacts/end-review/drawing-summary.json',root),JSON.stringify({
  provenance:'Actual controller drawGuides function, real recorded teacher references, mocked camera/canvas. No live-camera or human acceptance claimed.',
  passed:true,cases:rows.length,checks:['Readiness only shows starting squares','Starting square coordinates remain fixed into movement','Every available area exactly joins its square and triangle','Clip 3 has two hand areas and two fixed foot holds'],rows},null,2)+'\n');
console.log(JSON.stringify({passed:true,renderingCases:rows.length,readinessTriangles:0,startJumps:0,clip3ProgressAreas:2,clip3AnchoredFeet:2}));
