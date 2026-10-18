// Use one projection frame for the entire square -> tube -> triangle display.
// Mirroring belongs to the canvas, never to these anatomical coordinates.
import {projectStartPositionTargets} from './start-position.js';
import {projectFourPointGuides} from './four-point-game-runtime.js';
import {projectPracticeTubes} from './practice-tube.js';

export function projectPracticeGuideGeometry(reference,pathReference,placement,
  {fixedFrame=null,movement=null,controlIndices}={}){
  const frame=fixedFrame??placement?.bodyFrame;
  if(!frame)return {frame:null,starts:[],ends:[],routes:[]};
  return {frame,
    starts:projectStartPositionTargets(reference,{...placement,bodyFrame:frame,aspect:frame.aspect},{controlIndices}),
    ends:projectFourPointGuides(reference,null,frame.aspect,frame),
    routes:projectPracticeTubes(pathReference,frame,movement)};
}
