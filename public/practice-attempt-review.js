// Local, deterministic feedback after a complete practice attempt. MediaPipe
// supplies observations; these rules never infer missing motion or gate playback.
export const REVIEW_RULES=Object.freeze({
  version:'complete-clip-review-v2',
  visibilityThreshold:.45,
  maximumAgeMs:450,
  maximumObservedGapMs:300,
  minimumCoverage:.65,
  minimumMovementCoverage:.65,
  minimumTimingCoverage:.85,
  minimumMaterialMovementGapMs:600,
  maximumMaterialMovementGapFraction:.25,
  endpointRadius:.34,
  broadGuideRadius:.42,
  holdRadius:.42,
  minimumHandDisplacement:.35,
  minimumFootDisplacement:.45,
  minimumMovementFraction:.55,
  minimumMovementDistance:.12,
  endpointWindowMs:600,
  endpointSupportMs:60,
  maximumOffGuideFraction:.30,
  minimumOffGuideMs:400,
  minimumTimingRatio:.55,
  maximumTimingRatio:1.70,
  minimumTimingDurationMs:350,
  minimumLateStartMs:800,
  lateStartFraction:.35,
});

const finitePoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const validFrame=f=>!!f&&finitePoint(f.hip)&&Number.isFinite(f.aspect)&&f.aspect>0
  &&Number.isFinite(f.scale)&&f.scale>=.025;
const copyFrame=f=>validFrame(f)?{hip:{...f.hip},scale:f.scale,aspect:f.aspect}:null;
const normalize=(p,f)=>({x:(p.x*f.aspect-f.hip.x)/f.scale,y:(p.y-f.hip.y)/f.scale});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const foot=index=>[27,28,35,36].includes(index);
const trusted=p=>finitePoint(p)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1
  &&Number.isFinite(p.visibility)&&p.visibility>=REVIEW_RULES.visibilityThreshold&&p.visibility<=1
  &&(p.presence===undefined||Number.isFinite(p.presence)&&p.presence>=REVIEW_RULES.visibilityThreshold&&p.presence<=1);
function segmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy;
  const t=n?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/n):0;
  return distance(p,{x:a.x+t*dx,y:a.y+t*dy});
}
function guideDistance(p,control){
  if(!control.moving)return distance(p,control.start);
  const points=control.points;
  if(points.length<2)return segmentDistance(p,control.start,control.end);
  let nearest=Infinity;
  for(let i=1;i<points.length;i++)nearest=Math.min(nearest,segmentDistance(p,points[i-1],points[i]));
  return nearest;
}
function progress(p,start,end){
  const dx=end.x-start.x,dy=end.y-start.y,n=dx*dx+dy*dy;
  return n?((p.x-start.x)*dx+(p.y-start.y)*dy)/n:0;
}
function twoSupported(samples,predicate){
  let first=null,previous=null;
  for(const current of samples){
    if(!predicate(current)){first=null;previous=null;continue;}
    if(previous===null||current.elapsedMs-previous.elapsedMs>REVIEW_RULES.maximumObservedGapMs)first=current.elapsedMs;
    if(current.elapsedMs-first>=REVIEW_RULES.endpointSupportMs)return first;
    previous=current;
  }
  return null;
}

// Tempo events are estimated on the same piecewise timeline for both sides.
// This avoids making a 60 ms event depend on whether a camera samples at 8 or
// 30 Hz. Only supported adjacent pairs are connected; these derived times never
// enter raw samples, tracking coverage, endpoint evidence, or movement evidence.
function tempoTimeline(samples,start,end,canConnect){
  const timeline=[];
  for(let i=0;i<samples.length;i++){
    const b=samples[i],a=samples[i-1],gap=a?b.elapsedMs-a.elapsedMs:0;
    const connected=!!a&&gap>0&&gap<=REVIEW_RULES.maximumObservedGapMs&&canConnect(a,b);
    if(connected){
      const count=Math.ceil(gap/20);
      for(let j=1;j<count;j++){
        const t=j/count,point={x:a.point.x+(b.point.x-a.point.x)*t,
          y:a.point.y+(b.point.y-a.point.y)*t};
        timeline.push({elapsedMs:a.elapsedMs+gap*t,point,segmentStart:false});
      }
    }
    timeline.push({elapsedMs:b.elapsedMs,point:b.point,segmentStart:!connected});
  }
  return timeline.map(s=>({...s,phase:progress(s.point,start,end),
    distanceFromStart:distance(s.point,start),endpointDistance:distance(s.point,end)}));
}
function supportedTempoEvent(timeline,predicate){
  let first=null;
  for(const sample of timeline){
    if(sample.segmentStart||!predicate(sample))first=null;
    if(!predicate(sample))continue;
    first??=sample.elapsedMs;
    if(sample.elapsedMs-first>=REVIEW_RULES.endpointSupportMs)return first;
  }
  return null;
}

// This optional timeline defines a reviewed exercise rubric, not tracking.
// It stays separate from source observations and has no confidence values.
function authoredTimingSamples(path,playbackRate){
  if(path?.timingEvidenceKind!=='reviewed-teaching-targets-v1')return null;
  const keys=path.teachingKeyframes;
  if(!Array.isArray(keys)||keys.length<2||keys.some((key,i)=>!finitePoint(key.point)
    ||!Number.isFinite(key.sourceTimeSeconds)||key.sourceTimeSeconds<0
    ||i>0&&key.sourceTimeSeconds<=keys[i-1].sourceTimeSeconds))return [];
  const samples=[];
  for(let i=1;i<keys.length;i++){
    const a=keys[i-1],b=keys[i],duration=b.sourceTimeSeconds-a.sourceTimeSeconds;
    // Sample the explicitly authored target schedule in active playback time.
    // These points are never inserted into observations or camera evidence.
    const count=Math.max(1,Math.ceil(duration*1000/(100*playbackRate)));
    if(count>1000)return [];
    for(let j=0;j<count;j++){
      const t=j/count;samples.push({sourceTimeSeconds:a.sourceTimeSeconds+duration*t,
        point:{x:a.point.x+(b.point.x-a.point.x)*t,y:a.point.y+(b.point.y-a.point.y)*t}});
    }
  }
  samples.push({point:{...keys.at(-1).point},sourceTimeSeconds:keys.at(-1).sourceTimeSeconds});
  return samples;
}
// Recorded routes retain their actual timestamped observations. A separately
// authored rubric may instead supply an explicit target schedule, labelled in
// the result; it is never represented as observed teacher movement.
function teacherTiming(path,guide,playbackRate){
  const authored=authoredTimingSamples(path,playbackRate);
  const samples=(authored??path?.observations??[]).filter(o=>finitePoint(o.point)&&Number.isFinite(o.sourceTimeSeconds));
  if(samples.length<3||samples.some((o,i)=>i&&o.sourceTimeSeconds<=samples[i-1].sourceTimeSeconds))return null;
  const start=samples[0].point,end=samples.at(-1).point,displacement=distance(start,end);
  if(displacement<.12)return null;
  const origin=Number.isFinite(guide.startSourceSeconds)?guide.startSourceSeconds:samples[0].sourceTimeSeconds;
  const timed=tempoTimeline(samples.map(o=>({elapsedMs:(o.sourceTimeSeconds-origin)*1000/playbackRate,
    point:o.point})),start,end,()=>true);
  const onset=supportedTempoEvent(timed,o=>o.phase>=.10&&o.distanceFromStart>=Math.min(.10,displacement*.15));
  const finish=supportedTempoEvent(timed,o=>o.phase>=.85&&o.endpointDistance<=REVIEW_RULES.endpointRadius);
  if(onset===null||finish===null||finish<=onset)return null;
  return {onsetMs:Math.max(0,onset),finishMs:finish,movementDurationMs:finish-onset,
    sourceObservationCount:authored?0:samples.length,timingMethod:'supported-piecewise-tempo-v1',
    ...(authored?{timingEvidenceKind:'authored-teaching-timeline',reviewedTargetCount:path.teachingKeyframes.length}:{}),
  };
}

/** durationMs is the source clip duration, before applying playbackRate.
 * elapsedMs passed to observe/finalize is active wall time, excluding pauses.
 * Raw, unmirrored anatomical observations and one frozen projection frame are
 * used throughout; display mirroring has no role in the comparison.
 */
export function createAttemptReview(reference,pathReference,
  {bodyFrame,aspect,startAtMs=0,durationMs,playbackRate=1,controlIndices,completionMode='clip'}={}){
  const frame=copyFrame(bodyFrame),speed=Number.isFinite(playbackRate)&&playbackRate>0?playbackRate:1;
  const sourceDuration=Number.isFinite(durationMs)&&durationMs>0?durationMs:null;
  // Only the explicitly requested two-palm exercise may omit lower-body
  // controls. An arbitrary incomplete reference remains unknown by default.
  const selectedPalms=Array.isArray(controlIndices)&&controlIndices.length===2
    &&new Set(controlIndices).size===2&&[33,34].every(index=>controlIndices.includes(index));
  const sourceGuides=Array.isArray(reference?.guides)?reference.guides:[];
  const guides=controlIndices===undefined?sourceGuides:selectedPalms
    ?sourceGuides.filter(guide=>controlIndices.includes(guide?.index)):[];
  const controls=guides.map(guide=>{
    const path=pathReference?.paths?.find(p=>p.index===guide.index);
    const displacement=finitePoint(guide.start)&&finitePoint(guide.end)?distance(guide.start,guide.end):0;
    const moving=guide.targetGeometry?.mode!=='hold'
      &&displacement>=(foot(guide.index)?REVIEW_RULES.minimumFootDisplacement:REVIEW_RULES.minimumHandDisplacement);
    return {index:guide.index,label:guide.label??`Point ${guide.index}`,color:guide.color,
      valid:guide.valid===true&&finitePoint(guide.start)&&finitePoint(guide.end),
      start:finitePoint(guide.start)?{...guide.start}:null,end:finitePoint(guide.end)?{...guide.end}:null,
      displacement,moving,points:(path?.points??[]).filter(finitePoint).map(p=>({x:p.x,y:p.y})),
      expectedTiming:moving?teacherTiming(path,guide,speed):null,
      pathAvailable:!moving||!!path?.available,
      samples:[],observedIntervals:[],lastPoint:null,lastElapsedMs:null,lastValidElapsedMs:null,observedMs:0,offGuideMs:0,
      sampleCount:0,missingSamples:0,maximumDeviation:0,maximumForward:0};
  });
  const anatomical=selectedPalms?controls.length===2&&new Set(controls.map(c=>c.index)).size===2
    &&[33,34].every(index=>controls.some(c=>c.index===index))
    :controlIndices===undefined&&controls.length===4&&new Set(controls.map(c=>c.index)).size===4
      &&[[15,16,27,28],[33,34,35,36]].some(set=>set.every(index=>controls.some(c=>c.index===index)));
  const referenceUsable=reference?.referenceUsable===true&&pathReference?.referenceUsable===true
    &&anatomical&&controls.every(c=>c.valid&&c.pathAvailable);
  const frameUsable=!!frame&&Number.isFinite(aspect)&&Math.abs(aspect-frame.aspect)<1e-6;
  return {rulesVersion:REVIEW_RULES.version,referenceId:reference?.id??null,
    referenceUsable,unknownReason:!referenceUsable?pathReference?.unknownReason||reference?.unknownReason
      ||'The recorded teacher does not provide reliable reference observations for this clip.':null,
    bodyFrame:frame,aspect,frameUsable,startAtMs:Number.isFinite(startAtMs)?startAtMs:0,
    sourceDurationMs:sourceDuration,playbackRate:speed,expectedDurationMs:sourceDuration===null?null:sourceDuration/speed,
    completionMode:completionMode==='self-paced'?'self-paced':'clip',
    referenceEvidenceKind:reference?.assessmentEvidenceKind??'recorded-teacher-observations',
    controls,lastSampleTMs:null,lastObservedAtMs:null,lastElapsedMs:null,lastNowMs:null,
    acceptedSamples:0,rejectedSamples:0,finalized:false,result:null};
}

function collecting(session){
  return {status:'collecting',passed:false,percent:null,referenceUsable:session.referenceUsable,
    rulesVersion:REVIEW_RULES.version,acceptedSamples:session.acceptedSamples,
    ...(session.completionMode==='self-paced'?{completionMode:session.completionMode}:{}),
    limbs:session.controls.map(c=>({index:c.index,label:c.label,moving:c.moving,
      sampleCount:c.sampleCount,targetReached:false}))};
}

/** Records evidence only. It never returns a pass or makes playback decisions. */
export function observeAttemptReview(session,observation,{nowMs,elapsedMs}={}){
  if(session.finalized)return session.result;
  const elapsed=Number.isFinite(elapsedMs)?elapsedMs:nowMs-session.startAtMs;
  const observedAt=observation?.observedAtMs,sample=observation?.sample;
  const clockValid=Number.isFinite(nowMs)&&Number.isFinite(elapsed)&&elapsed>=0
    &&Number.isFinite(observedAt)&&observedAt<=nowMs+50&&nowMs-observedAt<=REVIEW_RULES.maximumAgeMs
    &&observedAt>=session.startAtMs-REVIEW_RULES.maximumAgeMs
    &&(session.lastElapsedMs===null||elapsed>session.lastElapsedMs)
    &&(session.lastObservedAtMs===null||observedAt>session.lastObservedAtMs);
  const sampleValid=Number.isFinite(sample?.tMs)&&sample.tMs>=0
    &&(session.lastSampleTMs===null||sample.tMs>session.lastSampleTMs)&&Array.isArray(sample.landmarks);
  const aspectValid=Number.isFinite(observation?.aspectRatio)&&Number.isFinite(session.aspect)
    &&Math.abs(observation.aspectRatio-session.aspect)<1e-6;
  const raw=sampleValid?new Map(sample.landmarks.map(p=>[p?.index,p])):null;
  if(!session.frameUsable||!clockValid||!sampleValid||!aspectValid||raw.size!==sample.landmarks.length){
    if(Number.isFinite(observation?.aspectRatio)&&!aspectValid)session.frameUsable=false;
    if(clockValid&&sampleValid)for(const control of session.controls){
      control.lastPoint=null;control.lastElapsedMs=null;
    }
    session.rejectedSamples++;
    return collecting(session);
  }
  session.lastObservedAtMs=observedAt;session.lastSampleTMs=sample.tMs;session.lastElapsedMs=elapsed;
  session.lastNowMs=nowMs;session.acceptedSamples++;
  for(const control of session.controls){
    const p=raw.get(control.index);
    if(sample.status!=='pose'||!trusted(p)||!control.valid){
      control.missingSamples++;control.lastPoint=null;control.lastElapsedMs=null;continue;
    }
    const point=normalize(p,session.bodyFrame),deviation=guideDistance(point,control);
    const gap=control.lastElapsedMs===null?0:elapsed-control.lastElapsedMs;
    if(gap>0&&gap<=REVIEW_RULES.maximumObservedGapMs){
      control.observedMs+=gap;
      control.observedIntervals.push({from:control.lastElapsedMs,to:elapsed});
      // A gap is never filled. Off-guide time needs two observed outside ends,
      // so a single noisy frame does not turn into correction feedback.
      if(deviation>(control.moving?REVIEW_RULES.broadGuideRadius:REVIEW_RULES.holdRadius)
        &&guideDistance(control.lastPoint,control)>(control.moving?REVIEW_RULES.broadGuideRadius:REVIEW_RULES.holdRadius))
        control.offGuideMs+=gap;
    }
    control.maximumDeviation=Math.max(control.maximumDeviation,deviation);
    control.maximumForward=Math.max(control.maximumForward,progress(point,control.start,control.end)*control.displacement);
    control.samples.push({elapsedMs:elapsed,observedAtMs:observedAt,point,
      phase:progress(point,control.start,control.end),distanceFromStart:distance(point,control.start),
      endpointDistance:distance(point,control.end)});
    control.lastPoint=point;control.lastElapsedMs=elapsed;control.lastValidElapsedMs=elapsed;control.sampleCount++;
  }
  return collecting(session);
}

const issue=(code,control,message,details={})=>({code,index:control?.index??null,
  label:control?.label??null,message,...details});

// Only intervals whose two ends were actually observed are credited. Explicit
// missing frames break intervals even when their timestamps are close together.
function windowEvidence(control,from,to){
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return null;
  let observedMs=0,cursor=from,longestGapMs=0;
  for(const interval of control.observedIntervals){
    const a=Math.max(from,interval.from),b=Math.min(to,interval.to);
    if(b<=a)continue;
    longestGapMs=Math.max(longestGapMs,a-cursor);
    observedMs+=b-a;cursor=Math.max(cursor,b);
  }
  longestGapMs=Math.max(longestGapMs,to-cursor);
  return {fromMs:from,toMs:to,durationMs:to-from,observedMs,
    coverage:clamp(observedMs/(to-from)),longestGapMs};
}
function observedMedoid(samples){
  if(!samples.length)return null;
  return samples.reduce((best,sample)=>{
    const cost=samples.reduce((sum,other)=>sum+distance(sample.point,other.point),0);
    return cost<best.cost?{point:sample.point,cost}:best;
  },{point:samples[0].point,cost:Infinity}).point;
}

function reviewControl(control,totalMs,elapsedMs,nowMs){
  const r=REVIEW_RULES,samples=control.samples,last=samples.at(-1),coverage=clamp(control.observedMs/Math.max(1,totalMs));
  const fresh=!!last&&elapsedMs-last.elapsedMs<=r.maximumAgeMs&&nowMs-last.observedAtMs<=r.maximumAgeMs;
  const recent=samples.filter(s=>elapsedMs-s.elapsedMs<=r.endpointWindowMs);
  const endSupported=twoSupported(recent,s=>s.endpointDistance<=r.endpointRadius)!==null;
  const endpointReached=fresh&&last.endpointDistance<=r.endpointRadius&&endSupported;
  const startSeen=samples.some(s=>s.distanceFromStart<=r.endpointRadius
    &&s.elapsedMs<=Math.max(500,Math.min(1500,totalMs*.35)));
  const movementObserved=!control.moving||startSeen&&control.maximumForward>=Math.max(r.minimumMovementDistance,
    control.displacement*r.minimumMovementFraction);
  // Timing uses the learner's observed excursion, rather than the exact target
  // centers. Otherwise a tolerated 0.1-unit initial offset can be mistaken for
  // movement throughout a long standstill prefix. Target correctness remains
  // independently checked against the teacher's designated geometry above.
  const initial=samples.filter(s=>s.elapsedMs<=(samples[0]?.elapsedMs??0)+200
    &&s.distanceFromStart<=r.endpointRadius);
  // A moving prefix (including a backwards preparation) is not a standstill.
  // Average only genuinely stationary initial observations, never real travel.
  const stationaryInitial=initial.length>0&&initial.every(s=>distance(s.point,samples[0].point)<=.04);
  const timingStart=(stationaryInitial?observedMedoid(initial):samples[0]?.point)??control.start;
  const timingEnd=observedMedoid(recent.filter(s=>s.endpointDistance<=r.endpointRadius))??control.end;
  const timingDisplacement=distance(timingStart,timingEnd);
  const supportedPairs=new Map(control.observedIntervals.map(interval=>[interval.to,interval.from]));
  const tempoSamples=tempoTimeline(samples,timingStart,timingEnd,
    (a,b)=>supportedPairs.get(b.elapsedMs)===a.elapsedMs);
  const onsetMs=control.moving?supportedTempoEvent(tempoSamples,s=>s.phase>=.10
    &&s.distanceFromStart>=Math.min(.10,timingDisplacement*.15)):null;
  const finishMs=control.moving?supportedTempoEvent(tempoSamples,s=>s.phase>=.85&&s.endpointDistance<=r.endpointRadius):null;
  const beforeOnset=onsetMs===null?null:samples.findLast(s=>s.elapsedMs<onsetMs);
  const movementDurationMs=onsetMs!==null&&finishMs!==null&&finishMs>=onsetMs
    ?finishMs>onsetMs?finishMs-onsetMs
      :beforeOnset&&onsetMs-beforeOnset.elapsedMs<=r.maximumObservedGapMs?onsetMs-beforeOnset.elapsedMs:null:null;
  const expected=control.expectedTiming;
  const movementEvidence=control.moving?windowEvidence(control,
    beforeOnset?.elapsedMs??onsetMs??expected?.onsetMs,
    finishMs??Math.min(elapsedMs,expected?.finishMs??elapsedMs)):null;
  const materialMovementHidden=!!movementEvidence&&(movementEvidence.coverage<r.minimumMovementCoverage
    ||movementEvidence.longestGapMs>Math.max(r.minimumMaterialMovementGapMs,
      (expected?.movementDurationMs??movementEvidence.durationMs)*r.maximumMaterialMovementGapFraction));
  const interruptedTiming=!!movementEvidence&&(movementEvidence.longestGapMs>r.maximumObservedGapMs
    ||movementEvidence.coverage<r.minimumTimingCoverage);
  const timingAssessed=movementDurationMs!==null&&expected?.movementDurationMs>=r.minimumTimingDurationMs
    &&!interruptedTiming&&!materialMovementHidden;
  const timingUncertainReason=!control.moving?null:materialMovementHidden?'Too much of the active movement was not observed.'
    :interruptedTiming?'Tracking was interrupted during the active movement.'
    :movementDurationMs===null?'The onset or finish timing was not sufficiently observed.'
    :!(expected?.movementDurationMs>=r.minimumTimingDurationMs)?'The teacher timing is not sufficiently observed.':null;
  const timingRatio=timingAssessed?movementDurationMs/expected.movementDurationMs:null;
  const lateStart=timingAssessed&&onsetMs-expected.onsetMs>Math.max(r.minimumLateStartMs,totalMs*r.lateStartFraction);
  const tooFast=timingAssessed&&timingRatio<r.minimumTimingRatio;
  const tooSlow=timingAssessed&&timingRatio>r.maximumTimingRatio;
  const offGuideFraction=control.offGuideMs/Math.max(1,control.observedMs);
  const significantDeviation=offGuideFraction>r.maximumOffGuideFraction&&control.offGuideMs>=r.minimumOffGuideMs;
  const metrics={index:control.index,label:control.label,color:control.color,moving:control.moving,
    sampleCount:control.sampleCount,missingSamples:control.missingSamples,observedMs:control.observedMs,
    coverage,fresh,startSeen,endpointDistance:last?.endpointDistance??null,endpointReached,movementObserved,
    offGuideFraction,offGuideMs:control.offGuideMs,maximumDeviation:control.maximumDeviation,
    onsetMs,finishMs,movementDurationMs,timingMethod:'supported-piecewise-tempo-v1',expectedOnsetMs:expected?.onsetMs??null,
    expectedMovementDurationMs:expected?.movementDurationMs??null,timingAssessed,timingUncertainReason,
    movementEvidence,materialMovementHidden,timingRatio,lateStart,tooFast,tooSlow,
    significantDeviation,issues:[]};
  const name=control.label.toLowerCase();
  const initialEvidenceMissing=control.moving&&!startSeen
    &&(!samples.length||samples[0].elapsedMs>Math.max(500,Math.min(1500,totalMs*.35)));
  if(coverage<r.minimumCoverage||!fresh||control.sampleCount<3||initialEvidenceMissing||materialMovementHidden){
    metrics.status='unknown';metrics.issues.push(issue('tracking_unknown',control,
      materialMovementHidden?`The camera lost your ${name} during the movement. Keep it visible from start to finish.`
        :`The camera could not clearly track your ${name}. Keep it visible throughout the attempt.`,
      {coverage,fresh,phase:materialMovementHidden?'active_movement':'whole_attempt',movementEvidence}));return metrics;
  }
  if(!endpointReached)metrics.issues.push(issue('endpoint_unreached',control,`Bring your ${name} closer to the ending triangle.`));
  else if(!movementObserved)metrics.issues.push(issue('movement_incomplete',control,`Move your ${name} from its starting square toward the finish.`));
  if(significantDeviation)metrics.issues.push(issue(control.moving?'off_guide':'hold_drift',control,
    control.moving?`Your ${name} moved well outside the general guide. Try a little closer to the shaded area.`
      :`Keep your ${name} near its starting position during this clip.`,{offGuideFraction}));
  if(tooFast)metrics.issues.push(issue('too_fast',control,`Your ${name} moved noticeably faster than the teacher. Take a little more time.`,{timingRatio}));
  else if(tooSlow)metrics.issues.push(issue('too_slow',control,`Your ${name} moved noticeably slower than the teacher. Try a slightly steadier pace.`,{timingRatio}));
  else if(lateStart)metrics.issues.push(issue('late_start',control,`Your ${name} started late. Begin closer to when the teacher begins moving.`));
  metrics.status=metrics.issues.length?'mismatch':'match';return metrics;
}

const pairedFeedback={
  tracking_unknown:part=>`The camera could not clearly track your ${part}. Keep them visible throughout the movement.`,
  endpoint_unreached:part=>`Bring your ${part} closer to the ending triangles.`,
  movement_incomplete:part=>`Move your ${part} from their starting squares toward the finish.`,
  off_guide:part=>`Your ${part} moved well outside the general guide. Try closer to the shaded areas.`,
  hold_drift:part=>`Keep your ${part} near their starting positions during this clip.`,
  too_fast:part=>`Your ${part} moved noticeably faster than the teacher. Take a little more time.`,
  too_slow:part=>`Your ${part} moved noticeably slower than the teacher. Try a slightly steadier pace.`,
  late_start:part=>`Your ${part} started late. Begin closer to when the teacher begins moving.`,
};
function conciseMessages(issues){
  const messages=[],consumed=new Set();
  for(let i=0;i<issues.length;i++){
    if(consumed.has(i))continue;
    const current=issues[i],part=foot(current.index)?'feet':[15,16,33,34].includes(current.index)?'hands':null;
    const partner=part&&pairedFeedback[current.code]?issues.findIndex((other,k)=>k>i&&!consumed.has(k)
      &&other.code===current.code&&other.index!==current.index
      &&(part==='feet'?foot(other.index):[15,16,33,34].includes(other.index))):-1;
    consumed.add(i);
    if(partner>=0){consumed.add(partner);messages.push(pairedFeedback[current.code](part));}
    else messages.push(current.message);
    if(messages.length===2)break;
  }
  return messages;
}

/** Clip mode requires the full teacher timeline. Self-paced mode requires the
 * controller's supported, fresh all-triangles gate instead; reaching a target
 * still does not imply correct movement or reliable tracking in this review.
 */
export function finalizeAttemptReview(session,{nowMs,elapsedMs,endpointsComplete=false}={}){
  if(session.finalized)return session.result;
  const elapsed=Number.isFinite(elapsedMs)?elapsedMs:nowMs-session.startAtMs;
  let issues=[],limbs=[];
  const selfPaced=session.completionMode==='self-paced';
  const complete=Number.isFinite(elapsed)&&(selfPaced?elapsed>0&&endpointsComplete===true
    :session.expectedDurationMs!==null&&elapsed>=session.expectedDurationMs-20);
  if(!session.referenceUsable)issues.push(issue('reference_unknown',null,session.unknownReason));
  else if(!session.frameUsable||!Number.isFinite(nowMs))issues.push(issue('tracking_unknown',null,
    'The camera framing changed. Set up in the starting squares again.'));
  else if(!complete)issues.push(issue('attempt_incomplete',null,selfPaced
    ?'Reach all ending triangles before reviewing this attempt.':'Play the full clip before reviewing this attempt.'));
  else{
    limbs=session.controls.map(control=>reviewControl(control,elapsed,elapsed,nowMs));
    issues=limbs.flatMap(limb=>limb.issues);
  }
  const unknown=issues.some(i=>['reference_unknown','tracking_unknown','attempt_incomplete'].includes(i.code));
  const status=unknown?'unknown':issues.length?'mismatch':'match';
  const priority={reference_unknown:0,tracking_unknown:1,attempt_incomplete:2,too_fast:3,too_slow:3,
    off_guide:4,hold_drift:4,endpoint_unreached:5,movement_incomplete:5,late_start:6};
  issues.sort((a,b)=>(priority[a.code]??9)-(priority[b.code]??9));
  const messages=issues.length?conciseMessages(issues):['Close enough — ready for the next movement.'];
  if(!issues.length&&limbs.some(limb=>limb.moving&&!limb.timingAssessed))
    messages.push('Timing needs clearer tracking.');
  session.result={status,passed:status==='match',referenceUsable:session.referenceUsable,percent:null,
    rulesVersion:REVIEW_RULES.version,messages,reason:messages[0],message:messages[0],issues,limbs,
    elapsedMs:Number.isFinite(elapsed)?elapsed:null,expectedDurationMs:session.expectedDurationMs,
    ...(selfPaced?{completionMode:session.completionMode,endpointsComplete:endpointsComplete===true}:{}),
    acceptedSamples:session.acceptedSamples,rejectedSamples:session.rejectedSamples,
    referenceEvidenceKind:session.referenceEvidenceKind,
    provenance:'Local versioned rules applied to actual per-side learner MediaPipe observations. Teacher observations and explicitly authored teaching rubrics retain separate provenance. Tempo event times use supported adjacent observations only; missing intervals, endpoint evidence, and tracking coverage are never filled.'};
  session.finalized=true;return session.result;
}
