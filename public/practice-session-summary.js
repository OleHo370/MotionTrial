// Lesson wording only: retain every review locally, without camera observations
// or any authority to change the lesson's measured result or progression.
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
const cloneAttempt=attempt=>({...attempt,messages:[...attempt.messages],issues:attempt.issues.map(issue=>({...issue}))});

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
  return {attemptId:value.attemptId,stepId:value.stepId,status:value.status,messages:[...value.messages],issues};
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

const phrases={too_fast:'moved too fast',too_slow:'moved too slowly',late_start:'started late',
  off_guide:'moved away from the beam',hold_drift:'moved during its hold',
  endpoint_unreached:'missed its ending triangle',movement_incomplete:'did not finish its guided movement'};
const corrections={too_fast:"match the teacher's pace",too_slow:"match the teacher's pace",
  late_start:'begin with the teacher',off_guide:'stay on the beam',hold_drift:'keep the hold steady',
  endpoint_unreached:'reach the ending triangle',movement_incomplete:'finish the whole guided movement'};
const joinParts=parts=>parts.length<2?parts[0]??'':`${parts.slice(0,-1).join(', ')}${parts.length>2?',':''} and ${parts.at(-1)}`;
const attemptsText=count=>`${count} ${count===1?'attempt':'attempts'}`;

export function localPracticeSessionSummary(payload){
  const attempts=Array.isArray(payload?.attempts)?payload.attempts:[];
  const results=Array.isArray(payload?.results)?payload.results:[];
  const matched=results.filter(result=>result.status==='matched').length;
  const manual=results.filter(result=>result.status==='manual').length;
  const mismatch=attempts.filter(attempt=>attempt.status==='mismatch').length;
  const unknown=attempts.filter(attempt=>attempt.status==='unknown').length;
  const uncertainTiming=attempts.filter(attempt=>attempt.status==='match'
    &&(attempt.issues?.some(issue=>issue.code==='timing_unknown')
      ||attempt.messages?.some(message=>/^(Left|Right) (hand|foot): timing unclear\.$/.test(message)))).length;
  const messages=[`You completed ${matched} of ${stepIds.size} movements with matching feedback.`];
  if(manual)messages[0]+=` ${manual===1?'One movement was':`${manual} movements were`} advanced manually, so ${manual===1?'that transition was':'those transitions were'} not verified as a match.`;
  if(attempts.length)messages[0]+=` You received feedback on ${attemptsText(attempts.length)}${mismatch?`, including ${attemptsText(mismatch)} that needed another try`:''}.`;
  const groups=new Map();
  for(const attempt of attempts){
    // An uncertain limb is not a movement mistake. A separate measured issue
    // from another limb still remains evidence in the same unknown review.
    if(!['mismatch','unknown'].includes(attempt.status))continue;
    const seen=new Set();
    for(const issue of attempt.issues??[]){
      const name=limbNames[issue.index],phrase=phrases[issue.code],key=`${name}:${issue.code}`;
      if(!name||!phrase||seen.has(key))continue;
      seen.add(key);
      if(!groups.has(name))groups.set(name,new Map());
      const codes=groups.get(name);codes.set(issue.code,(codes.get(issue.code)??0)+1);
    }
  }
  for(const [name,codes]of groups){
    const entries=[...codes].sort((a,b)=>b[1]-a[1]);
    const observed=entries.map(([code,count])=>`${phrases[code]} on ${attemptsText(count)}`);
    const next=[...new Set(entries.map(([code])=>corrections[code]))];
    messages.push(`Across your attempts, your ${name} ${joinParts(observed)}. On your next practice, ${joinParts(next)}.`);
  }
  if(unknown||uncertainTiming){
    const parts=[];
    if(unknown)parts.push(`Tracking was unclear on ${attemptsText(unknown)}. Those unclear observations were kept separate from measured movement mistakes; keep your hands and feet visible for the next practice.`);
    if(uncertainTiming)parts.push(`${uncertainTiming===1?'One completed attempt reached':`${uncertainTiming} completed attempts reached`} the targets while timing was unclear.`);
    messages.push(parts.join(' '));
  }
  else if(!groups.size&&mismatch)messages.push('Some attempts received a retry rather than a match. Take your time with the demonstration and reach each ending triangle on your next practice.');
  else if(!groups.size&&matched)messages.push('The measured attempts reached their targets with matching feedback. Keep following the teacher and reaching each ending triangle on your next practice.');
  return {source:'local',sessionId:payload?.sessionId??null,messages};
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
