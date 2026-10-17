// This isolated lesson reuses the existing sources and reviewed phase map.
// Display mirroring never enters recorded/reference/live landmark computation.
const $ = (id) => document.getElementById(id);
const put=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
const videos = { front: $('front-video'), back: $('back-video') };
const POINTS=[15,16,27,28];
const POINT_COLORS={15:'#41d9b1',16:'#ffbf69',27:'#79b8ff',28:'#eaa4ff'};
// Stable framing covers the archived 24-form movement range, with limb margins.
// These source-image rectangles affect presentation only, never raw pose inputs.
const TEACHER_FRAMING={front:{x:.30,y:.18,width:.40,height:.73},back:{x:.29,y:.14,width:.42,height:.77}};
const GAME_ENABLED=new URLSearchParams(location.search).get('mode')!=='routine'&&new URLSearchParams(location.search).get('game')!=='0';
const state = {
  manifest: null, form: null, step: null, allSteps: [], anchors: [], ready: false,
  playing: false, starting: false, held: false, speed: .5, operation: 0,
  loadGeneration: 0, seekGeneration: 0, pendingSeeks: new Set(), aborter: null,
  scrubbing: false, scrubResume: false, scrubTimer: null, lastDriftCheck: 0,
  ending: false, lastText: 0, data: null, sampleMap: new Map(), drawn: undefined,
  poseRequests: [], reference: null, session: null, runtime: null, camera: null,
  observation: null, feedback: null, completed: new Set(), finished: false,
  auto: {enabled:true,phase:'loading',paused:false,round:0,remainingMs:0,deadlineMs:null,
    attemptId:0,generation:0,busy:false,hold:null,progress:null,feedbackStartedAtMs:null,
    results:new Map(),awaitingCamera:false,overlay:null},
  game:{enabled:GAME_ENABLED,runtime:null,progressStore:null,reference:null,references:new Map(),session:null,
    formId:null,stars:0,saved:null,storageError:null,formComplete:false,teacherDrawnIndices:[],guideDrawnIndices:[],
    projected:[],trails:new Map(POINTS.map((index)=>[index,[]])),guideStatusSignature:''},
};
const AUTO_RULES={version:'follow-automatic-v1.0',countdownMs:3000,graceMs:4000,feedbackMs:3000,matchHoldMs:700,maximumSampleGapMs:450,visualRounds:3};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const fps = () => state.manifest?.sources.front.fps || 30;
const range = () => state.step.front;
const finalTime = () => Math.max(range().startSeconds, range().endSeconds - 1 / fps());
const timeText = (n) => {
  const s = Math.max(0, Number.isFinite(n) ? n : 0);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};
const currentIndex = () => state.allSteps.findIndex((entry) => entry.step.id === state.step?.id);
const runtimePromise = import('./follow-teacher-runtime.js').then((runtime) => (state.runtime = runtime)).catch(() => null);
const gameRuntimePromise=import('./four-point-game-runtime.js').then((runtime)=>(state.game.runtime=runtime)).catch(()=>null);
const gameProgressPromise=import('./game-progress.js').then((module)=>(state.game.progressStore=module)).catch(()=>null);
document.body.classList.add('four-point-view');
document.body.classList.toggle('game-mode',GAME_ENABLED);
if(GAME_ENABLED)document.querySelector('.overlay-progress-label').textContent='Target progress';

function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function showError(message) {
  $('load-error').hidden = !message;
  $('load-error-message').textContent = message || '';
}
function updateControls() {
  for (const id of ['play','replay','speed','seek','step-select','loop']) $(id).disabled = !state.ready;
  $('step-prev').disabled = !state.ready || currentIndex() <= 0;
  $('step-next').disabled = !state.ready || state.finished;
  $('step-next').textContent = currentIndex() === state.allSteps.length - 1 ? 'Finish lesson ✓' : 'Next step →';
  $('play').textContent = state.auto.paused?'Resume practice':state.auto.enabled?'Pause practice':'Start preview';
  $('play').setAttribute('aria-pressed', String(state.playing || state.starting));
  $('pace-state').textContent = state.finished ? 'Session complete' : state.auto.paused ? 'Paused' : 'Automatic practice';
  $('start-practice').disabled=!state.ready||state.auto.awaitingCamera||!state.camera;
  $('start-practice').hidden=!!state.camera?.getState().running&&state.auto.enabled&&!state.finished;
  $('start-practice').textContent=state.finished?'Restart lesson':'Start practice';
  $('practice-toggle').disabled=!state.auto.enabled||['loading','camera','finished','stopped'].includes(state.auto.phase);
  $('practice-toggle').textContent=state.auto.paused?'Resume':'Pause';
  $('practice-toggle').setAttribute('aria-pressed',String(state.auto.paused));
  $('end-practice').disabled=!state.auto.enabled&&!state.camera?.getState().running&&!state.auto.awaitingCamera;
}
function cancelSeeks() {
  state.seekGeneration++;
  for (const cancel of [...state.pendingSeeks]) cancel();
}
function pausePair(message) {
  state.operation++;
  state.playing = false; state.starting = false;
  clearTimeout(state.scrubTimer); cancelSeeks();
  Object.values(videos).forEach((video) => video.pause());
  updateControls();
  if (message) setStatus(message);
}
function resetSession() {
  state.session = state.reference && state.runtime ? state.runtime.createFollowSession(state.reference) : null;
  state.game.session=state.game.reference&&state.game.runtime?state.game.runtime.createFourPointSession(state.game.reference):null;
  for(const index of POINTS)state.game.trails.set(index,[]);
  state.feedback = null;
  state.auto.hold=null;state.auto.progress=null;
}
const activeReference=()=>GAME_ENABLED?state.game.reference:state.reference;
function referenceState(){const reference=activeReference();return !state.data||!state.runtime||!reference?'unavailable':reference.referenceUsable?'usable':'insufficient';}
function gameProgress(result=state.feedback){
  if(!result)return null;
  return {percent:result.percent,reason:result.reason,rulesVersion:result.rulesVersion,
    components:(result.limbs||[]).filter((limb)=>limb.required).map((limb)=>({id:`point-${limb.index}`,label:limb.label,complete:limb.targetReached,progress:limb.progress,weight:1/state.game.reference.focusJoints.length}))};
}
function saveGameProgress(){
  if(!GAME_ENABLED||!state.form||!state.game.progressStore||state.game.references.size!==state.form.steps.length)return;
  try{
    const stepIds=state.form.steps.map((step)=>step.id),eligibleStepIds=stepIds.filter((id)=>state.game.references.get(id)?.referenceUsable);
    const results=[...state.auto.results.values()].filter((result)=>stepIds.includes(result.stepId));
    state.game.saved=state.game.progressStore.recordGameFormResult({formId:state.form.id,stepIds,eligibleStepIds,results});
    state.game.stars=state.game.saved.stars;
    state.game.storageError=state.game.saved.persisted?null:'Stars are available for this visit, but browser storage is unavailable.';
  }catch(error){state.game.storageError=error.message||'Stars could not be saved on this device.';}
  put('game-star-display','★'.repeat(state.game.stars)+'☆'.repeat(3-state.game.stars));
  $('game-star-display').setAttribute('aria-label',`${state.game.stars} of 3 stars earned`);
}
function showGameFinish(){
  if(!GAME_ENABLED)return;
  saveGameProgress();state.game.formComplete=true;
  $('game-finish').hidden=false;
  put('game-finish-stars','★'.repeat(state.game.stars)+'☆'.repeat(3-state.game.stars));
  put('game-finish-title',`${state.form.title} · level finished`);
  const saved=state.game.saved;
  put('game-finish-description',saved?`${saved.matched} / ${saved.eligibleCount} playable targets collected. ${saved.visualOnlyCount} visual-only steps are separate. Stars record game targets, not Tai Chi correctness.${state.game.storageError?' '+state.game.storageError:''}`:'No star result was saved. Return to the level map to try again.');
  $('game-finish').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
function setAutomaticPhase(phase,duration=0){
  const auto=state.auto;auto.phase=phase;auto.remainingMs=duration;
  auto.deadlineMs=duration&&!auto.paused?performance.now()+duration:null;
  updateControls();renderAutomatic();
}
function clearAutomaticOverlay(){state.auto.overlay=null;$('practice-overlay').hidden=true;}
function renderAutomatic(){
  const auto=state.auto,phase=auto.phase;
  put('auto-position',`${Math.max(1,currentIndex()+1)} / ${state.allSteps.length||172}`);
  put('auto-step-title',state.step?.title||'Preparing your lesson…');
  put('auto-phase',auto.paused?'Paused':({loading:'Preparing',camera:'Starting camera',countdown:'Get ready',demonstrating:'Follow the teacher',grace:'Finish the movement',feedback:'Your feedback',advancing:'Next small step',finished:'Session complete',stopped:'Session ended'}[phase]||'Get ready'));
  put('auto-mode',referenceState()==='insufficient'?'Visual practice · not assessed':state.camera?.getState().running?'Camera-guided practice':'Video preview · Start practice for camera feedback');
  put('auto-round',referenceState()==='insufficient'?`Visual round ${Math.max(1,auto.round)} / 3`:`Attempt ${Math.max(1,auto.round)}`);
  const overlay=$('practice-overlay');
  overlay.hidden=auto.paused||!auto.enabled||!['countdown','feedback'].includes(phase);
  if(overlay.hidden)return;
  overlay.dataset.mode=phase==='countdown'?'countdown':'feedback';
  if(phase==='countdown'){
    put('overlay-countdown',String(Math.max(1,Math.ceil(auto.remainingMs/1000))));
    put('overlay-title','Get ready');
    put('overlay-reason',state.step?.title||'Follow the teacher');
    put('overlay-footer',state.camera?.getState().running?'Find ring 1, then move to ring 2. Keep the same hand or foot.':'Video starts automatically. Start practice when ready for camera feedback.');
  }else{
    const feedback=auto.overlay;
    put('overlay-title',feedback?.title||'Unable to judge');
    put('overlay-progress',feedback?.progress?.percent==null?'—':`${feedback.progress.percent}%`);
    put('overlay-reason',feedback?.reason||'Waiting for a clear observation.');
    const signature=JSON.stringify(feedback?.progress?.components||[]);
    if($('overlay-components').dataset.signature!==signature){
      $('overlay-components').dataset.signature=signature;
      $('overlay-components').replaceChildren(...(feedback?.progress?.components||[]).map((item)=>{
        const li=document.createElement('li');
        const label=item.id==='start'?'Beginning':item.id==='target'?'Target pose':item.label.charAt(0).toUpperCase()+item.label.slice(1);
        const value=item.progress==null?'not assessed':item.complete?(item.id==='target'?'close':'observed'):item.progress<=0?'not yet observed':`${Math.round(item.progress*100)}% toward the target`;
        li.textContent=`${label}: ${value}`;
        return li;
      }));
    }
    const next=referenceState()==='insufficient'&&auto.round>=AUTO_RULES.visualRounds;
    put('overlay-footer',`${next?'Continuing as not assessed':'Retrying this step'} in ${Math.max(1,Math.ceil(auto.remainingMs/1000))} s`);
  }
}
function pauseAutomatic(message='Paused. Resume when you are ready.'){
  const auto=state.auto;
  if(!auto.enabled||auto.paused)return;
  if(auto.deadlineMs!==null)auto.remainingMs=Math.max(0,auto.deadlineMs-performance.now());
  auto.deadlineMs=null;auto.paused=true;auto.hold=null;
  // Loading must complete even if the learner pauses during a cross-form transition.
  if(state.ready)pausePair();else Object.values(videos).forEach((video)=>video.pause());
  resetSession();setStatus(message);updateControls();renderAutomatic();
}
async function resumeAutomatic(){
  const auto=state.auto;
  if(!auto.enabled){beginAutomatic();return;}
  if(!auto.paused)return;
  auto.paused=false;
  if(['countdown','grace','feedback'].includes(auto.phase))auto.deadlineMs=performance.now()+Math.max(0,auto.remainingMs);
  if(auto.phase==='demonstrating')await playPair(false);
  setStatus('Automatic practice resumed.');updateControls();renderAutomatic();
}
function stopAutomatic(message='Session ended. Start practice whenever you are ready.',releaseCamera=true){
  const auto=state.auto;auto.generation++;auto.enabled=false;auto.paused=false;auto.busy=false;auto.awaitingCamera=false;
  auto.deadlineMs=null;auto.remainingMs=0;auto.phase='stopped';clearAutomaticOverlay();
  if(state.ready)pausePair();else Object.values(videos).forEach((video)=>video.pause());
  resetSession();state.observation=null;
  if(releaseCamera)state.camera?.stop();
  setStatus(message);updateControls();renderAutomatic();
}
function beginAutomatic(){
  if(!state.ready)return;
  const auto=state.auto;auto.generation++;auto.enabled=true;auto.paused=false;auto.busy=false;auto.round=0;
  auto.awaitingCamera=false;auto.overlay=null;auto.feedbackStartedAtMs=null;state.finished=false;
  pausePair();resetSession();state.held=false;
  setStatus('Get ready · automatic practice starts in 3 seconds.');
  setAutomaticPhase('countdown',AUTO_RULES.countdownMs);
}
async function startAutomaticRound(){
  const auto=state.auto;
  if(!auto.enabled||auto.paused||auto.busy||!state.ready)return;
  const generation=auto.generation;
  auto.busy=true;auto.round++;auto.attemptId++;clearAutomaticOverlay();resetSession();
  setAutomaticPhase('demonstrating');
  try{
    await playPair(true);
    if(generation===auto.generation&&auto.enabled&&!auto.paused&&!state.playing)pauseAutomatic('Playback needs your gesture. Press Resume to start.');
  }finally{if(generation===auto.generation)auto.busy=false;}
}
function finishAutomaticAttempt(){
  const auto=state.auto;
  if(!auto.enabled||auto.paused||auto.busy||auto.phase!=='grace')return;
  const source=referenceState(),fresh=state.observation&&performance.now()-state.observation.observedAtMs<=450;
  let progress=null,title='Unable to judge',reason='No fresh camera pose. Keep your full body in view; this step will repeat.';
  if(source==='insufficient'){
    title='Visual practice · not assessed';reason=`${activeReference().unknownReason} Visual round ${auto.round} of 3. This is not a pass.`;
  }else if(source==='unavailable'){
    reason='The front reference could not be loaded. The step will repeat; use Lesson settings to retry loading.';
  }else if(!state.camera?.getState().running){
    reason='The camera is off. Press Start practice once for camera feedback. This step will repeat without being marked passed.';
  }else if(fresh&&state.feedback){
    progress=GAME_ENABLED?gameProgress():state.runtime.summarizeFollowProgress(state.reference,state.feedback,state.session);
    title=progress.percent==null?'Unable to judge':'Keep practicing';
    reason=progress.reason;
    // A brief near-target observation is not the required continuous fresh match.
    if(state.feedback.status==='match'){
      reason='The target was observed briefly. Hold it clearly for 0.7 seconds to continue.';
      if(progress.percent!==null)progress={...progress,percent:Math.min(99,progress.percent),reason};
    }
  }
  auto.progress=progress;auto.overlay={title,reason,progress};auto.feedbackStartedAtMs=performance.now();
  setStatus(source==='insufficient'?'Visual practice: this step will be marked not assessed after three full rounds.':'Feedback for 3 seconds, then this step repeats automatically.');
  setAutomaticPhase('feedback',AUTO_RULES.feedbackMs);
}
async function advanceAutomatic(status){
  const auto=state.auto;
  if(!auto.enabled||auto.paused||auto.busy)return;
  const generation=auto.generation;auto.busy=true;
  auto.results.set(state.step.id,{stepId:state.step.id,status});
  saveGameProgress();
  state.completed.add(state.step.id);clearAutomaticOverlay();resetSession();pausePair();
  setAutomaticPhase('advancing');
  const next=state.allSteps[currentIndex()+1];
  if(!next){
    state.finished=true;auto.enabled=false;auto.paused=false;auto.phase='finished';auto.busy=false;
    state.camera?.stop();renderSelections();updateControls();renderAutomatic();
    setStatus(`Session complete · ${[...auto.results.values()].filter((r)=>r.status==='matched').length} observed matches, ${[...auto.results.values()].filter((r)=>r.status==='unassessed').length} not assessed.`);
    showGameFinish();
    return;
  }
  try{
    if(next.form.id===state.form.id)await selectStep(next.step,false);else await selectForm(next.form,next.step.id,false);
    if(generation!==auto.generation||!auto.enabled)return;
    auto.round=0;auto.busy=false;auto.overlay=null;auto.feedbackStartedAtMs=null;
    setStatus('Next small step · get ready.');setAutomaticPhase('countdown',AUTO_RULES.countdownMs);
  }finally{if(generation===auto.generation)auto.busy=false;}
}
function tickAutomatic(now){
  const auto=state.auto;
  if(auto.deadlineMs!==null&&!auto.paused)auto.remainingMs=Math.min(auto.remainingMs,Math.max(0,auto.deadlineMs-now));
  if(!auto.enabled||auto.paused||auto.busy){renderAutomatic();return;}
  if(['demonstrating','grace'].includes(auto.phase)&&referenceState()==='usable'&&auto.hold?.ready
      &&state.feedback?.status==='match'&&state.observation&&now-state.observation.observedAtMs<=450){
    void advanceAutomatic('matched');return;
  }
  if(auto.deadlineMs!==null&&auto.remainingMs<=0){
    auto.deadlineMs=null;
    if(auto.phase==='countdown')void startAutomaticRound();
    else if(auto.phase==='grace')finishAutomaticAttempt();
    else if(auto.phase==='feedback'){
      if(referenceState()==='insufficient'&&auto.round>=AUTO_RULES.visualRounds)void advanceAutomatic('unassessed');
      else void startAutomaticRound();
    }
  }
  renderAutomatic();
}
function prepareAnchors() {
  const chosen = state.step;
  const start = {frontSeconds:chosen.front.startSeconds,backSeconds:chosen.back.startSeconds};
  const end = {frontSeconds:chosen.front.endSeconds,backSeconds:chosen.back.endSeconds};
  const interior = state.form.anchors.filter((a) => a.frontSeconds > start.frontSeconds + .00001 && a.frontSeconds < end.frontSeconds - .00001 && a.backSeconds > start.backSeconds && a.backSeconds < end.backSeconds);
  state.anchors = [start,...interior,end];
}
function mapping(frontSeconds) {
  if (state.anchors.length < 2) return {time:frontSeconds,slope:1};
  let index = 0;
  while (index < state.anchors.length - 2 && frontSeconds >= state.anchors[index + 1].frontSeconds) index++;
  const a = state.anchors[index], b = state.anchors[index + 1];
  const slope = (b.backSeconds - a.backSeconds) / (b.frontSeconds - a.frontSeconds);
  return {time:clamp(a.backSeconds + (frontSeconds - a.frontSeconds) * slope,state.anchors[0].backSeconds,state.anchors.at(-1).backSeconds),slope};
}
function setRates() {
  videos.front.playbackRate = clamp(state.speed,.0625,16);
  videos.back.playbackRate = clamp(state.speed * mapping(videos.front.currentTime).slope,.0625,16);
}
function sampleAt(time) {
  if (!state.data || !Number.isFinite(time)) return null;
  const sample = state.sampleMap.get(Math.floor(time * fps() + .00001));
  return sample && Math.abs(sample.sourceTimeSeconds - time) <= 1 / fps() + .00001 ? sample : null;
}
function visiblePoint(p) {
  return p && [p.x,p.y,p.visibility].every(Number.isFinite) && p.visibility >= .45 && p.visibility <= 1
    && (p.presence == null || (Number.isFinite(p.presence) && p.presence >= .45))
    && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}
function drawTeacher(sample, force = false) {
  if (!force && state.drawn === sample) return;
  state.drawn = sample;
  const canvas = $('front-overlay'), ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Intrinsic video dimensions + the shared contain box preserve pixel alignment.
  if (canvas.width !== (videos.front.videoWidth || 640)) canvas.width = videos.front.videoWidth || 640;
  if (canvas.height !== (videos.front.videoHeight || 360)) canvas.height = videos.front.videoHeight || 360;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  state.game.teacherDrawnIndices=[];
  if (!$('teacher-skeleton').checked || sample?.status !== 'pose') return;
  const points = new Map(sample.landmarks.filter((p)=>POINTS.includes(p.index)&&visiblePoint(p)).map((p) => [p.index,p]));
  const position = (p) => [p.x * canvas.width,p.y * canvas.height];
  ctx.lineWidth = 2; ctx.shadowBlur = 3; ctx.shadowColor = '#10281b';
  for (const [index,p] of points) {
    ctx.fillStyle = POINT_COLORS[index]; ctx.beginPath(); ctx.arc(...position(p),6,0,Math.PI*2); ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();
  }
  state.game.teacherDrawnIndices=[...points.keys()];
  ctx.shadowBlur = 0;
}
function drawGameGuides(){
  const canvas=$('camera-guide-overlay'),video=$('camera-video'),ctx=canvas.getContext('2d');
  if(!ctx)return;
  if(canvas.width!==(video.videoWidth||640))canvas.width=video.videoWidth||640;
  if(canvas.height!==(video.videoHeight||360))canvas.height=video.videoHeight||360;
  const mirrored=$('mirror-preview').checked;
  canvas.style.transform=mirrored?'scaleX(-1)':'none';
  ctx.clearRect(0,0,canvas.width,canvas.height);state.game.guideDrawnIndices=[];
  const reference=state.game.reference,observation=state.observation;
  const fresh=observation&&performance.now()-observation.observedAtMs<=450&&state.camera?.getState().running;
  const guides=reference&&fresh&&state.game.runtime?state.game.runtime.projectFourPointGuides(reference,observation.sample,observation.aspectRatio):[];
  state.game.projected=guides;
  const inFrame=(p)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  const pixels=(p)=>[p.x*canvas.width,p.y*canvas.height];
  function ring(p,label,color,radius,filled=false){
    const[x,y]=pixels(p);ctx.save();ctx.translate(x,y);
    ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.fillStyle=filled?color:'#132e42b8';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle=color;ctx.stroke();
    if(mirrored)ctx.scale(-1,1);
    ctx.font='bold 12px Segoe UI,Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=filled?'#102535':color;ctx.fillText(label,0,1);ctx.restore();
  }
  if($('learner-skeleton').checked&&fresh){
    for(const guide of guides){
      if(!guide.valid||!inFrame(guide.start)||!inFrame(guide.end))continue;
      const color=POINT_COLORS[guide.index],a=pixels(guide.start),b=pixels(guide.end);
      ctx.save();ctx.globalAlpha=guide.required?1:.55;ctx.lineWidth=guide.required?3:2;ctx.strokeStyle=color;ctx.lineCap='round';
      if(!guide.stationary){
        ctx.setLineDash([7,5]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.setLineDash([]);
        const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),mx=a[0]+(b[0]-a[0])*.58,my=a[1]+(b[1]-a[1])*.58;
        ctx.beginPath();ctx.moveTo(mx-9*Math.cos(angle-.5),my-9*Math.sin(angle-.5));ctx.lineTo(mx,my);ctx.lineTo(mx-9*Math.cos(angle+.5),my-9*Math.sin(angle+.5));ctx.stroke();
        ring(guide.start,'1',color,guide.required?12:9);ring(guide.end,'2',color,guide.required?15:11,true);
      }else{ring(guide.end,'H',color,guide.required?15:10);ctx.beginPath();ctx.arc(...b,guide.required?21:15,0,Math.PI*2);ctx.stroke();}
      state.game.guideDrawnIndices.push(guide.index);ctx.restore();
    }
    for(const index of POINTS){
      const points=(state.game.trails.get(index)||[]).filter((p)=>performance.now()-p.tMs<1600);
      state.game.trails.set(index,points);if(points.length<2)continue;
      ctx.strokeStyle=POINT_COLORS[index];ctx.lineWidth=3;ctx.globalAlpha=.65;ctx.beginPath();
      points.forEach((p,i)=>{const pos=pixels(p);if(i===0)ctx.moveTo(...pos);else ctx.lineTo(...pos);});ctx.stroke();ctx.globalAlpha=1;
    }
  }
  const current=state.feedback?.limbs||[];
  const statuses=(reference?.guides||POINTS.map((index)=>({index,label:{15:'Left hand',16:'Right hand',27:'Left foot',28:'Right foot'}[index],valid:false}))).map((guide)=>{
    const limb=current.find((item)=>item.index===guide.index);
    const projected=guides.find((item)=>item.index===guide.index);
    const fits=projected?.valid&&inFrame(projected.start)&&inFrame(projected.end);
    return {index:guide.index,label:guide.label,missing:!guide.valid,reached:!!limb?.targetReached,
      text:!reference?'Loading targets':!guide.valid?'Reference unavailable':!fresh?'Waiting for camera':!fits?'Keep body and targets in view':limb?.targetReached?'Collected':guide.stationary?'Hold the ring':limb?.startSeen?'Slide to 2':'Find ring 1'};
  });
  const signature=JSON.stringify(statuses);
  if(signature!==state.game.guideStatusSignature){
    state.game.guideStatusSignature=signature;
    $('game-guide-status').replaceChildren(...statuses.map((status)=>{
      const chip=document.createElement('div');chip.className='guide-chip';chip.dataset.reached=String(status.reached);chip.dataset.missing=String(status.missing);
      const dot=document.createElement('i');dot.style.background=POINT_COLORS[status.index];chip.append(dot,document.createTextNode(`${status.label} · ${status.text}`));return chip;
    }));
  }
}
function renderFeedback() {
  let result = state.feedback;
  const cameraState = state.camera?.getState();
  if (state.auto.paused) result={status:'unknown',message:'Practice paused. Resume when ready; fresh movement evidence will be required.'};
  else if(referenceState()==='insufficient')result={status:'unknown',message:'Visual practice only. After three full rounds this step continues as not assessed.'};
  else if (!cameraState?.running) result = {status:'unknown',message:'Video preview is running. Press Start practice once to enable camera-guided progression.'};
  else if (!state.ready || !state.reference) result = {status:'unknown',message:'Front reference unavailable. This step cannot be marked passed.'};
  else if (!['demonstrating','grace'].includes(state.auto.phase))result={status:'unknown',message:state.auto.overlay?.reason||'Get ready for the next movement. Each attempt uses fresh observations.'};
  else if (!state.observation || performance.now() - state.observation.observedAtMs > 450) result = {status:'unknown',message:'Waiting for a fresh, visible camera pose. Keep your full body in view.'};
  if (!result) result = {status:'unknown',message:'Follow the teacher. Keep this step’s hand or foot and your torso visible.'};
  $('feedback').dataset.state = result.status;
  $('feedback-state').textContent = {match:'Observed match',mismatch:'Observed difference',unknown:'Unable to judge'}[result.status];
  if ($('feedback-message').textContent !== result.message) $('feedback-message').textContent = result.message;
  $('focus-caption').textContent = GAME_ENABLED&&state.game.reference?`Collect: ${state.game.reference.guides.filter((guide)=>guide.required).map((guide)=>guide.label.toLowerCase()).join(' + ')}. Same-side points only.`:state.reference?`Focus: ${state.reference.focusLabel}. Anatomical sides are preserved.`:'Focus: no reliable front reference available.';
}
function observeCamera(observation) {
  state.observation = observation;
  if (!observation) { resetSession(); drawGameGuides();renderFeedback(); return; }
  for(const index of POINTS){
    const point=observation.sample.landmarks.find((p)=>p.index===index);
    if(!visiblePoint(point)){state.game.trails.set(index,[]);continue;}
    const trail=state.game.trails.get(index)||[];
    if(trail.length&&observation.observedAtMs-trail.at(-1).tMs>450)trail.length=0;
    trail.push({x:point.x,y:point.y,tMs:observation.observedAtMs});
    state.game.trails.set(index,trail.filter((p)=>observation.observedAtMs-p.tMs<1600));
  }
  if (state.auto.enabled&&!state.auto.paused&&['demonstrating','grace'].includes(state.auto.phase)&&state.ready && activeReference() && state.runtime) {
    state.feedback = GAME_ENABLED?state.game.runtime.evaluateFourPointObservation(state.game.reference,observation.sample,{
      attemptAspectRatio:observation.aspectRatio,liveAgeMs:performance.now()-observation.observedAtMs,session:state.game.session,
    }):state.runtime.evaluateFollowObservation(state.reference, observation.sample, {
      attemptAspectRatio:observation.aspectRatio,liveAgeMs:performance.now() - observation.observedAtMs,session:state.session,
    });
    state.auto.progress=GAME_ENABLED?gameProgress():state.runtime.summarizeFollowProgress(state.reference,state.feedback,state.session);
    state.auto.hold=state.runtime.updateTeachingHold(state.auto.hold,{status:state.feedback.status==='match'?'close':state.feedback.status==='mismatch'?'adjust':'unknown'},performance.now(),{
      targetKey:`${state.step.id}:${state.auto.attemptId}`,holdMs:AUTO_RULES.matchHoldMs,maximumSampleGapMs:450,
      observationTimestampMs:observation.observedAtMs,
    });
  }
  drawGameGuides();
  renderFeedback();
}
function render(force = false) {
  const sample = videos.front.seeking || videos.front.readyState < 2 ? null : sampleAt(videos.front.currentTime);
  drawTeacher(sample,force);
  if (!force && performance.now() - state.lastText < 100) return;
  state.lastText = performance.now();
  drawGameGuides();
  for (const name of ['front','back']) $(name+'-clock').textContent = `Source ${timeText(videos[name].currentTime)}`;
  $('front-quality').textContent = !state.data ? 'Reference observations unavailable · manual learning remains available'
    : !sample || sample.status !== 'pose' ? 'No confident pose at this source frame · unknown'
    : 'Four observed points · left / right hand and foot';
  if (state.step) {
    const duration = range().endSeconds - range().startSeconds;
    const elapsed = state.held ? duration : clamp(videos.front.currentTime - range().startSeconds,0,duration);
    if (!state.scrubbing) $('seek').value = String(elapsed / duration * 1000);
    $('elapsed').textContent = `${timeText(elapsed)} / ${timeText(duration)}`;
  }
  renderFeedback();
}
function seekVideo(video, time) {
  const bounded = clamp(time,0,Math.max(0,video.duration-.001));
  if (Math.abs(video.currentTime - bounded) < .00001 && video.readyState >= 2 && !video.seeking) return Promise.resolve(true);
  return new Promise((resolve,reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('A source video seek timed out. Retry this lesson.')),20000);
    const cancel = () => finish(null,false), done = () => finish(null,true), failed = () => finish(new Error('A source video could not be decoded.'));
    function finish(error,result) {
      if (settled) return;
      settled = true; clearTimeout(timeout); state.pendingSeeks.delete(cancel);
      video.removeEventListener('seeked',done); video.removeEventListener('error',failed);
      error ? reject(error) : resolve(result);
    }
    state.pendingSeeks.add(cancel); video.addEventListener('seeked',done); video.addEventListener('error',failed);
    try { video.currentTime = bounded; } catch (error) { finish(error); }
  });
}
async function seekPair(frontSeconds,operation = state.operation) {
  cancelSeeks(); const generation = state.seekGeneration;
  const time = clamp(frontSeconds,range().startSeconds,finalTime());
  const results = await Promise.all([seekVideo(videos.front,time),seekVideo(videos.back,mapping(time).time)]);
  if (generation !== state.seekGeneration || operation !== state.operation || results.some((result) => !result)) return false;
  setRates(); render(true); return true;
}
async function playPair(replay = false) {
  if (!state.ready) return;
  const restart = replay || state.held || videos.front.currentTime >= finalTime() - .005;
  pausePair(); const operation = state.operation;
  state.held = false; state.ending = false;
  if (restart) resetSession();
  try {
    const time = restart ? range().startSeconds : clamp(videos.front.currentTime,range().startSeconds,finalTime());
    if (!await seekPair(time,operation) || operation !== state.operation || !state.ready) return;
    state.starting = true; updateControls();
    await Promise.all(Object.values(videos).map((video) => video.play()));
    if (operation !== state.operation || !state.ready) {
      if (!state.playing && !state.starting) Object.values(videos).forEach((video) => video.pause());
      return;
    }
    state.starting = false; state.playing = true;
    updateControls(); setStatus('Watch slowly · both views follow the same movement phase.');
  } catch (error) {
    if (operation === state.operation) pausePair(error.message || 'Playback could not start. Press Watch slowly again.');
  }
}
async function holdEnd() {
  if (state.ending) return;
  state.ending = true;
  pausePair(); const operation = state.operation;
  const generation=state.auto.generation;
  state.held = true;
  try {
    if (await seekPair(finalTime(),operation)) {
      if(generation!==state.auto.generation||!state.auto.enabled)return;
      setStatus('Finish the movement · four seconds of extra practice time.');
      $('learning-cue').textContent = 'Your turn. Finish the movement.';
      setAutomaticPhase('grace',AUTO_RULES.graceMs);
      updateControls();
    }
  } catch (error) { if (operation === state.operation) setStatus(error.message,true); }
  finally { state.ending = false; }
}
function tick(now) {
  if (state.ready && state.playing) {
    if (videos.front.currentTime >= finalTime() || videos.front.ended) void holdEnd();
    else {
      try { setRates(); } catch { pauseAutomatic('The browser could not apply this playback speed.'); }
      if (now - state.lastDriftCheck > 200) {
        state.lastDriftCheck = now;
        const target = mapping(videos.front.currentTime).time;
        if (!videos.front.seeking && !videos.back.seeking && Math.abs(videos.back.currentTime-target) > .08) videos.back.currentTime = target;
      }
    }
  }
  tickAutomatic(now);
  render(); requestAnimationFrame(tick);
}
async function readJson(src,signal) {
  const response = await fetch(src,{signal});
  if (!response.ok) throw new Error(`Could not load ${src} (HTTP ${response.status}).`);
  return response.json();
}
const validRange = (r) => r && Number.isFinite(r.startSeconds) && Number.isFinite(r.endSeconds) && r.startSeconds >= 0 && r.endSeconds > r.startSeconds;
function validateManifest(manifest) {
  if (manifest.schemaVersion !== 'dual-view-alignment-v1' || manifest.forms?.length !== 24 || !manifest.sources?.front?.src || !manifest.sources?.back?.src) throw new Error('The existing 24-form alignment map is unavailable.');
  const ids = new Set();
  for (const form of manifest.forms) {
    if (!validRange(form.front) || !validRange(form.back) || !Array.isArray(form.steps) || !form.steps.length || !Array.isArray(form.anchors) || form.anchors.length < 2) throw new Error('A form has incomplete alignment data.');
    for (let i=0;i<form.anchors.length;i++) {
      const a=form.anchors[i],p=form.anchors[i-1];
      if (![a.frontSeconds,a.backSeconds].every(Number.isFinite) || (p && (a.frontSeconds<=p.frontSeconds || a.backSeconds<=p.backSeconds))) throw new Error('Movement anchors must increase in both recordings.');
    }
    for (const step of form.steps) {
      if (ids.has(step.id) || !validRange(step.front) || !validRange(step.back) || step.front.startSeconds<form.front.startSeconds-.001 || step.front.endSeconds>form.front.endSeconds+.001 || step.back.startSeconds<form.back.startSeconds-.001 || step.back.endSeconds>form.back.endSeconds+.001) throw new Error('A small step has invalid source boundaries.');
      ids.add(step.id);
    }
  }
  if (ids.size!==172) throw new Error('The reviewed map must contain all 172 existing small steps.');
  return manifest;
}
function validatePose(data,form) {
  if (data.schemaVersion!=='dual-view-poses-v1' || data.view!=='front' || data.formNumber!==form.formNumber || data.sourceSha256!==state.manifest.sources.front.sha256 || data.modelSha256!==state.manifest.modelSha256 || !Array.isArray(data.samples) || !data.samples.length || data.sourceStartSeconds>form.front.startSeconds+.05 || data.sourceEndSeconds<form.front.endSeconds-.05) throw new Error('The recorded front observations do not match this source/form/model.');
  let previous=-1;
  for (const sample of data.samples) {
    if (!Number.isInteger(sample.frameIndex) || sample.frameIndex<=previous || !Number.isFinite(sample.sourceTimeSeconds) || !Number.isFinite(sample.tMs) || !['pose','no_pose','inference_error'].includes(sample.status) || !Array.isArray(sample.landmarks)) throw new Error('The front observations have invalid frame records.');
    previous=sample.frameIndex;
  }
  return data;
}
function prepareReference() {
  try {
    state.reference = state.data && state.runtime ? state.runtime.prepareStepReference(state.form,state.step,state.data) : null;
  } catch {
    state.reference = null;
    showError('The optional step comparison could not be prepared. Video learning and manual Next remain available.');
  }
  state.game.reference=state.game.references.get(state.step?.id)||null;
  resetSession();
}
function renderSelections() {
  $('form-select').value=state.form.id;
  $('step-select').replaceChildren(...state.form.steps.map((step,i)=>new Option(`${i+1}. ${step.title}`,step.id)));
  $('step-select').value=state.step.id;
  $('form-caption').textContent=`${state.form.steps.length} small steps · form ${state.form.formNumber} of 24`;
  $('step-caption').textContent=`Step ${state.form.steps.indexOf(state.step)+1} of ${state.form.steps.length} · shared movement phase`;
  const results=[...state.auto.results.values()];
  $('progress-caption').textContent=`Step ${currentIndex()+1} of ${state.allSteps.length} · ${results.filter((r)=>r.status==='matched').length} targets collected · ${results.filter((r)=>r.status==='unassessed').length} not assessed · ${results.filter((r)=>r.status==='skipped').length} manually skipped`;
  $('lesson-progress').style.width=`${results.length/Math.max(1,state.allSteps.length)*100}%`;
  $('learning-cue').textContent=state.step.title;
  $('learning-detail').textContent=GAME_ENABLED?'Find the highlighted start ring, slide along its straight guide, then settle on the end ring. A double ring means hold.':'Follow along. An observed match held for 0.7 seconds continues automatically. Feedback lasts three seconds before a retry.';
  put('game-level-label',GAME_ENABLED?`LEVEL ${String(state.form.formNumber).padStart(2,'0')} · ${state.form.title}`:'24 forms');
  updateControls(); renderFeedback();
}
async function selectStep(step,autoplay=false) {
  if (!state.ready || !step) return;
  pausePair(); const operation=state.operation;
  state.step=step;state.held=false;state.finished=false;state.scrubbing=false;state.scrubResume=false;state.ending=false;
  prepareAnchors();prepareReference();renderSelections();
  try {
    if(await seekPair(range().startSeconds,operation)) {
      setStatus('Ready · watch this small step, then practice at your own pace.');
      if(autoplay) await playPair(true);
    }
  } catch(error){if(operation===state.operation)setStatus(error.message,true);}
}
async function selectForm(form,requestedStep=null,autoplay=false) {
  pausePair();const generation=++state.loadGeneration,operation=state.operation;
  state.aborter?.abort();state.aborter=new AbortController();
  state.ready=false;state.form=form;state.step=form.steps.find((s,i)=>s.id===requestedStep||String(i+1)===requestedStep)||form.steps[0];
  if(GAME_ENABLED){state.allSteps=form.steps.map((step)=>({form,step}));state.game.formId=form.id;state.game.formComplete=false;$('game-finish').hidden=true;}
  state.held=false;state.finished=false;state.scrubbing=false;state.scrubResume=false;state.ending=false;
  state.data=null;state.sampleMap=new Map();state.reference=null;state.game.reference=null;state.game.references=new Map();resetSession();showError(null);
  prepareAnchors();renderSelections();render(true);setStatus(`Preparing form ${form.formNumber} · original front observations only…`);
  try {
    // A reference-data failure must not disable the video lesson or manual Next.
    let warning=null;
    state.poseRequests.push(form.front.poseSrc);
    const dataPromise=readJson(form.front.poseSrc,state.aborter.signal).then((data)=>validatePose(data,form)).catch((error)=>{if(error.name==='AbortError')throw error;warning=error.message;return null;});
    const [data,runtime,gameRuntime]=await Promise.all([dataPromise,runtimePromise,gameRuntimePromise,gameProgressPromise]);
    if(generation!==state.loadGeneration||operation!==state.operation)return;
    state.data=data;state.runtime=runtime;state.sampleMap=new Map((data?.samples||[]).map((sample)=>[sample.frameIndex,sample]));
    state.game.runtime=gameRuntime;
    if(data&&gameRuntime)state.game.references=new Map(form.steps.map((step)=>[step.id,gameRuntime.prepareFourPointStep(form,step,data)]));
    prepareReference();
    saveGameProgress();
    if(!await seekPair(range().startSeconds,operation)||generation!==state.loadGeneration)return;
    state.ready=true;updateControls();render(true);
    if(warning||!runtime||(GAME_ENABLED&&!gameRuntime))showError(`${warning||'The optional camera comparison module could not load.'} Video learning and manual Next remain available.`);
    setStatus('Ready · watch slowly, then take as much practice time as you need.');
    if(autoplay)await playPair(true);
  }catch(error){if(generation===state.loadGeneration&&operation===state.operation&&error.name!=='AbortError'){showError(error.message);setStatus(error.message,true);}}
}
function loadVideo(video,source) {
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>finish(new Error('The original recording took too long to load. Use Retry lesson.')),30000);
    const loaded=()=>finish(),failed=()=>finish(new Error('The original recording could not be decoded.'));
    function finish(error){clearTimeout(timeout);video.removeEventListener('loadeddata',loaded);video.removeEventListener('error',failed);error?reject(error):resolve();}
    video.addEventListener('loadeddata',loaded);video.addEventListener('error',failed);
    video.muted=true;video.playsInline=true;video.src=source.src;video.load();
  });
}
function frameTeacherVideos() {
  for(const [view,crop] of Object.entries(TEACHER_FRAMING)) {
    const source=state.manifest.sources[view],stage=$(`${view}-pixels`),plane=$(`${view}-source`);
    stage.style.setProperty('--teacher-aspect',String(source.width*crop.width/(source.height*crop.height)));
    plane.style.left=`${-100*crop.x/crop.width}%`;
    plane.style.top=`${-100*crop.y/crop.height}%`;
    plane.style.width=`${100/crop.width}%`;
    plane.style.height=`${100/crop.height}%`;
  }
}
async function boot() {
  pausePair();state.ready=false;showError(null);updateControls();$('form-select').disabled=true;
  try{
    state.manifest=validateManifest(await readJson('/practice-media/dual-view/manifest.json'));
    frameTeacherVideos();
    state.allSteps=state.manifest.forms.flatMap((form)=>form.steps.map((step)=>({form,step})));
    $('form-select').replaceChildren(...state.manifest.forms.map((form)=>new Option(`${String(form.formNumber).padStart(2,'0')} · ${form.title}`,form.id)));
    await Promise.all(Object.entries(videos).map(([name,video])=>loadVideo(video,state.manifest.sources[name])));
    const params=new URLSearchParams(location.search),requested=params.get('form');
    const initial=state.manifest.forms.find((form)=>form.id===requested||String(form.formNumber)===requested||String(form.formNumber).padStart(2,'0')===requested)||state.manifest.forms[0];
    $('form-select').disabled=false;
    await selectForm(initial,params.get('step'));
    if(state.ready&&state.auto.enabled&&!state.auto.paused)beginAutomatic();
  }catch(error){showError(error.message);setStatus(error.message,true);}
}
function setLayout(primary=$('teacher-views').dataset.primary,mode=$('teacher-views').dataset.mode) {
  $('teacher-views').dataset.primary=primary;$('teacher-views').dataset.mode=mode;
  $('back-role').textContent=primary==='back'?'Main · follow along':'Detail · observe';
  $('front-role').textContent=primary==='front'?'Main · mirrored detail':'Detail · observe';
  $('restore-views').hidden=mode==='dual';
  $('swap-views').textContent=primary==='back'?'Make front main':'Make back main';
  drawTeacher(sampleAt(videos.front.currentTime),true);
}
async function initializeCamera() {
  try{
    const {createFollowCamera}=await import('./follow-teacher-camera.js');
    state.camera=createFollowCamera({video:$('camera-video'),canvas:$('camera-overlay'),deviceSelect:$('camera-device'),startButton:$('start-camera'),stopButton:$('stop-camera'),mirrorCheckbox:$('mirror-preview'),skeletonCheckbox:$('learner-skeleton'),statusElement:$('camera-status'),pointIndices:POINTS,showConnections:false,pointColors:POINT_COLORS,onObservation:observeCamera,onState:(status)=>{
      $('camera-empty').hidden=!!status.running;
      if(state.auto.awaitingCamera&&status.running){state.auto.awaitingCamera=false;beginAutomatic();}
      else if(state.auto.awaitingCamera&&status.phase==='error'){
        state.auto.awaitingCamera=false;beginAutomatic();
        setStatus('Camera unavailable · video preview continues, with no observed passes.');
      }
      else if(state.auto.awaitingCamera&&status.phase==='idle'){
        state.auto.awaitingCamera=false;beginAutomatic();
        setStatus('Camera start canceled · video preview continues, with no observed passes.');
      }
      updateControls();
      renderFeedback();
    }});
    updateControls();
  }catch{
    $('camera-status').textContent='Optional camera feedback is unavailable. The complete video lesson remains available.';
    $('start-camera').disabled=true;
  }
}
$('practice-toggle').addEventListener('click',()=>{if(state.auto.paused)void resumeAutomatic();else pauseAutomatic();});
$('end-practice').addEventListener('click',()=>stopAutomatic());
$('start-practice').addEventListener('click',async()=>{
  if(!state.ready||!state.camera)return;
  stopAutomatic('Preparing camera-guided practice…',false);
  const generation=state.auto.generation;
  if(state.finished){state.auto.results.clear();state.completed.clear();await selectForm(GAME_ENABLED?state.form:state.manifest.forms[0]);}
  if(generation!==state.auto.generation)return;
  state.auto.enabled=true;state.auto.paused=false;state.auto.awaitingCamera=true;setAutomaticPhase('camera');
  if(state.camera.getState().running){state.auto.awaitingCamera=false;beginAutomatic();}else $('start-camera').click();
});
$('play').addEventListener('click',()=>{if(state.auto.paused)void resumeAutomatic();else if(!state.auto.enabled)beginAutomatic();else pauseAutomatic();});
$('replay').addEventListener('click',()=>beginAutomatic());
$('speed').addEventListener('change',()=>{state.speed=Number($('speed').value);try{setRates();}catch{pausePair('This playback speed is unavailable.');}});
async function chooseAutomatically(entry){
  if(!entry)return;
  stopAutomatic('Preparing the selected step…',false);
  if(GAME_ENABLED&&entry.form.id!==state.form.id){state.auto.results.clear();state.completed.clear();}
  const generation=state.auto.generation;
  if(entry.form.id===state.form.id)await selectStep(entry.step,false);else await selectForm(entry.form,entry.step.id,false);
  if(state.ready&&generation===state.auto.generation)beginAutomatic();
}
$('form-select').addEventListener('change',()=>{const form=state.manifest?.forms.find((f)=>f.id===$('form-select').value);if(form)void chooseAutomatically({form,step:form.steps[0]});});
$('step-select').addEventListener('change',()=>{const step=state.form.steps.find((s)=>s.id===$('step-select').value);if(step)void chooseAutomatically({form:state.form,step});});
for(const [id,offset]of[['step-prev',-1],['step-next',1]])$(id).addEventListener('click',()=>{
  if(!state.ready)return;
  if(offset===1){state.auto.results.set(state.step.id,{stepId:state.step.id,status:'skipped'});saveGameProgress();if(currentIndex()===state.allSteps.length-1){stopAutomatic('Session finished manually. The final step was skipped, not marked passed.');state.finished=true;renderSelections();showGameFinish();return;}}
  const entry=state.allSteps[clamp(currentIndex()+offset,0,state.allSteps.length-1)];
  void chooseAutomatically(entry);
});
function beginScrub(){if(state.scrubbing)return;pauseAutomatic('Paused for timeline inspection. Resume to continue automatically.');state.auto.phase='demonstrating';state.auto.deadlineMs=null;state.auto.remainingMs=0;state.scrubResume=false;pausePair();state.scrubbing=true;state.held=false;resetSession();}
$('seek').addEventListener('input',()=>{
  if(!state.ready)return;beginScrub();clearTimeout(state.scrubTimer);
  const time=range().startSeconds+Number($('seek').value)/1000*(range().endSeconds-range().startSeconds),operation=state.operation;
  $('elapsed').textContent=`${timeText(time-range().startSeconds)} / ${timeText(range().endSeconds-range().startSeconds)}`;
  state.scrubTimer=setTimeout(()=>{if(operation===state.operation)void seekPair(time,operation).catch((error)=>setStatus(error.message,true));},40);
});
$('seek').addEventListener('change',async()=>{
  if(!state.ready)return;clearTimeout(state.scrubTimer);
  const time=range().startSeconds+Number($('seek').value)/1000*(range().endSeconds-range().startSeconds),resume=state.scrubResume,operation=state.operation;
  state.scrubbing=false;state.scrubResume=false;
  try{if(await seekPair(time,operation)){if(resume)void playPair();else setStatus('Paused at this movement phase · both views remain linked.');}}catch(error){if(operation===state.operation)setStatus(error.message,true);}
});
$('teacher-skeleton').addEventListener('change',()=>render(true));
$('mirror-preview').addEventListener('change',()=>drawGameGuides());
$('learner-skeleton').addEventListener('change',()=>drawGameGuides());
$('game-replay-level').addEventListener('click',()=>{$('game-finish').hidden=true;$('start-practice').click();});
$('swap-views').addEventListener('click',()=>{const primary=$('teacher-views').dataset.primary==='back'?'front':'back';setLayout(primary,$('teacher-views').dataset.mode==='dual'?'dual':primary);});
$('enlarge-back').addEventListener('click',()=>setLayout('back','back'));
$('enlarge-front').addEventListener('click',()=>setLayout('front','front'));
$('restore-views').addEventListener('click',()=>setLayout($('teacher-views').dataset.primary,'dual'));
$('retry').addEventListener('click',async()=>{stopAutomatic('Retrying the local reference…',false);if(state.manifest&&state.form&&Object.values(videos).every((v)=>v.readyState>=2)){await selectForm(state.form,state.step?.id);if(state.ready)beginAutomatic();}else void boot();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseAutomatic('Paused while the page is hidden. Press Start practice to resume the camera.');state.observation=null;resetSession();}});
document.addEventListener('keydown',(event)=>{if(event.code==='Space'&&!event.repeat&&!event.target.closest('button,input,select,a,summary,textarea')){event.preventDefault();if(state.ready)$('play').click();}});
for(const[name,video]of Object.entries(videos)){
  video.addEventListener('seeking',()=>render(true));video.addEventListener('seeked',()=>render(true));
  video.addEventListener('waiting',()=>{if(state.playing)setStatus('The recording is buffering. Both views remain phase-linked.');});
  video.addEventListener('error',()=>{if(state.ready){pauseAutomatic();state.ready=false;updateControls();showError(`The ${name} recording could not be decoded. Use Retry lesson.`);}});
}
window.addEventListener('pagehide',()=>{stopAutomatic('Page closed.');state.aborter?.abort();state.camera?.destroy();});
Object.defineProperty(window,'followTeacherDiagnostics',{get:()=>({
  ready:state.ready,formId:state.form?.id,stepId:state.step?.id,formCount:state.manifest?.forms.length||0,stepCount:state.allSteps.length,
  frontTime:videos.front.currentTime,backTime:videos.back.currentTime,playing:state.playing,starting:state.starting,held:state.held,speed:state.speed,
  selection:state.step?JSON.parse(JSON.stringify(state.step)):null,anchors:state.anchors.map((a)=>({...a})),
  driftSeconds:state.step?videos.back.currentTime-mapping(videos.front.currentTime).time:null,
  sampleFrame:sampleAt(videos.front.currentTime)?.frameIndex??null,poseRequests:[...state.poseRequests],
  focus:state.reference?{joints:[...state.reference.focusJoints],label:state.reference.focusLabel,rulesVersion:state.feedback?.rulesVersion,referenceEvidence:state.reference.referenceEvidence}:null,
  feedback:state.feedback?{status:state.feedback.status,message:state.feedback.message}:null,
  camera:state.camera?.getState()||null,layout:{primary:$('teacher-views').dataset.primary,mode:$('teacher-views').dataset.mode},
  teacherFraming:JSON.parse(JSON.stringify(TEACHER_FRAMING)),
  teacherOverlayJoints:[...state.game.teacherDrawnIndices],totalMicrosteps:state.manifest?.forms.reduce((total,form)=>total+form.steps.length,0)||0,
  game:{enabled:GAME_ENABLED,formId:state.game.formId,formNumber:state.form?.formNumber,formComplete:state.game.formComplete,
    stars:state.game.stars,saved:state.game.saved?JSON.parse(JSON.stringify({...state.game.saved,progress:undefined})):null,
    storageError:state.game.storageError,targets:state.game.reference?JSON.parse(JSON.stringify(state.game.reference)):null,
    guideDrawnIndices:[...state.game.guideDrawnIndices],liveDrawnIndices:state.camera?.getState().overlayJoints||[],
    projected:state.game.projected.map((guide)=>({index:guide.index,start:guide.start,end:guide.end,valid:guide.valid,required:guide.required})),
    trails:POINTS.map((index)=>({index,count:(state.game.trails.get(index)||[]).length})),eligibleStepIds:[...state.game.references.values()].filter((ref)=>ref.referenceUsable).map((ref)=>ref.id)},
  completed:[...state.completed],finished:state.finished,
  auto:{enabled:state.auto.enabled,phase:state.auto.phase,paused:state.auto.paused,round:state.auto.round,
    remainingMs:state.auto.remainingMs,feedbackStartedAtMs:state.auto.feedbackStartedAtMs,referenceState:referenceState(),
    progress:state.auto.progress?JSON.parse(JSON.stringify(state.auto.progress)):null,
    results:[...state.auto.results.values()].map((result)=>({...result})),attemptId:state.auto.attemptId,
    hold:state.auto.hold?{...state.auto.hold}:null,overlay:state.auto.overlay?JSON.parse(JSON.stringify(state.auto.overlay)):null,rules:{...AUTO_RULES}},
})});
updateControls();setLayout();requestAnimationFrame(tick);void initializeCamera();void boot();
