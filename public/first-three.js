import {createFollowCamera} from './first-three-center-camera.js';
import {projectFourPointGuides} from './four-point-game-runtime.js';
import {visible} from './first-three-reference.js';
import {prepareRecutLesson} from './recut-six-reference.js';
import {withCenterFocus} from './practice-centers.js';
import {LESSON_CONTROLS} from './first-three-controls.js';
import {prepareStartPosition,createStartPositionSession,evaluateStartPosition} from './start-position.js';
import {preparePracticeTubes,projectPracticeTubes,TUBE_RULES} from './practice-tube.js';
import {drawPracticeTubes} from './practice-tube-drawing.js';
import {projectPracticeGuideGeometry} from './practice-guide-geometry.js';
import {finishTriangleSize} from './first-three-attempt.js';
import {createAttemptReview,observeAttemptReview,finalizeAttemptReview,REVIEW_RULES} from './practice-attempt-review.js';
import {getLiveTargetHighlights} from './practice-target-highlight.js';
import {createDisplaySmoother} from './practice-display-smoothing.js';
import {prepareTeacherDisplayGuides,getTeacherDisplayPoints} from './teacher-point-display.js';
import {prepareSixthAssessmentReference} from './sixth-assessment-reference.js';
import {createFeedbackSpeech} from './practice-feedback-speech.js';
import {attachArduinoFeedback} from './arduino-feedback-ui.js';
import {FULL_HEIGHT_LAYOUT_RULES as TARGET_LAYOUT,cameraViewportBounds,createFullHeightLayout} from './full-height-layout.js';
import {UPPER_BODY_LAYOUT_RULES,createUpperBodyLayout} from './upper-body-layout.js';

const $=id=>document.getElementById(id),video=$('teacher-video');
const feedbackSpeech=createFeedbackSpeech({enabled:$('spoken-feedback').checked,onState(status){
  $('spoken-feedback').disabled=!status.supported;
  $('spoken-feedback').checked=status.enabled;
  $('speech-status').textContent=status.message;
}});
const {indices:INDICES,colors:FOUR_POINT_COLORS,version:CONTROL_POINT_VERSION,startRules:START_POSITION_RULES,countWord:POINT_COUNT}=LESSON_CONTROLS;
let teacherDisplayVisibility=.45;
let teacherDisplaySmoother=createDisplaySmoother({indices:INDICES,minimumVisibility:teacherDisplayVisibility});
// The commented eight-point profile can restore readiness without extra UI code.
function configureControlUI(indices=INDICES){
  const count=indices.length===2?'two':POINT_COUNT;
  $('position-points').replaceChildren(...indices.map(index=>{
    const chip=document.createElement('div');chip.className='position-point';chip.dataset.joint=String(index);chip.dataset.status='unknown';
    chip.style.setProperty('--point-color',FOUR_POINT_COLORS[index]);
    const name=document.createElement('span');name.className='point-name';name.textContent=LESSON_CONTROLS.names[index];
    const status=document.createElement('span');status.className='point-state';status.textContent='Waiting';chip.append(name,status);return chip;
  }));
  document.querySelector('.lesson-hint').textContent=`Watch once, find the ${count} squares, then imitate the full clip. Arrows suggest the movement. Feedback comes afterwards; a close-enough attempt advances automatically.`;
  document.querySelector('[data-stage="positioning"] .stage-detail').textContent=indices.length===2?'Hold both starts for 1.5 s':`Hold all ${count} starts for 1.5 s`;
  document.querySelector('.position-hold span').textContent=indices.length===2?'Both starts held together':`All ${count} starts held together`;
  const key=document.querySelector('.point-key');key.textContent=`${indices.length} points`;key.setAttribute('aria-label',indices.length===2?'Two estimated palm centers':LESSON_CONTROLS.description);
}
configureControlUI();
const visibilityTest=new URLSearchParams(location.search).get('view')!=='standard';
document.documentElement.classList.toggle('visibility-test',visibilityTest);
const RULES={feedbackMs:3000,graceMs:1000,maximumAgeMs:450};
const state={manifest:null,data:null,sources:new Map(),sourceId:null,loading:false,refs:[],guidanceRefs:[],pathRefs:[],projectedPaths:[],index:0,ready:false,active:false,phase:'loading',paused:false,deadline:null,remainingMs:0,
  operation:0,round:0,awaitingCamera:false,camera:null,observation:null,observationRevision:0,feedback:null,session:null,results:new Map(),speed:.5,
  drawnJoints:[],teacherPoints:[],guideJoints:[],squareJoints:[],triangleJoints:[],projectedStarts:[],projectedEnds:[],preview:false,visualOnly:false,placement:null,positioning:null,fixedFrame:null,movement:null,positionNotice:null,
  cameraRunning:false,completionNotice:null,screenLayout:null,teacherFreezePending:false,teacherBoundaryAtMs:null,teacherIntro:false,
  watched:false,watchPurpose:null,attemptStartedAtMs:null,attemptInterrupted:null,attemptCameraGeneration:null,
  reviewAction:null,pausePhase:null,stepSixMode:'full-body',trails:new Map(INDICES.map(i=>[i,[]])),lastDrawn:undefined,lastSample:null};
const step=()=>state.manifest?.steps[state.index],reference=()=>state.refs[state.index];
const guidance=()=>state.guidanceRefs[state.index];
const pathReference=()=>state.pathRefs[state.index];
const total=()=>state.manifest?.steps.length||6;
const practiceStart=()=>step()?.practiceStartSeconds??step()?.startSeconds;
const recording=()=>state.sources.get(step()?.sourceId);
function practiceMode(){return state.index===5&&state.stepSixMode==='arms-only'?'arms-only':'full-body';}
function activeControlIndices(){return practiceMode()==='arms-only'?[33,34]:INDICES;}
function controlOptions(){return practiceMode()==='arms-only'?{controlIndices:activeControlIndices()}:{};}
function controlCount(){return practiceMode()==='arms-only'?'two':POINT_COUNT;}
function syncPracticeModeUI(){
  document.documentElement.classList.toggle('arms-only',practiceMode()==='arms-only');
  configureControlUI(activeControlIndices());fitPortraitCamera();
  $('practice-mode-controls').hidden=state.index!==5;
  for(const [id,mode]of [['practice-full-body','full-body'],['practice-arms-only','arms-only']]){
    $(id).setAttribute('aria-pressed',String(practiceMode()===mode));
  }
  put('practice-framing',practiceMode()==='arms-only'
    ?'Head at the top · waist at the bottom · both palms tracked'
    :'Head near the top · feet near the bottom · palms and feet tracked');
  put('camera-framing',practiceMode()==='arms-only'?'Head at the top, waist at the bottom.':'Head near the top, feet near the bottom.');
  put('hardware-controls-scope',practiceMode()==='arms-only'?'both palms':'all four points');
  put('practice-feedback-scope',practiceMode()==='arms-only'?'Step 6 receives arms-only feedback for both palms.':'All six clips receive four-point practice feedback.');
  put('practice-framing-help',practiceMode()==='arms-only'
    ?'Frame your head at the top and waist at the bottom of the preview. Step 6 palm targets use this head-to-waist height with the same proportions in both directions.'
    :'Stand with your head near the top and feet near the bottom of the preview. Target spacing uses this full standing height across all steps.');
}
function selectPracticeMode(mode){
  if(!state.ready||state.index!==5||state.loading||state.awaitingCamera||!['arms-only','full-body'].includes(mode)||mode===practiceMode())return;
  ++state.operation;video.pause();state.stepSixMode=mode;state.observation=null;state.paused=false;
  state.results.delete(step().id);state.lastDrawn=undefined;teacherDisplaySmoother.reset();
  $('completion').hidden=true;state.completionNotice=null;clearEvidence();syncPracticeModeUI();drawTeacher(true);
  // Changing framing always discards the previous hold and attempt evidence.
  state.active=!!state.camera?.getState().running;
  if(state.active){if(state.watched)void returnToStart();else void watchDemonstration('lesson');}
  else waitAtStart();
  drawGuides();render();
}
const hardwareFeedback=attachArduinoFeedback({getContext:()=>({
  reference:guidance(),pathReference:pathReference(),observation:state.observation,frame:state.fixedFrame,
  ...controlOptions(),
  active:state.active&&!state.paused&&['demonstrating','grace'].includes(state.phase)
    &&!!state.camera?.getState().running&&!state.attemptInterrupted,
  contextKey:`${state.operation}:${state.index}:${state.camera?.getState().generation??0}`,
})});
const put=(id,text)=>{if($(id).textContent!==text)$(id).textContent=text;};
const displayReason=result=>result?.messages?.join(' ')||result?.reason;
function clearEvidence(){feedbackSpeech.cancel();hardwareFeedback.neutral();state.placement=createStartPositionSession(guidance(),controlOptions());state.positioning=null;state.fixedFrame=null;state.movement=null;state.feedback=null;state.screenLayout=null;state.teacherFreezePending=false;state.teacherBoundaryAtMs=null;state.teacherIntro=false;state.attemptStartedAtMs=null;state.attemptInterrupted=null;state.attemptCameraGeneration=null;state.reviewAction=null;for(const i of INDICES)state.trails.set(i,[]);seedScreenTargets();}
function cameraFeedAvailable(){const v=$('camera-video');return !!v.srcObject&&v.videoWidth>0&&v.videoHeight>0;}
function screenGuides(frame){return projectFourPointGuides(guidance(),null,frame.aspect,frame);}
function screenPaths(frame,session){return projectPracticeTubes(pathReference(),frame,session);}
function seedScreenTargets(aspect=$('camera-video').videoWidth/$('camera-video').videoHeight){
  if(!state.active||state.loading||!guidance()||!state.placement||state.fixedFrame||!cameraFeedAvailable()||!Number.isFinite(aspect)||aspect<=0)return;
  if(state.placement.bodyFrame&&state.placement.aspect===aspect)return;
  const layout=(practiceMode()==='arms-only'?createUpperBodyLayout:createFullHeightLayout)(guidance(),state.guidanceRefs,aspect,state.pathRefs);if(!layout)return;
  state.placement=createStartPositionSession(guidance(),controlOptions());state.positioning=null;
  state.placement.bodyFrame=layout.frame;state.placement.aspect=aspect;state.screenLayout=layout;
}
function phase(name,duration=0){if(name!=='feedback')feedbackSpeech.cancel();state.phase=name;state.remainingMs=duration;state.deadline=duration&&!state.paused?performance.now()+duration:null;hardwareFeedback.update();render();}
function controls(){
  for(const id of ['practice-full-body','practice-arms-only'])$(id).disabled=!state.ready||state.loading||state.awaitingCamera||state.phase==='preparing';
  $('start-practice').disabled=!state.ready||state.awaitingCamera||state.loading;
  $('start-practice').hidden=!!state.camera?.getState().running&&state.active;
  $('start-practice').textContent=state.phase==='finished'?'Practice again':'Start practice';
  $('practice-toggle').disabled=!state.active||['loading','preparing','camera','finished','stopped'].includes(state.phase);
  $('practice-toggle').textContent=state.paused?'Resume':'Pause';
  $('practice-toggle').setAttribute('aria-pressed',String(state.paused));
  $('end-practice').disabled=!state.active&&!state.camera?.getState().running&&!state.awaitingCamera;
  for(const id of ['replay','next','previous','speed'])$(id).disabled=!state.ready;
  $('next').disabled=!state.ready||state.phase==='finished';
  $('previous').disabled=!state.ready||state.index===0;
  $('replay').textContent=state.camera?.getState().running?(state.watched?'Restart at squares':'Watch again'):'Watch demo';
}
function render(){
  controls();$('teacher-source').style.visibility=state.loading?'hidden':'visible';
  put('step-count',`${state.index+1} / ${total()}`);put('step-title',step()?.title||'Preparing the movement');
  const labels={loading:'Loading teacher…',preparing:'Preparing the clip…',camera:'Starting camera…',watching:'Watch the teacher once',positioning:`Find the ${controlCount()} starting squares`,demonstrating:'Your turn · follow the full clip',grace:'Finish your movement',feedback:'Movement review',finished:'Practice finished',stopped:'Session ended'};
  put('status',state.paused?'Paused':labels[state.phase]||'Ready');
  let result={status:'collecting',reason:'Follow the teacher. Feedback comes after the clip.'};
  if(state.phase==='feedback')result=state.feedback||{status:'unknown',reason:`Keep all ${controlCount()} points visible and try again.`};
  else if(state.paused)result={status:'collecting',reason:'Paused. Resume when ready.'};
  else if(state.phase==='watching')result={status:'collecting',reason:'Watch the teacher once. You will imitate on the second playback.'};
  else if(state.phase==='positioning')result={status:'collecting',reason:state.positioning?.reason||state.positionNotice||'Find the starting squares. The teacher waits for you.'};
  else if(!state.camera?.getState().running)result={status:'collecting',reason:'Choose Start practice to watch once, then imitate.'};
  put('feedback-state',({match:'Close enough',mismatch:'Try again',unknown:'Tracking unclear',collecting:'Practice'})[result.status]||'Practice');
  $('feedback-state').dataset.state=result.status;put('feedback-message',displayReason(result));
  renderPosition();renderFlowStatus();renderProgress();
  put('teacher-tracking-note',`${activeControlIndices().length} tutorial points · includes approximate guides`);
  const overlay=$('practice-overlay');overlay.hidden=!state.active||state.paused||state.phase!=='feedback';overlay.dataset.mode='feedback';
  const speaking=state.phase==='feedback'&&feedbackSpeech.isBusy()&&state.remainingMs<=0;overlay.dataset.speaking=String(speaking);
  if(!overlay.hidden){
    const passed=state.feedback?.status==='match';
    put('overlay-title',passed?'Good enough · well done':state.feedback?.status==='unknown'?'Tracking unclear · try again':'Try this movement again');
    put('overlay-value',speaking?'Speaking…':`${Math.max(1,Math.ceil(state.remainingMs/1000))} s`);
    put('overlay-reason',`${displayReason(state.feedback)||`Keep all ${controlCount()} points visible and try again.`} ${passed?'Next clip follows automatically.':'Return to the starting squares for another try.'}`);
  }
  for(const button of $('step-list').querySelectorAll('button')){
    button.setAttribute('aria-current',Number(button.dataset.index)===state.index?'step':'false');
    button.dataset.result=state.results.get(state.manifest.steps[Number(button.dataset.index)].id)?.status||'';
  }
}
function renderProgress(){
  const duration=Math.max(.01,(step()?.teacherFreezeSeconds??0)-(practiceStart()??0));
  const playing=['watching','demonstrating','grace'].includes(state.phase);
  const percent=playing?Math.max(0,Math.min(100,(video.currentTime-practiceStart())/duration*100)):0;
  const label=state.phase==='watching'?'Watch once · clip timeline':state.phase==='demonstrating'?'Your turn · clip timeline':state.phase==='grace'?'Finish your movement':state.phase==='feedback'?'Review after the full clip':'Watch → set up → imitate → review';
  put('progress-label',label);put('flow-path-label',label);
  for(const id of ['progress-fill','flow-path-fill'])$(id).style.width=`${percent}%`;
  for(const id of ['progress-meter','flow-path-meter']){
    $(id).setAttribute('aria-valuenow',String(Math.round(percent)));
    $(id).setAttribute('aria-valuetext',`${Math.round(percent)} percent of clip playback; this is not a movement score`);
  }
}
function nearestSample(time){
  if(!state.data||state.loading||state.sourceId!==step()?.sourceId||video.seeking||video.readyState<2)return null;
  if(state.manifest?.schemaVersion==='recut-six-teaching-v1'){
    // The 15 Hz archive keeps actual frame IDs. Hold its latest observation
    // briefly on unsampled video frames, without showing a future cut pose or
    // generating intermediate landmarks. Every category cut has an exact entry.
    const frame=Math.min(recording().video.frameCount-1,Math.max(0,Math.floor(time*recording().video.fps+1e-4)));
    const samples=state.data.samples;let low=0,high=samples.length;
    while(low<high){const mid=(low+high)>>1;if(samples[mid].sourceFrameIndex<=frame)low=mid+1;else high=mid;}
    const sample=samples[low-1];
    return sample&&time*1000-sample.tMs<=100?sample:null;
  }
  const t=time*1000,samples=state.data.samples;
  let low=0,high=samples.length;while(low<high){const mid=(low+high)>>1;if(samples[mid].tMs<t)low=mid+1;else high=mid;}
  const a=samples[Math.max(0,low-1)],b=samples[Math.min(samples.length-1,low)];
  const sample=Math.abs(a.tMs-t)<=Math.abs(b.tMs-t)?a:b;
  return Math.abs(sample.tMs-t)<=100?sample:null;
}
function renderPosition(){
  const moving=['demonstrating','grace'].includes(state.phase);
  $('stage-strip').dataset.phase=state.phase==='watching'?'watching':moving?'moving':state.phase==='feedback'?'finishing':'positioning';
  const held=moving?1500:state.positioning?.heldMs||0;
  $('position-fill').style.width=`${Math.min(100,held/15)}%`;put('position-time',`${Math.min(1.5,held/1000).toFixed(1)} / 1.5 s`);
  put('position-message',state.phase==='watching'?'Watch first. Your turn comes next.':moving?'Imitate the teacher. Arrows are general guidance; feedback comes after the clip.':state.positionNotice||state.positioning?.reason||'Find your starting squares.');
  for(const chip of $('position-points').querySelectorAll('[data-joint]')){
    const limb=state.positioning?.limbs?.find(point=>point.index===Number(chip.dataset.joint));
    chip.dataset.status=moving?'waiting':limb?.near?'ready':'unknown';
    chip.querySelector('.point-state').textContent=state.phase==='watching'?'Watch only':moving?'Observing · review later':limb?.near?'In square':'Find square';
  }
}
function renderFlowStatus(){
  put('practice-current',`Step ${state.index+1} / ${total()} · ${step()?.title||'Loading teacher'}`);
  let text='Choose Start practice · watch first, then imitate',kind='working';
  if(!state.ready)text='Loading the lesson…';
  else if(state.paused)text='Paused · resume when ready';
  else if(state.phase==='finished'){text='Practice complete';kind='complete';}
  else if(state.phase==='stopped')text='Session ended · Start practice to begin';
  else if(state.phase==='camera')text='Starting camera…';
  else if(state.phase==='watching')text='Watch once · your turn comes next';
  else if(state.phase==='positioning')text=state.camera?.getState().running?(state.positioning?.allNear?'Hold the starting squares · 1.5 seconds':state.positionNotice||state.positioning?.reason||`Find the ${controlCount()} squares · teacher waits`):'Choose Start practice · watch first, then imitate';
  else if(state.phase==='demonstrating')text='Your turn · follow the full clip · feedback afterwards';
  else if(state.phase==='grace')text='Finish your movement · review follows';
  else if(state.phase==='feedback'){text=displayReason(state.feedback)||'Tracking unclear · try again';kind=state.feedback?.status==='match'?'complete':state.feedback?.status==='unknown'?'unknown':'working';}
  else if(state.phase==='preparing')text='Preparing this clip…';
  $('practice-flow').dataset.state=kind;put('practice-action',text);$('practice-action').title=text;
}
function drawTeacher(force=false){
  const sample=nearestSample(video.currentTime);if(sample===state.lastDrawn&&!force)return;
  state.lastDrawn=sample;state.lastSample=sample;state.drawnJoints=[];state.teacherPoints=[];
  const canvas=$('teacher-overlay'),ctx=canvas.getContext('2d');canvas.width=video.videoWidth||450;canvas.height=video.videoHeight||360;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // Drawing has its own minimum: .45+ same-frame centers remain visible with
  // uncertainty styling. Source/step assessment thresholds stay unchanged.
  const threshold=.45;
  if(threshold!==teacherDisplayVisibility){
    teacherDisplayVisibility=threshold;
    teacherDisplaySmoother=createDisplaySmoother({indices:INDICES,minimumVisibility:threshold});
  }
  // The source archive stays raw. Filter only this overlay's fresh samples,
  // using display time so slow playback does not double the perceived lag.
  const displaySample=teacherDisplaySmoother.update(sample,{
    aspect:canvas.width/canvas.height,
    contextKey:`${state.sourceId}:${state.index}:${video.playbackRate}`,
    timestampMs:sample?.tMs/(video.playbackRate||1),
  });
  const points=getTeacherDisplayPoints(displaySample,recording()?.displayGuides,{
    indices:activeControlIndices(),observedThreshold:threshold,reliableThreshold:recording()?.observationVisibilityThreshold??.65,
  });
  state.teacherPoints=points;
  const approximate=points.some(p=>p.appearance!=='observed');
  const pointStatus=$('teacher-point-status');
  pointStatus.hidden=!approximate;pointStatus.textContent=approximate?'Approximate dots':'';
  pointStatus.title='Some tutorial dots use lower-confidence detections or reviewed visual guides. Practice feedback compares fresh learner tracking with the lesson targets.';
  for(const p of points){
    const x=p.x*canvas.width,y=p.y*canvas.height;
    ctx.save();ctx.fillStyle=FOUR_POINT_COLORS[p.index];ctx.strokeStyle='#fff';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.restore();state.drawnJoints.push(p.index);
  }
}
function drawGuides(){
  const canvas=$('camera-guide-overlay'),cameraVideo=$('camera-video'),ctx=canvas.getContext('2d');
  canvas.width=cameraVideo.videoWidth||640;canvas.height=cameraVideo.videoHeight||360;
  canvas.style.transform=$('mirror-preview').checked?'scaleX(-1)':'none';state.guideJoints=[];state.squareJoints=[];state.triangleJoints=[];state.projectedStarts=[];state.projectedEnds=[];state.projectedPaths=[];
  if(state.loading||!state.active||!['positioning','demonstrating','grace'].includes(state.phase)||!$('learner-skeleton').checked||!guidance()||!cameraFeedAvailable())return;
  seedScreenTargets();
  const geometry=projectPracticeGuideGeometry(guidance(),pathReference(),state.placement,
    {...controlOptions(),fixedFrame:state.fixedFrame,movement:null});
  const fixed=geometry.frame;if(!fixed)return;
  const moving=!state.paused&&['demonstrating','grace'].includes(state.phase),positioning=!moving;
  const selected=activeControlIndices(),starts=geometry.starts.filter(target=>selected.includes(target.index));
  const inFrame=p=>p&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  const labels={33:'LH',34:'RH',35:'LF',36:'RF',13:'LE',14:'RE',25:'LK',26:'RK'},half=START_POSITION_RULES.radius*fixed.scale*canvas.height;
  function label(p,text,color,offset){const footOffset=text==='LF'?12:text==='RF'?-12:0;ctx.save();ctx.translate(Math.max(16,Math.min(canvas.width-16,p.x*canvas.width+footOffset)),Math.max(9,Math.min(canvas.height-9,p.y*canvas.height+offset)));if($('mirror-preview').checked)ctx.scale(-1,1);ctx.font='bold 12px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=3;ctx.strokeStyle='#102d28';ctx.strokeText(text,0,0);ctx.fillStyle=color;ctx.fillText(text,0,0);ctx.restore();}
  for(const target of starts){
    if(!target.valid||!inFrame(target.point))continue;
    const x=target.point.x*canvas.width,y=target.point.y*canvas.height,near=state.positioning?.limbs?.find(l=>l.index===target.index)?.near;
    ctx.globalAlpha=positioning?1:.3;ctx.lineWidth=positioning?(near?5:3):1.5;ctx.strokeStyle=target.color;ctx.fillStyle=near?`${target.color}55`:'#152d3160';
    if(positioning)ctx.fillRect(x-half,y-half,half*2,half*2);
    ctx.strokeRect(x-half,y-half,half*2,half*2);
    if(positioning)label(target.point,labels[target.index],target.color,-half-10);
    state.squareJoints.push(target.index);state.projectedStarts.push({index:target.index,point:{...target.point},near:!!near,halfSizePixels:half});
  }
  // Readiness has only the active start squares and the camera's live circles.
  if(!moving){ctx.globalAlpha=1;return;}
  const guides=geometry.ends.filter(guide=>selected.includes(guide.index)),routes=geometry.routes.filter(route=>selected.includes(route.index));state.projectedPaths=routes;
  // Stationary controls can have a small observed endpoint offset. Keep their
  // original square visible and connect the two actual centers, without
  // inventing a movement route or demanding motion from a hold.
  for(const guide of guides.filter(guide=>guide.valid&&!routes.some(route=>route.index===guide.index))){
    ctx.globalAlpha=.35;ctx.strokeStyle=guide.color;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(guide.start.x*canvas.width,guide.start.y*canvas.height);
    ctx.lineTo(guide.end.x*canvas.width,guide.end.y*canvas.height);ctx.stroke();
  }
  drawPracticeTubes(ctx,routes,fixed,canvas.width,canvas.height,{nowMs:performance.now(),guideline:true});
  // Triangle glow follows the visible dots. Readiness, timing and the final
  // review still consume state.observation's unmodified MediaPipe sample.
  const displayObservation=state.camera?.getState().running
    ?(typeof state.camera.getDisplayObservation==='function'?state.camera.getDisplayObservation():state.observation):null;
  const liveTargets=new Map(getLiveTargetHighlights(guidance(),displayObservation,
    fixed,{nowMs:performance.now()}).map(target=>[target.index,target]));
  for(const g of guides){
    if(!g.valid||!inFrame(g.end))continue;
    const reached=liveTargets.get(g.index)?.reached===true,x=g.end.x*canvas.width,y=g.end.y*canvas.height,size=finishTriangleSize(fixed,canvas.height,guidance(),g.index);
    ctx.globalAlpha=reached?1:.9;ctx.strokeStyle=g.color;ctx.lineWidth=reached?5:3;
    ctx.beginPath();ctx.moveTo(x,y-size);ctx.lineTo(x+size*.9,y+size*.65);ctx.lineTo(x-size*.9,y+size*.65);ctx.closePath();ctx.fillStyle=reached?g.color:'#152d31b8';ctx.fill();ctx.stroke();
    label(g.end,labels[g.index],g.color,size+10);
    state.triangleJoints.push(g.index);state.guideJoints.push(g.index);state.projectedEnds.push({index:g.index,point:{...g.end},reached:!!reached});
  }
  ctx.globalAlpha=1;
}
function observe(observation){
  state.observationRevision++;state.observation=observation;
  const now=performance.now();
  if(observation)seedScreenTargets(observation.aspectRatio);
  if(!state.active||state.paused){hardwareFeedback.update();drawGuides();render();return;}
  if(state.phase==='positioning'){
    state.positioning=evaluateStartPosition(guidance(),observation?.sample??null,{...controlOptions(),bodyFrame:state.screenLayout?.frame,attemptAspectRatio:observation?.aspectRatio||state.placement?.aspect||1,nowMs:now,observedAtMs:observation?.observedAtMs??now,session:state.placement});
    if(state.positioning.holdReady){state.fixedFrame=state.positioning.bodyFrame;void startAttempt();return;}
  }else if(['demonstrating','grace'].includes(state.phase)&&state.movement){
    observeAttemptReview(state.movement,observation,{nowMs:now,elapsedMs:Math.max(0,now-state.attemptStartedAtMs)});
  }
  // Watching and review phases never collect learner evidence or advance.
  hardwareFeedback.update();drawGuides();render();
}
function seek(time,token){
  return new Promise((resolve,reject)=>{
    if(Math.abs(video.currentTime-time)<.002&&!video.seeking){resolve(token===state.operation);return;}
    const done=()=>finish(),failed=()=>finish(new Error('The teacher recording could not seek.'));
    const timer=setTimeout(()=>finish(new Error('The teacher recording took too long to seek.')),5000);
    function finish(error){clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',failed);error?reject(error):resolve(token===state.operation);}
    video.addEventListener('seeked',done,{once:true});video.addEventListener('error',failed,{once:true});video.currentTime=time;
  });
}
function referenceAvailable(){
  return guidance()?.referenceUsable&&prepareStartPosition(guidance(),controlOptions()).usable&&pathReference()?.referenceUsable
    &&activeControlIndices().every(index=>guidance().guides.find(guide=>guide.index===index)?.valid);
}
async function watchDemonstration(purpose='lesson'){
  if(!state.ready||!state.active||state.paused)return;
  const token=++state.operation;video.pause();clearEvidence();state.watchPurpose=purpose;state.preview=purpose==='preview';
  state.visualOnly=false;phase('preparing');
  try{
    if(!await seek(practiceStart(),token)||token!==state.operation||!state.active||state.paused)return;
    video.playbackRate=state.speed;await video.play();
    if(token!==state.operation||!state.active||state.paused)return;phase('watching');
  }catch(error){if(token===state.operation){stop();$('load-error').hidden=false;$('load-error').textContent=error.message;}}
}
async function finishWatch(){
  if(state.teacherFreezePending||state.phase!=='watching')return;
  const token=state.operation,purpose=state.watchPurpose;state.teacherFreezePending=true;video.pause();
  try{
    if(!await seek(practiceStart(),token)||token!==state.operation||!state.active||state.paused)return;
    state.teacherFreezePending=false;drawTeacher(true);
    state.preview=false;state.watchPurpose=null;
    if(purpose==='preview'){state.active=false;waitAtStart('Watch complete. Start practice when ready.');return;}
    state.watched=true;waitAtStart();
  }catch(error){if(token===state.operation){stop();$('load-error').hidden=false;$('load-error').textContent=error.message;}}
  finally{if(token===state.operation)state.teacherFreezePending=false;}
}
async function startAttempt(){
  if(!state.watched||!state.active||state.paused||!state.fixedFrame||!state.camera?.getState().running)return;
  const token=++state.operation;video.pause();state.feedback=null;state.reviewAction=null;state.attemptInterrupted=null;phase('preparing');
  try{
    if(!await seek(practiceStart(),token)||token!==state.operation||!state.active||state.paused)return;
    video.playbackRate=state.speed;await video.play();
    if(token!==state.operation||!state.active||state.paused)return;
    if(!state.camera?.getState().running){void returnToStart('Camera is off. Start practice when ready.');return;}
    const now=performance.now();state.attemptStartedAtMs=now;
    state.attemptCameraGeneration=state.camera.getState().generation;
    state.movement=createAttemptReview(guidance(),pathReference(),{...controlOptions(),bodyFrame:state.fixedFrame,aspect:state.fixedFrame.aspect,
      startAtMs:now,durationMs:(step().teacherFreezeSeconds-practiceStart())*1000,playbackRate:state.speed});
    phase('demonstrating');
  }catch(error){if(token===state.operation){stop();$('load-error').hidden=false;$('load-error').textContent=error.message;}}
}
function holdTeacherAtBoundary(){
  if(state.teacherFreezePending||state.phase!=='demonstrating')return;
  const token=state.operation;state.teacherFreezePending=true;video.pause();
  void seek(step().teacherFreezeSeconds,token).then(current=>{
    if(!current||token!==state.operation||!state.active||state.paused)return;
    state.teacherBoundaryAtMs=performance.now();drawTeacher(true);phase('grace',RULES.graceMs);
  }).catch(error=>{if(token===state.operation){stop();$('load-error').hidden=false;$('load-error').textContent=error.message;}})
    .finally(()=>{if(token===state.operation)state.teacherFreezePending=false;});
}
function finishAttempt(){
  if(state.phase!=='grace'||!state.movement||!state.active||state.paused)return;
  const now=performance.now();
  let review=finalizeAttemptReview(state.movement,{nowMs:now,elapsedMs:Math.max(0,now-state.attemptStartedAtMs)});
  if(state.attemptInterrupted||!state.camera?.getState().running||state.camera.getState().generation!==state.attemptCameraGeneration){
    const reason=state.attemptInterrupted||'The camera changed or stopped during this attempt. Please try again.';
    review={...review,status:'unknown',passed:false,percent:null,messages:[reason],reason};
  }
  beginReview(review,review.status==='match'?'advance':'retry');
}
function beginReview(review,action){
  feedbackSpeech.cancel();state.feedback=review;state.reviewAction=action;video.pause();phase('feedback',RULES.feedbackMs);
  if(state.active&&!state.paused)feedbackSpeech.speakReview(review);
}
function completeFeedback(){
  if(state.phase!=='feedback'||!state.active||state.paused||feedbackSpeech.isBusy())return;
  if(!state.camera?.getState().running){void returnToStart('Camera is off. Start practice to continue.');return;}
  if(state.reviewAction==='advance'&&state.feedback?.status==='match'){recordAndAdvance('matched');return;}
  void returnToStart(`${displayReason(state.feedback)||'Try this movement again.'} Find the starting squares to retry.`);
}
function waitAtStart(reason=null){
  clearEvidence();state.preview=false;state.watchPurpose=null;state.positionNotice=reason||(!referenceAvailable()?'Practice targets could not load. Reload this clip to retry.':null);state.visualOnly=false;phase('positioning');
}
async function returnToStart(reason=null){
  if(!state.ready||!state.active)return;
  const token=++state.operation;video.pause();clearEvidence();phase('preparing');drawGuides();
  try{
    if(!await seek(practiceStart(),token)||token!==state.operation||!state.active||state.paused)return;
    drawTeacher(true);waitAtStart(reason);
  }catch(error){if(token===state.operation){stop();$('load-error').hidden=false;$('load-error').textContent=error.message;}}
}
async function choose(index,manual=false){
  if(!state.ready||index<0||index>=total())return false;
  if(manual&&!state.results.has(step().id))state.results.set(step().id,{stepId:step().id,status:'manual',practiceMode:practiceMode(),reason:'Manual navigation, not an observed match.'});
  const token=++state.operation;video.pause();state.index=index;state.lastDrawn=undefined;state.lastSample=null;state.observation=null;state.watched=false;state.round=0;
  state.active=!!state.camera?.getState().running;state.paused=false;state.preview=false;state.visualOnly=false;state.loading=true;clearEvidence();$('completion').hidden=true;$('load-error').hidden=true;phase('preparing');drawTeacher(true);drawGuides();
  for(const [id,key]of [['screenshot-start','start'],['screenshot-end','end']]){
    const image=$(id);image.src=step().screenshots[key];image.hidden=false;image.style.transform='scaleX(-1)';image.alt=`Original teacher ${key} frame, mirrored`;
    image.nextElementSibling.textContent=`Exact source frame · ${key==='start'?'start':'finish'}`;
  }
  try{
    if(!await loadRecording(token)||!await seek(practiceStart(),token)||token!==state.operation)return false;
    state.loading=false;syncPracticeModeUI();drawTeacher(true);waitAtStart();
    state.active=!!state.camera?.getState().running;
    if(state.active)void watchDemonstration('lesson');
    return true;
  }catch(error){if(token===state.operation){state.loading=false;stop();$('load-error').hidden=false;$('load-error').textContent=error.message;}return false;}
}
function recordAndAdvance(status){
  if(!state.active||!['matched','manual'].includes(status))return;
  state.results.set(step().id,{stepId:step().id,status,practiceMode:practiceMode(),review:state.feedback?structuredClone(state.feedback):null,
    reason:status==='matched'?(practiceMode()==='arms-only'?'Close-enough arms-only imitation observed over the complete clip.':'Close-enough imitation observed over the complete clip.'):'Manual navigation, not an observed match.'});
  if(state.index===total()-1)finish();else void choose(state.index+1,false);
}
function stop(){
  ++state.operation;state.active=false;state.loading=false;state.awaitingCamera=false;state.paused=false;state.preview=false;state.visualOnly=false;state.completionNotice=null;video.pause();state.observation=null;clearEvidence();phase('stopped');state.camera?.stop();drawGuides();render();
}
function finish(){
  stop();phase('finished');$('completion').hidden=false;
  const results=[...state.results.values()],matched=results.filter(r=>r.status==='matched').length,manual=results.filter(r=>r.status==='manual').length;
  put('completion-description',`${matched} / ${total()} movements completed with matching feedback. ${manual} manually continued. These are ${POINT_COUNT}-point practice targets, not Tai Chi correctness. Start practice to try again.`);
  if(results.some(result=>result.practiceMode==='arms-only'))put('completion-description',`${matched} / ${total()} movements completed with matching feedback. ${manual} manually continued. Step 6 was practiced arms-only; its feedback covers both palms. Start practice to try again.`);
}
function pause(){
  if(!state.active||['camera','preparing'].includes(state.phase))return;
  if(!state.paused){
    feedbackSpeech.cancel();
    state.pausePhase=state.phase;state.remainingMs=state.deadline===null?0:Math.max(0,state.deadline-performance.now());state.deadline=null;
    state.paused=true;++state.operation;video.pause();state.teacherFreezePending=false;
    if(state.phase!=='feedback')clearEvidence();
  }else{
    const resume=state.pausePhase;state.paused=false;
    if(resume==='feedback'){phase('feedback',Math.max(1,state.remainingMs));return;}
    if(resume==='watching'){void watchDemonstration(state.watchPurpose||'lesson');return;}
    void returnToStart('Find the squares to begin a fresh, uninterrupted attempt.');return;
  }
  render();
}
function tick(){
  const now=performance.now();
  if(state.observation&&now-state.observation.observedAtMs>RULES.maximumAgeMs){
    state.observation=null;
    if(state.active&&!state.paused&&['demonstrating','grace'].includes(state.phase)&&state.movement)
      observeAttemptReview(state.movement,null,{nowMs:now,elapsedMs:Math.max(0,now-state.attemptStartedAtMs)});
    else if(state.phase==='positioning'&&state.placement)
      state.positioning=evaluateStartPosition(guidance(),null,{...controlOptions(),bodyFrame:state.screenLayout?.frame,attemptAspectRatio:state.placement.aspect||1,nowMs:now,observedAtMs:now,session:state.placement});
  }
  if(state.active&&!state.paused){
    if(state.deadline!==null)state.remainingMs=Math.max(0,state.deadline-now);
    if(state.phase==='watching'&&!video.seeking&&(video.ended||video.currentTime>=step().teacherFreezeSeconds))void finishWatch();
    else if(state.phase==='demonstrating'&&!video.seeking&&(video.ended||video.currentTime>=step().teacherFreezeSeconds))holdTeacherAtBoundary();
    else if(state.phase==='grace'&&state.deadline!==null&&state.remainingMs===0)finishAttempt();
    else if(state.phase==='feedback'&&state.deadline!==null&&state.remainingMs===0)completeFeedback();
  }
  hardwareFeedback.update();drawTeacher();drawGuides();render();requestAnimationFrame(tick);
}
async function readJson(url){const response=await fetch(url);if(!response.ok)throw new Error(`Local reference unavailable: ${url}`);return response.json();}
function validateData(data,source){
  if(data.schemaVersion!=='first-three-recorded-pose-v1'||data.sourceSha256!==state.manifest.source.sha256||data.sourceClipSha256!==source.video.sha256||data.modelSha256!=='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'||data.width!==source.video.width||data.height!==source.video.height||!data.samples?.length||data.samples.some((s,i,a)=>!Number.isFinite(s.tMs)||s.tMs<0||i>0&&s.tMs<=a[i-1].tMs))throw new Error('Recorded observations do not match this video.');
  return data;
}
function frameRecording(source){
  const crop=source.displayCrop,stage=$('teacher-pixels'),plane=$('teacher-source'),aspect=source.video.width*crop.width/(source.video.height*crop.height);
  stage.style.aspectRatio=String(aspect);stage.style.width=`min(100%, ${52*aspect}dvh)`;stage.style.marginInline='auto';stage.style.transform='scaleX(-1)';
  plane.style.left=`${-100*crop.x/crop.width}%`;plane.style.top=`${-100*crop.y/crop.height}%`;plane.style.width=`${100/crop.width}%`;plane.style.height=`${100/crop.height}%`;
  fitVisibilityTeacher();
}
function fitVisibilityTeacher(){
  if(!visibilityTest||!recording())return;
  const source=recording(),crop=source.displayCrop,stage=$('teacher-pixels'),card=stage.parentElement;
  const aspect=source.video.width*crop.width/(source.video.height*crop.height),width=Math.min(card.clientWidth,card.clientHeight*aspect);
  stage.style.setProperty('--teacher-fit-width',`${width}px`);stage.style.setProperty('--teacher-fit-height',`${width/aspect}px`);
}
function fitPortraitCamera(){
  if(!visibilityTest)return;
  const aspect=practiceMode()==='arms-only'?UPPER_BODY_LAYOUT_RULES.aspect:TARGET_LAYOUT.aspect;
  const stage=$('camera-pixels'),card=stage.parentElement,width=Math.min(card.clientWidth,card.clientHeight*aspect);
  stage.style.setProperty('--camera-fit-width',`${width}px`);stage.style.setProperty('--camera-fit-height',`${width/aspect}px`);
}
async function loadRecording(token){
  const source=recording();state.data=source.data;state.sourceId=null;
  if(video.getAttribute('src')!==source.video.src||video.readyState<2){
    const loaded=await new Promise((resolve,reject)=>{
      const done=()=>finish(),failed=()=>finish(new Error('The teacher video could not decode.'));
      const timer=setTimeout(()=>finish(new Error('The teacher video took too long to load. Reload to retry.')),20000);
      function finish(error){clearTimeout(timer);video.removeEventListener('loadeddata',done);video.removeEventListener('error',failed);error?reject(error):resolve(token===state.operation);}
      video.addEventListener('loadeddata',done,{once:true});video.addEventListener('error',failed,{once:true});video.src=source.video.src;video.load();
    });
    if(!loaded)return false;
  }
  if(token!==state.operation)return false;
  if(video.videoWidth!==source.video.width||video.videoHeight!==source.video.height)throw new Error('The teacher video dimensions do not match its observations.');
  state.sourceId=source.id;frameRecording(source);return true;
}
async function boot(){
  try{
    const originalManifest=await readJson('/practice-media/recut-six/manifest.json');
    if(originalManifest.schemaVersion!=='recut-six-teaching-v1'||originalManifest.steps?.length!==6||originalManifest.sources?.length!==1||originalManifest.source.sha256!=='2d62941ddebe1a75febee4423d0040d021a4247440e248f40d7ea1c69b17fab6')throw new Error('This lesson requires the complete recut 24.mp4 opening sample.');
    const manifest={...originalManifest,steps:originalManifest.steps.map(withCenterFocus),sources:originalManifest.sources.map(source=>({...source}))};
    state.manifest=manifest;
    const displayAnnotations=await readJson('/practice-media/recut-six/teacher-display-guides.json');
    const sources=await Promise.all(manifest.sources.map(async source=>{
      const data=LESSON_CONTROLS.referenceAdapter(validateData(await readJson(source.poseSrc),source));
      return {...source,data,displayGuides:prepareTeacherDisplayGuides(data,displayAnnotations)};
    }));
    state.sources=new Map(sources.map(source=>[source.id,source]));
    if(manifest.steps.some(s=>!state.sources.has(s.sourceId)||!Number.isFinite(s.startSeconds)||!Number.isFinite(s.endSeconds)||s.startSeconds<0||s.endSeconds<=s.startSeconds||s.endSeconds>state.sources.get(s.sourceId).video.durationSeconds+.001))throw new Error('A teaching interval does not match its source recording.');
    const lesson=prepareRecutLesson(manifest,state.sources,LESSON_CONTROLS.referenceOptions);
    manifest.steps=lesson.steps;manifest.continuity={version:lesson.version,seams:lesson.seams,coverage:lesson.coverage};
    const sixth=prepareSixthAssessmentReference(lesson,sources[0],
      await readJson('/practice-media/recut-six/clip-06-assessment-targets.json'));
    state.refs=lesson.references.map((ref,i)=>i===5?sixth.guidanceReference:ref);
    state.guidanceRefs=lesson.guidanceReferences.map((ref,i)=>i===5?sixth.guidanceReference:ref);
    state.pathRefs=manifest.steps.map((s,i)=>i===5?sixth.pathReference:preparePracticeTubes(state.guidanceRefs[i],s,state.sources));
    if(state.guidanceRefs.some((ref,i)=>!ref.referenceUsable||!prepareStartPosition(ref).usable
      ||!state.pathRefs[i].referenceUsable||!INDICES.every(index=>ref.guides.find(guide=>guide.index===index)?.valid)))
      throw new Error('Practice targets could not load for all six clips. Reload to retry.');
    fitPortraitCamera();
    $('step-list').replaceChildren(...manifest.steps.map((s,index)=>{const li=document.createElement('li'),button=document.createElement('button');button.dataset.index=String(index);button.textContent=`${index+1}. ${s.title}`;button.addEventListener('click',()=>choose(index,true));li.append(button);return li;}));
    state.ready=true;const requested=Number(new URLSearchParams(location.search).get('step'));await choose(Number.isInteger(requested)&&requested>=1&&requested<=total()?requested-1:0);
  }catch(error){$('load-error').textContent=error.message;$('load-error').hidden=false;put('status','The lesson could not load. Reload to retry.');}
}
state.camera=createFollowCamera({video:$('camera-video'),canvas:$('camera-overlay'),deviceSelect:$('camera-device'),startButton:$('start-camera'),stopButton:$('stop-camera'),mirrorCheckbox:$('mirror-preview'),skeletonCheckbox:$('learner-skeleton'),statusElement:$('camera-status'),pointIndices:INDICES,getPointIndices:activeControlIndices,showConnections:false,pointColors:FOUR_POINT_COLORS,adaptSample:LESSON_CONTROLS.liveAdapter,onObservation:observe,onState(status){
  $('camera-empty').hidden=!!status.running||cameraFeedAvailable();
  $('camera-pixels').parentElement.dataset.cameraPhase=status.phase;
  const wasRunning=state.cameraRunning,wasAwaiting=state.awaitingCamera;state.cameraRunning=!!status.running;
  if(!status.running){state.observation=null;feedbackSpeech.cancel();hardwareFeedback.neutral();}
  if(wasAwaiting&&(status.running||['error','idle'].includes(status.phase)))state.awaitingCamera=false;
  if(state.ready&&state.active&&!state.loading){
    const generation=state.camera?.getState().generation;
    if(wasAwaiting&&!state.awaitingCamera&&!status.running){
      ++state.operation;video.pause();clearEvidence();state.positionNotice='Camera unavailable. Check its permission or device, then choose Start practice.';phase('positioning');
    }else if(['demonstrating','grace'].includes(state.phase)&&(!status.running||generation!==state.attemptCameraGeneration)){
      state.attemptInterrupted='The camera stopped or changed during this attempt. Set up and try again.';
    }else if(state.phase==='feedback'&&(!status.running||(state.attemptCameraGeneration!==null&&generation!==state.attemptCameraGeneration))){
      feedbackSpeech.cancel();
      state.reviewAction='retry';state.feedback={status:'unknown',percent:null,messages:['The camera stopped or changed. Set up again before continuing.']};
    }else if(!state.paused&&status.running&&!wasRunning&&!['watching','feedback'].includes(state.phase)){
      if(!state.watched)void watchDemonstration('lesson');
      else void returnToStart();
    }else if(state.phase==='positioning'&&wasRunning&&!status.running){clearEvidence();}
  }
  render();
}});
$('start-practice').addEventListener('click',async()=>{
  if(!state.ready||state.loading)return;feedbackSpeech.unlock();if(state.phase==='finished'){state.results.clear();if(!await choose(0))return;}
  else if(state.phase==='stopped'||state.sourceId!==step().sourceId||video.readyState<2){if(!await choose(state.index))return;}
  if(state.camera.getState().running){state.active=true;state.paused=false;if(state.watched)void returnToStart();else void watchDemonstration('lesson');return;}
  state.active=true;state.paused=false;state.preview=false;state.visualOnly=false;state.awaitingCamera=true;video.pause();++state.operation;clearEvidence();phase('camera');$('start-camera').click();
});
$('practice-toggle').addEventListener('click',pause);$('end-practice').addEventListener('click',stop);
$('practice-full-body').addEventListener('click',()=>selectPracticeMode('full-body'));
$('practice-arms-only').addEventListener('click',()=>selectPracticeMode('arms-only'));
$('replay').addEventListener('click',async()=>{if(state.camera.getState().running){state.active=true;state.paused=false;if(state.watched)void returnToStart();else void watchDemonstration('lesson');}else if(await choose(state.index)){state.active=true;void watchDemonstration('preview');}});
$('previous').addEventListener('click',()=>choose(Math.max(0,state.index-1),true));
$('next').addEventListener('click',()=>{if(state.ready&&state.phase!=='finished'){state.active=true;recordAndAdvance('manual');}});
$('speed').addEventListener('change',()=>{state.speed=Number($('speed').value);video.playbackRate=state.speed;if(state.active&&['demonstrating','grace'].includes(state.phase))void returnToStart('Playback speed changed. Start a fresh attempt from the squares.');});
$('mirror-preview').addEventListener('change',drawGuides);$('learner-skeleton').addEventListener('change',drawGuides);
$('start-camera').addEventListener('click',()=>feedbackSpeech.unlock());
$('spoken-feedback').addEventListener('change',()=>{const enabled=$('spoken-feedback').checked;feedbackSpeech.unlock();feedbackSpeech.setEnabled(enabled);});
video.addEventListener('seeking',()=>{teacherDisplaySmoother.reset();state.lastDrawn=undefined;drawTeacher(true);});
for(const event of ['loadedmetadata','playing','resize'])$('camera-video').addEventListener(event,()=>{
  if(cameraFeedAvailable())$('camera-empty').hidden=true;
  seedScreenTargets();drawGuides();
});
$('visibility-settings').addEventListener('click',()=>{
  const open=document.documentElement.classList.toggle('settings-open');
  $('visibility-settings').setAttribute('aria-expanded',String(open));$('visibility-settings').textContent=open?'Close settings':'Settings';
  if(open)$('practice-settings').open=true;
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.documentElement.classList.contains('settings-open'))$('visibility-settings').click();});
if(visibilityTest){
  new ResizeObserver(fitVisibilityTeacher).observe($('teacher-pixels').parentElement);
  new ResizeObserver(fitPortraitCamera).observe($('camera-pixels').parentElement);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.ready)stop();});
window.addEventListener('pagehide',()=>{stop();state.camera?.destroy();feedbackSpeech.destroy();hardwareFeedback.destroy();});
for(const event of ['waiting','stalled'])video.addEventListener(event,()=>{
  if(state.active&&!state.paused&&state.phase==='demonstrating'&&state.movement&&video.readyState<3)
    state.attemptInterrupted='The demonstration was interrupted. Try this clip again with uninterrupted playback.';
});
Object.defineProperty(window,'firstThreeDiagnostics',{get:()=>({ready:state.ready,loading:state.loading,operation:state.operation,sourceId:state.sourceId,poseSrc:recording()?.poseSrc,sourceFile:state.manifest?.source.file,index:state.index,stepId:step()?.id,stepCount:state.manifest?.steps.length||0,selection:step()?JSON.parse(JSON.stringify(step())):null,phase:state.phase,paused:state.paused,active:state.active,round:state.round,remainingMs:state.remainingMs,speed:state.speed,teacherTime:video.currentTime,teacherBoundary:{pending:state.teacherFreezePending,settledAtMs:state.teacherBoundaryAtMs},finishMode:'full-clip-review',practiceMode:practiceMode(),controlIndices:[...activeControlIndices()],watched:state.watched,watchPurpose:state.watchPurpose,reviewAction:state.reviewAction,reviewRules:{...REVIEW_RULES},teacherVideo:{src:video.getAttribute('src'),width:video.videoWidth,height:video.videoHeight},sampleTimeMs:state.lastSample?.tMs??null,teacherJoints:[...state.drawnJoints],guideJoints:[...state.guideJoints],reference:reference()?JSON.parse(JSON.stringify(reference())):null,references:JSON.parse(JSON.stringify(state.refs)),feedback:state.feedback?JSON.parse(JSON.stringify(state.feedback)):null,results:[...state.results.values()],camera:state.camera?.getState()||null,teacherFraming:recording()?.displayCrop,referenceSampleRateHz:state.data?.sampleRateHz||12,rules:{...RULES}})});
Object.defineProperty(window,'trackingDisplayDiagnostics',{get:()=>({
  version:teacherDisplaySmoother.version,mode:'presentation-only',
  rawObservationsPreserved:true,reviewInput:'raw MediaPipe observations',
  teacherVisibilityThreshold:teacherDisplayVisibility,teacherClock:'playback-adjusted',
  teacherPoints:structuredClone(state.teacherPoints),guidePolicy:'Tutorial dots are visual guidance. Practice targets retain their own reference provenance; learner evidence remains fresh same-side tracking.',
  cameraVersion:state.camera?.getState().displaySmoothing||null,
})});
Object.defineProperty(window,'spokenFeedbackDiagnostics',{get:()=>feedbackSpeech.getState()});
Object.defineProperty(window,'arduinoFeedbackDiagnostics',{get:()=>hardwareFeedback.getState()});
Object.defineProperty(window,'startPositionDiagnostics',{get:()=>({
  continuity:state.manifest?.continuity?structuredClone(state.manifest.continuity):null,
  guidanceReference:guidance()?JSON.parse(JSON.stringify(guidance())):null,
  guidanceReferences:JSON.parse(JSON.stringify(state.guidanceRefs)),
  positioning:state.positioning?JSON.parse(JSON.stringify(state.positioning)):null,
  placement:state.placement?JSON.parse(JSON.stringify(state.placement)):null,
  fixedFrame:state.fixedFrame?{...state.fixedFrame}:null,screenLayout:state.screenLayout?structuredClone(state.screenLayout):null,
  squareJoints:[...state.squareJoints],triangleJoints:[...state.triangleJoints],
  projectedStarts:JSON.parse(JSON.stringify(state.projectedStarts)),projectedEnds:JSON.parse(JSON.stringify(state.projectedEnds)),
  preview:state.preview,visualOnly:state.visualOnly,controlPointVersion:CONTROL_POINT_VERSION,rules:{...START_POSITION_RULES,indices:[...activeControlIndices()]}
})});
Object.defineProperty(window,'recutLessonDiagnostics',{get:()=>({
  schemaVersion:state.manifest?.schemaVersion,coverage:state.manifest?.continuity?.coverage?structuredClone(state.manifest.continuity.coverage):null,
  sourceId:state.sourceId,poseSrc:recording()?.poseSrc,masterVideoSrc:recording()?.video.src,
  introPlaying:state.teacherIntro,teacherFrameIndex:state.lastSample?.sourceFrameIndex??null,
  currentCategory:step()?{id:step().id,firstFrame:step().sourceStartFrame,endFrameExclusive:step().sourceEndFrameExclusive,
    referenceStartFrame:step().referenceStartFrame,referenceEndFrame:step().referenceEndFrame,
    practiceStartSeconds:practiceStart(),freezeSeconds:step().teacherFreezeSeconds}:null,
  seams:state.manifest?.continuity?.seams?structuredClone(state.manifest.continuity.seams):[],
})});
Object.defineProperty(window,'movementPathDiagnostics',{get:()=>({
  pathReference:pathReference()?JSON.parse(JSON.stringify(pathReference())):null,
  pathReferences:JSON.parse(JSON.stringify(state.pathRefs)),projectedPaths:JSON.parse(JSON.stringify(state.projectedPaths)),
  session:state.movement?JSON.parse(JSON.stringify(state.movement)):null,practiceMode:'post-clip-review',pathRequired:false,rules:{...REVIEW_RULES}
})});
requestAnimationFrame(tick);void boot();
