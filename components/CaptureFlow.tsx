'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPoseClient, type PoseClient } from '../lib/pose-client';
import { CONSENT, INSTRUCTIONS, MODEL_VERSION, TASK_ID, TASK_VERSION, type CaptureMetadata, type Observation, type Provenance } from '../lib/types';

type Phase = 'briefing' | 'setup' | 'recording' | 'finalizing' | 'recorded' | 'uploading' | 'saved';
type ResourceState = 'idle' | 'loading' | 'ready' | 'failed';
type Tracking = { status: 'waiting' | Observation['status']; visible: number };
const TASK_MS = 20_000;
const MAX_BYTES = 25 * 1024 * 1024;
const upperConnections = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];

function supportedMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

function cameraMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Camera access was denied. Allow the camera in your browser’s site settings, then retry. Audio is never requested.';
  if (name === 'NotFoundError') return 'No camera was found. Connect a camera, then retry.';
  if (name === 'NotReadableError') return 'The camera is unavailable. Close other apps using it, then retry.';
  return 'The camera could not start. Use localhost in desktop Chrome or Edge, check the camera connection and permissions, then retry.';
}

export default function CaptureFlow({ parentSessionId }: { parentSessionId?: string }) {
  const [phase, setPhase] = useState<Phase>('briefing');
  const [demoCode, setDemoCode] = useState('DEMO-001');
  const [demoCase, setDemoCase] = useState('normal');
  const [provenance, setProvenance] = useState<Provenance>('live_camera');
  const [consented, setConsented] = useState(false);
  const [cameraState, setCameraState] = useState<ResourceState>('idle');
  const [modelState, setModelState] = useState<ResourceState>('idle');
  const [cameraError, setCameraError] = useState('');
  const [modelError, setModelError] = useState('');
  const [error, setError] = useState('');
  const [containerWarning, setContainerWarning] = useState('');
  const [mime, setMime] = useState<string | null>(null);
  const [capabilityChecked, setCapabilityChecked] = useState(false);
  const [tracking, setTracking] = useState<Tracking>({ status: 'waiting', visible: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [aspectRatio, setAspectRatio] = useState('16 / 9');
  const [localUrl, setLocalUrl] = useState('');
  const [localSize, setLocalSize] = useState(0);
  const [recordInfo, setRecordInfo] = useState<CaptureMetadata | null>(null);
  const [observationCount, setObservationCount] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [savedId, setSavedId] = useState('');

  const mounted = useRef(true);
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const pose = useRef<PoseClient | null>(null);
  const cameraToken = useRef(0);
  const modelToken = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const activeCapture = useRef(false);
  const finalizeRecording = useRef<(() => void) | null>(null);
  const stopDuration = useRef<number | null>(null);
  const discardOnStop = useRef(false);
  const captureMeta = useRef<CaptureMetadata | null>(null);
  const observations = useRef<Observation[]>([]);
  const blob = useRef<Blob | null>(null);
  const objectUrl = useRef('');
  const consentAt = useRef('');
  const xhr = useRef<XMLHttpRequest | null>(null);
  const overlayAt = useRef(-Infinity);
  const overlayExpiry = useRef<Animation | null>(null);
  const trackingFresh = useRef(false);
  const lastSampleAt = useRef(-Infinity);
  const lastVideoTime = useRef(-1);

  const clearOverlay = useCallback(() => {
    const canvas = overlay.current;
    overlayExpiry.current?.cancel();
    overlayExpiry.current = null;
    if (canvas) canvas.style.opacity = '0';
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    trackingFresh.current = false;
  }, []);

  const releaseResources = useCallback(() => {
    cameraToken.current += 1;
    modelToken.current += 1;
    stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    pose.current?.close();
    pose.current = null;
    clearOverlay();
  }, [clearOverlay]);

  const finishCapture = useCallback((reason?: string, discard = false) => {
    if (!activeCapture.current || !captureMeta.current) return;
    const durationMs = Math.max(1, performance.now() - captureMeta.current.timing.performanceStartMs);
    stopDuration.current = durationMs;
    discardOnStop.current = discard;
    captureMeta.current.durationMs = durationMs;
    captureMeta.current.interrupted = Boolean(reason);
    if (reason) captureMeta.current.interruptionReason = reason;
    activeCapture.current = false;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    else finalizeRecording.current?.();
  }, []);

  const loadCamera = useCallback(async () => {
    const token = ++cameraToken.current;
    stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    stream.current = null;
    setCameraState('loading');
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
      const next = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      if (!mounted.current || token !== cameraToken.current || !video.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = next;
      video.current.srcObject = next;
      await video.current.play();
      if (token !== cameraToken.current || !mounted.current) return;
      next.getVideoTracks().forEach((track) => {
        track.onended = () => {
          clearOverlay();
          setTracking({ status: 'waiting', visible: 0 });
          setCameraState('failed');
          setCameraError('The camera stream ended. Reconnect your camera and retry setup.');
          finishCapture('The camera stream ended during recording.');
        };
      });
      lastVideoTime.current = -1;
      setCameraState('ready');
    } catch (cause) {
      if (mounted.current && token === cameraToken.current) {
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = null;
        setCameraState('failed');
        setCameraError(cameraMessage(cause));
      }
    }
  }, [clearOverlay, finishCapture]);

  const loadModel = useCallback(async () => {
    const token = ++modelToken.current;
    pose.current?.close();
    pose.current = null;
    clearOverlay();
    setTracking({ status: 'waiting', visible: 0 });
    setModelState('loading');
    setModelError('');
    try {
      const next = await createPoseClient();
      if (!mounted.current || token !== modelToken.current) { next.close(); return; }
      pose.current = next;
      setModelState('ready');
    } catch (cause) {
      if (mounted.current && token === modelToken.current) {
        setModelState('failed');
        const detail = cause instanceof Error ? cause.message : 'Unknown model error';
        setModelError(`Pose model could not load. Run npm run setup:assets, restart the app and retry. Check local model/WASM assets and this browser’s WebAssembly support. ${detail}`);
      }
    }
  }, [clearOverlay]);

  useEffect(() => {
    mounted.current = true;
    setMime(supportedMime());
    setCapabilityChecked(true);
    const onVisibility = () => {
      if (document.hidden) {
        clearOverlay();
        setTracking({ status: 'waiting', visible: 0 });
        finishCapture('The browser tab was hidden during recording.');
      }
    };
    const onPageHide = () => finishCapture('The recording page was closed or left.');
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (activeCapture.current || blob.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const preventUnsavedNavigation = (event: Event) => {
      if (!activeCapture.current && !blob.current) return;
      event.preventDefault();
      setError('Save or discard this recording before leaving the capture page.');
    };
    const onLinkClick = (event: MouseEvent) => {
      if ((!activeCapture.current && !blob.current) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!anchor || anchor.target === '_blank' || anchor.getAttribute('href')?.startsWith('#')) return;
      preventUnsavedNavigation(event);
      // Next Link handles navigation in React's bubble listener. Stop it before
      // the flow unmounts and loses the retained recording.
      event.stopPropagation();
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const onNavigate = (event: Event) => {
      if (event.cancelable && !(event as Event & { hashChange?: boolean }).hashChange) preventUnsavedNavigation(event);
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('click', onLinkClick, true);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    navigation?.addEventListener('navigate', onNavigate);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', onLinkClick, true);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      navigation?.removeEventListener('navigate', onNavigate);
      activeCapture.current = false;
      if (recorder.current?.state !== 'inactive') recorder.current?.stop();
      releaseResources();
      xhr.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [clearOverlay, finishCapture, releaseResources]);

  useEffect(() => {
    if (phase === 'setup') {
      void loadCamera();
      void loadModel();
    }
  }, [phase, loadCamera, loadModel]);

  useEffect(() => {
    let request = 0;
    let lastUiAt = 0;
    const tick = () => {
      const now = performance.now();
      if (activeCapture.current && captureMeta.current) {
        const duration = now - captureMeta.current.timing.performanceStartMs;
        if (now - lastUiAt >= 80) { setElapsed(Math.min(TASK_MS, duration)); lastUiAt = now; }
        if (duration >= TASK_MS) finishCapture();
      }
      const element = video.current;
      if (pose.current && stream.current && element && element.readyState >= 2 && !document.hidden
          && now - lastSampleAt.current >= 100 && element.currentTime !== lastVideoTime.current) {
        // Bound work to 10 Hz and new source frames; the timestamp precedes inference.
        const frameTimeMs = performance.now();
        const sourceMs = element.currentTime * 1000;
        lastSampleAt.current = frameTimeMs;
        lastVideoTime.current = element.currentTime;
        // Inference is synchronous: remove the previous drawing BEFORE doing
        // work, so a slow call cannot hold old coordinates on screen.
        clearOverlay();
        try {
          const estimate = pose.current.estimate(element, frameTimeMs);
          if (estimate.status === 'inference_error') throw new Error('The model returned invalid landmark values.');
          if (activeCapture.current && captureMeta.current) {
            observations.current.push({
              tMs: Math.max(0, frameTimeMs - captureMeta.current.timing.performanceStartMs),
              sourceVideoMs: Math.max(0, sourceMs - captureMeta.current.timing.videoStartMs),
              status: estimate.status,
              landmarks: estimate.landmarks,
            });
          }
          clearOverlay();
          const visible = estimate.landmarks.filter((point) => point.visibility >= 0.6).length;
          const stillFresh = performance.now() - frameTimeMs <= 250;
          setTracking(stillFresh ? { status: estimate.status, visible } : { status: 'waiting', visible: 0 });
          overlayAt.current = frameTimeMs;
          trackingFresh.current = stillFresh;
          const canvas = overlay.current;
          if (stillFresh && estimate.status === 'pose' && canvas) {
            canvas.width = element.videoWidth;
            canvas.height = element.videoHeight;
            const context = canvas.getContext('2d');
            if (context) {
              context.strokeStyle = '#35ded0';
              context.fillStyle = '#35ded0';
              context.lineWidth = Math.max(2, canvas.width / 320);
              const points = new Map(estimate.landmarks.filter((point) => point.visibility >= 0.6).map((point) => [point.index, point]));
              for (const [a, b] of upperConnections) {
                const start = points.get(a); const end = points.get(b);
                if (start && end) {
                  context.beginPath(); context.moveTo(start.x * canvas.width, start.y * canvas.height);
                  context.lineTo(end.x * canvas.width, end.y * canvas.height); context.stroke();
                }
              }
              for (const point of points.values()) {
                context.beginPath(); context.arc(point.x * canvas.width, point.y * canvas.height, Math.max(4, canvas.width / 180), 0, Math.PI * 2); context.fill();
              }
              canvas.style.opacity = '1';
              // Opacity expiry can run on the compositor even while the main
              // thread is busy. Freshness is measured from source sampling.
              overlayExpiry.current = canvas.animate([{ opacity: 1 }, { opacity: 1, offset: 0.999 }, { opacity: 0 }], {
                duration: Math.max(1, 250 - (performance.now() - frameTimeMs)), fill: 'forwards',
              });
            }
          }
        } catch (cause) {
          clearOverlay();
          setTracking({ status: 'inference_error', visible: 0 });
          if (activeCapture.current && captureMeta.current) {
            observations.current.push({
              tMs: Math.max(0, frameTimeMs - captureMeta.current.timing.performanceStartMs),
              sourceVideoMs: Math.max(0, sourceMs - captureMeta.current.timing.videoStartMs),
              status: 'inference_error', landmarks: [],
            });
          }
          pose.current?.close(); pose.current = null;
          setModelState('failed');
          setModelError(`Pose inference stopped. Retry model setup before another recording. ${cause instanceof Error ? cause.message : ''}`);
          finishCapture('Pose inference stopped unexpectedly.');
        }
      }
      if (trackingFresh.current && performance.now() - overlayAt.current > 250) {
        clearOverlay();
        setTracking({ status: 'waiting', visible: 0 });
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [clearOverlay, finishCapture]);

  function startCapture() {
    if (!stream.current || !pose.current || !mime || !video.current) return;
    setError('');
    setContainerWarning('');
    observations.current = [];
    blob.current = null;
    stopDuration.current = null;
    discardOnStop.current = false;
    const chunks: BlobPart[] = [];
    const startCall = performance.now();
    captureMeta.current = {
      id: crypto.randomUUID(), demoCode: demoCode.trim(), provenance,
      consentAt: consentAt.current, recordedAt: new Date().toISOString(), durationMs: 0,
      interrupted: false, taskId: TASK_ID, taskVersion: TASK_VERSION, instructions: INSTRUCTIONS,
      modelVersion: MODEL_VERSION, ...(parentSessionId ? { parentSessionId } : {}),
      demoCase: provenance === 'live_camera' ? demoCase : `${demoCase} · Virtual camera · actual MediaPipe`,
      timing: { performanceStartMs: startCall, recorderStartMs: startCall, videoStartMs: video.current.currentTime * 1000 },
    };
    try {
      const next = new MediaRecorder(stream.current, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      recorder.current = next;
      let finalized = false;
      const finalize = async () => {
        if (finalized) return;
        finalized = true;
        activeCapture.current = false;
        const metadata = captureMeta.current;
        releaseResources();
        if (!mounted.current || !metadata) return;
        setCameraState('idle'); setModelState('idle');
        setTracking({ status: 'waiting', visible: 0 });
        if (discardOnStop.current) {
          observations.current = []; captureMeta.current = null;
          setRecordInfo(null); setElapsed(0); setPhase('briefing');
          return;
        }
        metadata.durationMs = stopDuration.current ?? Math.max(1, performance.now() - metadata.timing.performanceStartMs);
        if (stopDuration.current === null) {
          metadata.interrupted = true;
          metadata.interruptionReason = 'The browser recorder stopped unexpectedly.';
        }
        observations.current = observations.current.filter((observation) => observation.tMs <= metadata.durationMs);
        const original = new Blob(chunks, { type: next.mimeType || mime });
        // Keep original encoded frames recoverable while repairing only the
        // container metadata missing from browser MediaRecorder WebM output.
        blob.current = original;
        setRecordInfo({ ...metadata });
        setObservationCount(observations.current.length);
        setElapsed(metadata.durationMs);
        setPhase('finalizing');
        let recording = original;
        if (original.size && original.type.startsWith('video/webm')) {
          try {
            const { fixWebmDuration } = await import('@fix-webm-duration/fix');
            recording = await fixWebmDuration(original, metadata.durationMs, { logger: false });
            if (!recording.size) throw new Error('Empty repaired container');
          } catch {
            if (mounted.current) setContainerWarning('Duration metadata could not be repaired. The original video is kept and can still be saved. The native player may show unknown duration; the app timeline uses the measured recording clock. No frames were re-encoded.');
            recording = original;
          }
        }
        if (!mounted.current) return;
        blob.current = recording;
        setLocalSize(recording.size);
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = recording.size ? URL.createObjectURL(recording) : '';
        setLocalUrl(objectUrl.current);
        setPhase('recorded');
        if (!recording.size) setError('The browser produced an empty recording. Nothing was saved. Discard it and retry camera setup.');
        else if (recording.size > MAX_BYTES) setError('This recording exceeds the 25 MB upload limit. Discard it and retry.');
      };
      finalizeRecording.current = () => { void finalize(); };
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      next.onstart = () => {
        if (!captureMeta.current) return;
        // Ignore any setup estimate that ran before the recorder start event.
        observations.current = [];
        captureMeta.current.timing.performanceStartMs = performance.now();
        captureMeta.current.timing.videoStartMs = (video.current?.currentTime ?? 0) * 1000;
        captureMeta.current.recordedAt = new Date().toISOString();
      };
      next.onstop = () => { void finalize(); };
      next.onerror = () => {
        setError('The browser recorder reported an error. Any recoverable partial video is kept below.');
        finishCapture('The browser recorder reported an error.');
      };
      activeCapture.current = true;
      next.start(250);
      setElapsed(0);
      setPhase('recording');
    } catch (cause) {
      activeCapture.current = false;
      setError(`Recording could not start. Retry setup in desktop Chrome or Edge. ${cause instanceof Error ? cause.message : ''}`);
    }
  }

  function discardRecording(nextPhase: 'briefing' | 'setup' = 'briefing') {
    blob.current = null; captureMeta.current = null; observations.current = [];
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
    setLocalUrl(''); setLocalSize(0); setRecordInfo(null); setError(''); setContainerWarning(''); setElapsed(0);
    setPhase(nextPhase);
  }

  function upload() {
    if (!blob.current?.size || !captureMeta.current || blob.current.size > MAX_BYTES) return;
    setError(''); setUploadProgress(0); setPhase('uploading');
    const form = new FormData();
    form.append('video', blob.current, blob.current.type.startsWith('video/mp4') ? 'capture.mp4' : 'capture.webm');
    form.append('metadata', JSON.stringify(captureMeta.current));
    form.append('observations', JSON.stringify(observations.current));
    const request = new XMLHttpRequest();
    xhr.current = request;
    request.open('POST', '/api/sessions');
    request.timeout = 120_000;
    request.upload.onprogress = (event) => {
      if (mounted.current && event.lengthComputable) setUploadProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
    };
    const failure = (message: string) => {
      if (!mounted.current) return;
      setError(message); setPhase('recorded');
    };
    request.onerror = () => failure('Upload failed. Your video is still in this tab. Check that the local server is running, then retry saving.');
    request.ontimeout = () => failure('Saving timed out. Your video is still in this tab. Retry uses the same session ID and will not create a duplicate.');
    request.onload = () => {
      if (!mounted.current) return;
      let result: { id?: string; error?: string } = {};
      try { result = JSON.parse(request.responseText); } catch { /* Display the HTTP failure below. */ }
      if (request.status < 200 || request.status >= 300 || !result.id) {
        failure(result.error || `Saving failed (HTTP ${request.status}). Your recording is kept here for retry.`);
        return;
      }
      blob.current = null;
      setSavedId(result.id); setUploadProgress(100); setPhase('saved');
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = ''; setLocalUrl('');
    };
    request.send(form);
  }

  const isLive = phase === 'setup' || phase === 'recording';
  const hasPlayableRecording = localSize > 0 || Boolean(savedId);
  const sourceLabel = (source: Provenance) => source === 'live_camera' ? 'Live physical camera' : source === 'prerecorded_demo' ? 'Prerecorded virtual camera' : 'Synthetic virtual camera';
  const trackingText = tracking.status === 'pose'
    ? `${tracking.visible} / 6 shoulder, elbow and wrist landmarks above the visibility threshold`
    : tracking.status === 'no_pose' ? 'No pose detected — tracking is unknown'
      : tracking.status === 'inference_error' ? 'Inference unavailable — tracking is unknown' : 'Waiting for a fresh camera estimate — tracking is unknown';

  return (
    <div className="page capture-flow stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div><p className="eyebrow">Participant · demo view</p><h1>One comfortable movement task.</h1><p className="muted">20 seconds. Video without audio. Human review.</p></div>
        <a className="button ghost" href="/" onClick={(event) => {
          if (activeCapture.current || blob.current) { event.preventDefault(); setError('Save or discard this recording before leaving the capture page.'); }
        }}>Back to review queue</a>
      </div>
      <ol className="steps" aria-label="Assessment progress">
        {['Read & consent', 'Camera & record', 'Save recording'].map((label, index) => {
          const current = phase === 'briefing' ? 0 : isLive ? 1 : 2;
          return <li key={label} aria-current={index === current ? 'step' : undefined}><span>{index + 1}</span> {label}</li>;
        })}
      </ol>
      {parentSessionId && <p className="notice">Linked recapture: this creates a new session and keeps the original recording and review history.</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {containerWarning && <div className="notice amber" role="status">{containerWarning}</div>}

      {phase === 'finalizing' && <section className="card stack" role="status"><h2>Preparing your source video…</h2><p>The camera is off. Adding duration metadata to the original recorded video, without re-encoding its frames.</p><p className="muted">Keep this tab open. Saving becomes available when preparation finishes.</p></section>}

      {phase === 'briefing' && <form className="card stack" onSubmit={(event) => {
        event.preventDefault();
        if (!consented) return;
        consentAt.current = new Date().toISOString();
        setError(''); setPhase('setup');
      }}>
        <div><p className="eyebrow">Seated upper-limb movement · instruction {TASK_VERSION}</p><h2>Before you begin</h2><p>This prototype checks recording and tracking quality. It does not assess your physical ability or provide a clinical judgement.</p></div>
        <blockquote className="task-instructions">{INSTRUCTIONS}</blockquote>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label className="field" style={{ flex: '1 1 230px' }}>Pseudonymous demo code<input value={demoCode} onChange={(event) => setDemoCode(event.target.value)} required minLength={2} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" autoComplete="off" aria-describedby="code-help"/><small id="code-help" className="muted">Use a demo code such as DEMO-001. No names or health information.</small></label>
          <label className="field" style={{ flex: '1 1 230px' }}>Demo case label<select value={demoCase} onChange={(event) => setDemoCase(event.target.value)}><option value="normal">Comfortable movement</option><option value="tracking_loss">Suspected tracking loss</option><option value="small_amplitude">Small comfortable movement</option></select><small className="muted">An organizer’s label; results come from the actual recording.</small></label>
        </div>
        <div className="notice"><strong>Local demo data</strong><p>{CONSENT}</p><p>Saved video and observations remain on this app’s server until you delete the session or reset demo data. Closing this page does not delete saved data.</p></div>
        <label className="consent-label row" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} required style={{ width: 20, height: 20, flexShrink: 0, marginTop: 3 }}/><span>I consent to recording and storing this authorized demonstration video and tracking data.</span></label>
        <div><button className="button" type="submit" disabled={!consented}>Continue to camera setup <span aria-hidden="true">→</span></button></div>
      </form>}

      {isLive && <div className="capture-layout">
        <section className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><h2>{phase === 'recording' ? 'Recording your task' : 'Camera setup'}</h2><span className={`badge ${phase === 'recording' ? 'amber' : 'teal'}`}>{phase === 'recording' ? `● Recording · no audio · ${sourceLabel(provenance)}` : `${sourceLabel(provenance)} · real MediaPipe`}</span></div>
          {phase === 'recording' && <>
            <div className="row" style={{ justifyContent: 'space-between' }}><strong aria-live="off">{(elapsed / 1000).toFixed(1)} / 20.0 s</strong><span>{Math.max(0, Math.ceil((TASK_MS - elapsed) / 1000))} seconds remaining</span></div>
            <progress className="progress" value={elapsed} max={TASK_MS} aria-label="Recording progress"/>
          </>}
          <div className="video-stage">
            <div style={{ position: 'relative', width: '100%', aspectRatio }}>
              <video ref={video} autoPlay muted playsInline aria-label="Live camera preview, not mirrored" onLoadedMetadata={() => {
                if (video.current?.videoWidth && video.current.videoHeight) setAspectRatio(`${video.current.videoWidth} / ${video.current.videoHeight}`);
              }} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}/>
              <canvas ref={overlay} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}/>
              {cameraState !== 'ready' && <div className="camera-placeholder">{cameraState === 'loading' ? 'Requesting camera access…' : 'Camera preview is unavailable'}</div>}
            </div>
          </div>
          <p className={`notice ${tracking.status === 'pose' && tracking.visible === 6 ? '' : 'amber'}`} role="status">{trackingText}. {phase === 'setup' && 'Keep shoulders, elbows and wrists in view if comfortable. You can record even when no pose is detected.'}</p>
          <small className="muted">Unmirrored preview. Teal estimates are a separate overlay; the original video is recorded without landmarks. Estimates clear after 250 ms without fresh tracking.</small>
        </section>
        <aside className="card stack">
          <div><p className="eyebrow">Fixed task instructions</p><h2>{phase === 'recording' ? 'Move within your comfort.' : 'Ready when you are.'}</h2></div>
          <p>{INSTRUCTIONS}</p>
          <p className="muted">Small, slow or asymmetric movement is not a recording quality failure. Tracking loss means unknown data.</p>
          {phase === 'setup' ? <>
            <label className="field">Camera source<select value={provenance} onChange={(event) => setProvenance(event.target.value as Provenance)}><option value="live_camera">Live physical camera</option><option value="prerecorded_demo">Prerecorded video via virtual camera</option><option value="synthetic_demo">Synthetic input via virtual camera</option></select><small className="muted">Choose the actual source. Every option runs the real pose model; prerecorded or synthetic input is labelled in the saved record.</small></label>
            <div className="stack resource-status">
              <div><strong>Camera</strong><p role="status">{cameraState === 'ready' ? 'Ready · audio disabled' : cameraState === 'loading' ? 'Waiting for permission / camera…' : cameraState === 'failed' ? 'Camera unavailable' : 'Not started'}</p>{cameraError && <p className="notice error" role="alert">{cameraError}</p>}{cameraState === 'failed' && <button type="button" className="button secondary" onClick={() => void loadCamera()}>Retry camera</button>}</div>
              <div><strong>Pose model</strong><p role="status">{modelState === 'ready' ? 'Ready · local real model' : modelState === 'loading' ? 'Loading local model & WebAssembly…' : modelState === 'failed' ? 'Model unavailable' : 'Not started'}</p>{modelError && <p className="notice error" role="alert">{modelError}</p>}{modelState === 'failed' && <button type="button" className="button secondary" onClick={() => void loadModel()}>Retry model</button>}</div>
              <div><strong>Browser recorder</strong><p>{!capabilityChecked ? 'Checking…' : mime ? `Ready · ${mime}` : 'Unavailable. Use a current desktop Chrome or Edge browser.'}</p></div>
            </div>
            <button type="button" className="button" onClick={startCapture} disabled={cameraState !== 'ready' || modelState !== 'ready' || !mime}>Start 20-second recording</button>
            <button type="button" className="button ghost" onClick={() => { releaseResources(); setCameraState('idle'); setModelState('idle'); setPhase('briefing'); }}>Back to briefing</button>
          </> : <>
            <div className="notice">The task ends automatically after 20 seconds. You may stop at any time. Hiding this tab stops and keeps a partial recording.</div>
            <button type="button" className="button secondary" onClick={() => finishCapture('The participant stopped before the 20-second task finished.')}>Stop & keep partial recording</button>
            <button type="button" className="button ghost" onClick={() => finishCapture('The participant aborted the recording.', true)}>Abort & discard recording</button>
          </>}
        </aside>
      </div>}

      {(phase === 'recorded' || phase === 'uploading' || phase === 'saved') && <div className="capture-layout">
        <section className="card stack">
          <div><p className="eyebrow">{hasPlayableRecording ? 'Original source video' : 'Capture result'}</p><h2>{phase === 'saved' ? 'Recording saved.' : hasPlayableRecording ? 'Your recording is ready.' : 'No playable recording'}</h2></div>
          {(localUrl || savedId) ? <video className="recorded-video" src={savedId ? `/api/sessions/${savedId}/video` : localUrl} controls playsInline preload="metadata" aria-label="Original recorded video" style={{ width: '100%', borderRadius: 12, background: '#14263D' }}/> : <p className="notice error">No playable video was produced. Nothing has been saved.</p>}
          <div className="row" style={{ flexWrap: 'wrap' }}><span className="badge teal">{sourceLabel(recordInfo?.provenance ?? provenance)} · real MediaPipe</span><span className="badge">{(elapsed / 1000).toFixed(1)} seconds</span><span className="badge">{(localSize / 1024 / 1024).toFixed(1)} MB</span><span className="badge">{observationCount} observations</span></div>
          {recordInfo?.interrupted && <p className="notice amber"><strong>{hasPlayableRecording ? 'Partial / interrupted recording.' : 'Interrupted attempt.'}</strong> {recordInfo.interruptionReason} {hasPlayableRecording ? 'The recoverable source video is kept below. Unknown intervals remain unknown in analysis.' : 'No source video could be recovered; nothing was saved.'}</p>}
        </section>
        <aside className="card stack">
          <h2>{phase === 'saved' ? 'Continue to human review' : phase === 'uploading' ? 'Saving to the local server…' : hasPlayableRecording ? 'Save before leaving' : 'Recording unavailable'}</h2>
          {phase === 'saved' ? <>
            <p className="notice" role="status">The source video, timing metadata and tracking observations were saved. They remain available after refreshing.</p>
            <a className="button" href={`/sessions/${savedId}`}>Open researcher review <span aria-hidden="true">→</span></a>
            <a className="button secondary" href="/">Return to review queue</a>
          </> : <>
            <p>{hasPlayableRecording ? 'The video stays in this browser tab until saving succeeds. A failed upload can be retried with the same session ID.' : 'No playable video was produced and nothing was saved. Discard this attempt and retry camera setup.'}</p>
            <p className="muted">{hasPlayableRecording ? 'Automatic analysis describes capture and tracking quality. A researcher makes the review decision.' : 'Use desktop Chrome or Edge, check the camera connection and permissions, and keep this tab visible while recording.'}</p>
            {phase === 'uploading' ? <div role="status" className="stack"><progress className="progress" value={uploadProgress} max={100} aria-label="Upload progress"/><strong>{uploadProgress}% · {uploadProgress >= 99 ? 'Server is validating and saving…' : 'Uploading video and observations…'}</strong><p className="muted">Keep this tab open until saving completes.</p></div> : <>
              <button type="button" className="button" onClick={upload} disabled={!localSize || localSize > MAX_BYTES}>{!localSize ? 'Save recording' : error ? 'Retry saving recording' : 'Save recording'}</button>
              <button type="button" className="button secondary" onClick={() => discardRecording('setup')}>Discard & record again</button>
              <button type="button" className="button ghost" onClick={() => discardRecording()}>Discard & return to briefing</button>
            </>}
          </>}
          <small className="muted">Task {TASK_ID} · {TASK_VERSION}. {MODEL_VERSION}. No movement scores.</small>
        </aside>
      </div>}
    </div>
  );
}
