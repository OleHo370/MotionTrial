// Lesson target geometry only. Recorded MediaPipe landmarks, confidence,
// endpoint support and source-frame identities are never changed here.
export const FOOT_ANCHOR_VERSION='continuous-planted-foot-targets-v1';
const finitePoint=point=>!!point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
const inFrame=point=>finitePoint(point)&&point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1;
const validFrame=frame=>frame&&finitePoint(frame.hip)&&Number.isFinite(frame.aspect)&&frame.aspect>0
  &&Number.isFinite(frame.scale)&&frame.scale>=.025;
const normalize=(point,frame)=>({x:(point.x*frame.aspect-frame.hip.x)/frame.scale,
  y:(point.y-frame.hip.y)/frame.scale});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const supported=(guide,side)=>{
  const times=guide?.support?.[`${side}TimesMs`]??guide?.support?.[`${side}Frames`];
  return Array.isArray(times)&&new Set(times.filter(time=>Number.isFinite(time)&&time>=0)).size>=2;
};
const footGuide=(reference,side)=>reference?.guides?.find(guide=>guide.index===(side==='left'?35:36))
  ??reference?.guides?.find(guide=>guide.index===(side==='left'?27:28));

/**
 * Planted feet have one stable teaching target instead of following source
 * tracking jitter. Successive starts carry the preceding TEACHING end in the
 * original video's coordinate system; each is then expressed in the current
 * recorded torso frame. This keeps projected centers identical across clips
 * even when the teacher's hip position or torso scale changes at a cut.
 *
 * Small incidental foot displacement is treated as a hold, including a named
 * foot move below the same threshold. A true move targets its observed absolute
 * endpoint, avoiding accumulated drift.
 * These are designated practice targets, never replacement observations.
 * A missing/unsupported finish stays missing and prevents further carry. Its
 * separately supported start can still inherit the prior teaching finish.
 */
export function prepareFootAnchorReferences(references,{minimumFootDisplacement=.45}={}){
  if(!Array.isArray(references))throw new Error('Foot anchors require a reference list.');
  if(!Number.isFinite(minimumFootDisplacement)||minimumFootDisplacement<=0)
    throw new Error('The minimum foot displacement must be a positive body-unit distance.');
  const result=structuredClone(references),carry=new Map();
  for(const reference of result){
    reference.footAnchorVersion=FOOT_ANCHOR_VERSION;
    reference.footAnchorProvenance='Designated teaching foot targets carry the previous clip finish. Small incidental foot movement is held; source landmarks, endpoint observations and support remain unchanged.';
    for(const side of ['left','right']){
      const guide=footGuide(reference,side),frame=reference.teacherFrame;
      if(!guide||!validFrame(frame)||!inFrame(guide.startRaw)||!finitePoint(guide.start)||!supported(guide,'start')){
        // Continuity is never used to conceal unavailable source evidence.
        carry.delete(side);continue;
      }
      const footFocus=reference.focusJoints?.includes(guide.index)===true;
      const previous=carry.get(side);
      const sameSource=previous&&previous.sourceId===guide.startObservation?.sourceId;
      const targetStartRaw={...(sameSource?previous.point:guide.startRaw)};
      guide.start=normalize(targetStartRaw,frame);
      const metadata={version:FOOT_ANCHOR_VERSION,kind:'anchored-foot',
        minimumDisplacement:minimumFootDisplacement,footFocus,
        carriedFromReferenceId:sameSource?previous.referenceId:null,
        sourceCoordinates:'original unmirrored source-video coordinates'};
      if(guide.valid!==true||!inFrame(guide.endRaw)||!finitePoint(guide.end)||!supported(guide,'end')){
        guide.targetGeometry={...metadata,mode:'unavailable-end',startRaw:targetStartRaw,endRaw:null,
          observedDisplacement:null,
          provenance:'Supported teaching start inherits the previous finish; the unsupported source finish remains unavailable and cannot be assessed.'};
        carry.delete(side);continue;
      }
      const observedStart=normalize(guide.startRaw,frame),observedEnd=normalize(guide.endRaw,frame);
      const observedDisplacement=distance(observedStart,observedEnd);
      const holding=observedDisplacement<minimumFootDisplacement;
      const targetEndRaw={...(holding?targetStartRaw:guide.endRaw)};
      guide.end=normalize(targetEndRaw,frame);
      guide.distance=distance(guide.start,guide.end);guide.stationary=guide.distance<.08;
      guide.targetGeometry={...metadata,mode:holding?'hold':'move',
        startRaw:targetStartRaw,endRaw:targetEndRaw,observedDisplacement,
        provenance:holding?'Planted-foot teaching hold; supported source endpoints retained separately.'
          :'Observed absolute foot destination with the previous teaching finish as its start; supported source observations retained separately.'};
      carry.set(side,{point:targetEndRaw,referenceId:reference.id,sourceId:guide.endObservation?.sourceId});
    }
  }
  return result;
}
