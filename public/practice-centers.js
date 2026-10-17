// Page-local control points, explicitly derived from same-frame Pose observations.
// Raw MediaPipe anatomical indices 0..32 are retained without replacement.
export const CENTER_POINT_VERSION='observed-palm-foot-centers-v1';
export const CENTER_POINT_DEFINITIONS=Object.freeze([
  {index:33,sourceIndex:15,label:'Left palm',color:'#42dfd0',sources:[15,17,19],weights:[.5,.25,.25],kind:'estimated-palm-center'},
  {index:34,sourceIndex:16,label:'Right palm',color:'#ffc968',sources:[16,18,20],weights:[.5,.25,.25],kind:'estimated-palm-center'},
  {index:35,sourceIndex:27,label:'Left foot',color:'#79b8ff',sources:[29,31],weights:[.5,.5],kind:'estimated-foot-center'},
  {index:36,sourceIndex:28,label:'Right foot',color:'#eaa4ff',sources:[30,32],weights:[.5,.5],kind:'estimated-foot-center'},
].map(p=>Object.freeze({...p,sources:Object.freeze(p.sources),weights:Object.freeze(p.weights)})));
export const CENTER_INDICES=Object.freeze(CENTER_POINT_DEFINITIONS.map(p=>p.index));
export const CENTER_COLORS=Object.freeze(Object.fromEntries(CENTER_POINT_DEFINITIONS.map(p=>[p.index,p.color])));
export const CENTER_NAMES=Object.freeze(Object.fromEntries(CENTER_POINT_DEFINITIONS.map(p=>[p.index,p.label])));
export const CENTER_REFERENCE_OPTIONS=Object.freeze({pointIndices:CENTER_INDICES,controlPointVersion:CENTER_POINT_VERSION});
// Elbows/knees use their actual SDK landmark IDs, alongside the four derived centers.
export const BODY_POINT_VERSION='eight-body-controls-v1';
export const BODY_POINT_DEFINITIONS=Object.freeze([...CENTER_POINT_DEFINITIONS,
  Object.freeze({index:13,label:'Left elbow',color:'#8ee886',kind:'observed-elbow'}),
  Object.freeze({index:14,label:'Right elbow',color:'#ff9678',kind:'observed-elbow'}),
  Object.freeze({index:25,label:'Left knee',color:'#62c9f5',kind:'observed-knee'}),
  Object.freeze({index:26,label:'Right knee',color:'#f582c3',kind:'observed-knee'}),
]);
export const BODY_INDICES=Object.freeze(BODY_POINT_DEFINITIONS.map(p=>p.index));
export const BODY_COLORS=Object.freeze(Object.fromEntries(BODY_POINT_DEFINITIONS.map(p=>[p.index,p.color])));
export const BODY_NAMES=Object.freeze(Object.fromEntries(BODY_POINT_DEFINITIONS.map(p=>[p.index,p.label])));
export const BODY_REFERENCE_OPTIONS=Object.freeze({pointIndices:BODY_INDICES,controlPointVersion:BODY_POINT_VERSION});
const valid=p=>!!p&&[p.x,p.y,p.visibility].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1
  &&p.visibility>=.45&&p.visibility<=1&&(p.presence===undefined||Number.isFinite(p.presence)&&p.presence>=.45&&p.presence<=1);
export function withPracticeCenters(sample){
  if(!sample||!Array.isArray(sample.landmarks))return sample;
  // Rebuilding is idempotent. Virtual IDs are never mistaken for SDK landmarks.
  const anatomical=sample.landmarks.filter(p=>p.index>=0&&p.index<=32),raw=new Map(anatomical.map(p=>[p.index,p]));
  if(raw.size!==anatomical.length)return {...sample,landmarks:anatomical,controlPointVersion:CENTER_POINT_VERSION};
  const centers=sample.status==='pose'?CENTER_POINT_DEFINITIONS.flatMap(def=>{
    const points=def.sources.map(index=>raw.get(index));
    if(!points.every(valid))return [];
    const point={index:def.index,x:points.reduce((sum,p,i)=>sum+p.x*def.weights[i],0),
      y:points.reduce((sum,p,i)=>sum+p.y*def.weights[i],0),visibility:Math.min(...points.map(p=>p.visibility)),
      kind:def.kind,sourceIndices:[...def.sources],controlPointVersion:CENTER_POINT_VERSION};
    if(points.every(p=>Number.isFinite(p.z)))point.z=points.reduce((sum,p,i)=>sum+p.z*def.weights[i],0);
    const presence=points.map(p=>p.presence).filter(p=>p!==undefined);
    if(presence.length)point.presence=Math.min(...presence);
    return [point];
  }):[];
  return {...sample,landmarks:[...anatomical,...centers],controlPointVersion:CENTER_POINT_VERSION};
}
export function withCenterReferenceData(data){return {...data,controlPointVersion:CENTER_POINT_VERSION,samples:data.samples.map(withPracticeCenters)};}
export function withBodyPracticePoints(sample){
  const adapted=withPracticeCenters(sample);
  return adapted?{...adapted,controlPointVersion:BODY_POINT_VERSION}:adapted;
}
export function withBodyReferenceData(data){return {...data,controlPointVersion:BODY_POINT_VERSION,samples:data.samples.map(withBodyPracticePoints)};}
export function withCenterFocus(step){
  return {...step,focusJoints:step.focusJoints.map(index=>CENTER_POINT_DEFINITIONS.find(p=>p.sourceIndex===index)?.index??index)};
}
export function controlPointIndices(reference,defaults){
  return reference?.controlPointVersion===BODY_POINT_VERSION?BODY_INDICES
    :reference?.controlPointVersion===CENTER_POINT_VERSION?CENTER_INDICES:defaults;
}
