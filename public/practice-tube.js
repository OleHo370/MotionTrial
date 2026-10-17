// Spatial corridor practice. Source observations stay separate from the
// rounded guide geometry; smoothing never fills a missing tracking interval.
import {visible} from './first-three-reference.js';
import {createAreaMatcher} from './practice-area-matcher.js';
export {isInsidePracticeArea} from './practice-area-matcher.js';
import {finishTargetContains} from './first-three-attempt.js';
import {positionedMovementRulesFor,prepareStartPosition} from './start-position.js';
import {getFourPointBodyFrame} from './four-point-game-runtime.js';

export const TUBE_RULES=Object.freeze({version:'movement-area-corridors-v1',halfWidth:.18,
  simplifyTolerance:.035,maximumSourceGapMs:150,maximumSourceStep:.55,
  minimumHandDisplacement:.35,minimumFootDisplacement:.45,
  maximumObservedStep:.40,minimumObservedTravel:.012});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const frameCopy=frame=>frame?{hip:{...frame.hip},scale:frame.scale,aspect:frame.aspect}:null;
const normalize=(p,frame)=>({x:(p.x*frame.aspect-frame.hip.x)/frame.scale,y:(p.y-frame.hip.y)/frame.scale});
const project=(p,frame)=>({x:(p.x*frame.scale+frame.hip.x)/frame.aspect,y:p.y*frame.scale+frame.hip.y});
const trusted=(p,threshold)=>visible(p)&&p.visibility>=threshold&&(p.presence===undefined||p.presence>=threshold);
const cropKey=source=>JSON.stringify([source.video.width,source.video.height,
  ...['x','y','width','height'].map(key=>source.video.sourceCropPixels?.[key])]);
function segmentProjection(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const fraction=length?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/length,0,1):0;
  const point={x:a.x+dx*fraction,y:a.y+dy*fraction};return {point,fraction,distance:distance(p,point)};
}
function simplify(points,first=0,last=points.length-1){
  if(last-first<2)return [points[first],points[last]];
  let furthest=-1,maximum=0;
  for(let i=first+1;i<last;i++){
    const d=segmentProjection(points[i],points[first],points[last]).distance;
    if(d>maximum){maximum=d;furthest=i;}
  }
  return maximum>TUBE_RULES.simplifyTolerance
    ?[...simplify(points,first,furthest).slice(0,-1),...simplify(points,furthest,last)]
    :[points[first],points[last]];
}
function roundedGeometry(observations){
  const vertices=simplify(observations.map(p=>p.point)),points=[{...vertices[0]}];
  const push=p=>{if(distance(points.at(-1),p)>1e-8)points.push(p);};
  // Local quadratic corner rounding stays within the observed vertices' hull.
  // These are visible guide vertices, never additional source observations.
  for(let i=1;i<vertices.length-1;i++){
    const before=vertices[i-1],corner=vertices[i],after=vertices[i+1];
    const a={x:(before.x+corner.x)/2,y:(before.y+corner.y)/2};
    const b={x:(after.x+corner.x)/2,y:(after.y+corner.y)/2};push(a);
    for(let j=1;j<=10;j++){
      const t=j/10,u=1-t;push({x:u*u*a.x+2*u*t*corner.x+t*t*b.x,y:u*u*a.y+2*u*t*corner.y+t*t*b.y});
    }
  }
  push({...vertices.at(-1)});
  let length=0;
  for(let i=0;i<points.length;i++){if(i)length+=distance(points[i-1],points[i]);points[i].arcLength=length;}
  for(const point of points)point.phase=length?point.arcLength/length:0;
  return {points,totalLength:length};
}

export function practiceTubeIndices(reference){
  // A named focus does not turn small endpoint jitter into a progress task.
  // Feet can be explicit teaching holds, separate from their raw observations.
  const focus=new Set(reference?.focusJoints||[]);
  return (reference?.guides||[]).filter(guide=>{
    if(!guide.valid)return focus.has(guide.index);
    if(guide.targetGeometry?.mode==='hold')return false;
    const foot=[27,28,35,36].includes(guide.index);
    const displacement=guide.targetGeometry?.observedDisplacement??guide.distance;
    return Number.isFinite(displacement)&&displacement>=(foot?TUBE_RULES.minimumFootDisplacement:TUBE_RULES.minimumHandDisplacement);
  }).map(guide=>guide.index);
}

export function preparePracticeTubes(reference,step,sources){
  const body=reference?.teacherFrame,threshold=step.referenceVisibilityThreshold??.45;
  const paths=practiceTubeIndices(reference).map(index=>{
    const guide=reference.guides.find(g=>g.index===index);
    const empty=reason=>({index,label:guide?.label??'Required point',color:guide?.color??'#fff',available:false,
      reason,points:[],observations:[],halfWidth:TUBE_RULES.halfWidth,totalLength:0,stationary:false});
    if(!body||!guide?.valid)return empty('This movement needs supported recorded start and finish points.');
    const a=guide.startObservation,b=guide.endObservation;
    if(!a||!b||b.sourceTimeSeconds<=a.sourceTimeSeconds)return empty('The tube needs explicit source archive and time provenance.');
    const first=sources.get(a.sourceId),last=sources.get(b.sourceId);
    if(!first||!last)return empty('A tube source archive is unavailable.');
    const entries=[...sources.values()].filter(source=>source.video.sourceEndSeconds>=a.sourceTimeSeconds
      &&source.video.sourceStartSeconds<=b.sourceTimeSeconds);
    if(entries.some(source=>cropKey(source)!==cropKey(first)||source.data.sourceSha256!==first.data.sourceSha256
      ||source.data.modelSha256!==first.data.modelSha256||source.data.sourceClipSha256!==source.video.sha256))
      return empty('The tube recordings do not share compatible source coordinates.');
    const span=entries.flatMap(source=>source.data.samples.filter(sample=>Number.isFinite(sample.sourceTimeSeconds)
      &&sample.sourceTimeSeconds>=a.sourceTimeSeconds-1e-8&&sample.sourceTimeSeconds<=b.sourceTimeSeconds+1e-8)
      .map(sample=>({source,sample}))).sort((x,y)=>x.sample.sourceTimeSeconds-y.sample.sourceTimeSeconds);
    if(span.length<3)return empty('Not enough actual source observations for a tube.');
    const observations=[];
    for(const {source,sample}of span){
      const raw=sample.landmarks?.find(p=>p.index===index);
      if(sample.status!=='pose'||!trusted(raw,threshold)||![11,12,23,24].every(joint=>trusted(sample.landmarks.find(p=>p.index===joint),threshold)))
        return empty(`${guide.label} has missing recorded tracking inside this movement. No tube is drawn across the gap.`);
      const previous=observations.at(-1),point=normalize(raw,body);
      if(previous&&(sample.sourceTimeSeconds<=previous.sourceTimeSeconds
        ||(sample.sourceTimeSeconds-previous.sourceTimeSeconds)*1000>TUBE_RULES.maximumSourceGapMs
        ||distance(point,previous.point)>TUBE_RULES.maximumSourceStep))
        return empty(`${guide.label} has interrupted or unstable recorded tracking. This tube is unavailable.`);
      observations.push({sourceId:source.id,tMs:sample.tMs,sourceTimeSeconds:sample.sourceTimeSeconds,raw:{...raw},point});
    }
    const start=observations[0],end=observations.at(-1);
    if(start.sourceId!==a.sourceId||end.sourceId!==b.sourceId||Math.abs(start.tMs-a.tMs)>1e-6||Math.abs(end.tMs-b.tMs)>1e-6
      ||distance(start.raw,guide.startRaw)>1e-9||distance(end.raw,guide.endRaw)>1e-9)
      return empty('The tube endpoints do not match their original observations.');
    // Foot teaching anchors cancel small accumulated camera/pose drift. Apply
    // an endpoint calibration to GUIDE geometry only. Every source observation
    // above remains unchanged and must pass its original quality checks.
    const guideObservations=observations.map(observation=>{
      const fraction=(observation.sourceTimeSeconds-a.sourceTimeSeconds)/(b.sourceTimeSeconds-a.sourceTimeSeconds);
      return {...observation,point:{
        x:observation.point.x+(guide.start.x-start.point.x)*(1-fraction)+(guide.end.x-end.point.x)*fraction,
        y:observation.point.y+(guide.start.y-start.point.y)*(1-fraction)+(guide.end.y-end.point.y)*fraction}};
    });
    const geometry=roundedGeometry(guideObservations);
    if(geometry.totalLength<.12)return empty(`${guide.label} needs a clearer recorded movement route.`);
    return {index,label:guide.label,color:guide.color,available:true,reason:null,...geometry,observations,
      halfWidth:TUBE_RULES.halfWidth,stationary:false,
      targetGeometry:guide.targetGeometry?structuredClone(guide.targetGeometry):null,
      provenance:'Actual same-side source observations with original timestamps and quality checks. Rounded guide geometry is calibrated to designated teaching endpoints; observations remain unchanged. The visible corridor and area matcher share this geometry; no missing source tracking is interpolated.'};
  });
  const usable=reference?.referenceUsable===true&&prepareStartPosition(reference).usable
    &&reference.guides.every(guide=>guide.valid)&&paths.every(path=>path.available);
  return {referenceId:reference?.id??null,referenceUsable:usable,unknownReason:usable?null:paths.find(path=>!path.available)?.reason||'The recorded tube is unavailable.',
    rulesVersion:TUBE_RULES.version,paths,teacherFrame:frameCopy(body),
    key:JSON.stringify([reference?.id,TUBE_RULES.version,paths.map(p=>[p.index,p.available,p.points,p.observations.map(s=>[s.sourceId,s.tMs])])])};
}

export function createTubeMatcher(){return createAreaMatcher(TUBE_RULES);}

const sameFrame=(a,b)=>a&&b&&Math.abs(a.aspect-b.aspect)<1e-6&&Math.abs(a.scale-b.scale)<1e-9
  &&Math.abs(a.hip.x-b.hip.x)<1e-9&&Math.abs(a.hip.y-b.hip.y)<1e-9;
export function projectPracticeTubes(pathReference,bodyFrame,session){
  const matches=session?.pathKey===pathReference?.key&&sameFrame(bodyFrame,session?.bodyFrame);
  return (pathReference?.paths||[]).map(path=>{
    const state=matches?session.paths[path.index]:null,available=path.available&&!!bodyFrame;
    const progress=state?.complete?1:(state?.arc??0)/Math.max(.001,path.totalLength);
    return {index:path.index,label:path.label,color:path.color,available,stationary:path.stationary,
      halfWidth:path.halfWidth,progress,complete:!!state?.complete,offPath:!!state?.offPath,
      entryPending:!!state?.entryPending,
      points:available?path.points.map(p=>({...project(p,bodyFrame),phase:p.phase})):[],
      nextPoint:null};
  });
}
