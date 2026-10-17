// A page-local, explicitly mixed teaching rubric for clip 6. Reviewed hand
// targets are authored practice geometry, never replacement pose observations.
import {getFourPointBodyFrame} from './four-point-game-runtime.js';
import {prepareStartPosition} from './start-position.js';
import {finishTargetSize} from './first-three-attempt.js';
import {TUBE_RULES} from './practice-tube.js';

export const SIXTH_ASSESSMENT_VERSION='sixth-mixed-practice-targets-v1';
const INDICES=[33,34,35,36],TORSO=[11,12,23,24],THRESHOLD=.65,EPS=1e-6;
const COMPONENTS=new Map([[33,[[15,17,19],[.5,.25,.25]]],[34,[[16,18,20],[.5,.25,.25]]],
  [35,[[29,31],[.5,.5]]],[36,[[30,32],[.5,.5]]]]);
const finitePoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const inFrame=p=>finitePoint(p)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const trusted=p=>inFrame(p)&&Number.isFinite(p.visibility)&&p.visibility>=THRESHOLD&&p.visibility<=1
  &&(p.presence===undefined||Number.isFinite(p.presence)&&p.presence>=THRESHOLD&&p.presence<=1);
const text=value=>typeof value==='string'&&value.trim().length>0;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const normalize=(point,frame)=>({x:(point.x*frame.aspect-frame.hip.x)/frame.scale,y:(point.y-frame.hip.y)/frame.scale});
const copyFrame=frame=>({hip:{...frame.hip},scale:frame.scale,aspect:frame.aspect});
const fail=message=>{throw Error(`Invalid sixth-step assessment targets: ${message}`);};
function polyline(points){
  const result=[];let totalLength=0;
  for(const point of points){
    const previous=result.at(-1);if(previous)totalLength+=distance(previous,point);
    result.push({x:point.x,y:point.y,arcLength:totalLength});
  }
  for(const point of result)point.phase=totalLength?point.arcLength/totalLength:0;
  return {points:result,totalLength};
}

export function prepareSixthAssessmentReference(lesson,source,targetSpec){
  const step=lesson?.steps?.[5],original=lesson?.guidanceReferences?.[5],data=source?.data;
  if(lesson?.steps?.length!==6||lesson?.guidanceReferences?.length!==6||step?.id!=='first-six-06'
    ||original?.id!==step.id||source?.id!==step.sourceId||!Array.isArray(data?.samples))fail('the six-step source lesson is missing.');
  if(targetSpec?.schemaVersion!=='sixth-practice-targets-v1'||targetSpec.stepId!==step.id
    ||targetSpec.startFrame!==465||targetSpec.endFrame!==524
    ||step.referenceStartFrame!==465||step.referenceEndFrame!==524)fail('the authored target scope must be exact source frames 465–524 of clip 6.');
  if(targetSpec.displayOnly===true||targetSpec.assessmentEligible===false
    ||targetSpec.sourceId!==undefined&&targetSpec.sourceId!==source.id)fail('the supplied target scope is not eligible for this source assessment.');
  for(const key of ['sourceSha256','sourceClipSha256']){
    if(!sha(data[key])||targetSpec[key]!==data[key])fail(`${key} does not identify the preserved source.`);
  }
  if(source.video?.sha256!==data.sourceClipSha256)fail('the source video and observation archive do not agree.');
  for(const key of ['width','height','fps']){
    if(!Number.isFinite(data[key])||data[key]<=0||source.video[key]!==data[key]||targetSpec[key]!==data[key])fail(`${key} does not match the preserved source video.`);
  }
  const fps=data.fps,aspect=data.width/data.height,startFrame=targetSpec.startFrame,endFrame=targetSpec.endFrame;
  const sourceOffset=source.video.sourceStartSeconds;
  if(!Number.isFinite(sourceOffset)||Math.abs(sourceOffset)>EPS
    ||Math.abs(step.practiceStartSeconds-startFrame/fps)>EPS||Math.abs(step.teacherFreezeSeconds-endFrame/fps)>EPS)fail('the target timestamps do not match the source frames.');
  if(!Number.isInteger(source.video.frameCount)||source.video.frameCount<=endFrame
    ||!Number.isFinite(source.video.durationSeconds)||!Number.isFinite(source.video.sourceEndSeconds)
    ||Math.abs(source.video.durationSeconds-source.video.frameCount/fps)>EPS
    ||Math.abs(source.video.sourceEndSeconds-(sourceOffset+source.video.durationSeconds))>EPS)fail('the source video frame range is inconsistent.');
  const samples=new Map();let previous=-1;
  for(const sample of data.samples){
    const frame=sample.sourceFrameIndex;
    if(!Number.isInteger(frame)||frame<0||frame>=source.video.frameCount||frame<=previous
      ||sample.frameIndex!==undefined&&sample.frameIndex!==frame||!Number.isFinite(sample.tMs)
      ||Math.abs(sample.tMs-frame*1000/fps)>EPS||!Number.isFinite(sample.sourceTimeSeconds)
      ||Math.abs(sample.sourceTimeSeconds-(sourceOffset+frame/fps))>EPS)fail('source observation frame identities are invalid.');
    previous=frame;samples.set(frame,sample);
  }
  const rawPoints=sample=>{
    if(sample?.status!=='pose'||!Array.isArray(sample.landmarks))return null;
    const points=new Map(sample.landmarks.map(point=>[point.index,point]));
    return points.size===sample.landmarks.length?points:null;
  };
  const supports=(sample,indices)=>{
    const points=rawPoints(sample);return !!points&&[...TORSO,...indices].every(index=>trusted(points.get(index)))
      &&indices.every(index=>{
        const definition=COMPONENTS.get(index);if(!definition)return true;
        const [ids,weights]=definition,parts=ids.map(id=>points.get(id)),control=points.get(index);
        return parts.every(trusted)&&Math.abs(control.x-parts.reduce((sum,p,i)=>sum+p.x*weights[i],0))<=EPS
          &&Math.abs(control.y-parts.reduce((sum,p,i)=>sum+p.y*weights[i],0))<=EPS
          &&Math.abs(control.visibility-Math.min(...parts.map(p=>p.visibility)))<=EPS
          &&(control.presence===undefined||parts.every(p=>Number.isFinite(p.presence))
            &&Math.abs(control.presence-Math.min(...parts.map(p=>p.presence)))<=EPS);
      });
  };
  const first=samples.get(startFrame),last=samples.get(endFrame),body=original.teacherFrame;
  if(!supports(first,INDICES)||!sha(first?.inputPngSha256))fail('all four genuine starting controls and torso must remain supported.');
  if(!body||!finitePoint(body.hip)||!(body.scale>=.025)||!Number.isFinite(body.aspect)||Math.abs(body.aspect-aspect)>EPS)fail('the original frozen teacher frame is unavailable.');
  const actualFrame=getFourPointBodyFrame(first,aspect);
  if(!actualFrame||distance(actualFrame.hip,body.hip)>EPS||Math.abs(actualFrame.scale-body.scale)>EPS)fail('the frozen teacher frame is not its genuine starting frame.');
  if(!Array.isArray(original.guides)||original.guides.length!==4||new Set(original.guides.map(g=>g.index)).size!==4
    ||!INDICES.every(index=>original.guides.some(g=>g.index===index))||!prepareStartPosition(original).usable)fail('the original four start squares are not usable.');
  const firstPoints=rawPoints(first);
  for(const guide of original.guides){
    const observed=firstPoints.get(guide.index),startObservation=guide.startObservation;
    if(!inFrame(guide.startRaw)||distance(guide.startRaw,observed)>EPS
      ||startObservation?.sourceId!==source.id||!Number.isFinite(startObservation.tMs)||Math.abs(startObservation.tMs-first.tMs)>EPS
      ||Math.abs(guide.startSourceSeconds-first.sourceTimeSeconds)>EPS)fail('a starting control no longer matches its original source observation.');
    const times=guide.support?.startTimesMs;
    if(!Array.isArray(times)||new Set(times).size<2||times.some(time=>!Number.isFinite(time)
      ||!supports(data.samples.find(s=>Math.abs(s.tMs-time)<EPS),INDICES)))fail('genuine starting support is missing.');
  }
  if(!Array.isArray(targetSpec.tracks)||targetSpec.tracks.length!==2
    ||new Set(targetSpec.tracks.map(track=>track.index)).size!==2
    ||![33,34].every(index=>targetSpec.tracks.some(track=>track.index===index)))fail('exactly the left and right authored hand tracks are required.');
  const tracks=new Map();
  for(const track of targetSpec.tracks){
    if(!text(track.provenance)||!Array.isArray(track.keyframes)||track.keyframes.length<2)fail('each authored hand track needs review provenance and keyframes.');
    let previousKey=startFrame;
    const keys=track.keyframes.map(key=>{
      const frame=key.sourceFrameIndex,sample=samples.get(frame);
      if(!Number.isInteger(frame)||frame<=previousKey||frame>endFrame||!sample||sample.status!=='pose'||!inFrame(key)
        ||!sha(key.inputPngSha256)||key.inputPngSha256!==sample.inputPngSha256)fail('an authored keyframe is unsorted, outside the scope, or differs from its source PNG.');
      previousKey=frame;return {sourceFrameIndex:frame,x:key.x,y:key.y,inputPngSha256:key.inputPngSha256};
    });
    if(keys.at(-1).sourceFrameIndex!==endFrame)fail('each authored hand track must include the exact final source frame.');
    tracks.set(track.index,{provenance:track.provenance,keys});
  }
  if(!supports(last,[35])||!sha(last?.inputPngSha256))fail('the actual left-foot endpoint is not supported at the unchanged 0.65 threshold.');
  const near=data.samples.filter(sample=>Math.abs(sample.sourceFrameIndex-endFrame)<=Math.ceil(fps*.25)&&supports(sample,[35]));
  if(near.length<2)fail('the left-foot endpoint lacks nearby genuine supporting observations.');
  const span=data.samples.filter(sample=>sample.sourceFrameIndex>=startFrame&&sample.sourceFrameIndex<=endFrame);
  if(span.length<3||span[0]!==first||span.at(-1)!==last)fail('the complete recorded left-foot path is missing.');
  const footObservations=[];
  for(const sample of span){
    if(!supports(sample,[35])||!sha(sample.inputPngSha256))fail('the left foot or torso has missing or low-confidence source tracking inside clip 6.');
    const raw=rawPoints(sample).get(35),point=normalize(raw,body),previous=footObservations.at(-1);
    if(previous&&((sample.sourceTimeSeconds-previous.sourceTimeSeconds)*1000>TUBE_RULES.maximumSourceGapMs
      ||distance(point,previous.point)>TUBE_RULES.maximumSourceStep))fail('the genuine left-foot path has an interrupted or unstable source interval.');
    footObservations.push({sourceId:source.id,tMs:sample.tMs,sourceTimeSeconds:sample.sourceTimeSeconds,
      sourceFrameIndex:sample.sourceFrameIndex,inputPngSha256:sample.inputPngSha256,point,raw:structuredClone(raw)});
  }
  const guidanceReference=structuredClone(original),paths=[];
  guidanceReference.sourceObservationQuality=structuredClone(original.endpointQuality);
  // Original endpoint quality still describes the raw archive; the new rubric
  // has its own per-control evidence rather than relabeling that quality.
  delete guidanceReference.endpointQuality;
  guidanceReference.referenceEvidenceKind='mixed-reviewed-teaching-targets';
  guidanceReference.assessmentEvidenceKind='mixed-reviewed-teaching-targets';
  guidanceReference.assessmentVersion=SIXTH_ASSESSMENT_VERSION;
  guidanceReference.guideVersion=SIXTH_ASSESSMENT_VERSION;
  guidanceReference.guideProvenance='Clip 6 uses reviewed authored hand teaching targets, a genuine observed left-foot route, and a designated planted-right-foot hold. Original teacher observations and all learner evidence remain separate.';
  guidanceReference.boundaryProvenance='All four starts retain the original exact frame-465 observations. Hand endings are reviewed targets, left-foot ending is independently observed at frame 524, and the right foot is a designated teaching hold.';
  for(const guide of guidanceReference.guides){
    const startEvidence={evidenceKind:'recorded-start-observation',sourceId:source.id,sourceFrameIndex:startFrame,
      tMs:first.tMs,sourceTimeSeconds:first.sourceTimeSeconds,inputPngSha256:first.inputPngSha256,supportTimesMs:[...guide.support.startTimesMs]};
    if(guide.index===33||guide.index===34){
      const track=tracks.get(guide.index),final=track.keys.at(-1);
      guide.end=normalize(final,body);guide.endRaw=null;guide.endObservation=null;
      guide.endSourceSeconds=sourceOffset+endFrame/fps;guide.support.endTimesMs=[];
      guide.targetEvidence={start:startEvidence,end:{evidenceKind:'reviewed-teaching-target',sourceId:source.id,sourceFrameIndex:endFrame,
        sourceTimeSeconds:guide.endSourceSeconds,inputPngSha256:final.inputPngSha256,point:{...guide.end},sourcePosition:{x:final.x,y:final.y},provenance:track.provenance}};
      guide.distance=distance(guide.start,guide.end);guide.stationary=guide.distance<.08;
      guide.targetGeometry={version:SIXTH_ASSESSMENT_VERSION,kind:'reviewed-teaching-target',mode:'move',
        observedDisplacement:null,teachingDisplacement:guide.distance,provenance:track.provenance};
      const teachingKeyframes=[{point:{...guide.start},sourceId:source.id,sourceFrameIndex:startFrame,
        sourceTimeSeconds:first.sourceTimeSeconds,inputPngSha256:first.inputPngSha256,evidenceKind:'recorded-start-observation'},
      ...track.keys.map(key=>({point:normalize(key,body),sourceId:source.id,sourceFrameIndex:key.sourceFrameIndex,
        sourceTimeSeconds:sourceOffset+key.sourceFrameIndex/fps,inputPngSha256:key.inputPngSha256,
        evidenceKind:'reviewed-teaching-target',provenance:track.provenance}))];
      const geometry=polyline(teachingKeyframes.map(key=>key.point)),available=guide.distance>=TUBE_RULES.minimumHandDisplacement&&geometry.totalLength>=.12;
      paths.push({index:guide.index,label:guide.label,color:guide.color,available,
        reason:available?null:'The authored hand target does not define a sufficiently large teaching movement.',
        ...geometry,observations:[],teachingKeyframes,timingEvidenceKind:'reviewed-teaching-targets-v1',
        halfWidth:TUBE_RULES.halfWidth,stationary:false,targetGeometry:structuredClone(guide.targetGeometry),
        provenance:track.provenance});
    }else if(guide.index===35){
      const raw=rawPoints(last).get(35);guide.endRaw={x:raw.x,y:raw.y};guide.end=normalize(raw,body);
      guide.endSourceSeconds=last.sourceTimeSeconds;guide.support.endTimesMs=near.map(sample=>sample.tMs);
      guide.endObservation={sourceId:source.id,tMs:last.tMs,sourceTimeSeconds:last.sourceTimeSeconds,
        sourceFrameIndex:endFrame,supportTimesMs:[...guide.support.endTimesMs]};
      guide.targetEvidence={start:startEvidence,end:{evidenceKind:'recorded-source-observation',sourceId:source.id,sourceFrameIndex:endFrame,
        tMs:last.tMs,sourceTimeSeconds:last.sourceTimeSeconds,inputPngSha256:last.inputPngSha256,supportTimesMs:[...guide.support.endTimesMs]}};
      guide.distance=distance(guide.start,guide.end);guide.stationary=guide.distance<.08;
      guide.targetGeometry={...guide.targetGeometry,version:SIXTH_ASSESSMENT_VERSION,kind:'anchored-foot',mode:'move',
        endRaw:{...guide.endRaw},observedDisplacement:distance(normalize(guide.startRaw,body),guide.end),
        provenance:'Genuine same-frame left-foot endpoint at source frame 524; the existing carried start remains fixed. Source observations remain unchanged.'};
      const firstPoint=footObservations[0].point,lastPoint=footObservations.at(-1).point;
      const calibrated=footObservations.map(observation=>{
        const fraction=(observation.sourceTimeSeconds-first.sourceTimeSeconds)/(last.sourceTimeSeconds-first.sourceTimeSeconds);
        return {x:observation.point.x+(guide.start.x-firstPoint.x)*(1-fraction)+(guide.end.x-lastPoint.x)*fraction,
          y:observation.point.y+(guide.start.y-firstPoint.y)*(1-fraction)+(guide.end.y-lastPoint.y)*fraction};
      });
      const geometry=polyline(calibrated),available=guide.distance>=TUBE_RULES.minimumFootDisplacement&&geometry.totalLength>=.12;
      paths.push({index:35,label:guide.label,color:guide.color,available,reason:available?null:'The genuine left-foot route is too small for this heel-extension task.',
        ...geometry,observations:footObservations,halfWidth:TUBE_RULES.halfWidth,stationary:false,
        targetGeometry:structuredClone(guide.targetGeometry),provenance:'Actual unchanged left-foot/torso observations at the original 0.65 threshold. Only visible guide geometry receives endpoint calibration; no missing tracking is filled.'});
    }else{
      guide.end={...guide.start};guide.endRaw=null;guide.endObservation=null;guide.support.endTimesMs=[];
      guide.endSourceSeconds=sourceOffset+endFrame/fps;guide.distance=0;guide.stationary=true;
      const carried=guide.targetGeometry?.startRaw;
      if(!inFrame(carried))fail('the carried planted-right-foot teaching position is missing.');
      guide.targetGeometry={...guide.targetGeometry,version:SIXTH_ASSESSMENT_VERSION,kind:'anchored-foot',mode:'hold',
        endRaw:{...carried},observedDisplacement:null,
        provenance:'Designated planted-foot teaching hold at the unchanged carried start; not an observation of the unreliable frame-524 right heel.'};
      guide.targetEvidence={start:startEvidence,end:{evidenceKind:'designated-planted-foot-hold',sourceId:source.id,
        sourceFrameIndex:endFrame,sourceTimeSeconds:guide.endSourceSeconds,point:{...guide.end},
        carriedFromReferenceId:guide.targetGeometry.carriedFromReferenceId,provenance:guide.targetGeometry.provenance}};
      const previousReference=lesson.guidanceReferences[4],previousGuide=previousReference?.guides?.find(p=>p.index===36);
      if(previousGuide&&previousReference.teacherFrame?.scale>0)guide.finishTargetSize=Math.max(finishTargetSize(guidanceReference,36),
        finishTargetSize(previousReference,36)*previousReference.teacherFrame.scale/body.scale);
    }
    guide.valid=finitePoint(guide.start)&&finitePoint(guide.end);guide.available=guide.valid;
    guide.endAvailable=guide.valid;
  }
  const usable=prepareStartPosition(guidanceReference).usable&&guidanceReference.guides.every(guide=>guide.valid)&&paths.every(path=>path.available);
  const reason=usable?null:paths.find(path=>!path.available)?.reason||'The mixed clip-6 teaching targets are unavailable.';
  guidanceReference.referenceUsable=usable;guidanceReference.unknownReason=reason;guidanceReference.unassessedReason=null;
  const pathReference={referenceId:step.id,referenceUsable:usable,unknownReason:reason,rulesVersion:TUBE_RULES.version,
    assessmentVersion:SIXTH_ASSESSMENT_VERSION,referenceEvidenceKind:'mixed-reviewed-teaching-targets',paths,teacherFrame:copyFrame(body),
    key:JSON.stringify([step.id,SIXTH_ASSESSMENT_VERSION,data.sourceSha256,data.sourceClipSha256,paths.map(path=>[path.index,path.available,path.points]),guidanceReference.guides.map(guide=>[guide.index,guide.end])])};
  return {guidanceReference,pathReference,version:SIXTH_ASSESSMENT_VERSION};
}
