// A completed pose must also be a valid starting pose at the next shared cut.
// This only sizes visible targets; original observed coordinates stay unchanged.
import {prepareStartPosition} from './start-position.js';
import {finishTargetSize} from './first-three-attempt.js';
import {TUBE_RULES,practiceTubeIndices} from './practice-tube.js';

export const HANDOFF_VERSION='continuous-teaching-target-areas-v2';
const triangleOuterRadius=Math.max(1,Math.hypot(.9,.65));
const sameObservation=(a,b)=>a&&b&&a.sourceId===b.sourceId&&Math.abs(a.tMs-b.tMs)<1e-6;

export function prepareHandoffReferences(references){
  const result=structuredClone(references);
  // Resolve from the last clip backwards so a planted-foot hold also contains
  // the previous finish after its own eventual handoff size is known.
  for(let i=result.length-2;i>=0;i--){
    const current=result[i],next=result[i+1];
    const a=current.teacherFrame?.scale,b=next.teacherFrame?.scale;
    if(!(a>0&&b>0))continue;
    const starts=prepareStartPosition(next);
    for(const guide of current.guides){
      const incoming=next.guides.find(point=>point.index===guide.index);
      if(!guide.valid||!incoming||!starts.usable||!starts.targets.find(target=>target.index===guide.index)?.valid
        ||!sameObservation(guide.endObservation,incoming.startObservation)
        ||!guide.endRaw||!incoming.startRaw
        ||Math.hypot(guide.endRaw.x-incoming.startRaw.x,guide.endRaw.y-incoming.startRaw.y)>1e-9)continue;
      // Per-step torso frames have different scales even at the same screen
      // coordinate. Convert the incoming square/corridor into outgoing units.
      const ratio=b/a;
      let size=Math.min(finishTargetSize(current,guide.index),starts.radius*ratio);
      const moving=incoming.valid&&practiceTubeIndices(next).includes(guide.index);
      if(moving)size=Math.min(size,TUBE_RULES.halfWidth*ratio/triangleOuterRadius);
      const planted=incoming.targetGeometry?.mode==='hold';
      if(planted)size=Math.min(size,finishTargetSize(next,guide.index)*ratio);
      guide.finishTargetSize=size;
      guide.finishHandoff={version:HANDOFF_VERSION,toReferenceId:next.id,
        sourceId:guide.endObservation.sourceId,tMs:guide.endObservation.tMs,
        incomingScaleRatio:ratio,insideNextStart:true,insideNextTube:moving,insideNextHold:planted};
    }
    current.handoffVersion=HANDOFF_VERSION;
  }
  return result;
}
