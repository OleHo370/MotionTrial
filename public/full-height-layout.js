// Visual framing calibration, not a generated head/sole tracking landmark.
// Bounds were reviewed on the actual upright 450x360 source frame at 1 second.
import {prepareStartPosition,positionedMovementRulesFor} from './start-position.js';

export const FULL_HEIGHT_LAYOUT_RULES=Object.freeze({
  version:'standing-height-screen-layout-v1',aspect:7/8,edge:.02,
  headTopY:60/360,footBottomY:344/360,
  calibrationImage:'/practice-media/first-three/step-01-start.jpg',
});
export function cameraViewportBounds(aspect){
  const width=Math.min(1,FULL_HEIGHT_LAYOUT_RULES.aspect/aspect),height=Math.min(1,aspect/FULL_HEIGHT_LAYOUT_RULES.aspect);
  return {left:(1-width)/2,right:(1+width)/2,top:(1-height)/2,bottom:(1+height)/2,width,height};
}
const validFrame=frame=>frame&&Number.isFinite(frame.scale)&&frame.scale>=.025&&Number.isFinite(frame.aspect)&&frame.aspect>0
  &&Number.isFinite(frame.hip?.x)&&Number.isFinite(frame.hip?.y);

export function createFullHeightLayout(reference,references,aspect,routeReferences=[]){
  if(!Number.isFinite(aspect)||aspect<=0||!validFrame(reference?.teacherFrame))return null;
  const calibration=reference.framingCalibration,uploaded=reference.uploaded===true;
  if(uploaded&&(!calibration||!Number.isFinite(calibration.topY)||!Number.isFinite(calibration.bottomY)
    ||calibration.topY<0||calibration.bottomY>1||calibration.bottomY-calibration.topY<.15))return null;
  const rules=uploaded?{...FULL_HEIGHT_LAYOUT_RULES,headTopY:calibration.topY,footBottomY:calibration.bottomY,calibrationImage:null}:FULL_HEIGHT_LAYOUT_RULES;
  const viewport=cameraViewportBounds(aspect);
  const factor=viewport.height*(1-2*rules.edge)/(rules.footBottomY-rules.headTopY);
  const extents=[],verticalTubeBounds=[],top=viewport.top+rules.edge*viewport.height;
  // One horizontal origin across the lesson avoids moving targets between steps.
  // Only translation changes to accommodate arm reach; human scale never shrinks.
  for(const ref of references){
    const teacher=ref?.teacherFrame;if(!validFrame(teacher))continue;
    const startRadius=prepareStartPosition(ref).radius;
    for(const guide of ref.guides||[]){
      for(const [point,halfWidth]of [[guide.start,startRadius],
        [guide.valid?guide.end:null,positionedMovementRulesFor(ref).endRadius*.85*.9]]){
        if(!point||!Number.isFinite(point.x))continue;
        const center=(point.x*teacher.scale+teacher.hip.x)*factor,margin=halfWidth*teacher.scale*factor;
        extents.push({left:center-margin,right:center+margin});
      }
    }
    // Tubes use the same standing-height scale and one lesson-wide origin.
    // Include their full corridor, rather than fitting only its endpoints.
    for(const path of routeReferences.find(route=>route.referenceId===ref.id)?.paths||[]){
      if(!path.available)continue;
      for(const point of path.points){
        const center=(point.x*teacher.scale+teacher.hip.x)*factor,margin=path.halfWidth*teacher.scale*factor;
        extents.push({left:center-margin,right:center+margin});
        const y=top+(point.y*teacher.scale+teacher.hip.y-rules.headTopY)*factor;
        verticalTubeBounds.push({top:y-margin,bottom:y+margin});
      }
    }
  }
  if(!extents.length)return null;
  const left=Math.min(...extents.map(p=>p.left)),right=Math.max(...extents.map(p=>p.right));
  const origin=aspect*.5-(left+right)/2,teacher=reference.teacherFrame;
  let verticalShift=0;
  if(verticalTubeBounds.length){
    const minimum=viewport.top-Math.min(...verticalTubeBounds.map(p=>p.top));
    const maximum=viewport.bottom-Math.max(...verticalTubeBounds.map(p=>p.bottom));
    if(minimum<=maximum)verticalShift=Math.max(minimum,Math.min(0,maximum));
  }
  const frame={hip:{x:teacher.hip.x*factor+origin,y:top+(teacher.hip.y-rules.headTopY)*factor+verticalShift},
    scale:teacher.scale*factor,aspect};
  return {frame,factor,viewport,version:rules.version,
    mappedHeadY:top+verticalShift,mappedSoleY:viewport.bottom-rules.edge*viewport.height+verticalShift,
    tubeVerticalShift:verticalShift,
    horizontalBounds:{left:(left+origin)/aspect,right:(right+origin)/aspect},
    calibration:{image:rules.calibrationImage,headTopY:rules.headTopY,footBottomY:rules.footBottomY,
      provenance:uploaded?calibration.provenance:'Visually reviewed upright source-frame bounds; recorded joint observations remain unchanged.',
      ...(uploaded?{sourceTimeSeconds:calibration.sourceTimeSeconds,source:'uploaded-instructor'}:{})}};
}
