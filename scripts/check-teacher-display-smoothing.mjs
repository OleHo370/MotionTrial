/**
 * Teacher display integration regression: actual page function bodies and
 * genuine saved MediaPipe observations and explicitly reviewed illustration
 * annotations run against a MOCK video/canvas DOM.
 * No live inference, physical webcam, or human tracking acceptance is claimed.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createDisplaySmoother} from '../public/practice-display-smoothing.js';
import {prepareTeacherDisplayGuides,getTeacherDisplayPoints} from '../public/teacher-point-display.js';
import {withPracticeCenters,CENTER_INDICES,CENTER_COLORS} from '../public/practice-centers.js';
import {visible} from '../public/first-three-reference.js';

const root=new URL('../',import.meta.url),checks=[];
const page=await readFile(new URL('public/first-three.js',root),'utf8');
const archiveText=await readFile(new URL('public/practice-media/recut-six/master.poses.json',root),'utf8');
const archive=JSON.parse(archiveText);
const manifest=JSON.parse(await readFile(new URL('public/practice-media/recut-six/manifest.json',root),'utf8'));
const sourceInfo=manifest.sources[0];
const sha=value=>createHash('sha256').update(value).digest('hex');
function extract(name,next){
  const start=page.indexOf(`function ${name}(`),end=page.indexOf(`function ${next}(`,start);
  assert.ok(start>=0&&end>start,`Actual ${name} source exists`);
  return page.slice(start,end);
}
const declarations=page.match(/^let teacherDisplayVisibility=.*;\r?\nlet teacherDisplaySmoother=.*;$/m)?.[0];
const seekRegistration=page.match(/^video\.addEventListener\('seeking',.*$/m)?.[0];
assert.ok(declarations&&seekRegistration,'Actual smoother declarations and seek reset listener exist');
assert.match(page,/import \{createDisplaySmoother\} from '\.\/practice-display-smoothing\.js'/);
const functionSource=[declarations,extract('nearestSample','renderPosition'),extract('drawTeacher','drawGuides'),seekRegistration].join('\n');
const factory=new Function('dependencies',`
  const {state,video,$,recording,step,INDICES,FOUR_POINT_COLORS,createDisplaySmoother,visible,getTeacherDisplayPoints}=dependencies;
  ${functionSource}
  return {draw:drawTeacher};
`);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
const data=freeze({...archive,samples:archive.samples.map(withPracticeCenters)});
const dataBefore=JSON.stringify(data),trusted=p=>visible(p)&&p.visibility>=.45&&(p.presence===undefined||p.presence>=.45);
const good=data.samples.filter(s=>s.status==='pose'&&CENTER_INDICES.every(index=>trusted(s.landmarks.find(p=>p.index===index))));
const pair=good.map((sample,index)=>[sample,good[index+1]]).find(([a,b])=>b&&b.tMs-a.tMs>0&&b.tMs-a.tMs<=100
  &&CENTER_INDICES.some(index=>{
    const p=a.landmarks.find(p=>p.index===index),q=b.landmarks.find(p=>p.index===index);
    return Math.hypot(p.x-q.x,p.y-q.y)>.0001;
  }));
assert.ok(pair,'Genuine nearby teacher observations contain visible movement');
const [first,second]=pair;
function harness(){
  const listeners=new Map(),ctx={arcs:[],clears:0,clearRect(){this.arcs=[];this.clears++;},beginPath(){},arc(x,y,r){this.arcs.push({x,y,r});},fill(){},stroke(){},save(){},restore(){},setLineDash(){}};
  const canvas={width:450,height:360,getContext:()=>ctx};
  const legend={hidden:true,textContent:'',title:''};
  const video={currentTime:first.tMs/1000,videoWidth:450,videoHeight:360,playbackRate:.5,seeking:false,readyState:4,
    addEventListener(name,callback){listeners.set(name,callback);}};
  const state={data,loading:false,sourceId:sourceInfo.id,index:0,manifest:{...manifest,steps:manifest.steps.map(s=>({...s}))},lastDrawn:undefined,lastSample:null,drawnJoints:[],teacherPoints:[]};
  let recordingInfo={...sourceInfo};
  const controller=factory({state,video,$:id=>{assert.ok(['teacher-overlay','teacher-point-status'].includes(id));return id==='teacher-overlay'?canvas:legend;},recording:()=>recordingInfo,
    step:()=>state.manifest.steps[state.index],INDICES:CENTER_INDICES,FOUR_POINT_COLORS:CENTER_COLORS,createDisplaySmoother,visible,getTeacherDisplayPoints});
  return {state,video,canvas,ctx,legend,listeners,draw:controller.draw,setRecording:info=>{recordingInfo=info;},getRecording:()=>recordingInfo,
    at(sample,force=false){video.currentTime=sample.tMs/1000;controller.draw(force);return ctx.arcs.map(p=>({...p}));}};
}
const assertShown=(h,expected)=>{
  const points=getTeacherDisplayPoints(expected,h.getRecording().displayGuides,{indices:CENTER_INDICES,observedThreshold:.45,reliableThreshold:.65});
  assert.deepEqual(h.state.drawnJoints,points.map(p=>p.index));assert.deepEqual(h.state.teacherPoints,points);
  let arcIndex=0;
  points.forEach(p=>{
    const radii=[5];
    for(const radius of radii){
      const arc=h.ctx.arcs[arcIndex++];assert.ok(arc);
      assert.ok(Math.abs(arc.x-p.x*h.canvas.width)<1e-9);assert.ok(Math.abs(arc.y-p.y*h.canvas.height)<1e-9);assert.equal(arc.r,radius);
    }
  });
  assert.equal(h.ctx.arcs.length,arcIndex);
  assert.equal(h.legend.hidden,!points.some(p=>p.appearance!=='observed'));
};
const assertRawShown=(h,sample)=>assertShown(h,sample);

{
  const h=harness(),expected=createDisplaySmoother({indices:CENTER_INDICES,minimumVisibility:.45});
  for(const sample of [first,second]){
    h.at(sample);
    const shown=expected.update(sample,{aspect:1.25,contextKey:`${sourceInfo.id}:0:0.5`,timestampMs:sample.tMs/.5});
    assertShown(h,shown);assert.equal(h.state.lastSample,sample,'Page diagnostics retain exact raw sample identity');
  }
  assert.ok(h.state.teacherPoints.some(p=>{
    const raw=second.landmarks.find(q=>q.index===p.index);
    return Math.abs(p.x-raw.x)>1e-6||Math.abs(p.y-raw.y)>1e-6;
  }),'The actual teacher renderer smooths visible saved motion');
  const drawn=structuredClone(h.ctx.arcs),clears=h.ctx.clears;
  for(let i=0;i<20;i++)h.draw();
  assert.equal(h.ctx.clears,clears,'Repeated ordinary render skips the same observation');
  for(let i=0;i<20;i++)h.draw(true);
  assert.deepEqual(h.ctx.arcs,drawn,'Forced same-timestamp redraws do not advance smoothing');
  checks.push('Actual drawTeacher renders genuine saved observations through the display filter; repeated and forced redraws do not advance it, and diagnostic lastSample retains the exact raw object.');
}

{
  const h=harness(),expected=createDisplaySmoother({indices:CENTER_INDICES,minimumVisibility:.45});
  const replay=data.samples.filter(s=>s.tMs>=first.tMs&&s.tMs<=first.tMs+2500);
  for(const sample of replay){
    h.at(sample);
    assertShown(h,expected.update(sample,{aspect:1.25,contextKey:`${sourceInfo.id}:0:0.5`,timestampMs:sample.tMs/.5}));
  }
  checks.push(`Replayed ${replay.length} genuine saved teacher samples through actual nearestSample/drawTeacher; rendered positions match the filter at playback-scaled timestamps, accepting the lesson's 0.45+ centers and marking lower-confidence points as approximate.`);
}

{
  const resetCases=[
    ['earlier source time',h=>h.at(first,true),first],
    ['a different step',h=>{h.state.index=1;h.at(second,true);},second],
    ['a different source identity',h=>{h.state.sourceId='same-saved-recording-new-display-context';h.state.manifest.steps[0].sourceId=h.state.sourceId;h.at(second,true);},second],
    ['changed playback speed',h=>{h.video.playbackRate=.75;h.at(second,true);},second],
    ['changed display aspect',h=>{h.video.videoWidth=360;h.at(second,true);},second],
  ];
  for(const [label,change,sample]of resetCases){
    const h=harness();h.at(first);h.at(second);change(h);assertRawShown(h,sample);
  }
  const later=good.find(s=>s.tMs>second.tMs+301);
  assert.ok(later);const h=harness();h.at(first);h.at(second);h.at(later);assertRawShown(h,later);
  checks.push('Reversing teacher time, changing step/source identity, playback speed or display aspect, and a long observation gap each reset display history to the next actual saved observation.');
}

{
  const h=harness();h.at(first);h.at(second);
  h.video.seeking=true;h.listeners.get('seeking')();
  assert.equal(h.ctx.arcs.length,0);assert.equal(h.state.lastSample,null);assert.deepEqual(h.state.drawnJoints,[]);
  h.video.seeking=false;h.at(second);assertRawShown(h,second);
  h.at(first);h.at(second);h.state.loading=true;h.draw(true);
  assert.equal(h.ctx.arcs.length,0);assert.equal(h.state.lastSample,null);
  h.state.loading=false;h.at(second);assertRawShown(h,second);
  const noPose=data.samples.find(s=>s.status!=='pose');assert.ok(noPose,'Saved archive explicitly marks unknown title frames');
  h.at(noPose,true);assert.equal(h.ctx.arcs.length,0);assert.equal(h.state.lastSample,noPose);
  h.at(first);assertRawShown(h,first);
  checks.push('The actual seeking listener clears teacher dots immediately; seek completion, loading recovery and a saved no-pose frame reset history without filling missing observations.');
}

{
  const partial=data.samples.find(s=>s.status==='pose'&&s.landmarks.some(p=>CENTER_INDICES.includes(p.index)&&p.visibility>=.45&&p.visibility<.65));
  assert.ok(partial,'Genuine saved partial confidence is available');
  const h=harness();h.at(partial);assertRawShown(h,partial);
  const uncertain=partial.landmarks.filter(p=>CENTER_INDICES.includes(p.index)&&p.visibility>=.45&&p.visibility<.65);
  for(const point of uncertain){
    const shown=h.state.teacherPoints.find(p=>p.index===point.index);
    assert.equal(shown.appearance,'uncertain');assert.equal(shown.visibility,point.visibility);
  }
  assert.equal(h.legend.hidden,false);assert.match(h.legend.textContent,/Approximate/);
  checks.push('Genuine 0.45–0.65 teacher controls remain visible as solid dots with their unchanged confidence; the Approximate dots label makes their uncertainty explicit.');
}

{
  const annotations=JSON.parse(await readFile(new URL('public/practice-media/recut-six/teacher-display-guides.json',root),'utf8'));
  const prepared=prepareTeacherDisplayGuides(data,annotations),h=harness();
  h.setRecording({...sourceInfo,displayGuides:prepared});h.state.index=5;
  const samples=data.samples.filter(s=>s.sourceFrameIndex>=480&&s.sourceFrameIndex<=524);
  const evidence=freeze({sample:second,observedAtMs:1000,aspectRatio:1.25});h.state.observation=evidence;
  for(const sample of samples){
    h.at(sample);
    assert.equal(h.state.lastSample,sample);assert.equal(h.state.observation,evidence,'Teacher guides cannot replace learner scoring evidence');
    assert.deepEqual(h.state.drawnJoints,[33,34,35,36]);
    for(const index of [33,34]){
      const shown=h.state.teacherPoints.find(p=>p.index===index);
      assert.equal(shown.appearance,'guide');assert.equal(shown.displayOnly,true);assert.equal('visibility' in shown,false);assert.equal('presence' in shown,false);
      assert.ok(shown.supportInputPngSha256.every(value=>/^[a-f0-9]{64}$/.test(value)));
    }
    assert.equal(h.legend.hidden,false);
  }
  const last=samples.at(-1);
  assert.equal(last.landmarks.some(p=>p.index===33),false,'The genuine late left-hand observation remains missing');
  assert.equal(h.state.teacherPoints.find(p=>p.index===33).appearance,'guide');
  const firstKey=annotations.tracks.find(t=>t.index===33).keyframes[0];h.at(data.samples.find(s=>s.sourceFrameIndex===firstKey.sourceFrameIndex),true);
  const firstGuide=h.state.teacherPoints.find(p=>p.index===33);assert.equal(firstGuide.x,firstKey.x);assert.equal(firstGuide.y,firstKey.y);
  checks.push(`Actual teacher renderer displays all four dots through ${samples.length} late clip-6 source samples using explicitly reviewed hand guides; guides retain source-frame/hash provenance, have no fabricated confidence, leave missing raw centers absent, and never replace raw teacher or learner evidence.`);
}

assert.equal(JSON.stringify(data),dataBefore,'All frozen adapted source samples remain unchanged');
assert.equal(await readFile(new URL('public/practice-media/recut-six/master.poses.json',root),'utf8'),archiveText,'Recorded source file remains unchanged');
checks.push('The complete frozen adapted teacher observation collection and original recorded pose archive remain byte-for-byte unchanged.');
const report={passed:true,checkGroups:checks.length,checks,
  provenance:'Software integration regression only. Actual page nearestSample/drawTeacher/seeking code, genuine saved MediaPipe teacher observations and explicitly reviewed illustration annotations run against a MOCK video/canvas DOM. Reviewed/interpolated guides are not observed landmarks. No physical webcam, fresh live inference or human movement accuracy acceptance is claimed.',
  source:{archive:'public/practice-media/recut-six/master.poses.json',sha256:sha(archiveText),functionSourceSha256:sha(functionSource),firstFrame:first.sourceFrameIndex,secondFrame:second.sourceFrameIndex},
  limitations:['Actual displayed-video alignment and physical webcam stability still need user testing.']};
const destination=new URL('artifacts/display-smoothing-review/',root);await mkdir(destination,{recursive:true});
await writeFile(new URL('teacher-summary.json',destination),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
