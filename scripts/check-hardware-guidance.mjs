/**
 * Hardware feedback rule checks. All learner points here are CONSTRUCTED
 * software inputs, including those based on genuine teacher references.
 * They do not represent a live learner, circuit, Wi-Fi or buzzer acceptance.
 */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createHardwareGuidance,HARDWARE_GUIDANCE_RULES} from '../public/practice-hardware-guidance.js';
import {REVIEW_RULES} from '../public/practice-attempt-review.js';
import {prepareRecutLesson} from '../public/recut-six-reference.js';
import {prepareSixthAssessmentReference} from '../public/sixth-assessment-reference.js';
import {LESSON_CONTROLS} from '../public/first-three-controls.js';
import {withCenterFocus} from '../public/practice-centers.js';
import {preparePracticeTubes} from '../public/practice-tube.js';
import {createFullHeightLayout} from '../public/full-height-layout.js';

const checks=[],root=new URL('../',import.meta.url),indices=[33,34,35,36];
const frame={hip:{x:.625,y:.5},scale:.2,aspect:1.25};
const starts=[{x:-1,y:.3},{x:1,y:.3},{x:-.45,y:1.4},{x:.45,y:1.4}];
const ends=[{x:-1,y:-1.1},{x:1,y:-1.1},{x:-.45,y:1.45},{x:.45,y:1.4}];
const reference={id:'constructed-only',referenceUsable:true,guides:indices.map((index,i)=>({index,
  label:['Left hand','Right hand','Left foot','Right foot'][i],valid:true,start:starts[i],end:ends[i],
  ...(i===3?{targetGeometry:{mode:'hold'}}:{})}))};
const pathReference={referenceId:reference.id,referenceUsable:true,paths:[
  {index:33,available:true,points:[starts[0],{x:-2,y:-.5},ends[0]]},
  {index:34,available:true,points:[starts[1],ends[1]]},
]};
const clone=value=>structuredClone(value);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const project=(point,body=frame)=>({x:(point.x*body.scale+body.hip.x)/body.aspect,y:point.y*body.scale+body.hip.y});
function input(time,{points=starts,body=frame,modify=observation=>observation}={}){
  return modify({sample:{tMs:10000+time,status:'pose',landmarks:indices.map((index,i)=>({index,
    ...project(points[i],body),visibility:.95,presence:.96})),
    provenance:'CONSTRUCTED software input; not webcam inference'},aspectRatio:body.aspect,observedAtMs:10000+time});
}
function update(helper,time,options={}){
  return helper.update(options.reference??reference,options.pathReference??pathReference,
    options.observation===undefined?input(time,options):options.observation,options.body??frame,
    {nowMs:options.nowMs??10000+time,active:options.active??true,contextKey:options.contextKey??'attempt-1'});
}
function feed(helper,times,options){let state;for(const time of times)state=update(helper,time,options);return state;}
function check(name,test){test();checks.push({name,passed:true});console.log(`PASS: ${name}`);}
const offset=(i,x=0,y=0)=>starts.map((point,index)=>index===i?{x:point.x+x,y:point.y+y}:{...point});

check('Hardware radii, trust threshold and sample expiry reuse the existing reviewer rules',()=>{
  assert.equal(HARDWARE_GUIDANCE_RULES.visibilityThreshold,REVIEW_RULES.visibilityThreshold);
  assert.equal(HARDWARE_GUIDANCE_RULES.maximumAgeMs,REVIEW_RULES.maximumAgeMs);
  assert.equal(HARDWARE_GUIDANCE_RULES.warningRadius,REVIEW_RULES.broadGuideRadius);
  assert.equal(HARDWARE_GUIDANCE_RULES.recoveryRadius,REVIEW_RULES.endpointRadius);
});
check('Only fresh active four-point tracking establishes green after 200 ms',()=>{
  const helper=createHardwareGuidance();assert.equal(helper.getState().state,'idle');
  assert.equal(update(helper,0).state,'idle');assert.equal(update(helper,199).state,'idle');
  const state=update(helper,200);assert.equal(state.state,'good');assert.equal(state.limbs.length,4);
  assert.ok(state.limbs.every(limb=>limb.status==='inside'));
  assert.equal(update(helper,210,{active:false}).state,'idle');
  assert.equal(update(helper,220).state,'idle');
});
check('A curved route accepts its actual bend and rejects shortcutting through the endpoint chord',()=>{
  const helper=createHardwareGuidance(),curve=starts.map((point,i)=>i===0?{x:-2,y:-.5}:point);
  assert.equal(feed(helper,[0,100,200],{points:curve}).state,'good');
  const shortcut=starts.map((point,i)=>i===0?{x:-1,y:-.5}:point);
  const warning=feed(helper,[300,400,550],{points:shortcut});assert.equal(warning.state,'off');
  assert.ok(warning.limbs.find(limb=>limb.index===33).deviation>.42);
});
check('Each anatomical hand and foot can independently trigger red; opposite-side swaps do not match',()=>{
  for(let i=0;i<4;i++){
    const helper=createHardwareGuidance();
    const state=feed(helper,[0,100,250],{points:offset(i,.65,0)});assert.equal(state.state,'off',`Point ${indices[i]}`);
    assert.equal(state.limbs.find(limb=>limb.status==='outside')?.index,indices[i]);
  }
  const helper=createHardwareGuidance(),swapped=[starts[1],starts[0],starts[3],starts[2]];
  const state=feed(helper,[0,125,250],{points:swapped});assert.equal(state.state,'off');
  assert.ok(state.limbs.every(limb=>limb.status==='outside'));
});
check('Planted feet use their anchored start rather than a drifting end or misleading route',()=>{
  const ref=clone(reference),path=clone(pathReference);ref.guides[3].end={x:1.4,y:1.4};
  path.paths.push({index:36,available:true,points:[starts[3],ref.guides[3].end]});
  const helper=createHardwareGuidance();
  assert.equal(feed(helper,[0,100,200],{reference:ref,pathReference:path}).state,'good');
  const state=feed(helper,[300,400,550],{reference:ref,pathReference:path,points:offset(3,.65)});
  assert.equal(state.state,'off');assert.equal(state.limbs.find(limb=>limb.index===36).moving,false);
});
check('A short excursion produces neutral silence, a sustained one warns, and recovery uses hysteresis',()=>{
  const helper=createHardwareGuidance();assert.equal(feed(helper,[0,100,200]).state,'good');
  const outside=offset(3,.6),border=offset(3,.38),inside=offset(3,.30);
  assert.equal(update(helper,250,{points:outside}).state,'idle');
  assert.equal(update(helper,400,{points:outside}).state,'idle');
  assert.equal(update(helper,499,{points:outside}).state,'idle');
  assert.equal(update(helper,500,{points:outside}).state,'off');
  assert.equal(feed(helper,[600,700,800],{points:border}).state,'off');
  assert.equal(update(helper,900,{points:inside}).state,'off');
  assert.equal(update(helper,1099,{points:inside}).state,'off');
  assert.equal(update(helper,1100,{points:inside}).state,'good');
  assert.equal(update(helper,1200,{points:border}).state,'good');
});
check('Repeating one webcam frame never manufactures debounce and expires to idle',()=>{
  const helper=createHardwareGuidance(),same=input(0,{points:offset(2,.6)});
  for(const time of [0,100,250,400])assert.equal(update(helper,time,{observation:same}).state,'idle');
  assert.equal(update(helper,451,{observation:same}).state,'idle');
  const inside=input(500);
  for(const time of [500,600,700])assert.equal(update(helper,time,{observation:inside}).state,'idle');
  assert.equal(update(helper,750).state,'good');
});
check('Missing tracking immediately silences a warning and breaks consecutive support',()=>{
  const helper=createHardwareGuidance(),points=offset(0,.65);
  assert.equal(feed(helper,[0,100,250],{points}).state,'off');
  assert.equal(update(helper,300,{observation:null}).state,'idle');
  assert.equal(update(helper,400,{points}).state,'idle');
  assert.equal(update(helper,649,{points}).state,'idle');
  assert.equal(update(helper,650,{points}).state,'off');
  assert.equal(update(helper,1000,{points}).state,'idle','An observed gap over 300 ms starts new evidence');
  assert.equal(update(helper,1250,{points}).state,'off');
});
check('No-pose, partial, low-confidence, out-of-frame and duplicate-index observations are unknown',()=>{
  const modifications=[
    value=>({...value,sample:{...value.sample,status:'missing'}}),
    value=>({...value,sample:{...value.sample,landmarks:value.sample.landmarks.slice(1)}}),
    value=>{value.sample.landmarks[0].visibility=.449;return value;},
    value=>{value.sample.landmarks[1].presence=.449;return value;},
    value=>{value.sample.landmarks[2].x=-.01;return value;},
    value=>{value.sample.landmarks[2].y=1.01;return value;},
    value=>{value.sample.landmarks[0].x=NaN;return value;},
    value=>{value.sample.landmarks.push({...value.sample.landmarks[0]});return value;},
    value=>{value.sample.landmarks[0].visibility=1.1;return value;},
    value=>{value.sample.landmarks[1].presence=1.1;return value;},
  ];
  for(const modify of modifications){
    const helper=createHardwareGuidance();assert.equal(feed(helper,[0,100,200]).state,'good');
    assert.equal(update(helper,250,{observation:input(250,{modify})}).state,'idle');
  }
});
check('Future, stale, reversed and inconsistent frame timestamps never retain green or warning',()=>{
  for(const modify of [
    value=>({...value,observedAtMs:value.observedAtMs+1}),
    value=>({...value,observedAtMs:value.observedAtMs-451}),
    value=>({...value,observedAtMs:10001}),
    value=>({...value,sample:{...value.sample,tMs:10001}}),
  ]){
    const helper=createHardwareGuidance();assert.equal(feed(helper,[0,100,200]).state,'good');
    assert.equal(update(helper,250,{observation:input(250,{modify})}).state,'idle');
  }
  const helper=createHardwareGuidance();assert.equal(feed(helper,[0,100,200]).state,'good');
  const changed=input(200);changed.sample.landmarks[0].x+=.01;
  assert.equal(update(helper,210,{observation:changed}).state,'idle','Changed data cannot reuse an inference timestamp');
  assert.equal(update(helper,190).state,'idle','Reversed render clock is unknown');
});
check('Phase context, body frame, camera aspect and reference changes reset support',()=>{
  const helper=createHardwareGuidance();assert.equal(feed(helper,[0,100,200]).state,'good');
  assert.equal(update(helper,250,{contextKey:'attempt-2'}).state,'idle');
  assert.equal(feed(helper,[350,450],{contextKey:'attempt-2'}).state,'good');
  const body={...frame,scale:.21};assert.equal(update(helper,500,{contextKey:'attempt-2',body}).state,'idle');
  const changed=clone(reference);assert.equal(update(helper,600,{contextKey:'attempt-2',body,reference:changed}).state,'idle');
  assert.equal(update(helper,700,{contextKey:'attempt-2',body,reference:changed,
    observation:input(700,{body,modify:value=>({...value,aspectRatio:1.5})})}).state,'idle');
  const invalidFrames=[null,{...frame,scale:0},{...frame,aspect:-1},{...frame,hip:{x:-1,y:.5}},
    {...frame,hip:{x:.5,y:1.1}},{...frame,scale:100}];
  for(const invalid of invalidFrames)assert.equal(helper.update(reference,pathReference,input(800),invalid,
    {active:true,nowMs:10800,contextKey:'attempt-3'}).state,'idle');
});
check('Malformed or missing guides and routes never manufacture a hardware success',()=>{
  for(const mutate of [
    (ref,path)=>{ref.referenceUsable=false;},
    (ref,path)=>{ref.guides.pop();},
    (ref,path)=>{ref.guides[0].valid=false;},
    (ref,path)=>{ref.guides[0].index=34;},
    (ref,path)=>{path.referenceUsable=false;},
    (ref,path)=>{path.paths[0].available=false;},
    (ref,path)=>{path.paths[0].points=[];},
    (ref,path)=>{path.paths[0].points[0].x=NaN;},
    (ref,path)=>{path.paths.push(clone(path.paths[0]));},
    (ref,path)=>{path.referenceId='another-clip';},
  ]){
    const ref=clone(reference),path=clone(pathReference);mutate(ref,path);
    const helper=createHardwareGuidance();assert.equal(feed(helper,[0,100,200],{reference:ref,pathReference:path}).state,'idle');
  }
});
check('Mirroring is a display choice; raw anatomical coordinates work at landscape and portrait camera aspects',()=>{
  for(const aspect of [16/9,4/3,7/8]){
    const body={hip:{x:aspect/2,y:.5},scale:.18,aspect},helper=createHardwareGuidance();
    assert.equal(feed(helper,[0,100,200],{body}).state,'good');
    const mirrored=input(300,{body,modify:value=>{
      value.sample.landmarks=value.sample.landmarks.map(point=>({...point,x:1-point.x}));return value;}});
    // Passing display pixels instead of raw camera points cannot silently swap
    // left and right identities and report an acceptable anatomical movement.
    const state=feed(helper,[300,400,550],{body,observation:mirrored});
    assert.equal(state.state,'idle','A repeated mirrored snapshot cannot accrue evidence');
    const fresh=feed(helper,[600,700,850],{body,modify:value=>{
      value.sample.landmarks=value.sample.landmarks.map(point=>({...point,x:1-point.x}));return value;}});
    assert.equal(fresh.state,'off');
  }
});
check('Snapshots cannot alter the helper state and every reference and raw input remains unchanged',()=>{
  const helper=createHardwareGuidance(),observation=input(0),before=sha([reference,pathReference,frame,observation]);
  update(helper,0,{observation});const result=helper.getState();result.state='good';result.limbs[0].deviation=100;
  assert.equal(helper.getState().state,'idle');assert.notEqual(helper.getState().limbs[0].deviation,100);
  assert.equal(sha([reference,pathReference,frame,observation]),before);
  const changed=clone(reference),path=clone(pathReference),other=createHardwareGuidance();
  assert.equal(feed(other,[0,100,200],{reference:changed,pathReference:path}).state,'good');
  changed.guides[0].start.x-=.1;
  assert.equal(update(other,250,{reference:changed,pathReference:path}).state,'idle','In-place guideline changes reset the debounce');
});

const archivePath=new URL('public/practice-media/recut-six/master.poses.json',root);
const archiveText=await readFile(archivePath,'utf8'),raw=JSON.parse(archiveText);
const manifest=JSON.parse(await readFile(new URL('public/practice-media/recut-six/manifest.json',root),'utf8'));
const spec=JSON.parse(await readFile(new URL('public/practice-media/recut-six/clip-06-assessment-targets.json',root),'utf8'));
const source={...manifest.sources[0],data:LESSON_CONTROLS.referenceAdapter(raw)},sources=new Map([[source.id,source]]);
const lesson=prepareRecutLesson({...manifest,steps:manifest.steps.map(withCenterFocus)},sources,LESSON_CONTROLS.referenceOptions);
const sixth=prepareSixthAssessmentReference(lesson,source,spec);
const refs=[...lesson.guidanceReferences.slice(0,5),sixth.guidanceReference];
const paths=[...refs.slice(0,5).map((ref,i)=>preparePracticeTubes(ref,lesson.steps[i],sources)),sixth.pathReference];
const realMetrics=[];
check('All six real lesson contracts accept constructed route traces and preserve original archive bytes',()=>{
  const before=sha([refs,paths,raw]);
  for(let clip=0;clip<6;clip++)for(const aspect of [4/3,7/8]){
    const ref=refs[clip],path=paths[clip],body=createFullHeightLayout(ref,refs,aspect,paths)?.frame;
    assert.ok(body);const helper=createHardwareGuidance();let accepted=0,total=0;
    for(let tick=0;tick<=20;tick++){
      const phase=tick/20,points=ref.guides.map(guide=>{
        const moving=guide.targetGeometry?.mode!=='hold'&&Math.hypot(guide.end.x-guide.start.x,guide.end.y-guide.start.y)
          >=(guide.index>=35?REVIEW_RULES.minimumFootDisplacement:REVIEW_RULES.minimumHandDisplacement);
        if(!moving)return guide.start;
        const route=path.paths.find(p=>p.index===guide.index)?.points;assert.ok(route?.length>=2);
        const at=phase*(route.length-1),a=route[Math.floor(at)],b=route[Math.min(route.length-1,Math.floor(at)+1)],t=at-Math.floor(at);
        return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      });
      const observation=input(tick*100,{points,body});
      const state=helper.update(ref,path,observation,body,{nowMs:10000+tick*100,active:true,contextKey:ref.id});
      if(tick>=2){total++;if(state.state==='good')accepted++;assert.equal(state.state,'good',`Clip ${clip+1} at ${aspect}, tick ${tick}: ${state.reason}`);}
    }
    realMetrics.push({clip:clip+1,aspect,accepted,total,referenceEvidenceKind:ref.assessmentEvidenceKind??'recorded-teacher-observations'});
  }
  assert.equal(sha([refs,paths,raw]),before);
});
assert.equal(await readFile(archivePath,'utf8'),archiveText,'The original archive file remains byte-identical');

await mkdir(new URL('artifacts/arduino-feedback-review/',root),{recursive:true});
await writeFile(new URL('artifacts/arduino-feedback-review/guidance-summary.json',root),JSON.stringify({result:'PASS',
  version:HARDWARE_GUIDANCE_RULES.version,groups:checks.length,checks,realMetrics,
  sourceArchiveSha256:createHash('sha256').update(archiveText).digest('hex'),
  provenance:'All learner samples are CONSTRUCTED software inputs. Real archived MediaPipe teacher references and separately authored sixth-clip teaching targets are used unchanged. No physical webcam, board, network, LED or buzzer acceptance is claimed.',
  limitations:['Human practice and physical circuit behaviour still need live acceptance.']},null,2)+'\n');
console.log(`${checks.length} hardware-guidance groups passed.`);
