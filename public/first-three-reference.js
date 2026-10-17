// Separate three-step references. Raw archived observations remain unchanged.
import {getFourPointBodyFrame, FOUR_POINT_COLORS} from './four-point-game-runtime.js';
import {BODY_POINT_VERSION,BODY_COLORS,BODY_NAMES} from './practice-centers.js';
export const INDICES=[15,16,27,28];
const NAMES={15:'Left hand',16:'Right hand',27:'Left foot',28:'Right foot'};
export const REFERENCE_VERSION='first-three-observed-v1.0';
export function visible(p){return !!p&&[p.x,p.y,p.visibility].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&p.visibility>=.45&&p.visibility<=1&&(p.presence===undefined||Number.isFinite(p.presence)&&p.presence>=.45&&p.presence<=1);}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function endpoint(samples,index,aspect,threshold,selectedTMs=null){
  const observed=samples.flatMap(sample=>{
    const body=getFourPointBodyFrame(sample,aspect),p=sample.landmarks.find(p=>p.index===index);
    const trusted=q=>visible(q)&&q.visibility>=threshold&&(q.presence===undefined||q.presence>=threshold);
    return body&&sample.status==='pose'&&trusted(p)&&[11,12,23,24].every(i=>trusted(sample.landmarks.find(q=>q.index===i)))?[{point:{x:(p.x*aspect-body.hip.x)/body.scale,y:(p.y-body.hip.y)/body.scale},raw:{x:p.x,y:p.y},sample}]:[];
  });
  if(observed.length<2)return null;
  const medoid=selectedTMs===null?observed.reduce((best,p)=>{const cost=observed.reduce((sum,q)=>sum+distance(p.point,q.point),0);return cost<best.cost?{p,cost}:best;},{p:observed[0],cost:Infinity}).p:observed.find(p=>p.sample.tMs===selectedTMs);
  if(!medoid)return null;
  return {...medoid,support:observed.map(p=>p.sample.tMs)};
}
export function prepareFirstThreeReference(step,data,options={}){
  const indices=options.pointIndices??INDICES,names={...NAMES,...BODY_NAMES},colors={...FOUR_POINT_COLORS,...BODY_COLORS};
  const aspect=data.width/data.height,threshold=step.referenceVisibilityThreshold??.45;
  if(!(aspect>0)||!Array.isArray(step.focusJoints)||!step.focusJoints.length||step.focusJoints.some(i=>!indices.includes(i)))throw new Error('Invalid three-step reference metadata.');
  const samples=data.samples.filter(s=>s.tMs>=step.startSeconds*1000-.01&&s.tMs<step.endSeconds*1000-.01);
  const starts=samples.filter(s=>s.tMs<(step.startSeconds+.25)*1000),ends=samples.filter(s=>s.tMs>=(step.endSeconds-.30)*1000);
  const pick=(side,index,fallback)=>{
    const boundary=options.boundaries?.[side];
    if(!boundary)return endpoint(fallback,index,aspect,threshold);
    if(!boundary.available)return null;
    const selected=endpoint(boundary.samples,index,aspect,Math.max(threshold,boundary.threshold),boundary.tMs);
    return selected?{...selected,sourceId:boundary.sourceId}:null;
  };
  const observation=value=>value?{sourceId:value.sourceId??step.sourceId,tMs:value.sample.tMs,
    sourceTimeSeconds:value.sample.sourceTimeSeconds,supportTimesMs:[...value.support]}:null;
  const guides=indices.map(index=>{
    const start=pick('start',index,starts),end=pick('end',index,ends),length=start&&end?distance(start.point,end.point):null;
    return {index,label:names[index],color:colors[index],required:step.focusJoints.includes(index),valid:!!start&&!!end,
      start:start?.point??null,end:end?.point??null,startRaw:start?.raw??null,endRaw:end?.raw??null,
      startSourceSeconds:start?.sample.sourceTimeSeconds??null,endSourceSeconds:end?.sample.sourceTimeSeconds??null,
      ...(options.boundaries?{startObservation:observation(start),endObservation:observation(end)}:{}),
      support:{startTimesMs:start?.support??[],endTimesMs:end?.support??[]},distance:length,stationary:length!==null&&length<.08};
  });
  const issues=[];
  for(const guide of guides.filter(g=>g.required)){
    if(!guide.valid){issues.push(`${guide.label} needs clearer recorded endpoints`);continue;}
    // A named raise/lower/step must show that motion in the teacher data. A
    // high visibility score alone must never turn a failed raise into a hold.
    const delta={x:guide.end.x-guide.start.x,y:guide.end.y-guide.start.y};
    if(step.motion==='raise'&&delta.y>-.20)issues.push(`${guide.label} raise needs source review`);
    if(step.motion==='lower'&&delta.y<.20)issues.push(`${guide.label} lowering needs source review`);
    if(step.motion==='left-step'&&delta.x<.15)issues.push('Left-foot step needs source review');
    if(['open','circle'].includes(step.motion)&&guide.distance<.12)issues.push(`${guide.label} movement needs source review`);
    if(step.motion==='left-heel'&&guide.distance<.15)issues.push('Left-heel movement needs source review');
  }
  return {id:step.id,title:step.title,focusJoints:[...step.focusJoints],guides,referenceAspectRatio:aspect,referenceUsable:!issues.length,
    unknownReason:issues.length?issues.join('. ')+'. Visual practice only.':null,rulesVersion:'four-point-slide-v1.0',guideVersion:options.controlPointVersion??REFERENCE_VERSION,
    ...(options.controlPointVersion?{controlPointVersion:options.controlPointVersion,controlPointIndices:[...indices]}:{}),
    ...(options.targetSizeProfile?{targetSizeProfile:options.targetSizeProfile}:{}),
    guideProvenance:options.controlPointVersion===BODY_POINT_VERSION?'Eight controls from actual 24.mp4 observations: raw anatomical elbows/knees and same-frame estimated palm/foot centers. Supported endpoints only; missing data remains unavailable.':options.controlPointVersion?'Estimated palm/foot centers derived from same-frame observed hand/foot landmarks in actual 24.mp4 clips. Supported endpoints; missing components remain unavailable. Raw anatomical indices are preserved.':'Actual 24.mp4-derived archived MediaPipe observations, supported endpoint medoids. Explicit same-side movement checks; no generated landmarks or missing-point interpolation.'};
}
