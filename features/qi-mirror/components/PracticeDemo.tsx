'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PracticeBrand from './PracticeBrand';
import PracticeCompletion from './PracticeCompletion';
import PracticeInstructions from './PracticeInstructions';
import BambooLoadingScreen from './BambooLoadingScreen';
import QiSymbol from './QiSymbol';
import type { ReactNode } from 'react';
import { clearCanvas, drawPose, visibleJoints, waitForVideo, seekTo, readRecordedAnalysis, cameraErrorMessage, type ReferenceAnalysis } from '../lib/practice-display';
import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluatePracticeAttempt, PRACTICE_CONNECTIONS, PRACTICE_JOINTS, type AttemptResult, type PoseSample } from '@/lib/imitation';
import { createImitationPoseClient } from '@/lib/imitation-pose';
import { mapReferenceToLiveBody } from '@/lib/practice-overlay';
import { listPracticeCameras, requestPracticeCamera, type PracticeCameraOption } from '@/lib/practice-camera';
import { useBambooLoading } from '../lib/use-bamboo-loading';

type PoseClient = Awaited<ReturnType<typeof createImitationPoseClient>>;
type Phase = 'loading' | 'instructions' | 'ready' | 'countdown' | 'practicing' | 'retry' | 'passed' | 'form-complete' | 'transition' | 'paused' | 'complete';
type Resource = 'idle' | 'loading' | 'ready' | 'failed';
interface Clip {
  id: string;
  src: string;
  title: string;
  description: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  sourceFile: string;
  focusJoints: number[];
  sourcePlaybackRate?: number;
  sha256?: string;
  referencePoseSrc?: string;
  trackingNotes?: string;
}
interface Playlist { id: string; title: string; clips: Clip[] }
interface Routine { id: string; title: string; src: string; sourceFile: string }

function parsePlaylist(value: unknown): Playlist {
  if (!value || typeof value !== 'object') throw new Error('The practice playlist is invalid: an object is required.');
  const data = value as Record<string, unknown>;
  if (typeof data.id !== 'string' || !data.id.trim() || typeof data.title !== 'string' || !data.title.trim() || !Array.isArray(data.clips) || data.clips.length === 0) throw new Error('The practice playlist is invalid: id, title, and a nonempty clips list are required.');
  const ids = new Set<string>();
  for (const item of data.clips) {
    if (!item || typeof item !== 'object') throw new Error('The practice playlist contains an invalid clip.');
    const clip = item as Record<string, unknown>;
    for (const field of ['id', 'src', 'title', 'description', 'sourceFile']) if (typeof clip[field] !== 'string' || !(clip[field] as string).trim()) throw new Error(`The practice playlist clip is missing ${field}.`);
    if (!/^\/practice-media\/[^?#]+\.(webm|mp4)$/.test(clip.src as string) || (clip.src as string).includes('..')) throw new Error('Practice clips must use local practice-media video assets.');
    if (ids.has(clip.id as string)) throw new Error('The practice playlist contains duplicate clip IDs.');
    ids.add(clip.id as string);
    if (!Array.isArray(clip.focusJoints) || clip.focusJoints.length === 0 || new Set(clip.focusJoints).size !== clip.focusJoints.length || clip.focusJoints.some((joint) => typeof joint !== 'number' || ![15, 16, 27, 28].includes(joint))) throw new Error('Every practice clip must specify unique focusJoints from wrists (15, 16) or ankles (27, 28).');
    for (const field of ['startSeconds', 'endSeconds', 'durationSeconds']) if (typeof clip[field] !== 'number' || !Number.isFinite(clip[field]) || (clip[field] as number) < 0) throw new Error(`The practice playlist clip has invalid ${field}.`);
    if ((clip.endSeconds as number) <= (clip.startSeconds as number) || (clip.durationSeconds as number) <= 0 || (clip.sourcePlaybackRate !== undefined && (typeof clip.sourcePlaybackRate !== 'number' || !Number.isFinite(clip.sourcePlaybackRate) || clip.sourcePlaybackRate <= 0))) throw new Error('The practice playlist clip has invalid duration or playback rate.');
  }
  return data as unknown as Playlist;
}
const SAMPLE_MS = 1000 / 12;
const FRESH_MS = 250;
export default function PracticeDemo({ modeControl }: { modeControl?: ReactNode }) {
  const router = useRouter();
  const bamboo = useBambooLoading();
  const [completion, setCompletion] = useState<{ index: number; title: string; nextIndex: number | null } | null>(null);
  const completionRef = useRef<typeof completion>(null);
  const [instructions, setInstructions] = useState(false);
  const instructionsSeen = useRef(false);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineId, setRoutineId] = useState('original24');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [passedIds, setPassedIds] = useState<string[]>([]);
  const passedIdsRef = useRef<string[]>([]);
  const [phase, setPhaseState] = useState<Phase>('loading');
  const [referenceState, setReferenceState] = useState<Resource>('loading');
  const [modelState, setModelState] = useState<Resource>('idle');
  const [cameraState, setCameraState] = useState<Resource>('idle');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [visible, setVisible] = useState(0);
  const [referenceVisible, setReferenceVisible] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [profile, setProfile] = useState<'easy' | 'standard'>('easy');
  const [standardAvailable, setStandardAvailable] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showLivePose, setShowLivePose] = useState(true);
  const [cameras, setCameras] = useState<PracticeCameraOption[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [cameraLabel, setCameraLabel] = useState('');
  const [liveIssue, setLiveIssue] = useState('');

  const referenceVideo = useRef<HTMLVideoElement>(null);
  const cameraVideo = useRef<HTMLVideoElement>(null);
  const referenceCanvas = useRef<HTMLCanvasElement>(null);
  const cameraCanvas = useRef<HTMLCanvasElement>(null);
  const guideCanvas = useRef<HTMLCanvasElement>(null);
  const latestLiveSample = useRef<PoseSample | null>(null);
  const showGuideRef = useRef(true);
  const showLivePoseRef = useRef(true);
  const playlistPath = useRef('/practice-media/playlist.json');
  const profileRef = useRef<'easy' | 'standard'>('easy');
  const referenceSamples = useRef<PoseSample[]>([]);
  const attemptSamples = useRef<PoseSample[]>([]);
  const referenceCache = useRef(new Map<string, ReferenceAnalysis>());
  const playlistRef = useRef<Playlist | null>(null);
  const indexRef = useRef(0);
  const liveModel = useRef<PoseClient | null>(null);
  const sourceModel = useRef<PoseClient | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const runGeneration = useRef(0);
  const cameraGeneration = useRef(0);
  const phaseRef = useRef<Phase>('loading');
  const referenceStateRef = useRef<Resource>('loading');
  const active = useRef(false);
  const startedAt = useRef(0);
  const lastLiveSampleAt = useRef(-Infinity);
  const lastCameraTime = useRef(-1);
  const liveFreshAt = useRef(-Infinity);
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceDuration = useRef(0);
  const finishAttemptRef = useRef<() => void>(() => {});
  const beginPlaybackRef = useRef<(token: number) => Promise<void>>(async () => {});
  const scheduleAttemptRef = useRef<(retry?: boolean) => void>(() => {});
  const loadClipRef = useRef<(index: number, autoToken?: number) => Promise<void>>(async () => {});

  const setPhase = useCallback((next: Phase) => { phaseRef.current = next; setPhaseState(next); }, []);
  const setReference = useCallback((next: Resource) => { referenceStateRef.current = next; setReferenceState(next); }, []);
  const cancelTimers = useCallback(() => {
    if (runTimer.current) clearTimeout(runTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    runTimer.current = null; countdownTimer.current = null;
  }, []);

  const pausePractice = useCallback((message = '') => {
    runGeneration.current += 1; cancelTimers(); active.current = false;
    referenceVideo.current?.pause(); setPreviewing(false);
    if (mounted.current) { if (!['instructions', 'form-complete'].includes(phaseRef.current)) setPhase('paused'); if (message) setError(message); }
  }, [cancelTimers, setPhase]);

  const stopCamera = useCallback(() => {
    bamboo.cancel();
    runGeneration.current += 1; generation.current += 1; cameraGeneration.current += 1;
    cancelTimers(); active.current = false;
    referenceVideo.current?.pause();
    cameraStream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    cameraStream.current = null;
    if (cameraVideo.current) cameraVideo.current.srcObject = null;
    liveModel.current?.close(); liveModel.current = null;
    sourceModel.current?.close(); sourceModel.current = null;
    clearCanvas(cameraCanvas.current);
    clearCanvas(guideCanvas.current); latestLiveSample.current = null;
    if (mounted.current) {
      if (referenceStateRef.current === 'loading') { setReference('idle'); clearCanvas(referenceCanvas.current); }
      setCameraState('idle'); setModelState('idle'); setVisible(0); setCameraLabel(''); setLiveIssue(''); setPreviewing(false); setElapsed(0);
      if (!['instructions', 'complete', 'form-complete'].includes(phaseRef.current)) setPhase('paused');
    }
  }, [cancelTimers, setPhase, setReference, bamboo.cancel]);

  const loadClip = useCallback(async (index: number, autoToken?: number) => {
    const metadata = playlistRef.current?.clips[index];
    if (!metadata || (autoToken !== undefined && autoToken !== runGeneration.current)) return;
    completionRef.current = null; setCompletion(null);
    setInstructions(false);
    const loadingTicket = bamboo.begin();
    const token = ++generation.current;
    sourceModel.current?.close(); sourceModel.current = null;
    active.current = false; referenceVideo.current?.pause();
    indexRef.current = index; setCurrentIndex(index);
    referenceSamples.current = []; attemptSamples.current = []; sourceDuration.current = 0;
    clearCanvas(referenceCanvas.current); setReferenceVisible(0);
    clearCanvas(guideCanvas.current);
    setReference('loading'); setAnalysisProgress(0); setError(''); setElapsed(0); setDuration(0);
    setAttemptNumber(0); setResult(null); setPreviewing(false);
    setStandardAvailable(false);
    setPhase(autoToken !== undefined ? 'transition' : 'loading');
    let model: PoseClient | null = null;
    try {
      const video = referenceVideo.current;
      if (!video) throw new Error('The reference player is unavailable. Reload the page.');
      video.src = metadata.src; video.load();
      if (video.readyState < 2) await waitForVideo(video, 'loadeddata');
      if (!mounted.current || token !== generation.current) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('The reference video has no readable duration.');
      const durationMs = video.duration * 1000;
      sourceDuration.current = durationMs; setDuration(durationMs);
      let analysis = referenceCache.current.get(metadata.id);
      if (!analysis) analysis = await readRecordedAnalysis(metadata, video) ?? undefined;
      if (!mounted.current || token !== generation.current) return;
      if (!analysis) {
        model = await createImitationPoseClient();
        if (!mounted.current || token !== generation.current) { model.close(); model = null; return; }
        sourceModel.current = model;
        const samples: PoseSample[] = [];
        const count = Math.ceil(durationMs / SAMPLE_MS);
        for (let index = 0; index <= count; index += 1) {
          if (!mounted.current || token !== generation.current) return;
          const tMs = Math.max(0, Math.min(index * SAMPLE_MS, durationMs - 15));
          if (samples.at(-1)?.tMs === tMs) continue;
          await seekTo(video, tMs / 1000);
          if (!mounted.current || token !== generation.current) return;
          const sample: PoseSample = { tMs, ...model.estimate(video, tMs + 1) };
          samples.push(sample); drawPose(referenceCanvas.current, video, sample);
          setAnalysisProgress(Math.round((index + 1) / (count + 1) * 100));
          bamboo.update(loadingTicket, Math.floor((index + 1) / (count + 1) * 98));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        model.close(); sourceModel.current = null; model = null;
        if (!mounted.current || token !== generation.current) return;
        analysis = { samples, durationMs };
      }
      const referenceCheck = evaluatePracticeAttempt(analysis.samples, analysis.samples, {
          referenceAspectRatio: video.videoWidth / video.videoHeight,
          attemptAspectRatio: video.videoWidth / video.videoHeight,
          referenceDurationMs: durationMs, attemptDurationMs: durationMs,
          focusJoints: metadata.focusJoints,
        });
      if (referenceCheck.status !== 'matched') throw new Error('This reference cannot be compared yet. ' + referenceCheck.reason);
      const supportsStandard = evaluatePracticeAttempt(analysis.samples, analysis.samples, {
        profile: 'standard', referenceAspectRatio: video.videoWidth / video.videoHeight,
        attemptAspectRatio: video.videoWidth / video.videoHeight, referenceDurationMs: durationMs,
        attemptDurationMs: durationMs, focusJoints: metadata.focusJoints,
      }).status === 'matched';
      setStandardAvailable(supportsStandard);
      if (!supportsStandard && profileRef.current === 'standard') {
        profileRef.current = 'easy'; setProfile('easy');
        setError('This instructor view has limited tracking for Standard. Relaxed mode has been selected for this form.');
      }
      referenceCache.current.set(metadata.id, analysis);
      if (!mounted.current || token !== generation.current) return;
      await seekTo(video, 0);
      if (!mounted.current || token !== generation.current) return;
      referenceSamples.current = analysis.samples; sourceDuration.current = analysis.durationMs;
      setDuration(analysis.durationMs); setAnalysisProgress(100);
      drawPose(referenceCanvas.current, video, analysis.samples[0]);
      setReferenceVisible(visibleJoints(analysis.samples[0])); setReference('ready');
      if (!await bamboo.finish(loadingTicket)) return;
      if (!mounted.current || token !== generation.current) return;
      if (index === 0 && !instructionsSeen.current) {
        instructionsSeen.current = true;
        referenceVideo.current?.pause(); setInstructions(true); setPhase('instructions');
        return;
      }
      if (autoToken !== undefined && autoToken === runGeneration.current && cameraStream.current && liveModel.current && !document.hidden) scheduleAttemptRef.current();
      else if (phaseRef.current !== 'paused') setPhase('ready');
    } catch (cause) {
      if (!mounted.current || token !== generation.current) return;
      bamboo.cancel();
      clearCanvas(referenceCanvas.current); setReference('failed');
      if (phaseRef.current !== 'paused') setPhase('ready');
      setError(cause instanceof Error ? cause.message : 'Reference analysis failed. Retry this movement.');
    } finally {
      // A canceled analysis is closed by its canceler; never close a newer model.
      if (model && sourceModel.current === model) { model.close(); sourceModel.current = null; }
    }
  }, [setPhase, setReference, bamboo.begin, bamboo.update, bamboo.finish, bamboo.cancel]);
  loadClipRef.current = loadClip;

  const initializePlaylist = useCallback(async () => {
    completionRef.current = null; setCompletion(null); bamboo.begin();
    const token = ++generation.current;
    runGeneration.current += 1; cancelTimers(); active.current = false;
    referenceVideo.current?.pause(); sourceModel.current?.close(); sourceModel.current = null;
    referenceSamples.current = []; attemptSamples.current = []; sourceDuration.current = 0;
    clearCanvas(referenceCanvas.current); clearCanvas(guideCanvas.current);
    playlistRef.current = null; setPlaylist(null); referenceCache.current.clear();
    passedIdsRef.current = []; setPassedIds([]); indexRef.current = 0; setCurrentIndex(0);
    setResult(null); setAttemptNumber(0); setElapsed(0); setDuration(0); setReferenceVisible(0); setPreviewing(false);
    setError(''); setReference('loading'); setPhase('loading');
    try {
      const response = await fetch(playlistPath.current, { cache: 'no-store' });
      if (!response.ok) throw new Error('The practice playlist is unavailable. Check the local playlist.json asset and retry.');
      const next = parsePlaylist(await response.json());
      if (!mounted.current || token !== generation.current) return;
      playlistRef.current = next; setPlaylist(next); referenceCache.current.clear();
      passedIdsRef.current = []; setPassedIds([]); indexRef.current = 0; setCurrentIndex(0);
      await loadClipRef.current(0);
    } catch (cause) {
      if (!mounted.current || token !== generation.current) return;
      bamboo.cancel();
      playlistRef.current = null; setPlaylist(null); setReference('failed'); setPhase('ready');
      setError(cause instanceof Error ? cause.message : 'The practice playlist could not be loaded.');
    }
  }, [cancelTimers, setPhase, setReference, bamboo.begin, bamboo.cancel]);

  useEffect(() => {
    mounted.current = true;
    bamboo.begin();
    let cancelled = false;
    const loadLibrary = async () => {
      try {
        const response = await fetch('/practice-media/library.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('Library unavailable');
        const library = await response.json();
        if (!Array.isArray(library.routines) || !library.routines.length || library.routines.some((item: Routine) => !item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.sourceFile !== 'string' || typeof item.src !== 'string' || !/^\/practice-media\/[a-zA-Z0-9_-]+\.json$/.test(item.src))) throw new Error('Invalid library');
        if (cancelled) return;
        setRoutines(library.routines);
        const requested = new URLSearchParams(window.location.search).get('routine');
        const selected: Routine = library.routines.find((item: Routine) => item.id === requested) ?? library.routines.find((item: Routine) => item.id === library.defaultId) ?? library.routines[0];
        playlistPath.current = selected.src; setRoutineId(selected.id);
      } catch { /* Keep the original local playlist usable if the optional library is absent. */ }
      if (!cancelled) await initializePlaylist();
    };
    void loadLibrary();
    const refreshCameras = () => { void listPracticeCameras().then((devices) => { if (!cancelled) setCameras(devices); }).catch(() => {}); };
    refreshCameras();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameras);
    const visibility = () => {
      if (document.hidden && ['countdown', 'practicing', 'retry', 'passed', 'transition', 'loading'].includes(phaseRef.current)) pausePractice('Practice paused because this tab was hidden. Restart this movement when ready.');
      clearCanvas(cameraCanvas.current);
      clearCanvas(guideCanvas.current); latestLiveSample.current = null;
    };
    const pageHide = () => stopCamera();
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pageHide);
    return () => {
      cancelled = true;
      mounted.current = false; stopCamera();
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshCameras);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pageHide);
    };
  }, [initializePlaylist, pausePractice, stopCamera, bamboo.begin]);

  const startCamera = useCallback(async () => {
    const token = ++cameraGeneration.current;
    setError(''); setLiveIssue(''); setCameraState('loading'); setModelState('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('The camera API is unavailable. Use http://127.0.0.1:3000 in desktop Chrome on this computer.');
      const stream = await requestPracticeCamera(selectedCamera);
      if (!mounted.current || token !== cameraGeneration.current || !cameraVideo.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      cameraStream.current = stream; cameraVideo.current.srcObject = stream;
      await cameraVideo.current.play();
      if (!mounted.current || token !== cameraGeneration.current) return;
      setCameraState('ready');
      setCameraLabel(stream.getVideoTracks()[0]?.label ?? '');
      void listPracticeCameras().then((devices) => { if (mounted.current && token === cameraGeneration.current) setCameras(devices); }).catch(() => {});
      stream.getVideoTracks().forEach((track) => { track.onended = () => { stopCamera(); setCameraState('failed'); setError('The camera disconnected. Reconnect it, then choose Start camera.'); }; });
      if (!liveModel.current) {
        const model = await createImitationPoseClient();
        if (!mounted.current || token !== cameraGeneration.current) { model.close(); return; }
        liveModel.current = model;
      }
      lastCameraTime.current = -1; lastLiveSampleAt.current = -Infinity;
      setModelState('ready');
    } catch (cause) {
      if (!mounted.current || token !== cameraGeneration.current) return;
      cameraStream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); }); cameraStream.current = null;
      if (cameraVideo.current) cameraVideo.current.srcObject = null;
      liveModel.current?.close(); liveModel.current = null;
      setCameraState('failed'); setModelState('failed'); setVisible(0); clearCanvas(cameraCanvas.current);
      clearCanvas(guideCanvas.current); latestLiveSample.current = null;
      setError(cameraErrorMessage(cause));
    }
  }, [selectedCamera, stopCamera]);

  const scheduleAttempt = useCallback((retry = false) => {
    if (phaseRef.current === 'instructions' || referenceStateRef.current !== 'ready' || !cameraStream.current || !liveModel.current || document.hidden) return;
    const token = ++runGeneration.current;
    cancelTimers(); active.current = false;
    referenceVideo.current?.pause(); setPreviewing(false); setError(''); setElapsed(0);
    setCountdown(3); setPhase(retry ? 'retry' : 'countdown');
    const video = referenceVideo.current;
    if (video) void seekTo(video, 0).catch(() => {
      if (mounted.current && token === runGeneration.current) pausePractice('The reference could not reset to its starting pose. Restart the movement to try again.');
    });
    const until = performance.now() + 3000;
    countdownTimer.current = setInterval(() => { if (token === runGeneration.current) setCountdown(Math.max(1, Math.ceil((until - performance.now()) / 1000))); }, 100);
    runTimer.current = setTimeout(() => { if (token === runGeneration.current) { cancelTimers(); void beginPlaybackRef.current(token); } }, 3000);
  }, [cancelTimers, pausePractice, setPhase]);
  scheduleAttemptRef.current = scheduleAttempt;

  const beginPlayback = useCallback(async (token: number) => {
    const video = referenceVideo.current;
    if (!video || !cameraStream.current || !liveModel.current || token !== runGeneration.current) return;
    try {
      await seekTo(video, 0);
      if (!mounted.current || token !== runGeneration.current || document.hidden || !['countdown', 'retry'].includes(phaseRef.current)) return;
      attemptSamples.current = []; setAttemptNumber((number) => number + 1); setPhase('practicing');
      startedAt.current = performance.now(); active.current = true;
      await video.play();
      if (token !== runGeneration.current) video.pause();
    } catch {
      if (mounted.current && token === runGeneration.current) pausePractice('The reference could not play. Check the video, then restart the movement.');
    }
  }, [pausePractice, setPhase]);
  beginPlaybackRef.current = beginPlayback;

  const finishAttempt = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    const clips = playlistRef.current?.clips;
    const index = indexRef.current;
    const metadata = clips?.[index];
    if (!metadata) return;
    const source = referenceVideo.current; const camera = cameraVideo.current;
    const comparison = evaluatePracticeAttempt(referenceSamples.current, attemptSamples.current, {
      profile: profileRef.current,
      referenceAspectRatio: source && source.videoHeight ? source.videoWidth / source.videoHeight : 1,
      attemptAspectRatio: camera && camera.videoHeight ? camera.videoWidth / camera.videoHeight : 1,
      referenceDurationMs: sourceDuration.current, attemptDurationMs: sourceDuration.current,
      focusJoints: metadata.focusJoints,
    });
    setResult(comparison); setElapsed(sourceDuration.current);
    if (comparison.status !== 'matched') { scheduleAttempt(true); return; }
    const id = clips[index].id;
    const nextPassed = [...new Set([...passedIdsRef.current, id])];
    passedIdsRef.current = nextPassed; setPassedIds(nextPassed);
    ++runGeneration.current; cancelTimers(); source?.pause(); setPreviewing(false);
    const finished = { index, title: metadata.title, nextIndex: index + 1 < clips.length ? index + 1 : null };
    completionRef.current = finished; setCompletion(finished); setPhase('form-complete');
  }, [cancelTimers, scheduleAttempt, setPhase]);
  finishAttemptRef.current = finishAttempt;

  const restudy = () => {
    const finished = completionRef.current, clips = playlistRef.current?.clips;
    if (!finished || !clips) return;
    const kept = passedIdsRef.current.filter(id => id !== clips[finished.index].id);
    passedIdsRef.current = kept; setPassedIds(kept);
    void loadClipRef.current(finished.index);
  };
  const nextMovement = () => {
    const finished = completionRef.current; if (!finished) return;
    if (finished.nextIndex === null) {
      completionRef.current = null; setCompletion(null); setPhase('complete'); stopCamera(); router.push('/qi-mirror/levels');
    } else {
      const token = ++runGeneration.current; cancelTimers();
      void loadClipRef.current(finished.nextIndex, cameraStream.current && liveModel.current ? token : undefined);
    }
  };

  useEffect(() => {
    let frame = 0; let lastUi = 0;
    const tick = () => {
      if (!mounted.current) return;
      const now = performance.now(); const camera = cameraVideo.current;
      if (camera && cameraStream.current && liveModel.current && camera.readyState >= 2 && !document.hidden && now - lastLiveSampleAt.current >= SAMPLE_MS && camera.currentTime !== lastCameraTime.current) {
        lastLiveSampleAt.current = now; lastCameraTime.current = camera.currentTime;
        clearCanvas(cameraCanvas.current);
        let sample: PoseSample;
        const tMs = active.current ? (referenceVideo.current?.currentTime ?? 0) * 1000 : 0;
        try { sample = { tMs, ...liveModel.current.estimate(camera, now) }; }
        catch { sample = { tMs, status: 'inference_error', landmarks: [] }; }
        if (active.current) attemptSamples.current.push(sample);
        const sampleAge = performance.now() - now;
        setLiveIssue(sampleAge >= FRESH_MS ? 'Pose tracking is too slow. Close other busy tabs, then stop and restart the camera.' : sample.status === 'inference_error' ? 'Pose tracking failed. Stop and restart the camera to try again.' : '');
        if (sampleAge < FRESH_MS && showLivePoseRef.current) drawPose(cameraCanvas.current, camera, sample, FRESH_MS - sampleAge);
        latestLiveSample.current = sampleAge < FRESH_MS && sample.status === 'pose' ? sample : null;
        liveFreshAt.current = now; setVisible(sampleAge < FRESH_MS ? visibleJoints(sample) : 0);
      }
      if (now - liveFreshAt.current >= FRESH_MS) { clearCanvas(cameraCanvas.current); clearCanvas(guideCanvas.current); latestLiveSample.current = null; setVisible(0); }
      const source = referenceVideo.current;
      if (source && referenceSamples.current.length) {
        const sourceTime = source.currentTime * 1000;
        const nearest = referenceSamples.current.reduce((best, sample) => Math.abs(sample.tMs - sourceTime) < Math.abs(best.tMs - sourceTime) ? sample : best);
        const fresh = Math.abs(nearest.tMs - sourceTime) <= 150;
        drawPose(referenceCanvas.current, source, fresh ? nearest : undefined);
        const live = latestLiveSample.current;
        const remaining = FRESH_MS - (performance.now() - liveFreshAt.current);
        const aligned = showGuideRef.current && fresh && live && remaining > 0 && camera?.videoHeight
          ? mapReferenceToLiveBody(nearest, live, { referenceAspectRatio: source.videoWidth / source.videoHeight, liveAspectRatio: camera.videoWidth / camera.videoHeight, liveAgeMs: performance.now() - liveFreshAt.current, maximumLiveAgeMs: FRESH_MS }) : null;
        drawPose(guideCanvas.current, camera, aligned ?? undefined, remaining, true);
        if (now - lastUi >= 100) setReferenceVisible(fresh ? visibleJoints(nearest) : 0);
      }
      if (now - lastUi >= 100) { if (active.current && source) setElapsed(Math.min(sourceDuration.current, source.currentTime * 1000)); lastUi = now; }
      if (active.current && source && now - startedAt.current > sourceDuration.current + 4000) pausePractice('Reference playback stalled. Restart the movement to try again.');
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pausePractice]);

  const previewReference = async () => {
    const video = referenceVideo.current;
    if (!video || referenceState !== 'ready') return;
    if (!video.paused) { video.pause(); setPreviewing(false); return; }
    const token = runGeneration.current;
    try {
      if (video.ended) await seekTo(video, 0);
      if (token !== runGeneration.current) return;
      await video.play();
      if (token === runGeneration.current) setPreviewing(true); else video.pause();
    } catch { if (token === runGeneration.current) setError('The reference clip could not play. Reload the page and retry.'); }
  };

  const retryReference = () => {
    runGeneration.current += 1; cancelTimers();
    if (playlistRef.current) void loadClipRef.current(indexRef.current);
    else void initializePlaylist();
  };
  const backToFirst = () => {
    const token = ++runGeneration.current; cancelTimers(); active.current = false;
    passedIdsRef.current = []; setPassedIds([]); setResult(null);
    void loadClipRef.current(0, cameraStream.current && liveModel.current ? token : undefined);
  };
  const selectMovement = (index: number) => {
    pausePractice();
    void loadClipRef.current(index);
  };
  const selectRoutine = (id: string) => {
    const selected = routines.find((item) => item.id === id);
    if (!selected) return;
    pausePractice(); setRoutineId(id); playlistPath.current = selected.src;
    void initializePlaylist();
  };
  const selectCamera = (id: string) => {
    stopCamera(); setSelectedCamera(id);
  };
  useEffect(() => {
    document.querySelector('.practice-sequence [aria-current="step"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentIndex]);
  const clip = playlist?.clips[currentIndex];
  const focusLabel = clip?.focusJoints.length === 2 && clip.focusJoints.includes(15) && clip.focusJoints.includes(16) ? 'Both arms' : clip?.focusJoints.map((joint) => ({ 15: 'Left arm', 16: 'Right arm', 27: 'Left leg', 28: 'Right leg' })[joint as 15 | 16 | 27 | 28]).join(', ');
  const total = playlist?.clips.length ?? 0;
  const isRunning = ['practicing', 'countdown', 'retry', 'passed', 'form-complete', 'transition'].includes(phase);
  const canPractice = phase !== 'instructions' && referenceState === 'ready' && cameraState === 'ready' && modelState === 'ready';
  const fullBody = visible === PRACTICE_JOINTS.length;
  const heading = phase === 'form-complete' ? 'Movement complete' : phase === 'transition' ? 'Preparing the next movement' : phase === 'loading' ? 'Preparing your reference' : phase === 'passed' ? 'Movement complete' : phase === 'countdown' ? 'Get ready · ' + countdown : phase === 'practicing' ? 'Follow the movement' : phase === 'retry' ? (result?.status === 'unknown' ? 'Tracking was incomplete' : 'Let’s try that again') + ' · ' + countdown : phase === 'complete' ? 'All movements complete' : phase === 'paused' ? 'Practice paused' : canPractice ? 'Find your starting position' : 'Start with your camera';
  const message = phase === 'form-complete' ? 'Choose Restudy to try this movement again, or Next when you are ready.' : phase === 'transition' ? 'The next reference is being analyzed with real MediaPipe. Your camera stays on; the next movement begins after a fresh countdown.' : phase === 'loading' ? 'MediaPipe is reading the actual reference frames. This may take a moment on first load.' : phase === 'passed' ? 'This movement matched. Preparing the next movement automatically…' : phase === 'countdown' ? 'Stand back so both hands and feet stay in view. Follow the same arm and leg sides as the instructor.' : phase === 'practicing' ? 'Attempt ' + attemptNumber + ' · Follow the reference through the whole movement.' : phase === 'retry' ? (result?.reason ?? 'This attempt needs another look.') + ' The same clip will repeat automatically.' : phase === 'complete' ? 'You matched all ' + total + ' movements in this sequence. You can return to the first movement to practice again.' : phase === 'paused' ? cameraState === 'ready' ? 'Your camera stays on. Restart this movement when ready, or stop the camera.' : 'Automatic playback is paused. Prepare this movement if needed, then start your camera when ready.' : canPractice ? 'Keep your whole body in view. Start practice gives you a 3-second countdown.' : 'Enable your camera, then stand where both your hands and feet are visible. Video stays in this browser and is not recorded.';

  return <><div className="practice-page" inert={bamboo.loading} aria-hidden={bamboo.loading || undefined} data-current-movement={total ? currentIndex + 1 : 0} data-total-movements={total} data-phase={phase} data-routine={routineId}>
    <header className="practice-header">
      <PracticeBrand />
      {modeControl}
      <div className="practice-header-right"><Link href="/">Assessment workspace ↗</Link><span className="practice-prototype"><span className="practice-dot" />Movement sequence prototype</span></div>
    </header>
    <div className="practice-intro">
      <div><div className="practice-kicker">{playlist?.title ?? 'Movement practice'}</div><h1>Learn the movement sequence.</h1><p>{clip?.description ?? 'Loading the local movement playlist…'}</p></div>
      <div className="practice-action-count"><strong>{total ? String(currentIndex + 1).padStart(2, '0') : '—'}</strong><span>of {total ? String(total).padStart(2, '0') : '—'} movements</span></div>
    </div>
    {routines.length > 1 && <div className="practice-library"><label>Training video <select aria-label="Training video" value={routineId} onChange={(event) => selectRoutine(event.target.value)}>{routines.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><span>{routines.find((item) => item.id === routineId)?.sourceFile} · Choose a movement below</span></div>}
    {playlist && <ol className="practice-sequence" aria-label="Movement sequence">{playlist.clips.map((item, index) => {
      const state = passedIds.includes(item.id) ? 'passed' : index === currentIndex ? 'current' : 'upcoming';
      return <li key={item.id} data-state={state}><button aria-label={'Practice movement ' + (index + 1) + ': ' + item.title} aria-current={index === currentIndex ? 'step' : undefined} onClick={() => selectMovement(index)}><span>{state === 'passed' ? '✓' : String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>{state === 'passed' ? 'Passed' : state === 'current' ? 'Current movement' : 'Choose to practice'} · {item.durationSeconds.toFixed(1)}s</small></div></button></li>;
    })}</ol>}
    <div className="practice-settings"><p><span className="practice-legend guide" />Amber: instructor guide <span className="practice-legend learner" />Mint: your movement</p><div><label>Match tolerance <select aria-label="Match tolerance" value={profile} disabled={isRunning || referenceState !== 'ready'} onChange={(event) => { const next = event.target.value as 'easy' | 'standard'; profileRef.current = next; setProfile(next); setResult(null); }}><option value="easy">Relaxed</option><option value="standard" disabled={!standardAvailable}>Standard{standardAvailable ? '' : ' · limited view'}</option></select></label></div></div>
    <div className="practice-workspace">
      <section className="practice-panel" aria-labelledby="reference-heading">
        <div className="practice-panel-heading"><div><h2 id="reference-heading">Reference clip</h2><p>{clip?.title ?? 'Waiting for playlist'}{duration > 0 ? ' · ' + (duration / 1000).toFixed(1) + ' seconds' : ''}</p></div><span className="practice-source-tag">Recorded video + MediaPipe</span></div>
        <div className="practice-stage">
          <div className={'practice-media ' + (mirror ? 'mirrored' : '')}><video ref={referenceVideo} aria-label="Recorded reference movement" muted playsInline preload="auto" onEnded={() => { setPreviewing(false); finishAttemptRef.current(); }} onError={() => { if (referenceState === 'ready') pausePractice('The reference video could not play. Reload the page and retry.'); }} /><canvas ref={referenceCanvas} aria-label="Pose estimated from the reference clip" /></div>
          {referenceState === 'ready' && <span className="practice-stage-badge">REFERENCE · source clip</span>}
          {referenceState !== 'ready' && <div className="practice-stage-empty"><span className="practice-camera-icon" aria-hidden="true">{referenceState === 'failed' ? '!' : '◇'}</span><strong>{referenceState === 'failed' ? 'Reference unavailable' : referenceState === 'idle' ? 'Reference preparation paused' : 'Reading the movement'}</strong><p>{referenceState === 'failed' ? 'Use the retry button below to reload the local playlist, clip, and model.' : referenceState === 'idle' ? 'Choose Prepare movement when you are ready.' : 'Running real MediaPipe on the reference video.'}</p>{referenceState === 'loading' && <><div className="practice-loading-line"><span style={{ width: analysisProgress + '%' }} /></div><span style={{ fontSize: 10 }}>{analysisProgress}% analyzed</span></>}</div>}
        </div>
        <div className="practice-panel-foot"><span className={'practice-tracking ' + (referenceVisible === 12 ? 'is-tracked' : 'is-unknown')}><i />{referenceState !== 'ready' ? 'Reference analysis pending' : referenceVisible === 12 ? 'Body pose tracked' : 'Partial visibility · ' + referenceVisible + '/12 joints'}</span><button className="practice-text-button" onClick={() => void previewReference()} disabled={referenceState !== 'ready' || isRunning || phase === 'loading'}>{previewing ? 'Pause preview' : 'Preview reference'} {previewing ? 'Ⅱ' : '▷'}</button></div>
      </section>
      <section className="practice-panel" aria-labelledby="camera-heading">
        <div className="practice-panel-heading"><div><h2 id="camera-heading">Your camera</h2><p>Match your mint skeleton to the amber guide</p></div><span className={'practice-source-tag ' + (cameraState === 'ready' ? 'live' : '')}>{cameraState === 'ready' ? modelState === 'ready' ? 'Live camera + MediaPipe' : 'Live camera · model loading' : 'Camera off'}</span></div>
        <div className="practice-stage">
          <div className={'practice-media ' + (mirror ? 'mirrored' : '')}><video ref={cameraVideo} aria-label="Live camera preview" muted playsInline autoPlay /><canvas ref={guideCanvas} className="practice-guide-canvas" aria-label="Reference skeleton aligned to your body" /><canvas ref={cameraCanvas} aria-label="Pose estimated from the live camera" /></div>
          {cameraState === 'ready' ? <span className="practice-stage-badge">LIVE · {mirror ? 'mirrored preview' : 'unmirrored preview'}</span> : <div className="practice-stage-empty"><QiSymbol className="practice-camera-seal" /><strong>{cameraState === 'loading' ? 'Opening your camera' : 'Your space to move'}</strong><p>{cameraState === 'loading' ? 'Allow camera access when your browser asks.' : 'Turn on your camera to see your movement here. No audio, recording, or upload.'}</p></div>}
          {(phase === 'countdown' || phase === 'retry') && <div className="practice-countdown"><strong>{countdown}</strong><span>{phase === 'retry' ? 'Try again' : 'Get ready'}</span></div>}
        </div>
        <div className="practice-panel-foot"><span className={'practice-tracking ' + (fullBody ? 'is-tracked' : cameraState === 'ready' ? 'is-unknown' : '')}><i />{cameraState !== 'ready' ? 'Waiting for camera' : modelState !== 'ready' ? 'Loading pose model…' : fullBody ? 'Body pose tracked' : (visible ? 'Partial visibility · ' : 'Unknown / partial · ') + visible + '/12 joints'}</span><label className="practice-mirror"><input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} />Mirror both views</label></div>
        <p className="practice-camera-hint">Both views mirror together. Follow the instructor’s left and right.</p><div className="practice-camera-settings"><label>Camera <select aria-label="Camera device" value={selectedCamera} disabled={cameraState === 'loading'} onChange={(event) => selectCamera(event.target.value)}><option value="">Default camera</option>{cameras.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}{selectedCamera && !cameras.some((device) => device.deviceId === selectedCamera) && <option value={selectedCamera}>Selected camera · disconnected</option>}</select></label><div><label><input type="checkbox" checked={showLivePose} onChange={(event) => { showLivePoseRef.current = event.target.checked; setShowLivePose(event.target.checked); if (!event.target.checked) clearCanvas(cameraCanvas.current); }} />Show my skeleton</label><label><input type="checkbox" checked={showGuide} onChange={(event) => { showGuideRef.current = event.target.checked; setShowGuide(event.target.checked); if (!event.target.checked) clearCanvas(guideCanvas.current); }} />Show instructor guide</label></div></div>
        {cameraState === 'ready' && <p className="practice-camera-hint">{cameraLabel ? cameraLabel + ' · ' : ''}{modelState !== 'ready' ? 'Preparing real pose tracking…' : liveIssue || (!visible ? 'No body detected yet. Step back until your hands, hips and feet are visible.' : !fullBody ? 'Some joints are out of view or uncertain. Keep your whole body in the frame.' : 'Live tracking active. Your mint skeleton follows your body.')}{!showLivePose ? ' Your skeleton display is hidden.' : ''}</p>}
      </section>
    </div>
    <div className="practice-lower">
      <div className={'practice-console ' + (phase === 'complete' || phase === 'passed' ? 'practice-completed' : '')}>
        <div className="practice-phase" role="status" aria-live="polite"><span className={'practice-phase-symbol ' + (phase === 'retry' ? 'is-amber' : '')} aria-hidden="true">{phase === 'complete' || phase === 'passed' ? '✓' : phase === 'retry' ? '↻' : phase === 'practicing' ? '▷' : '→'}</span><div><h2>{heading}</h2><p>{message}</p>{result && ['retry', 'passed', 'complete'].includes(phase) && <div className="practice-result-metrics"><span>Tracked time: {Math.round(result.diagnostics.attemptCoverage * 100)}%</span><span>Rule: {result.rulesVersion}</span></div>}</div></div>
        <div className="practice-controls">
          {phase === 'complete' ? <button className="practice-button" onClick={backToFirst}>Back to first movement<span aria-hidden="true">↻</span></button> : referenceState === 'failed' || referenceState === 'idle' ? <button className="practice-button" onClick={retryReference}>{referenceState === 'failed' ? playlist ? 'Retry reference' : 'Retry playlist' : 'Prepare movement'}</button> : cameraState !== 'ready' ? <button className="practice-button" onClick={() => void startCamera()} disabled={referenceState !== 'ready' || cameraState === 'loading'}>{cameraState === 'loading' ? 'Opening camera…' : 'Start camera'}<span aria-hidden="true">→</span></button> : isRunning || phase === 'loading' ? <button className="practice-button secondary" onClick={() => pausePractice()}>Pause</button> : <button className="practice-button" disabled={!canPractice} onClick={() => { setResult(null); scheduleAttempt(); }}>{phase === 'paused' || attemptNumber > 0 ? 'Restart movement' : 'Start practice'}<span aria-hidden="true">→</span></button>}
          {(cameraState === 'ready' || cameraState === 'loading') && <button className="practice-button secondary" onClick={stopCamera}>Stop camera</button>}
        </div>
      </div>
      <div className="practice-progress" role="progressbar" aria-label="Current movement playback" aria-valuemin={0} aria-valuemax={100} aria-valuenow={duration ? Math.round(elapsed / duration * 100) : 0}><span style={{ width: (duration ? Math.min(100, elapsed / duration * 100) : 0) + '%' }} /></div>
      {error && <div className="practice-error" role="alert">{error}</div>}
      <div className="practice-resources"><span>Sequence <strong>{passedIds.length} / {total} passed</strong></span><span>Reference <strong>{referenceState === 'ready' ? 'analyzed locally' : referenceState === 'failed' ? 'unavailable' : referenceState === 'idle' ? 'paused' : 'loading'}</strong></span><span>Camera <strong>{cameraState}</strong></span><span>Live pose model <strong>{modelState}</strong></span><span>Recording <strong>off</strong></span></div>
      <div className="practice-notes"><p>One movement at a time.<br />A match opens Restudy and Next choices. An incomplete or unknown attempt repeats the current clip. Pause whenever you need.</p><details><summary>How this prototype decides</summary><p>Real MediaPipe Pose estimates shoulders, elbows, wrists, hips, knees, and ankles. The amber guide comes from real MediaPipe observations of this recorded clip, prepared locally or read from a source- and model-checked reference file. The mint skeleton uses only current camera frames. The guide is aligned to your hips and torso size; it never replaces your detected pose. No demo landmarks or scores are substituted for missing tracking.</p>{clip && <p>Current focus: <strong>{focusLabel}</strong>. The comparison checks the selected wrist or ankle movement. Pose does not grade palm orientation or fine foot shape.</p>}{clip?.trackingNotes && <p>Reference visibility: {clip.trackingNotes}</p>}<p>Relaxed mode allows approximate poses, smaller movements, and timing differences. Standard mode is closer to the reference. Both compare actual movement through the start, middle, and finish, with enough tracked evidence; a held pose does not pass. Missing tracking is unknown, and old camera coordinates disappear within 250 ms. This is an experimental imitation rule, not a clinical assessment or a calibrated measure of ability.</p><p>Follow the instructor’s anatomical left and right. Mirror both views flips the instructor video, camera preview and all skeletons together; it does not swap the comparison’s left and right. The default is unmirrored.</p>{clip && <p>Current source: <code>{clip.sourceFile}</code>{' · ' + clip.startSeconds.toFixed(2) + '–' + clip.endSeconds.toFixed(2) + ' s'}{clip.sourcePlaybackRate ? ' · ' + clip.sourcePlaybackRate + '× source speed' : ''}. Complete-form recordings retain their original speed and natural duration. Opening stages use the practice speed shown above. Source videos remain on this local server. Live video and pose samples are held only in this page’s memory. Audio and recording are off. Stop camera releases camera and models; leaving the page releases all resources.</p>}{result && <p>Latest attempt: <strong>{result.status}</strong>. {result.reason}</p>}</details></div>
    </div>
    {instructions && <PracticeInstructions onBegin={() => { setInstructions(false); setPhase('ready'); }} />}
    {completion && <PracticeCompletion title={`Level ${String(completion.index + 1).padStart(2, '0')} · ${completion.title}`} detail={`This movement matched the practice rule. Choose when to continue.${completion.nextIndex === null ? ' Next returns to level selection.' : ''}`} onRestudy={restudy} onNext={nextMovement} />}
  </div>{bamboo.loading && <div className="practice-loading-overlay"><BambooLoadingScreen progress={bamboo.progress} /></div>}</>;
}
