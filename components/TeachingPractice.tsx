'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { type PoseSample } from '../lib/imitation';
import { createImitationPoseClient } from '../lib/imitation-pose';
import { mapReferenceToLiveBody } from '../lib/practice-overlay';
import { clearCanvas, drawPose, readRecordedAnalysis, seekTo, waitForVideo, cameraErrorMessage, visibleJoints, type ReferenceAnalysis, type PracticeReferenceClip } from '../lib/practice-display';
import { listPracticeCameras, requestPracticeCamera, type PracticeCameraOption } from '../lib/practice-camera';
import { evaluateTeachingPose, updateTeachingHold, parseTeachingPlaylist, type TeachingPlaylist, type TeachingHold, type TeachingPoseResult } from '../lib/teaching';

type Phase = 'loading' | 'ready' | 'watching' | 'imitating' | 'paused' | 'matched' | 'complete' | 'error';
type PoseClient = Awaited<ReturnType<typeof createImitationPoseClient>>;
interface ParentClip extends PracticeReferenceClip { title: string; durationSeconds: number; sourceFile: string }
const SAMPLE_MS = 1000 / 12, FRESH_MS = 250;
const nearestPose = (samples: PoseSample[], tMs: number) => samples.length
  ? samples.reduce((best, sample) => Math.abs(sample.tMs - tMs) < Math.abs(best.tMs - tMs) ? sample : best) : undefined;

export default function TeachingPractice({ modeControl }: { modeControl?: ReactNode }) {
  const [lesson, setLesson] = useState<TeachingPlaylist | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhaseState] = useState<Phase>('loading');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(0.5);
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<TeachingPoseResult | null>(null);
  const [heldMs, setHeldMs] = useState(0);
  const [cameraState, setCameraState] = useState<'off' | 'loading' | 'ready'>('off');
  const [cameraLabel, setCameraLabel] = useState('');
  const [cameras, setCameras] = useState<PracticeCameraOption[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [visible, setVisible] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showLive, setShowLive] = useState(true);

  const video = useRef<HTMLVideoElement>(null), camera = useRef<HTMLVideoElement>(null);
  const referenceCanvas = useRef<HTMLCanvasElement>(null), guideCanvas = useRef<HTMLCanvasElement>(null), liveCanvas = useRef<HTMLCanvasElement>(null);
  const lessonRef = useRef<TeachingPlaylist | null>(null), parents = useRef<ParentClip[]>([]), indexRef = useRef(0);
  const phaseRef = useRef<Phase>('loading'), speedRef = useRef(0.5), autoRef = useRef(false);
  const showGuideRef = useRef(true), showLiveRef = useRef(true);
  const mounted = useRef(false), generation = useRef(0), cameraGeneration = useRef(0), runGeneration = useRef(0);
  const sourceModel = useRef<PoseClient | null>(null), liveModel = useRef<PoseClient | null>(null);
  const stream = useRef<MediaStream | null>(null), cache = useRef(new Map<string, ReferenceAnalysis>()), samples = useRef<PoseSample[]>([]);
  const parentId = useRef(''), lastLive = useRef<PoseSample | null>(null), liveAt = useRef(-Infinity);
  const lastSampleAt = useRef(-Infinity), lastCameraTime = useRef(-1), hold = useRef<TeachingHold | null>(null);
  const completedRef = useRef<string[]>([]), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadStepRef = useRef<(next: number, play?: boolean) => Promise<void>>(async () => {});
  const watchRef = useRef<() => Promise<void>>(async () => {}), advanceRef = useRef<(kind: 'manual' | 'matched') => void>(() => {});
  const stopAtTargetRef = useRef<() => void>(() => {});
  const setPhase = useCallback((value: Phase) => { phaseRef.current = value; setPhaseState(value); }, []);
  const resetHold = useCallback(() => { hold.current = null; setHeldMs(0); setFeedback(null); }, []);
  const cancelRun = useCallback(() => {
    runGeneration.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; video.current?.pause();
    hold.current = null; setHeldMs(0);
  }, []);
  const pause = useCallback(() => { cancelRun(); if (mounted.current) setPhase('paused'); }, [cancelRun, setPhase]);
  const stopCamera = useCallback(() => {
    cameraGeneration.current++;
    stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); }); stream.current = null;
    if (camera.current) camera.current.srcObject = null;
    liveModel.current?.close(); liveModel.current = null; lastLive.current = null;
    clearCanvas(liveCanvas.current); clearCanvas(guideCanvas.current);
    hold.current = null;
    if (mounted.current) { setCameraState('off'); setCameraLabel(''); setVisible(0); setHeldMs(0); setFeedback(null); }
    cancelRun();
    if (mounted.current && !['loading', 'ready', 'complete', 'error'].includes(phaseRef.current)) setPhase('paused');
  }, [cancelRun, setPhase]);

  const watch = useCallback(async () => {
    const step = lessonRef.current?.steps[indexRef.current], source = video.current;
    if (!step || !source || !samples.current.length || phaseRef.current === 'loading') return;
    cancelRun(); resetHold(); const token = runGeneration.current;
    try {
      await seekTo(source, step.startSeconds);
      if (!mounted.current || token !== runGeneration.current) return;
      source.playbackRate = speedRef.current; setElapsed(0); setError(''); setPhase('watching');
      await source.play();
      if (token !== runGeneration.current) source.pause();
    } catch (cause) { if (mounted.current && token === runGeneration.current) { setError(cameraErrorMessage(cause)); setPhase('paused'); } }
  }, [cancelRun, resetHold, setPhase]);
  watchRef.current = watch;

  const loadStep = useCallback(async (next: number, play = false) => {
    const step = lessonRef.current?.steps[next]; if (!step) return;
    cancelRun(); resetHold(); const token = ++generation.current, playbackToken = runGeneration.current;
    sourceModel.current?.close(); sourceModel.current = null;
    indexRef.current = next; setIndex(next); setReady(false); setError(''); setElapsed(0); setPhase('loading');
    clearCanvas(referenceCanvas.current); clearCanvas(guideCanvas.current);
    const source = video.current, parent = parents.current.find((item) => item.id === step.parentFormId);
    if (!source || !parent) { setError('This step has no source form. Reload the lesson.'); setPhase('error'); return; }
    let model: PoseClient | null = null;
    try {
      if (parentId.current !== parent.id || !source.currentSrc || new URL(source.currentSrc, window.location.href).pathname !== parent.src || source.error) {
        source.src = parent.src; source.load();
        if (source.readyState < 2) await waitForVideo(source, 'loadeddata');
      }
      if (!mounted.current || token !== generation.current) return;
      if (!Number.isFinite(source.duration) || step.endSeconds > source.duration + 0.05) throw new Error('The step exceeds its actual source video.');
      let analysis = cache.current.get(parent.id);
      if (!analysis) analysis = await readRecordedAnalysis(parent, source) ?? undefined;
      if (!mounted.current || token !== generation.current) return;
      if (!analysis) {
        model = await createImitationPoseClient();
        if (!mounted.current || token !== generation.current) { model.close(); model = null; return; }
        sourceModel.current = model;
        const observed: PoseSample[] = [], durationMs = source.duration * 1000;
        for (let tMs = 0; tMs < durationMs; tMs += SAMPLE_MS) {
          if (!mounted.current || token !== generation.current) return;
          const time = Math.min(tMs, durationMs - 15);
          await seekTo(source, time / 1000);
          if (!mounted.current || token !== generation.current) return;
          observed.push({ tMs: time, ...model.estimate(source, time + 1) });
        }
        analysis = { samples: observed, durationMs };
        model.close(); sourceModel.current = null; model = null;
      }
      if (!mounted.current || token !== generation.current) return;
      cache.current.set(parent.id, analysis); samples.current = analysis.samples; parentId.current = parent.id;
      await seekTo(source, step.startSeconds);
      if (!mounted.current || token !== generation.current) return;
      source.playbackRate = speedRef.current; setReady(true);
      if (phaseRef.current !== 'paused') setPhase('ready');
      if (play && playbackToken === runGeneration.current && !document.hidden) await watchRef.current();
    } catch (cause) {
      if (mounted.current && token === generation.current) { samples.current = []; setError(cause instanceof Error ? cause.message : 'The teaching step could not load.'); setPhase('error'); }
    } finally { if (model && sourceModel.current === model) { model.close(); sourceModel.current = null; } }
  }, [cancelRun, resetHold, setPhase]);
  loadStepRef.current = loadStep;

  useEffect(() => {
    mounted.current = true; let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/practice-media/teaching-playlist.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('The step-by-step lesson is unavailable. Retry after the local lesson assets are prepared.');
        const next = parseTeachingPlaylist(await response.json());
        const referenceResponse = await fetch(next.referencePlaylistSrc, { cache: 'no-store' });
        if (!referenceResponse.ok) throw new Error('The instructor form list is unavailable.');
        const reference = await referenceResponse.json();
        if (!Array.isArray(reference.clips) || next.steps.some((step) => !reference.clips.some((item: ParentClip) => item.id === step.parentFormId))) throw new Error('Teaching steps do not match the instructor forms.');
        if (cancelled) return;
        parents.current = reference.clips; lessonRef.current = next; setLesson(next);
        await loadStepRef.current(0);
      } catch (cause) { if (!cancelled) { setError(cause instanceof Error ? cause.message : 'Lesson loading failed.'); setPhase('error'); } }
    })();
    const refresh = () => { void listPracticeCameras().then((items) => { if (!cancelled) setCameras(items); }).catch(() => {}); };
    refresh(); navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    const hide = () => { if (document.hidden) { cancelRun(); if (!['loading', 'complete', 'error'].includes(phaseRef.current)) setPhase('paused'); clearCanvas(liveCanvas.current); clearCanvas(guideCanvas.current); lastLive.current = null; } };
    const pageHide = () => stopCamera();
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', pageHide);
    return () => {
      cancelled = true; mounted.current = false; generation.current++; stopCamera();
      sourceModel.current?.close(); sourceModel.current = null;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', pageHide);
    };
  }, [cancelRun, setPhase, stopCamera]);

  const startCamera = async () => {
    const token = ++cameraGeneration.current; setCameraState('loading'); setError('');
    try {
      const opened = await requestPracticeCamera(selectedCamera);
      if (!mounted.current || token !== cameraGeneration.current || !camera.current) { opened.getTracks().forEach((track) => track.stop()); return; }
      stream.current = opened; camera.current.srcObject = opened; await camera.current.play();
      if (!mounted.current || token !== cameraGeneration.current) return;
      const model = await createImitationPoseClient();
      if (!mounted.current || token !== cameraGeneration.current) { model.close(); return; }
      liveModel.current = model; lastCameraTime.current = -1; lastSampleAt.current = -Infinity;
      opened.getTracks().forEach((track) => { track.onended = () => { stopCamera(); if (mounted.current) setError('The camera disconnected. Choose a camera and start it again.'); }; });
      setCameraLabel(opened.getVideoTracks()[0]?.label ?? ''); setCameraState('ready');
      void listPracticeCameras().then((items) => { if (mounted.current && token === cameraGeneration.current) setCameras(items); }).catch(() => {});
    } catch (cause) { if (mounted.current && token === cameraGeneration.current) { stopCamera(); setError(cameraErrorMessage(cause)); } }
  };

  const advance = useCallback((kind: 'manual' | 'matched') => {
    const all = lessonRef.current?.steps, step = all?.[indexRef.current]; if (!all || !step) return;
    cancelRun();
    const done = [...new Set([...completedRef.current, step.id])]; completedRef.current = done; setCompleted(done);
    if (done.length === all.length) { setPhase('complete'); return; }
    const next = [...all.keys()].map((offset) => (indexRef.current + offset + 1) % all.length).find((candidate) => !done.includes(all[candidate].id))!;
    if (kind === 'matched') {
      setPhase('matched'); const token = runGeneration.current;
      timer.current = setTimeout(() => { if (mounted.current && token === runGeneration.current && !document.hidden) void loadStepRef.current(next, true); }, 1100);
    } else void loadStepRef.current(next, true);
  }, [cancelRun, setPhase]);
  advanceRef.current = advance;

  const stopAtTarget = useCallback(() => {
    const step = lessonRef.current?.steps[indexRef.current], source = video.current;
    if (!source || !step || phaseRef.current !== 'watching') return;
    source.pause(); hold.current = null; setHeldMs(0); setFeedback(null);
    setElapsed(step.endSeconds - step.startSeconds); setPhase('imitating');
    const token = runGeneration.current;
    void seekTo(source, Math.min(source.duration - 0.02, Math.max(step.startSeconds, step.targetSeconds ?? step.endSeconds - 1 / 30))).catch(() => {
      if (mounted.current && token === runGeneration.current) { setError('The demonstration could not hold its final frame. Replay this step.'); setPhase('paused'); }
    });
  }, [setPhase]);
  stopAtTargetRef.current = stopAtTarget;

  useEffect(() => {
    let frame = 0, lastUi = 0;
    const tick = () => {
      if (!mounted.current) return;
      const now = performance.now(), source = video.current, liveVideo = camera.current;
      const step = lessonRef.current?.steps[indexRef.current];
      if (source && step && phaseRef.current === 'watching' && source.currentTime >= step.endSeconds - 0.025) stopAtTargetRef.current();
      if (liveVideo && stream.current && liveModel.current && liveVideo.readyState >= 2 && !document.hidden && now - lastSampleAt.current >= SAMPLE_MS && liveVideo.currentTime !== lastCameraTime.current) {
        lastSampleAt.current = now; lastCameraTime.current = liveVideo.currentTime;
        let observation: PoseSample;
        try { observation = { tMs: now, ...liveModel.current.estimate(liveVideo, now) }; }
        catch { observation = { tMs: now, status: 'inference_error', landmarks: [] }; }
        const age = performance.now() - now;
        liveAt.current = now; lastLive.current = age < FRESH_MS && observation.status === 'pose' ? observation : null;
        drawPose(liveCanvas.current, liveVideo, showLiveRef.current && age < FRESH_MS ? observation : undefined, FRESH_MS - age);
        setVisible(age < FRESH_MS ? visibleJoints(observation) : 0);
        if (step && source && phaseRef.current === 'imitating') {
          const nearest = nearestPose(samples.current, source.currentTime * 1000);
          const target = nearest && Math.abs(nearest.tMs - source.currentTime * 1000) <= 150 ? nearest : undefined;
          const evaluation = evaluateTeachingPose(target, observation, {
            referenceAspectRatio: source.videoWidth / source.videoHeight,
            attemptAspectRatio: liveVideo.videoWidth / liveVideo.videoHeight,
            focusJoints: step.focusJoints, liveAgeMs: age, maximumLiveAgeMs: FRESH_MS,
          });
          setFeedback(evaluation);
          hold.current = updateTeachingHold(hold.current, evaluation, now, { targetKey: step.id, enabled: autoRef.current, maximumSampleGapMs: FRESH_MS });
          setHeldMs(hold.current.heldMs);
          if (autoRef.current && hold.current.ready) advanceRef.current('matched');
        }
      }
      const liveRemaining = FRESH_MS - (performance.now() - liveAt.current);
      if (liveRemaining <= 0) { if (lastLive.current) setFeedback(null); lastLive.current = null; clearCanvas(liveCanvas.current); clearCanvas(guideCanvas.current); hold.current = null; if (now - lastUi > 100) { setVisible(0); setHeldMs(0); } }
      if (source && samples.current.length && step && phaseRef.current !== 'loading') {
        const estimated = nearestPose(samples.current, source.currentTime * 1000);
        const fresh = estimated && Math.abs(estimated.tMs - source.currentTime * 1000) <= 150;
        drawPose(referenceCanvas.current, source, fresh ? estimated : undefined, undefined, true);
        const aligned = showGuideRef.current && fresh && lastLive.current && liveVideo?.videoHeight && liveRemaining > 0
          ? mapReferenceToLiveBody(estimated, lastLive.current, { referenceAspectRatio: source.videoWidth / source.videoHeight, liveAspectRatio: liveVideo.videoWidth / liveVideo.videoHeight, liveAgeMs: performance.now() - liveAt.current, maximumLiveAgeMs: FRESH_MS }) : null;
        drawPose(guideCanvas.current, liveVideo, aligned ?? undefined, liveRemaining, true);
        if (now - lastUi >= 100 && phaseRef.current === 'watching') setElapsed(Math.max(0, Math.min(step.endSeconds - step.startSeconds, source.currentTime - step.startSeconds)));
      }
      if (now - lastUi >= 100) lastUi = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, []);

  const step = lesson?.steps[index], total = lesson?.steps.length ?? 0;
  const formSteps = lesson?.steps.filter((item) => item.parentFormId === step?.parentFormId) ?? [];
  const forms = lesson?.steps.filter((item) => item.stepOrder === 1) ?? [];
  const duration = step ? step.endSeconds - step.startSeconds : 0;
  const canNavigate = ready && !['loading', 'matched', 'complete', 'error'].includes(phase);
  const instruction = phase === 'watching' ? 'Watch this small movement slowly. It will stop at the end.' : phase === 'imitating' ? auto ? 'Take your time. A loose match held briefly can move you on. Next step is always available.' : 'Take your time. Copy the held pose, then choose Next step when you are ready.' : phase === 'matched' ? 'Close enough. Preparing the next small step…' : phase === 'paused' ? 'Paused. Replay this small step or continue at your own pace.' : phase === 'complete' ? 'You confirmed every small step in this lesson. You can go through it again whenever you like.' : 'One small movement, then a pause. You decide when to continue.';

  return <div className="practice-page teaching-page" data-step-id={step?.id ?? ''} data-parent-form={step?.parentFormOrder ?? 0} data-step-phase={phase} data-completed-steps={completed.length}>
    <header className="practice-header"><div className="practice-brand"><span className="practice-brand-symbol" aria-hidden="true">m</span>MotionTrial</div><div className="practice-header-right"><Link href="/">Assessment workspace ↗</Link><span className="practice-prototype">Learn at your own pace</span></div></header>
    {modeControl}
    <div className="practice-intro"><div><div className="practice-kicker">24 forms · guided learning</div><h1>One small step at a time.</h1><p>Slow demonstration. A held target. As much time as you need.</p></div><div className="practice-action-count"><strong>{step?.parentFormOrder ?? '—'}</strong><span>form of 24 · step {step?.stepOrder ?? '—'} / {formSteps.length || '—'}</span></div></div>
    <div className="teaching-options"><label>Form <select aria-label="Teaching form" value={step?.parentFormOrder ?? ''} disabled={!lesson} onChange={(event) => { const next = lesson?.steps.findIndex((item) => item.parentFormOrder === Number(event.target.value)); if (next !== undefined && next >= 0) void loadStep(next); }}>{forms.map((item) => <option key={item.parentFormId} value={item.parentFormOrder}>{String(item.parentFormOrder).padStart(2, '0')} · {item.parentFormTitle}</option>)}</select></label><label>Speed <select aria-label="Demonstration speed" value={speed} onChange={(event) => { const next = Number(event.target.value); speedRef.current = next; setSpeed(next); if (video.current) video.current.playbackRate = next; }}><option value="0.25">Extra slow · 0.25×</option><option value="0.5">Slow · 0.5×</option><option value="0.75">Gentle · 0.75×</option><option value="1">Original · 1×</option></select></label><label><input type="checkbox" checked={auto} onChange={(event) => { autoRef.current = event.target.checked; setAuto(event.target.checked); resetHold(); }} />Auto advance when close</label></div>
    <ol className="teaching-step-strip" aria-label="Small steps in this form">{formSteps.map((item) => <li key={item.id}><button aria-label={'Practice step ' + item.stepOrder + ': ' + item.title} aria-current={item.id === step?.id ? 'step' : undefined} data-completed={completed.includes(item.id)} onClick={() => { const next = lesson!.steps.findIndex((candidate) => candidate.id === item.id); void loadStep(next); }}><span>{completed.includes(item.id) ? '✓' : item.stepOrder}</span>{item.title}</button></li>)}</ol>
    <section className="teaching-instruction" aria-label="Current small step"><div role="status" aria-live="polite"><div className="practice-kicker">{phase === 'imitating' ? 'Your turn · no time limit' : phase === 'watching' ? 'Slow demonstration' : 'Your next small step'}</div><h2>{step?.title ?? 'Preparing the lesson'}</h2><p className="teaching-cue">{step?.cue ?? 'Reading the locally reviewed teaching steps…'}</p><p>{instruction}</p>{feedback && phase === 'imitating' && <p className={'teaching-feedback ' + feedback.status}>{feedback.status === 'close' ? 'You are in the relaxed range.' : feedback.status === 'unknown' ? 'Some pose points are unclear. You can replay or continue manually.' : 'Keep adjusting gently, or continue when you feel ready.'}{auto && feedback.status === 'close' ? ' Hold: ' + Math.min(100, Math.round(heldMs / 700 * 100)) + '%' : ''}</p>}</div><div className="teaching-actions">{phase === 'complete' ? <button className="practice-button" onClick={() => { completedRef.current = []; setCompleted([]); void loadStep(0); }}>Start another round</button> : <><button className="practice-button secondary" disabled={!canNavigate || index === 0} onClick={() => void loadStep(index - 1)}>Previous step</button>{phase === 'watching' || phase === 'matched' ? <button className="practice-button secondary" onClick={pause}>Pause</button> : <button className="practice-button secondary" disabled={!canNavigate} onClick={() => void watch()}>{phase === 'ready' ? 'Watch slowly' : 'Replay step'}</button>}<button className="practice-button" disabled={!canNavigate} onClick={() => advance('manual')}>Next step →</button></>}</div></section>
    <div className="practice-progress" role="progressbar" aria-label="Small step demonstration" aria-valuemin={0} aria-valuemax={100} aria-valuenow={duration ? Math.round(elapsed / duration * 100) : 0}><span style={{ width: (duration ? Math.min(100, elapsed / duration * 100) : 0) + '%' }} /></div>
    {error && <div className="practice-error" role="alert">{error}{phase === 'error' && <button className="practice-button secondary" onClick={() => lesson ? void loadStep(index) : window.location.reload()}>Retry lesson</button>}</div>}
    <div className="practice-settings teaching-legend"><p><span className="practice-legend guide" />Amber: instructor <span className="practice-legend learner" />Mint: you</p><span>{completed.length} / {total} small steps confirmed · original outdoor recording</span></div>
    <div className="practice-workspace">
      <section className="practice-panel" aria-labelledby="teaching-reference-heading"><div className="practice-panel-heading"><div><h2 id="teaching-reference-heading">Small-step demonstration</h2><p>{step?.parentFormTitle ?? '24-form instructor video'}{duration ? ' · ' + (duration / speed).toFixed(1) + ' seconds at ' + speed + '×' : ''}</p></div><span className="practice-source-tag">Recorded video + MediaPipe</span></div><div className="practice-stage"><div className="practice-media"><video ref={video} aria-label="Recorded reference movement" muted playsInline preload="auto" onEnded={() => stopAtTargetRef.current()} /><canvas ref={referenceCanvas} aria-label="Pose estimated from the reference clip" /></div>{phase === 'loading' && <div className="practice-stage-empty"><strong>Preparing this small step</strong><p>Reading real local instructor video and pose observations.</p></div>}{phase === 'imitating' && <span className="practice-stage-badge">HELD TARGET · take your time</span>}</div><div className="practice-panel-foot"><span>{phase === 'watching' ? 'Slow demonstration in progress' : phase === 'imitating' ? 'Target held · no countdown' : 'Replay as often as you like'}</span><span>{step ? 'Source ' + step.sourceStartSeconds.toFixed(2) + '–' + step.sourceEndSeconds.toFixed(2) + ' s' : ''}</span></div></section>
      <section className="practice-panel" aria-labelledby="teaching-camera-heading"><div className="practice-panel-heading"><div><h2 id="teaching-camera-heading">Your camera</h2><p>Line up your mint skeleton with the amber guide</p></div>{cameraState === 'off' ? <button className="practice-button secondary" onClick={() => void startCamera()}>Start camera</button> : <button className="practice-button secondary" onClick={stopCamera}>Stop camera</button>}</div><div className="practice-stage"><div className={'practice-media ' + (mirror ? 'mirrored' : '')}><video ref={camera} aria-label="Live camera preview" muted playsInline autoPlay /><canvas ref={guideCanvas} className="practice-guide-canvas" aria-label="Reference skeleton aligned to your body" /><canvas ref={liveCanvas} aria-label="Pose estimated from the live camera" /></div>{cameraState !== 'ready' && <div className="practice-stage-empty"><strong>{cameraState === 'loading' ? 'Preparing your camera' : 'Camera is optional for self-paced learning'}</strong><p>{cameraState === 'loading' ? 'Allow camera access if your browser asks.' : 'Watch, copy, and choose Next step. Start the camera for both skeletons in this frame.'}</p></div>}</div><div className="practice-panel-foot"><span>{cameraState === 'ready' ? visible ? visible + '/12 joints visible' : 'No body detected · keep your hands and feet in view' : cameraState === 'loading' ? 'Camera/model loading' : 'Camera off'}</span><label className="practice-mirror"><input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} />Mirror preview</label></div><div className="practice-camera-settings"><label>Camera <select aria-label="Camera device" value={selectedCamera} disabled={cameraState === 'loading'} onChange={(event) => { stopCamera(); setSelectedCamera(event.target.value); }}><option value="">Default camera</option>{cameras.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label}</option>)}</select></label><div><label><input type="checkbox" checked={showLive} onChange={(event) => { showLiveRef.current = event.target.checked; setShowLive(event.target.checked); if (!event.target.checked) clearCanvas(liveCanvas.current); }} />Show my skeleton</label><label><input type="checkbox" checked={showGuide} onChange={(event) => { showGuideRef.current = event.target.checked; setShowGuide(event.target.checked); if (!event.target.checked) clearCanvas(guideCanvas.current); }} />Show instructor guide</label></div></div>{cameraLabel && <p className="practice-camera-hint">{cameraLabel} · live video stays in this browser</p>}</section>
    </div>
    <div className="practice-notes"><p>Self-paced learning counts the steps you confirm.<br />There is no timed attempt or automatic retry. Pause and replay whenever you need.</p><details><summary>About this learning mode</summary><p>Each form is manually divided at visible movement transitions. The demonstration uses windows of the original instructor clip at your selected speed. The final frame waits while you imitate.</p><p>Amber poses come from actual instructor observations; mint poses come only from your current camera. Auto advance is optional and compares a generous final-pose range after the demonstration, with a brief continuous hold. It is a learning aid rather than a complete movement assessment. Unknown tracking never grants an automatic match. Next step is your own confirmation, and does not claim that MediaPipe assessed a correct movement.</p></details></div>
  </div>;
}
