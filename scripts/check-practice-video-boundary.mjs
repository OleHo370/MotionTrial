// Constructed timing controls, not a live camera or physical follow-along test.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {advanceFinishHold} from '../public/practice-finish-hold.js';
import {canAdvanceFinishedStep} from '../public/practice-video-boundary.js';

const checks=[],result={status:'match',pathComplete:true,percent:100};
const observation=t=>({observedAtMs:t,sample:{status:'pose',tMs:t}});
const matchingHold=(previous,t)=>advanceFinishHold(previous,{result,observation:observation(t),nowMs:t});
const first=matchingHold(null,1000),middle=matchingHold(first,1400),ready=matchingHold(middle,1700);
const defaults={hold:ready,observation:observation(1700),nowMs:1700,active:true,paused:false,phase:'grace',
  teacherTime:13.3,freezeSeconds:13.3,seeking:false,videoPaused:true,boundarySettledAtMs:1650};
function check(name,run){run();checks.push({name,passed:true});}
check('An early completed live hold cannot skip the rest of the demonstration',()=>{
  assert.equal(ready.ready,true);
  assert.equal(canAdvanceFinishedStep({...defaults,phase:'demonstrating',teacherTime:10,videoPaused:false,boundarySettledAtMs:null}),false);
});
check('Reaching the cut time does not count while its seek remains pending',()=>{
  assert.equal(canAdvanceFinishedStep({...defaults,phase:'demonstrating'}),false);
  assert.equal(canAdvanceFinishedStep({...defaults,seeking:true}),false);
  assert.equal(canAdvanceFinishedStep({...defaults,boundarySettledAtMs:null}),false);
});
check('A fresh post-boundary matched observation advances an earned live hold',()=>{
  assert.equal(canAdvanceFinishedStep(defaults),true);
});
check('A frame captured before seek settlement cannot pass even if delivered afterwards',()=>{
  assert.equal(canAdvanceFinishedStep({...defaults,boundarySettledAtMs:1750,nowMs:1800}),false);
});
check('The held teacher time must actually match the shared cut',()=>{
  assert.equal(canAdvanceFinishedStep({...defaults,teacherTime:13.2}),false);
  assert.equal(canAdvanceFinishedStep({...defaults,teacherTime:13.4}),false);
  assert.equal(canAdvanceFinishedStep({...defaults,videoPaused:false}),false);
});
check('Stale and cached hold evidence cannot trigger automatic advancement',()=>{
  assert.equal(canAdvanceFinishedStep({...defaults,nowMs:2151}),false);
  assert.equal(canAdvanceFinishedStep({...defaults,observation:observation(1800),nowMs:1800}),false);
  assert.equal(canAdvanceFinishedStep({...defaults,hold:null}),false);
});
check('Unknown tracking resets an early hold and a fresh full hold is required',()=>{
  let hold=advanceFinishHold(ready,{result:{...result,status:'unknown'},observation:observation(1800),nowMs:1800});
  assert.equal(hold,null);
  hold=matchingHold(hold,1900);
  assert.equal(canAdvanceFinishedStep({...defaults,hold,observation:observation(1900),nowMs:1900,boundarySettledAtMs:1850}),false);
  hold=matchingHold(hold,2300);hold=matchingHold(hold,2600);
  assert.equal(canAdvanceFinishedStep({...defaults,hold,observation:observation(2600),nowMs:2600,boundarySettledAtMs:1850}),true);
});
check('Stopped and paused sessions cannot advance from a ready hold',()=>{
  assert.equal(canAdvanceFinishedStep({...defaults,active:false}),false);
  assert.equal(canAdvanceFinishedStep({...defaults,paused:true}),false);
});
const directory=new URL('../artifacts/clip-handoff-review/',import.meta.url);
await mkdir(directory,{recursive:true});
await writeFile(new URL('video-boundary-summary.json',directory),JSON.stringify({
  provenance:'Constructed observation/video timing controls, not physical camera acceptance.',groups:checks.length,checks,
},null,2)+'\n');
console.log(`Video boundary advancement: ${checks.length} groups passed (constructed controls).`);
