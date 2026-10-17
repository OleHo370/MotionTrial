// Software-only final-hold timing checks. These constructed observations are
// not MediaPipe inference, real webcam input, or human follow-along acceptance.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {advanceFinishHold} from '../public/practice-finish-hold.js';

const checks=[];
const match={status:'match',pathComplete:true,percent:100};
const observation=(observedAtMs,tMs=observedAtMs)=>({observedAtMs,sample:{status:'pose',tMs}});
const update=(previous,time,{result=match,source=time,now=time,sample=observation(time,source)}={})=>advanceFinishHold(previous,{result,observation:sample,nowMs:now});
function check(name,run){run();checks.push({name,passed:true});}
check('Distinct fresh matched frames require the entire 700 ms final hold',()=>{
  let hold=null;
  for(const time of [1000,1100,1200,1300,1400,1500,1600,1699]){
    hold=update(hold,time);assert.equal(hold.ready,false);
  }
  hold=update(hold,1700);assert.equal(hold.ready,true);assert.equal(hold.heldMs,700);
});
check('Completing the paths alone does not complete or start an unsupported finish hold',()=>{
  assert.equal(update(null,1000,{result:{...match,status:'unknown'}}),null);
  assert.equal(update(null,1000,{result:{...match,status:'mismatch'}}),null);
  assert.equal(update(null,1000,{result:{...match,pathComplete:false}}),null);
});
check('Mismatch or unknown resets accumulated hold without modifying earned path progress',()=>{
  for(const status of ['mismatch','unknown']){
    let hold=update(null,1000);hold=update(hold,1400);
    const result={...match,status};
    hold=update(hold,1500,{result});assert.equal(hold,null);assert.equal(result.percent,100);
    hold=update(hold,1600);hold=update(hold,2000);assert.equal(hold.heldMs,400);assert.equal(hold.ready,false);
  }
});
check('Stale, future, absent, and non-pose observations cannot hold the finish',()=>{
  const hold=update(null,1000);
  assert.equal(update(hold,1100,{now:1551}),null);
  assert.equal(update(hold,1100,{now:1099}),null);
  assert.equal(update(hold,1100,{sample:null}),null);
  assert.equal(update(hold,1100,{sample:{observedAtMs:1100,sample:{status:'no_pose',tMs:1100}}}),null);
});
check('Repeated inference callbacks and reused source frames never add held time',()=>{
  const hold=update(null,1000);
  assert.equal(update(hold,1000,{now:1100}),hold);
  assert.equal(update(hold,1300,{source:1000}),hold);
  assert.equal(update(hold,1400,{source:999}),hold);
  assert.equal(update(hold,1500,{source:1000}),null);
});
check('A long frame gap starts a fresh hold instead of counting unobserved time',()=>{
  let hold=update(null,1000);hold=update(hold,1400);assert.equal(hold.heldMs,400);
  hold=update(hold,1851);assert.equal(hold.heldMs,0);assert.equal(hold.startMs,1851);
  hold=update(hold,2200);assert.equal(hold.ready,false);
});
check('Clearing state for pause, stop, or step change requires a new complete hold',()=>{
  let old=update(null,1000);old=update(old,1400);assert.equal(old.heldMs,400);
  let hold=update(null,1600);assert.equal(hold.heldMs,0);
  hold=update(hold,2000);assert.equal(hold.ready,false);
});
check('Delayed but fresh callbacks count capture time, never processing wall-clock time',()=>{
  let hold=update(null,1000,{now:1400});
  hold=update(hold,1100,{now:1500});assert.equal(hold.heldMs,100);assert.equal(hold.ready,false);
  hold=update(hold,1500,{now:1900});assert.equal(hold.heldMs,500);assert.equal(hold.ready,false);
});
const directory=new URL('../artifacts/progress-counting-review/',import.meta.url);
await mkdir(directory,{recursive:true});
await writeFile(new URL('finish-hold-summary.json',directory),JSON.stringify({
  provenance:'Constructed software observations, not live inference or human movement acceptance.',
  groups:checks.length,checks,
},null,2)+'\n');
console.log(`Final hold: ${checks.length} groups passed (constructed software observations).`);
