// Completing the pose cannot cut the demonstration short. This gate is checked
// only on a fresh camera observation, after the teacher's boundary seek settles.
export function canAdvanceFinishedStep({hold,observation,nowMs,active,paused,phase,
  teacherTime,freezeSeconds,seeking,videoPaused,boundarySettledAtMs,maximumAgeMs=450}){
  const observedAt=observation?.observedAtMs,sampleTMs=observation?.sample?.tMs;
  return active===true&&!paused&&phase==='grace'&&hold?.ready===true
    &&seeking===false&&videoPaused===true
    &&Number.isFinite(teacherTime)&&Number.isFinite(freezeSeconds)
    &&Math.abs(teacherTime-freezeSeconds)<=.002
    &&Number.isFinite(boundarySettledAtMs)&&Number.isFinite(observedAt)
    &&Number.isFinite(nowMs)&&observedAt>=boundarySettledAtMs
    &&nowMs>=observedAt&&nowMs-observedAt<=maximumAgeMs
    &&observation?.sample?.status==='pose'&&Number.isFinite(sampleTMs)
    &&hold.lastMs===observedAt&&hold.lastSampleMs===sampleTMs;
}
