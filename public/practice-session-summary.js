// Lesson wording only: retain every review locally, without camera observations
// or any authority to change the lesson's measured result or progression.
import {normalizePracticeFeedbackContext} from './practice-feedback-context-schema.js';
const stepIds=new Set(['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05']);
const statuses=new Set(['match','mismatch','unknown']);
const resultStatuses=new Set(['matched','manual']);
const issueCodes=new Set(['too_fast','too_slow','late_start','off_guide','hold_drift',
  'endpoint_unreached','movement_incomplete','tracking_unknown','reference_unknown','attempt_incomplete','timing_unknown']);
const limbNames={15:'left hand',16:'right hand',27:'left foot',28:'right foot',
  33:'left hand',34:'right hand',35:'left foot',36:'right foot'};
const indices=new Set(Object.keys(limbNames).map(Number));
const maximumAttempts=200,maximumBodyBytes=96*1024;
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=120
  &&!/[\u0000-\u0020\u007f<>]/.test(value);
const safeText=(value,maximum)=>typeof value==='string'&&value.trim().length>0&&value.length<=maximum
  &&!/[\u0000-\u001f\u007f<>]/.test(value);
const wordCount=messages=>messages.join(' ').trim().split(/\s+/).filter(Boolean).length;
const cloneAttempt=attempt=>({...attempt,messages:[...attempt.messages],issues:attempt.issues.map(issue=>({...issue})),
  ...(attempt.context?{context:{...attempt.context,limbs:attempt.context.limbs.map(limb=>({...limb}))}}:{})});

function normalizeAttempt(value){
  if(!value||!safeId(value.attemptId)||!stepIds.has(value.stepId)||!statuses.has(value.status)
    ||!Array.isArray(value.messages)||!value.messages.length||value.messages.length>8
    ||!value.messages.every(message=>safeText(message,600))||value.messages.join(' ').length>2400
    ||wordCount(value.messages)>200||!Array.isArray(value.issues)||value.issues.length>16)return null;
  const issues=[];
  for(const issue of value.issues){
    if(!issueCodes.has(issue?.code)||!(issue.index===null||issue.index===undefined||indices.has(issue.index))
      ||issue.code==='timing_unknown'&&!indices.has(issue.index))return null;
    issues.push({index:issue.index??null,code:issue.code});
  }
  const context=value.context===undefined?undefined:normalizePracticeFeedbackContext(value.context,issues);
  if(value.context!==undefined&&!context)return null;
  return {attemptId:value.attemptId,stepId:value.stepId,status:value.status,messages:[...value.messages],issues,
    ...(context?{context}:{})};
}

function normalizeResults(values){
  const results=[];
  for(const value of values){
    if(!value||!stepIds.has(value.stepId)||!resultStatuses.has(value.status))return null;
    if(results.some(result=>result.stepId===value.stepId))return null;
    results.push({stepId:value.stepId,status:value.status});
  }
  return results;
}

// Reject an oversized remote request instead of silently dropping early retries.
// The complete local history can still produce a grounded written/spoken summary.
export function practiceSummaryPayload(value){
  if(!value||!safeId(value.sessionId)||!Array.isArray(value.attempts)||value.attempts.length>maximumAttempts
    ||!Array.isArray(value.results)||value.results.length>stepIds.size)return null;
  const attempts=[],seen=new Set();
  for(const valueAttempt of value.attempts){
    const attempt=normalizeAttempt(valueAttempt);
    if(!attempt||seen.has(attempt.attemptId))return null;
    seen.add(attempt.attemptId);attempts.push(attempt);
  }
  const results=normalizeResults(value.results);
  if(!results)return null;
  const payload={sessionId:value.sessionId,attempts,results};
  if(new TextEncoder().encode(JSON.stringify(payload)).byteLength>maximumBodyBytes)return null;
  return payload;
}

export function createPracticeSessionHistory({sessionId}={}){
  if(!safeId(sessionId))throw new TypeError('A bounded session identifier is required.');
  let currentSessionId=sessionId;
  const attempts=[],seen=new Set();
  return {
    record(value){
      const attempt=normalizeAttempt(value);
      if(!attempt||seen.has(attempt.attemptId))return false;
      seen.add(attempt.attemptId);attempts.push(attempt);return true;
    },
    snapshot(results=[]){
      const values=results instanceof Map?[...results.values()]:results;
      if(!Array.isArray(values)||values.length>stepIds.size)throw new TypeError('Lesson results must be bounded.');
      const normalized=normalizeResults(values);
      if(!normalized)throw new TypeError('Lesson results must identify unique known movements.');
      return {sessionId:currentSessionId,attempts:attempts.map(cloneAttempt),results:normalized};
    },
    clear(nextSessionId){
      if(!safeId(nextSessionId))throw new TypeError('A new bounded session identifier is required.');
      currentSessionId=nextSessionId;attempts.length=0;seen.clear();
    },
    getAttempts:()=>attempts.map(cloneAttempt),
    getSessionId:()=>currentSessionId
  };
}

// These counts come from the retained journal, never from generated prose.
export function practiceSessionStats(payload){
  const attempts=Array.isArray(payload?.attempts)?payload.attempts:[];
  const results=Array.isArray(payload?.results)?payload.results:[];
  const visited=new Set(attempts.map(attempt=>attempt.stepId));
  return {matched:results.filter(result=>result.status==='matched').length,total:stepIds.size,
    attempts:attempts.length,retries:Math.max(0,attempts.length-visited.size),
    unclear:attempts.filter(attempt=>attempt.status==='unknown').length};
}

export function localPracticeSessionSummary(payload){
  const attempts=Array.isArray(payload?.attempts)?payload.attempts:[],stats=practiceSessionStats(payload);
  const manual=(payload?.results??[]).some(result=>result.status==='manual');
  const measured=attempts.filter(attempt=>['mismatch','unknown'].includes(attempt.status));
  const themes=new Map();
  for(const attempt of measured){
    for(const issue of attempt.issues??[]){
      if(!limbNames[issue.index]||!['too_fast','too_slow','late_start','off_guide','hold_drift',
        'endpoint_unreached','movement_incomplete'].includes(issue.code))continue;
      const key=`${issue.index}:${issue.code}`,theme=themes.get(key)??{...issue,count:0};
      theme.count++;themes.set(key,theme);
    }
  }
  const ranked=[...themes.values()].sort((a,b)=>b.count-a.count);
  const describeParts=values=>{
    const names=[...new Set(values.map(issue=>limbNames[issue.index]).filter(Boolean))];
    if(names.length===2&&names.every(name=>name.includes('hand')))return 'hands';
    if(names.length===2&&names.every(name=>name.includes('foot')))return 'feet';
    return names.join(' and ');
  };
  const pace=ranked.filter(theme=>['too_fast','too_slow','late_start'].includes(theme.code));
  const coordination=measured.find(attempt=>attempt.context?.practiceFocus==='coordination');
  const range=measured.find(attempt=>attempt.context?.practiceFocus==='range');
  const path=ranked.find(theme=>theme.code==='off_guide'),hold=ranked.find(theme=>theme.code==='hold_drift');
  let takeaway=stats.matched===5?'You stayed with the whole sequence and reached the ending targets in every step.'
    :stats.matched?'You reached the ending targets in the steps marked complete. Let’s use this session to choose a clear focus for your next round.'
    :'This session gives you a starting point. Work through one movement at a time and use the guides to check the path.';
  if(stats.retries&&stats.matched)takeaway+=' Some steps took another attempt, and you kept working toward their ending positions.';
  if(manual)takeaway+=' Manually advanced steps remain unverified.';
  const timingUnclear=attempts.some(attempt=>attempt.issues?.some(issue=>issue.code==='timing_unknown')
    ||attempt.messages?.some(message=>/^(Left|Right) (hand|foot): timing unclear\.$/.test(message)));
  if(stats.unclear)takeaway+=' Some attempts could not be fully assessed; those observations are separate from the measured corrections.';
  if(timingUnclear)takeaway+=' Where timing was unclear, speed could not be assessed.';
  let priority,nextPractice;
  if(coordination){
    const feetHeld=coordination.issues.some(issue=>limbNames[issue.index]?.includes('foot')&&issue.code==='hold_drift');
    const held=describeParts(coordination.issues.filter(issue=>issue.code==='hold_drift'
      &&(feetHeld?limbNames[issue.index]?.includes('foot'):limbNames[issue.index]?.includes('hand'))));
    priority=feetHeld?`Bring your attention to how your hands and feet work together. In a step that asks your hands to move, your ${held} drifted from the hold. Let the hands travel while the feet stay settled.`
      :`Focus on pairing the foot movement with steady hands. In a step that asks a foot to move, your ${held} drifted from the hold. Keeping that hold settled gives you one less thing to manage.`;
    nextPractice=feetHeld?'Next time, settle your feet first, then follow one complete hand path to its target. Think of the steady feet and moving hands as one coordinated action. Practice that pairing in one step before joining the sequence again.'
      :'Next time, settle your hands in their hold positions before following the foot guide. Repeat that pairing in one step, then carry it into the sequence.';
  }else if(range){
    priority='Give your hand movement room to finish. An observed hand path stopped short of its full movement or target. The useful improvement is to follow the complete guide, with a comfortably larger movement where the path asks for it.';
    nextPractice='Watch where the teacher’s hand starts and finishes, then follow that whole journey from square to triangle. Build confidence in completing the path rather than rushing the finish. Keep the movement comfortable and repeat it before joining the sequence.';
  }else if(pace.length){
    const body=describeParts(pace);
    const fast=pace.some(theme=>theme.code==='too_fast'),slow=pace.some(theme=>theme.code==='too_slow');
    const observation=fast&&slow?'Some motion got ahead of the teacher and some fell behind.'
      :slow?`Your ${body} fell behind the teacher.`:fast?`Your ${body} got ahead of the teacher.`:'The movement began after the teacher.';
    priority=`Make the teacher’s rhythm your main focus. ${observation} Aim for one smooth pace through the whole movement${path?', keeping the direction inside the beam as you go':''}.`;
    nextPractice='Next time, watch one demonstration all the way through and notice when the movement begins. Follow that rhythm from the starting squares to the ending triangles. Work on one step first, then carry that same rhythm into the next one.';
  }else if(path){
    const name=limbNames[path.index],context=measured.filter(attempt=>attempt.issues?.some(issue=>issue.code==='off_guide'
      &&limbNames[issue.index]===name)).flatMap(attempt=>attempt.context?.limbs??[])
      .find(limb=>limbNames[limb.index]===name&&['up','down'].includes(limb.expectedDirection));
    priority=`Give the direction of your ${name} a little more attention. It left the beam${context?` during a movement with an ${context.expectedDirection==='up'?'upward':'downward'} guide`:''}. Focus on the journey through the beam, as well as the final triangle.`;
    nextPractice=`Next time, watch the teacher’s direction and trace the same guide with your ${name}. Follow the middle of the beam from start to finish, then bring that path back into the sequence.`;
  }else if(hold){
    priority=`Focus on keeping your ${limbNames[hold.index]} settled when the step asks for a hold. It drifted from that position. Establish the hold first, then keep it steady through the rest of the movement.`;
    nextPractice='Next time, watch which parts move and which stay still. Settle into the starting positions, follow one step, and check that the held points stay in place before joining the full sequence.';
  }else if(ranked.length){
    priority='Make the whole guided path your focus. The feedback included an unfinished movement or ending target that was not reached. Follow the journey from square to triangle before moving on.';
    nextPractice='Next time, watch one step’s starting and ending positions, then follow its complete path. Take the time you need to reach the triangle and settle there before joining the next step.';
  }else if(stats.unclear){
    const tracking=attempts.some(attempt=>attempt.issues?.some(issue=>issue.code==='tracking_unknown'));
    const reference=attempts.some(attempt=>attempt.issues?.some(issue=>issue.code==='reference_unknown'));
    priority=tracking?'A clearer view is the first useful priority. The uncertain tracking does not tell us that your movement was wrong, so there is no reason to guess at a correction yet.'
      :reference?'A usable teacher reference is the first priority. With the movement targets unavailable, this session cannot identify a reliable correction to your movement.'
      :'A complete, uninterrupted attempt is the first priority. This session did not provide a reliable movement review, so there is no reason to guess which part needs correcting.';
    nextPractice=tracking?'Next time, keep the tracked hands and feet visible from start to finish. Return to the starting squares, watch the demonstration, and try one step again with that clear view.'
      :reference?'Replay the demonstration and wait for its targets to load, then return to the starting squares. Try one step with that reference ready before joining the sequence.'
      :'Return to the starting squares and follow one complete step through to its ending triangles. Take the time you need, then use the next review to choose a specific practice focus.';
  }else{
    priority='Keep the complete paths and settled ending positions as your foundation. This session does not establish a new measured movement correction; use the next round to make the sequence easier to follow.';
    nextPractice='Next time, watch how one step flows into the next, then repeat the same guided paths in the teacher’s rhythm. Build familiarity with the sequence one transition at a time.';
  }
  return {source:'local',sessionId:payload?.sessionId??null,messages:[takeaway,priority,nextPractice]};
}

function validSummary(value,payload){
  return value?.source==='factory'&&value.sessionId===payload.sessionId&&Array.isArray(value.messages)
    &&value.messages.length>0&&value.messages.length<=6&&value.messages.every(message=>safeText(message,800))
    &&value.messages.join(' ').length<=3600&&wordCount(value.messages)<=350;
}

export function createPracticeSummaryClient({fetchImpl=globalThis.fetch,timeoutMs=25000,onState=()=>{}}={}){
  let revision=0,controller=null,timer=null,resolveCancellation=null;
  let state={source:'local',pending:false,sessionId:null};
  const publish=()=>onState({...state});
  function cancel(){
    ++revision;controller?.abort();resolveCancellation?.(null);resolveCancellation=null;
    controller=null;if(timer!==null)clearTimeout(timer);timer=null;
    state={source:'local',pending:false,sessionId:null};publish();
  }
  async function request(value,{onResult=()=>{}}={}){
    cancel();const payload=practiceSummaryPayload(value);
    if(!payload||typeof fetchImpl!=='function'||typeof AbortController==='undefined')return null;
    const token=revision,abort=new AbortController();controller=abort;
    const cancelled=new Promise(resolve=>{resolveCancellation=resolve;});
    state={source:'local',pending:true,sessionId:payload.sessionId};publish();
    timer=setTimeout(()=>{if(token===revision)cancel();},Math.max(1,timeoutMs));
    try{
      const result=await Promise.race([cancelled,(async()=>{
        const response=await fetchImpl('/api/practice-summary',{method:'POST',headers:{'Content-Type':'application/json'},
          credentials:'same-origin',body:JSON.stringify(payload),signal:abort.signal});
        if(token!==revision||abort.signal.aborted||!response?.ok)return null;
        return response.json();
      })()]);
      if(token!==revision||abort.signal.aborted||!validSummary(result,payload))return null;
      const summary={source:'factory',sessionId:result.sessionId,messages:[...result.messages]};
      state={...state,source:'factory',pending:false};onResult(summary);return summary;
    }catch{return null;}
    finally{
      if(token===revision){if(timer!==null)clearTimeout(timer);timer=null;controller=null;resolveCancellation=null;state={...state,pending:false};publish();}
    }
  }
  return {request,cancel,getState:()=>({...state})};
}
