import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUpperBodyLayout,UPPER_BODY_LAYOUT_RULES,upperBodyCameraViewportBounds} from '../public/upper-body-layout.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {prepareSixthAssessmentReference} from '../public/sixth-assessment-reference.js';
import {createStartPositionSession,projectStartPositionTargets} from '../public/start-position.js';
import {projectFourPointGuides} from '../public/four-point-game-runtime.js';
import {projectPracticeTubes} from '../public/practice-tube.js';

const read=(path:string)=>JSON.parse(readFileSync(new URL(`../public/${path}`,import.meta.url),'utf8'));
const manifest=read('practice-media/recut-six/manifest.json');
manifest.steps=manifest.steps.map(withCenterFocus);
const sources=manifest.sources.map((source:any)=>({...source,data:LESSON_CONTROLS.referenceAdapter(read(source.poseSrc.slice(1)))}));
const lesson=prepareRecutLesson(manifest,new Map(sources.map((source:any)=>[source.id,source])),LESSON_CONTROLS.referenceOptions);
const sixth=prepareSixthAssessmentReference(lesson,sources[0],read('practice-media/recut-six/clip-06-assessment-targets.json'));
const reference=sixth.guidanceReference;
const pathReference=sixth.pathReference;
const close=(actual:number,expected:number,message:string)=>assert.ok(Math.abs(actual-expected)<1e-9,`${message}: ${actual} != ${expected}`);
const inside=(value:number,min:number,max:number)=>assert.ok(value>=min-1e-9&&value<=max+1e-9,`${value} outside ${min}..${max}`);
const project=(point:{x:number,y:number},frame:{hip:{x:number,y:number},scale:number,aspect:number})=>({
  x:(point.x*frame.scale+frame.hip.x)/frame.aspect,y:point.y*frame.scale+frame.hip.y,
});

test('recorded step 6 crown and waist map to exact visible camera boundaries with isotropic proportions',()=>{
  for(const aspect of [16/9,4/3,1,9/16]){
    const layout=createUpperBodyLayout(reference,lesson.guidanceReferences,aspect,[pathReference]);
    assert.ok(layout);
    const {frame,viewport}=layout,teacher=reference.teacherFrame;
    assert.ok(teacher);
    close(viewport.width*aspect/viewport.height,UPPER_BODY_LAYOUT_RULES.aspect,'square camera crop');
    close(frame.hip.y,viewport.bottom,'waist anchor');
    const crownInTeacherFrame={x:0,y:(UPPER_BODY_LAYOUT_RULES.headTopY-teacher.hip.y)/teacher.scale};
    close(project(crownInTeacherFrame,frame).y,viewport.top,'crown anchor');
    close(layout.factor,viewport.height/(teacher.hip.y-UPPER_BODY_LAYOUT_RULES.headTopY),'head-to-waist gain');
    const center=project({x:0,y:0},frame),unitX=project({x:1,y:0},frame),unitY=project({x:0,y:1},frame);
    close((unitX.x-center.x)*aspect,unitY.y-center.y,'equal horizontal and vertical pixel gain');
    assert.deepEqual(layout.controlIndices,[33,34]);
    assert.equal(layout.bodyFrame,layout.frame);
    assert.equal(layout.tubeVerticalShift,0);
    assert.equal(layout.calibration.anchorKind,'assumed-camera-boundaries');
    assert.match(layout.calibration.provenance,/no live torso or hidden joints are fabricated/);
  }
});

test('real palm square, route and finish projections share the same frame and remain reachable',()=>{
  for(const aspect of [16/9,4/3,9/16]){
    const layout=createUpperBodyLayout(reference,[reference],aspect,[pathReference]);
    assert.ok(layout);
    const session:any=createStartPositionSession(reference);
    session.bodyFrame=layout.frame;session.aspect=aspect;
    const starts=projectStartPositionTargets(reference,session).filter((point:any)=>[33,34].includes(point.index));
    const ends=projectFourPointGuides(reference,null,aspect,layout.frame).filter((point:any)=>[33,34].includes(point.index));
    const routes=projectPracticeTubes(pathReference,layout.frame,null).filter((path:any)=>[33,34].includes(path.index));
    assert.equal(starts.length,2);assert.ok(starts.every((point:any)=>point.valid));
    assert.equal(ends.length,2);assert.ok(ends.every((point:any)=>point.valid));
    assert.equal(routes.length,2);assert.ok(routes.every((path:any)=>path.available));
    for(const start of starts){
      const end=ends.find((point:any)=>point.index===start.index);
      const route=routes.find((path:any)=>path.index===start.index);
      const guide=reference.guides.find((point:any)=>point.index===start.index);
      assert.ok(end&&route&&guide&&start.point&&end.end);
      const direct=project(guide.start,layout.frame);
      close(start.point.x,direct.x,'starting-square x');close(start.point.y,direct.y,'starting-square y');
      close(route.points[0].x,start.point.x,'route starts at square x');
      close(route.points[0].y,start.point.y,'route starts at square y');
      close(route.points.at(-1)!.x,end.end.x,'route finishes at triangle x');
      close(route.points.at(-1)!.y,end.end.y,'route finishes at triangle y');
      for(const point of [start.point,end.end,...route.points]){
        inside(point.x,layout.viewport.left,layout.viewport.right);
        inside(point.y,layout.viewport.top,layout.viewport.bottom);
      }
    }
    assert.equal(layout.clippedEdges.left,false);assert.equal(layout.clippedEdges.right,false);
    // The authored palm route naturally reaches near the waist. Its corridor
    // can cross the requested crop; never alter that route to hide the clipping.
    assert.equal(layout.clippedEdges.bottom,true);
    assert.ok(layout.verticalBounds.bottom>layout.viewport.bottom);
  }
});

test('lower-body geometry and other lesson steps cannot alter arms calibration or original full-body layout',()=>{
  const fullBefore=createFullHeightLayout(reference,lesson.guidanceReferences,16/9,[pathReference]);
  const referenceBefore=JSON.stringify(reference),pathsBefore=JSON.stringify(pathReference),sourcesBefore=JSON.stringify(sources);
  const original=createUpperBodyLayout(reference,[reference],16/9,[pathReference]);
  const unrelated=structuredClone(reference);
  unrelated.id='unrelated-step';
  for(const guide of unrelated.guides)guide.start={x:1000,y:-1000};
  const changedFeet=structuredClone(reference),changedFootRoutes:any=structuredClone(pathReference);
  for(const guide of changedFeet.guides.filter((guide:any)=>[35,36].includes(guide.index))){
    guide.start={x:1000,y:-1000};guide.end={x:-1000,y:1000};
  }
  for(const path of changedFootRoutes.paths.filter((path:any)=>path.index===35)){
    path.halfWidth=1000;path.points=[{x:-1000,y:1000,arcLength:0,phase:0}];
  }
  assert.deepEqual(createUpperBodyLayout(reference,[unrelated,reference],16/9,[pathReference]),original);
  assert.deepEqual(createUpperBodyLayout(changedFeet,[changedFeet],16/9,[changedFootRoutes]),original);
  assert.equal(JSON.stringify(reference),referenceBefore);
  assert.equal(JSON.stringify(pathReference),pathsBefore);
  assert.equal(JSON.stringify(sources),sourcesBefore);
  assert.deepEqual(createFullHeightLayout(reference,lesson.guidanceReferences,16/9,[pathReference]),fullBefore);
});

test('upper-body calibration never invents missing geometry and supports original wrist identities',()=>{
  for(const aspect of [0,-1,Number.NaN,Number.POSITIVE_INFINITY]){
    assert.equal(upperBodyCameraViewportBounds(aspect),null);
    assert.equal(createUpperBodyLayout(reference,[reference],aspect,[pathReference]),null);
  }
  assert.equal(createUpperBodyLayout(null,[],1),null);
  assert.equal(createUpperBodyLayout({...reference,teacherFrame:null},[],1),null);
  assert.equal(createUpperBodyLayout({...reference,teacherFrame:{...reference.teacherFrame,hip:{x:.5,y:UPPER_BODY_LAYOUT_RULES.headTopY}}},[],1),null);
  assert.equal(createUpperBodyLayout({...reference,guides:reference.guides.filter((guide:any)=>guide.index!==34)},[],1),null);
  const wrists=structuredClone(reference);
  wrists.guides=wrists.guides.filter((guide:any)=>[33,34].includes(guide.index)).map((guide:any)=>({...guide,index:guide.index===33?15:16}));
  const layout=createUpperBodyLayout(wrists,[wrists],1);
  assert.ok(layout);assert.deepEqual(layout.controlIndices,[15,16]);
  assert.deepEqual(wrists.guides.map((guide:any)=>guide.index),[15,16]);
});
