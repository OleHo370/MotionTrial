// Actual archived teacher data plus explicitly constructed software fixtures.
// This is geometry QA, never physical-camera or human-practice acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {prepareFootAnchorReferences,FOOT_ANCHOR_VERSION} from '../public/practice-foot-anchors.js';
import {prepareFirstThreeReference,visible} from '../public/first-three-reference.js';
import {prepareAnchoredReference} from '../public/start-position.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {getFourPointBodyFrame} from '../public/four-point-game-runtime.js';

const root=new URL('../',import.meta.url),checks=[];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const check=(name,run)=>{run();checks.push(name);};
const normalize=(point,frame)=>({x:(point.x*frame.aspect-frame.hip.x)/frame.scale,y:(point.y-frame.hip.y)/frame.scale});
const project=(point,frame)=>({x:(point.x*frame.scale+frame.hip.x)/frame.aspect,y:point.y*frame.scale+frame.hip.y});
const frame={hip:{x:.5,y:.5},scale:.2,aspect:1.25};
const foot=(index,start,end)=>({index,valid:true,available:true,start:normalize(start,frame),end:normalize(end,frame),
  startRaw:start,endRaw:end,startObservation:{sourceId:'master',tMs:0},endObservation:{sourceId:'master',tMs:100},
  support:{startTimesMs:[0,1],endTimesMs:[99,100]}});
const fixture=()=>[
  {id:'a',teacherFrame:frame,referenceUsable:true,focusJoints:[35],guides:[
    foot(35,{x:.4,y:.8},{x:.5,y:.8}),foot(36,{x:.6,y:.8},{x:.601,y:.8}),
    {...foot(33,{x:.4,y:.4},{x:.4,y:.2}),kind:'hand'}]},
  {id:'b',teacherFrame:{hip:{x:.51,y:.52},scale:.24,aspect:1.25},referenceUsable:true,focusJoints:[33],guides:[
    foot(35,{x:.5,y:.8},{x:.501,y:.8}),foot(36,{x:.601,y:.8},{x:.602,y:.8})]},
];

check('Cloned target geometry never changes raw observations, source support or hand targets',()=>{
  const input=fixture(),before=JSON.stringify(input),out=prepareFootAnchorReferences(input);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(out[0].guides.find(g=>g.index===33),input[0].guides.find(g=>g.index===33));
  for(let i=0;i<input.length;i++)for(let j=0;j<input[i].guides.length;j++){
    const a=input[i].guides[j],b=out[i].guides[j];
    for(const key of ['startRaw','endRaw','startObservation','endObservation','support'])assert.deepEqual(a[key],b[key]);
  }
});
check('Planted feet retain exact teaching positions across clips with different torso frames',()=>{
  const out=prepareFootAnchorReferences(fixture());
  for(const index of [35,36]){
    const a=out[0].guides.find(g=>g.index===index),b=out[1].guides.find(g=>g.index===index);
    assert.deepEqual(a.targetGeometry.endRaw,b.targetGeometry.startRaw);
    const end=project(a.end,out[0].teacherFrame),start=project(b.start,out[1].teacherFrame);
    close(end.x,start.x);close(end.y,start.y);
    assert.equal(b.targetGeometry.mode,'hold');assert.deepEqual(b.start,b.end);
  }
});
check('Only sufficient observed endpoint displacement moves a foot, including named foot foci',()=>{
  const ref={...fixture()[0],focusJoints:[35],guides:[foot(35,{x:.4,y:.8},{x:.42,y:.8})]};
  let out=prepareFootAnchorReferences([ref]);
  assert.equal(out[0].guides[0].targetGeometry.footFocus,true);
  assert.equal(out[0].guides[0].targetGeometry.mode,'hold');
  out=prepareFootAnchorReferences([ref],{minimumFootDisplacement:.1});
  assert.equal(out[0].guides[0].targetGeometry.mode,'move');
  assert.deepEqual(out[0].guides[0].targetGeometry.endRaw,ref.guides[0].endRaw);
  assert.throws(()=>prepareFootAnchorReferences([ref],{minimumFootDisplacement:0}));
});
check('A supported start still inherits the previous finish when its own finish is missing; missing ends break further carry',()=>{
  const refs=fixture(),broken=structuredClone(refs[1]);broken.id='missing';
  broken.guides[0].valid=false;broken.guides[0].endRaw=null;broken.guides[0].end=null;
  broken.referenceUsable=false;const incoming=structuredClone(refs[1]);incoming.id='after-missing';
  incoming.guides[0].startRaw={x:.55,y:.8};
  const out=prepareFootAnchorReferences([refs[0],broken,incoming]);
  assert.equal(out[1].referenceUsable,false);assert.equal(out[1].guides[0].valid,false);
  assert.equal(out[1].guides[0].endRaw,null);assert.equal(out[1].guides[0].end,null);
  assert.equal(out[1].guides[0].targetGeometry.mode,'unavailable-end');
  assert.equal(out[1].guides[0].targetGeometry.endRaw,null);
  assert.deepEqual(out[1].guides[0].targetGeometry.startRaw,out[0].guides[0].targetGeometry.endRaw);
  const end=project(out[0].guides[0].end,out[0].teacherFrame),start=project(out[1].guides[0].start,out[1].teacherFrame);
  close(end.x,start.x);close(end.y,start.y);
  assert.equal(out[2].guides[0].targetGeometry.carriedFromReferenceId,null);
  assert.deepEqual(out[2].guides[0].targetGeometry.startRaw,incoming.guides[0].startRaw);
});
check('Legacy ankle control IDs receive the same explicit target anchoring',()=>{
  const refs=fixture();for(const ref of refs){ref.guides=ref.guides.filter(g=>[35,36].includes(g.index));
    for(const g of ref.guides)g.index=g.index===35?27:28;}
  const out=prepareFootAnchorReferences(refs);
  assert.deepEqual(out[0].guides[1].targetGeometry.endRaw,out[1].guides[1].targetGeometry.startRaw);
});

// Build exact-frame references directly. This intentionally avoids the recut
// integration helper so the anchoring transform is applied exactly once here.
const manifest=JSON.parse(await readFile(new URL('public/practice-media/recut-six/manifest.json',root),'utf8'));
const raw=JSON.parse(await readFile(new URL('public'+manifest.sources[0].poseSrc,root),'utf8'));
const before=JSON.stringify(raw),data=LESSON_CONTROLS.referenceAdapter(raw),steps=manifest.steps.map(withCenterFocus);
const aspect=data.width/data.height,indices=LESSON_CONTROLS.indices,torso=[11,12,23,24];
const trusted=(sample,threshold)=>sample?.status==='pose'&&!!getFourPointBodyFrame(sample,aspect)
  &&[...indices,...torso].every(index=>{
    const point=sample.landmarks.find(p=>p.index===index);
    return visible(point)&&point.visibility>=threshold&&(point.presence??1)>=threshold;
  });
const boundary=(frame,threshold)=>{
  const sample=data.samples.find(s=>s.sourceFrameIndex===frame);
  const support=data.samples.filter(s=>Math.abs(s.sourceFrameIndex-frame)<=8&&trusted(s,threshold));
  return {available:trusted(sample,threshold)&&support.length>=2,sourceId:'master',
    tMs:sample?.tMs,threshold,samples:support};
};
const actual=steps.map((step,i)=>{
  const a=Math.max(step.referenceVisibilityThreshold??.45,steps[i-1]?.referenceVisibilityThreshold??.45);
  const b=Math.max(step.referenceVisibilityThreshold??.45,steps[i+1]?.referenceVisibilityThreshold??.45);
  const observed=prepareFirstThreeReference({...step,startSeconds:step.practiceStartSeconds,endSeconds:step.teacherFreezeSeconds},data,
    {...LESSON_CONTROLS.referenceOptions,boundaries:{start:boundary(step.referenceStartFrame,a),end:boundary(step.referenceEndFrame,b)}});
  return prepareAnchoredReference(observed,{...step,startSeconds:step.practiceStartSeconds},
    {...data,samples:data.samples.filter(sample=>sample.sourceFrameIndex===step.referenceStartFrame)});
});
const teaching=prepareFootAnchorReferences(actual),rows=[];
check('Actual six-clip teacher references have anchored first-five foot targets and unsupported final evidence stays unknown',()=>{
  assert.equal(JSON.stringify(raw),before);
  assert.deepEqual(teaching.map(ref=>ref.referenceUsable),[true,true,true,true,true,false]);
  for(let i=0;i<teaching.length;i++){
    const ref=teaching[i],feet=ref.guides.filter(guide=>[35,36].includes(guide.index));
    rows.push({id:ref.id,referenceUsable:ref.referenceUsable,feet:feet.map(guide=>({index:guide.index,valid:guide.valid,
      mode:guide.targetGeometry?.mode??'unavailable',observedDisplacement:guide.targetGeometry?.observedDisplacement??null,
      start:guide.targetGeometry?.startRaw??null,end:guide.targetGeometry?.endRaw??null}))});
    for(const guide of feet){
      const previous=teaching[i-1]?.guides.find(g=>g.index===guide.index);
      if(previous?.valid&&guide.startRaw){
        assert.deepEqual(previous.targetGeometry.endRaw,guide.targetGeometry.startRaw);
        const end=project(previous.end,teaching[i-1].teacherFrame),start=project(guide.start,ref.teacherFrame);
        close(end.x,start.x);close(end.y,start.y);
      }
      if(!guide.valid){
        assert.equal(guide.targetGeometry.mode,'unavailable-end');
        assert.equal(guide.end,null);assert.equal(guide.targetGeometry.endRaw,null);continue;
      }
      if(guide.targetGeometry.mode==='hold')assert.deepEqual(guide.start,guide.end);
    }
  }
  assert.deepEqual(rows.slice(1,4).map(row=>row.feet.map(foot=>foot.mode)),[['hold','hold'],['hold','hold'],['hold','hold']]);
});
const report={version:FOOT_ANCHOR_VERSION,checks,steps:rows,
  provenance:'Actual archived MediaPipe teacher data and explicitly constructed software fixtures; no physical-camera acceptance.',
  anchors:rows.flatMap(row=>row.feet).filter(foot=>foot.mode==='hold').length,
  moves:rows.flatMap(row=>row.feet).filter(foot=>foot.mode==='move').length};
await mkdir(new URL('artifacts/corridor-practice-review/',root),{recursive:true});
await writeFile(new URL('artifacts/corridor-practice-review/foot-anchor-checks.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
