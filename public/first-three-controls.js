// Lesson controls only. Raw MediaPipe observations still retain every joint.
import {CENTER_INDICES,CENTER_COLORS,CENTER_NAMES,CENTER_POINT_VERSION,CENTER_REFERENCE_OPTIONS,
  withCenterReferenceData,withPracticeCenters} from './practice-centers.js';
import {COMPACT_CENTER_START_POSITION_RULES} from './start-position.js';

export const LESSON_CONTROLS=Object.freeze({
  indices:CENTER_INDICES,colors:CENTER_COLORS,names:CENTER_NAMES,
  version:CENTER_POINT_VERSION,countWord:'four',description:'palms and feet',
  referenceOptions:Object.freeze({...CENTER_REFERENCE_OPTIONS,targetSizeProfile:'compact'}),
  referenceAdapter:withCenterReferenceData,liveAdapter:withPracticeCenters,
  startRules:COMPACT_CENTER_START_POSITION_RULES,
});

/* Elbow/knee mode is temporarily disabled. To restore it, comment out the
 * active imports/profile above and uncomment these imports and this profile.
 * Teacher dots, camera dots, targets, matching and readiness follow this profile.
import {BODY_INDICES,BODY_COLORS,BODY_NAMES,BODY_POINT_VERSION,BODY_REFERENCE_OPTIONS,
  withBodyReferenceData,withBodyPracticePoints} from './practice-centers.js';
import {BODY_START_POSITION_RULES} from './start-position.js';
export const LESSON_CONTROLS=Object.freeze({
  indices:BODY_INDICES,colors:BODY_COLORS,names:BODY_NAMES,
  version:BODY_POINT_VERSION,countWord:'eight',description:'palms, elbows, knees and feet',
  referenceOptions:BODY_REFERENCE_OPTIONS,
  referenceAdapter:withBodyReferenceData,liveAdapter:withBodyPracticePoints,
  startRules:BODY_START_POSITION_RULES,
});
*/
