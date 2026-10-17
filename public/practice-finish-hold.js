// Final readiness is separate from earned path progress. Only distinct, fresh
// observed frames can accumulate the 700 ms hold; display/render ticks cannot.
export function advanceFinishHold(previous,{result,observation,nowMs,holdMs=700,maximumAgeMs=450}){
  const observedAt=observation?.observedAtMs,sampleTMs=observation?.sample?.tMs;
  if(result?.status!=='match'||result.pathComplete!==true||observation?.sample?.status!=='pose'
    ||!Number.isFinite(nowMs)||!Number.isFinite(observedAt)||!Number.isFinite(sampleTMs)
    ||observedAt<0||sampleTMs<0||nowMs<observedAt||nowMs-observedAt>maximumAgeMs)return null;
  if(previous&&(observedAt<=previous.lastMs||sampleTMs<=previous.lastSampleMs)){
    return nowMs-previous.lastMs>maximumAgeMs?null:previous;
  }
  const continuous=previous&&observedAt-previous.lastMs<=maximumAgeMs;
  const startMs=continuous?previous.startMs:observedAt;
  const heldMs=Math.min(holdMs,Math.max(0,observedAt-startMs));
  return {startMs,lastMs:observedAt,lastSampleMs:sampleTMs,heldMs,ready:heldMs>=holdMs};
}
