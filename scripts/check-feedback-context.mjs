// Pure checks of actual archived teacher geometry and clearly constructed raw
// learner observations. No physical camera, speaker, USB board or AI request.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {derivePracticeFeedbackContext} from '../public/practice-feedback-context.js';
import {descriptivePracticeFeedback} from '../public/practice-descriptive-feedback.js';
import {createAttemptReview,observeAttemptReview,finalizeAttemptReview} from '../public/practice-attempt-review.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {preparePracticeTubes} from '../public/practice-tube.js';

const root=new URL('../',import.meta.url),checks=[];
const readJson=async name=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const manifest=await readJson('public/practice-media/recut-six/manifest.json');
const raw=await readJson('public/practice-media/recut-six/master.poses.json');
const source={...manifest.sources[0],data:LESSON_CONTROLS.referenceAdapter(raw)};
const sources=new Map([[source.id,source]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const archived=lesson.steps.slice(0,5).map((step,index)=>derivePracticeFeedbackContext({step,
  review:{status:'match',issues:[],limbs:[]},reference:lesson.guidanceReferences[index],
  pathReference:preparePracticeTubes(lesson.guidanceReferences[index],step,sources)}));
assert.equal(archived.length,5);
for(const [index,context]of archived.entries()){
  assert.equal(context.limbs.length,4,`Step ${index+1} supplies all four source-backed guide directions.`);
  assert.equal(context.version,'practice-feedback-context-v1');
  assert.ok(context.limbs.every(limb=>!Object.hasOwn(limb,'observedDirection')));
  assert.equal(Object.hasOwn(context,'practiceFocus'),false,'Teacher geometry alone cannot diagnose a learner.');
}
assert.deepEqual(archived[1].limbs.filter(limb=>[33,34].includes(limb.index)).map(limb=>limb.expectedDirection),['up','up']);
assert.deepEqual(archived[2].limbs.filter(limb=>[33,34].includes(limb.index)).map(limb=>limb.expectedDirection),['down','down']);
assert.deepEqual(archived[3].limbs.filter(limb=>[33,34].includes(limb.index)).map(limb=>limb.expectedDirection),['up','left']);
assert.deepEqual(archived[4].limbs.filter(limb=>[33,34].includes(limb.index)).map(limb=>limb.expectedDirection),['down','up']);
checks.push('All five real archived teaching guides provide bounded directions; the two later clips retain distinct left/right-hand reference directions instead of guessing from their titles.');

function fixture({missing=false,sideways=false,short=false,footDrift=false}={}){
  const reference={id:'constructed-teacher-fixture',referenceUsable:true,guides:[33,34,35,36].map(index=>({index,
    valid:true,label:{33:'Left hand',34:'Right hand',35:'Left foot',36:'Right foot'}[index],
    start:{x:[33,35].includes(index)?-.3:.3,y:index<35?0:1},
    end:{x:[33,35].includes(index)?-.3:.3,y:index<35?-1:1},startSourceSeconds:0,targetGeometry:index>=35?{mode:'hold'}:undefined}))};
  const pathReference={referenceUsable:true,paths:reference.guides.map(guide=>({index:guide.index,available:true,
    points:[guide.start,guide.end],observations:Array.from({length:21},(_,i)=>({sourceTimeSeconds:i/10,
      point:{x:guide.start.x,y:guide.start.y+(guide.end.y-guide.start.y)*i/20}}))}))};
  const session=createAttemptReview(reference,pathReference,{bodyFrame:{hip:{x:.5,y:.5},scale:.2,aspect:1},
    aspect:1,startAtMs:0,durationMs:4000});
  for(let elapsedMs=0;elapsedMs<=4000;elapsedMs+=100){
    const landmarks=reference.guides.flatMap(guide=>{
      if(missing&&guide.index===33&&elapsedMs>=1300&&elapsedMs<=1900)return [];
      let point={...guide.start};
      if(guide.index<35){
        if(short&&guide.index===33)point.y=-Math.min(.35,elapsedMs/4000*.35);
        else if(sideways&&guide.index===33){
          if(elapsedMs>=600&&elapsedMs<=2500)point.x+=.8;
          else if(elapsedMs>2500)point.y=-Math.min(1,(elapsedMs-2500)/800);
        }else point.y=-Math.min(1,Math.max(0,(elapsedMs-400)/1600));
      }else if(footDrift&&guide.index===35&&elapsedMs>=600&&elapsedMs<=2500)point.x+=.6;
      return [{index:guide.index,x:.5+point.x*.2,y:.5+point.y*.2,visibility:.99,presence:.99}];
    });
    observeAttemptReview(session,{sample:{status:'pose',tMs:elapsedMs,landmarks},observedAtMs:elapsedMs,aspectRatio:1},
      {nowMs:elapsedMs,elapsedMs});
  }
  const review=finalizeAttemptReview(session,{nowMs:4000,elapsedMs:4000});
  const context=derivePracticeFeedbackContext({review,session,reference,pathReference});
  return {review,context,session,reference,pathReference};
}

{
  const full=fixture({sideways:true}),original=structuredClone(full.review),raw=structuredClone(full.session.controls);
  assert.ok(full.review.issues.some(issue=>issue.index===33&&issue.code==='off_guide'));
  assert.equal(full.context.limbs.find(limb=>limb.index===33).observedDirection,'right');
  assert.deepEqual(full.review,original);assert.deepEqual(full.session.controls,raw);
  const text=descriptivePracticeFeedback(full.review,full.context).messages.join(' ');
  assert.match(text,/left hand.*drifted sideways.*guide led upward/);
  assert.doesNotMatch(text,/to your right|confidence|afraid/);
  const gap=fixture({sideways:true,missing:true});
  assert.equal(Object.hasOwn(gap.context.limbs.find(limb=>limb.index===33),'observedDirection'),false);
  checks.push('A sustained raw observed sideways excursion gets contextual wording; missing tracking prevents the same claim and original evidence stays unchanged.');
}

{
  const fixtureData=fixture(),limb=fixtureData.review.limbs.find(limb=>limb.index===33);
  const invented={...fixtureData.review,status:'mismatch',issues:[{index:33,code:'off_guide'}]};
  const noExcursion=derivePracticeFeedbackContext({...fixtureData,review:invented});
  assert.equal(Object.hasOwn(noExcursion.limbs.find(limb=>limb.index===33),'observedDirection'),false);
  const incompleteSession={...fixtureData.session,frameUsable:false};
  assert.ok(derivePracticeFeedbackContext({...fixtureData,session:incompleteSession}).limbs.every(limb=>!limb.observedDirection));
  const tooBrief=fixture({sideways:true});
  const control=tooBrief.session.controls.find(control=>control.index===33);
  control.samples=control.samples.slice(0,9);control.observedIntervals=control.observedIntervals.filter(interval=>interval.to<=800);
  assert.equal(Object.hasOwn(derivePracticeFeedbackContext(tooBrief).limbs.find(limb=>limb.index===33),'observedDirection'),false);
  assert.equal(limb.status,'match');
  checks.push('Off-guide code alone, a broken camera frame and a brief excursion never imply an observed direction.');
}

{
  const coordination=fixture({footDrift:true});
  assert.ok(coordination.review.issues.some(issue=>issue.index===35&&issue.code==='hold_drift'));
  assert.equal(coordination.context.practiceFocus,'coordination');
  const short=fixture({short:true});
  assert.ok(short.review.issues.some(issue=>issue.index===33&&issue.code==='endpoint_unreached'));
  assert.equal(short.context.practiceFocus,'range');
  const slowOnly=fixture();slowOnly.review.issues=[{index:33,code:'too_slow'}];
  assert.equal(Object.hasOwn(derivePracticeFeedbackContext(slowOnly),'practiceFocus'),false);
  const unknown=fixture({short:true,missing:true});
  assert.equal(Object.hasOwn(unknown.context,'practiceFocus'),false);
  checks.push('Coordination advice requires measured hold drift with an observed other-part movement; range advice requires trusted incomplete hand travel, never slow or unknown movement alone.');
}

{
  const review={status:'mismatch',passed:false,percent:null,issues:[{index:33,code:'too_slow'},
    {index:34,code:'too_slow'},{index:34,code:'off_guide'}],limbs:[]};
  const context={version:'practice-feedback-context-v1',limbs:[{index:33,expectedDirection:'up'},
    {index:34,expectedDirection:'up',observedDirection:'right'}]};
  const result=descriptivePracticeFeedback(review,context);
  assert.equal(result.messages.length,2);assert.match(result.messages[0],/^Both hands moved too slowly on the way up/);
  assert.match(result.messages[1],/right hand.*drifted sideways/);
  assert.deepEqual(result.issues,review.issues);assert.equal(result.passed,false);
  assert.ok(result.messages.join(' ').split(/\s+/).length<=75);
  const generic=descriptivePracticeFeedback(review);
  assert.doesNotMatch(generic.messages.join(' '),/upward|sideways|on the way up/);
  checks.push('Both slow hands share one main idea while a supported right-hand direction error gets separate context; no direction is invented without reference annotations.');
}

{
  const curve=fixture(),control=curve.session.controls.find(control=>control.index===33);
  control.points=[control.start,{x:control.start.x,y:-1},{x:control.start.x,y:.6},control.end];
  const curved=derivePracticeFeedbackContext(curve);
  assert.equal(curved.limbs.find(limb=>limb.index===33).expectedDirection,'mixed');
  const unavailable=derivePracticeFeedbackContext({...curve,reference:{...curve.reference,referenceUsable:false}});
  assert.deepEqual(unavailable,{version:'practice-feedback-context-v1',limbs:[]});
  const noSource=derivePracticeFeedbackContext({...curve,pathReference:{...curve.pathReference,referenceUsable:false}});
  assert.deepEqual(noSource,{version:'practice-feedback-context-v1',limbs:[]});
  checks.push('Material route reversals retain a mixed description, and unavailable teacher reference or paths provide no invented context.');
}

{
  const dense={status:'unknown',issues:[33,34,35,36].flatMap(index=>[
    {index,code:'tracking_unknown'},{index,code:'off_guide'},{index,code:'too_slow'}]),limbs:[]};
  const result=descriptivePracticeFeedback(dense);
  assert.deepEqual(result.issues,dense.issues);assert.ok(result.messages.join(' ').split(/\s+/).length<=200);
  assert.doesNotMatch(result.messages.join(' '),/moved too slowly|drifted sideways/);
  checks.push('Dense uncertainty stays bounded and does not promote an unclear limb to a measured movement diagnosis.');
}

console.log(JSON.stringify({checks:checks.length,provenance:'Actual archived teacher guide geometry plus labelled constructed raw learner observations. No live camera, audio, USB hardware or paid AI.',
  archivedDirections:archived.map((context,index)=>({step:lesson.steps[index].id,limbs:context.limbs})),details:checks},null,2));
