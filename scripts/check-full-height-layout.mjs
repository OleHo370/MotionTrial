// Offline geometry checks of genuine archived references, not webcam acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CENTER_REFERENCE_OPTIONS,withCenterReferenceData,withCenterFocus} from '../public/practice-centers.js';
import {prepareFirstThreeReference} from '../public/first-three-reference.js';
import {CENTER_START_POSITION_RULES,POSITIONED_MOVEMENT_RULES,prepareAnchoredReference,createStartPositionSession,projectStartPositionTargets} from '../public/start-position.js';
import {projectFourPointGuides} from '../public/four-point-game-runtime.js';
import {FULL_HEIGHT_LAYOUT_RULES,cameraViewportBounds,createFullHeightLayout} from '../public/full-height-layout.js';

const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-9,`${label}: ${actual} != ${expected}`);
const inside=(value,low,high,label)=>assert.ok(value>=low-1e-9&&value<=high+1e-9,`${label}: ${value} outside [${low}, ${high}]`);
const manifest=await read('public/practice-media/next-three/manifest.json'),sources=new Map();
for(const source of manifest.sources)sources.set(source.id,await read(`public/practice-media/first-three-centers/${source.id}.poses.json`));
const rawBefore=digest([...sources]);
const refs=manifest.steps.map(original=>{
  const step=withCenterFocus(original),data=withCenterReferenceData(sources.get(step.sourceId));
  return prepareAnchoredReference(prepareFirstThreeReference(step,data,CENTER_REFERENCE_OPTIONS),step,data);
});
const refsBefore=digest(refs);
assert.equal(refs.length,6);
assert.equal(FULL_HEIGHT_LAYOUT_RULES.aspect,7/8);
const report={
  provenance:'Offline geometry using genuine prerecorded teacher references. The standing-frame crown and sole bounds are visual framing calibration, not new or inferred landmarks. No webcam, browser, or human practice test.',
  rules:FULL_HEIGHT_LAYOUT_RULES,checks:[],cases:[],
  limitations:['An individual learner may have different proportions or camera perspective. Physical full-body framing and target reachability still need manual verification.'],
};
const horizontalOrigins=[];
for(const aspect of [16/9,4/3,9/16]){
  const viewport=cameraViewportBounds(aspect);
  close(viewport.width*aspect/viewport.height,FULL_HEIGHT_LAYOUT_RULES.aspect,'Portrait crop aspect');
  const aspectOrigins=[];
  for(const ref of refs){
    assert.equal(ref.referenceUsable,true,ref.id);
    const layout=createFullHeightLayout(ref,refs,aspect),frame=layout.frame;
    assert.ok(frame,`${ref.id}: layout frame missing`);
    const factor=frame.scale/ref.teacherFrame.scale;
    const yOffset=frame.hip.y-ref.teacherFrame.hip.y*factor;
    const xOffset=frame.hip.x-ref.teacherFrame.hip.x*factor;
    const mappedHead=FULL_HEIGHT_LAYOUT_RULES.headTopY*factor+yOffset;
    const mappedSole=FULL_HEIGHT_LAYOUT_RULES.footBottomY*factor+yOffset;
    close(mappedHead,viewport.top+FULL_HEIGHT_LAYOUT_RULES.edge*viewport.height,`${ref.id}: crown`);
    close(mappedSole,viewport.bottom-FULL_HEIGHT_LAYOUT_RULES.edge*viewport.height,`${ref.id}: soles`);
    close(factor,viewport.height*(1-2*FULL_HEIGHT_LAYOUT_RULES.edge)/(FULL_HEIGHT_LAYOUT_RULES.footBottomY-FULL_HEIGHT_LAYOUT_RULES.headTopY),`${ref.id}: full-height scale without fit shrink`);
    // One canonical unit has the same screen-pixel length in both directions.
    const project=p=>({x:(p.x*frame.scale+frame.hip.x)/aspect,y:p.y*frame.scale+frame.hip.y});
    const origin=project({x:0,y:0}),unitX=project({x:1,y:0}),unitY=project({x:0,y:1});
    close((unitX.x-origin.x)*aspect,unitY.y-origin.y,`${ref.id}: isotropic pixel gain`);
    const session=createStartPositionSession(ref);session.bodyFrame=frame;session.aspect=aspect;
    const starts=projectStartPositionTargets(ref,session),ends=projectFourPointGuides(ref,null,aspect,frame).filter(g=>g.valid);
    assert.equal(starts.length,4);assert.ok(starts.every(t=>t.valid));
    for(const target of starts){
      const guide=ref.guides.find(g=>g.index===target.index),direct=project(guide.start);
      close(target.point.x,direct.x,`${ref.id}: shared start x`);close(target.point.y,direct.y,`${ref.id}: shared start y`);
      inside(target.point.x,viewport.left,viewport.right,`${ref.id}: start x`);
      inside(target.point.y,viewport.top,viewport.bottom,`${ref.id}: start y`);
      const half=CENTER_START_POSITION_RULES.radius*frame.scale/aspect;
      inside(target.point.x-half,viewport.left,viewport.right,`${ref.id}: square left`);
      inside(target.point.x+half,viewport.left,viewport.right,`${ref.id}: square right`);
      // The projection preserves the archived teacher point with the same gain.
      close(target.point.x,(guide.startRaw.x*ref.referenceAspectRatio*factor+xOffset)/aspect,`${ref.id}: raw start x`);
      close(target.point.y,guide.startRaw.y*factor+yOffset,`${ref.id}: raw start y`);
    }
    for(const target of ends){
      const guide=ref.guides.find(g=>g.index===target.index),direct=project(guide.end);
      close(target.end.x,direct.x,`${ref.id}: shared end x`);close(target.end.y,direct.y,`${ref.id}: shared end y`);
      inside(target.end.x,viewport.left,viewport.right,`${ref.id}: end x`);
      inside(target.end.y,viewport.top,viewport.bottom,`${ref.id}: end y`);
      const half=POSITIONED_MOVEMENT_RULES.endRadius*.85*.9*frame.scale/aspect;
      inside(target.end.x-half,viewport.left,viewport.right,`${ref.id}: triangle left`);
      inside(target.end.x+half,viewport.left,viewport.right,`${ref.id}: triangle right`);
    }
    aspectOrigins.push(xOffset);
    report.cases.push({step:ref.id,nativeAspect:aspect,previewAspect:viewport.width*aspect/viewport.height,
      factor,torsoScale:frame.scale,mappedHeadY:(mappedHead-viewport.top)/viewport.height,
      mappedSoleY:(mappedSole-viewport.top)/viewport.height,startCount:starts.length,endCount:ends.length});
  }
  for(const origin of aspectOrigins)close(origin,aspectOrigins[0],'One horizontal origin across all six steps');
  horizontalOrigins.push({aspect,origin:aspectOrigins[0]});
}
assert.equal(digest([...sources]),rawBefore,'Raw recorded source data changed');
assert.equal(digest(refs),refsBefore,'Prepared references changed during layout');
report.checks.push('All six steps use crown-to-sole visual framing at 2% to 98% of visible height, without route-dependent scale shrink.');
report.checks.push('Native 16:9, 4:3, and 9:16 inputs retain an isotropic 7:8 portrait preview; all four start centers and available finish centers remain visible.');
report.checks.push('Starting-square and finish-triangle horizontal extents fit the crop at the same globally centered origin across all six steps.');
report.checks.push('Start-square and finish-guide projection share the exact fixed matching frame; source coordinates transform with uniform pixel gain and no foot-only display offset.');
report.checks.push('Raw recorded sources and prepared references remain byte-equivalent in memory.');
report.horizontalOrigins=horizontalOrigins;
await mkdir(new URL('../artifacts/full-height-layout-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/full-height-layout-review/summary.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
