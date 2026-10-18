// Camera-boundary calibration for arms-only practice. The viewport is assumed
// to run from crown to waist; this creates no observed or inferred live joints.
import {FULL_HEIGHT_LAYOUT_RULES} from './full-height-layout.js';
import {prepareStartPosition} from './start-position.js';
import {finishTargetSize} from './first-three-attempt.js';

export const UPPER_BODY_LAYOUT_RULES=Object.freeze({
  version:'head-to-waist-screen-layout-v1',aspect:1,edge:0,
  headTopY:FULL_HEIGHT_LAYOUT_RULES.headTopY,
  calibrationImage:FULL_HEIGHT_LAYOUT_RULES.calibrationImage,
});
const PALMS=Object.freeze([33,34]),WRISTS=Object.freeze([15,16]);
const finitePoint=point=>!!point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
const validFrame=frame=>frame&&finitePoint(frame.hip)&&Number.isFinite(frame.scale)&&frame.scale>=.025
  &&Number.isFinite(frame.aspect)&&frame.aspect>0;

/** Visible bounds in native camera coordinates, matching object-fit:cover. */
export function upperBodyCameraViewportBounds(aspect){
  if(!Number.isFinite(aspect)||aspect<=0)return null;
  const width=Math.min(1,UPPER_BODY_LAYOUT_RULES.aspect/aspect),height=Math.min(1,aspect/UPPER_BODY_LAYOUT_RULES.aspect);
  return {left:(1-width)/2,right:(1+width)/2,top:(1-height)/2,bottom:(1+height)/2,width,height};
}

/**
 * One isotropic transform projects the recorded teacher's crown to the visible
 * camera top and its frozen waist/hip anchor to the visible bottom. Its same
 * frame must drive squares, routes, triangles and matching. Only the active
 * step's two arm controls determine horizontal centering; foot geometry cannot
 * shrink the arms or move their targets. Corridor edges crossing the waist are
 * honestly reported, rather than shifting/clamping the recorded trajectory.
 */
export function createUpperBodyLayout(reference,references,aspect,routeReferences=[]){
  const teacher=reference?.teacherFrame,rules=UPPER_BODY_LAYOUT_RULES;
  const viewport=upperBodyCameraViewportBounds(aspect);
  if(!viewport||!validFrame(teacher)||teacher.hip.y<=rules.headTopY||teacher.hip.y>1)return null;
  const guides=Array.isArray(reference.guides)?reference.guides:[];
  const indices=guides.some(guide=>PALMS.includes(guide.index))?PALMS:WRISTS;
  if(!indices.every(index=>guides.filter(guide=>guide.index===index&&finitePoint(guide.start)).length===1))return null;
  const factor=viewport.height/(teacher.hip.y-rules.headTopY);
  const frameScale=teacher.scale*factor;
  const extents=[],verticalExtents=[];
  // The matching API accepts the same lesson-wide arguments as full-height
  // layout. Arms mode is scoped to one step, so unrelated lesson reach cannot
  // affect its calibration. Use the supplied active reference without mutation.
  const activeReferences=(Array.isArray(references)?references:[]).filter(ref=>ref===reference);
  if(!activeReferences.length)activeReferences.push(reference);
  const include=(point,horizontalHalf,topHalf=horizontalHalf,bottomHalf=topHalf)=>{
    if(!finitePoint(point))return;
    const x=(point.x*teacher.scale+teacher.hip.x)*factor;
    const y=viewport.bottom+point.y*frameScale;
    extents.push({left:x-horizontalHalf*frameScale,right:x+horizontalHalf*frameScale});
    verticalExtents.push({top:y-topHalf*frameScale,bottom:y+bottomHalf*frameScale});
  };
  for(const ref of activeReferences){
    const startRadius=prepareStartPosition(ref).radius;
    for(const guide of ref.guides||[]){
      if(!indices.includes(guide.index))continue;
      include(guide.start,startRadius);
      if(guide.valid){
        const size=finishTargetSize(ref,guide.index);
        include(guide.end,size*.9,size,size*.65);
      }
    }
  }
  for(const route of Array.isArray(routeReferences)?routeReferences:[]){
    if(route?.referenceId!==reference.id)continue;
    for(const path of route.paths||[]){
      if(!indices.includes(path.index)||!path.available||!Number.isFinite(path.halfWidth)||path.halfWidth<0)continue;
      for(const point of path.points||[])include(point,path.halfWidth);
    }
  }
  if(!extents.length)return null;
  const left=Math.min(...extents.map(bounds=>bounds.left)),right=Math.max(...extents.map(bounds=>bounds.right));
  const origin=aspect*.5-(left+right)/2;
  const frame={hip:{x:teacher.hip.x*factor+origin,y:viewport.bottom},scale:frameScale,aspect};
  const horizontalBounds={left:(left+origin)/aspect,right:(right+origin)/aspect};
  const verticalBounds={top:Math.min(...verticalExtents.map(bounds=>bounds.top)),bottom:Math.max(...verticalExtents.map(bounds=>bounds.bottom))};
  return {frame,bodyFrame:frame,factor,viewport,version:rules.version,controlIndices:[...indices],
    mappedHeadY:viewport.top,mappedWaistY:viewport.bottom,tubeVerticalShift:0,
    horizontalBounds,verticalBounds,
    clippedEdges:{left:horizontalBounds.left<viewport.left,right:horizontalBounds.right>viewport.right,
      top:verticalBounds.top<viewport.top,bottom:verticalBounds.bottom>viewport.bottom},
    calibration:{image:rules.calibrationImage,headTopY:rules.headTopY,waistY:teacher.hip.y,
      anchorKind:'assumed-camera-boundaries',
      provenance:'Visible camera top is assumed crown height and bottom is assumed waist height. The recorded starting waist frame provides proportions only; no live torso or hidden joints are fabricated. Recorded guide centers and source observations remain unchanged.'}};
}
