// A single fresh matched observation can complete the step. The movement-area
// matcher supplies movement evidence; all four live targets must agree now.
export function canAdvanceOnTargets({result,observation,nowMs,active,paused,phase,
  indices=[33,34,35,36],maximumAgeMs=450}){
  const sample=observation?.sample,observedAt=observation?.observedAtMs;
  if(active!==true||paused||!['demonstrating','grace'].includes(phase)
    ||result?.status!=='match'||result.pathComplete!==true
    ||sample?.status!=='pose'||!Number.isFinite(sample.tMs)||sample.tMs<0
    ||!Number.isFinite(nowMs)||!Number.isFinite(observedAt)||observedAt<0
    ||nowMs<observedAt||nowMs-observedAt>maximumAgeMs
    ||!Array.isArray(sample.landmarks)||!Array.isArray(result.limbs))return false;
  const points=new Map();
  for(const point of sample.landmarks){
    if(!point||!Number.isInteger(point.index)||points.has(point.index))return false;
    points.set(point.index,point);
  }
  return indices.length>0&&new Set(indices).size===indices.length&&indices.every(index=>{
    const limbs=result.limbs.filter(limb=>limb.index===index),point=points.get(index);
    return limbs.length===1&&limbs[0].available===true&&limbs[0].valid===true&&limbs[0].targetReached===true
      &&point&&[point.x,point.y,point.visibility].every(Number.isFinite)
      &&point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1
      &&point.visibility>=.45&&point.visibility<=1
      &&(point.presence===undefined||Number.isFinite(point.presence)&&point.presence>=.45&&point.presence<=1);
  });
}
