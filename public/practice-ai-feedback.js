// Optional wording only. This helper never receives camera frames or landmarks,
// and never changes the local review's status, evidence or progression.
const statuses=new Set(['match','mismatch','unknown']);
const issueCodes=new Set(['too_fast','too_slow','late_start','off_guide','hold_drift',
  'endpoint_unreached','movement_incomplete','tracking_unknown','reference_unknown','attempt_incomplete']);
const indices=new Set([15,16,27,28,33,34,35,36]);
const safeText=value=>typeof value==='string'&&value.trim().length>0&&value.length<=180
  &&!/[\u0000-\u001f\u007f<>]/.test(value);
const safeResponseText=value=>typeof value==='string'&&value.trim().length>0&&value.length<=600
  &&!/[\u0000-\u001f\u007f<>]/.test(value);
function requestSummary(payload){
  if(!payload||typeof payload.attemptId!=='string'||!payload.attemptId.length||payload.attemptId.length>120
    ||typeof payload.stepId!=='string'||!payload.stepId.length||payload.stepId.length>80||!statuses.has(payload.status)
    ||!Array.isArray(payload.messages)||!payload.messages.length||payload.messages.length>8
    ||!payload.messages.every(safeText)||payload.messages.join(' ').length>800
    ||!Array.isArray(payload.issues)||payload.issues.length>16)return null;
  const issues=[];
  for(const issue of payload.issues){
    if(!issueCodes.has(issue?.code)||!(issue.index===null||issue.index===undefined||indices.has(issue.index)))return null;
    issues.push({index:issue.index??null,code:issue.code});
  }
  return {attemptId:payload.attemptId,stepId:payload.stepId,status:payload.status,messages:[...payload.messages],issues};
}
function validWording(result,payload){
  return result?.source==='factory'&&result.attemptId===payload.attemptId&&result.stepId===payload.stepId
    &&result.status===payload.status&&Array.isArray(result.messages)&&result.messages.length>0
    &&result.messages.length<=4&&result.messages.every(safeResponseText)&&result.messages.join(' ').length<=2400
    &&result.messages.join(' ').trim().split(/\s+/).length<=200;
}
export function createPracticeAiFeedback({fetchImpl=globalThis.fetch,timeoutMs=45000,onState=()=>{}}={}){
  let revision=0,controller=null,timer=null,resolveCancellation=null;
  let state={source:'local',pending:false,attemptId:null,stepId:null};
  const publish=()=>onState({...state});
  function cancel(){
    ++revision;controller?.abort();resolveCancellation?.(null);resolveCancellation=null;
    controller=null;if(timer!==null)clearTimeout(timer);timer=null;
    state={source:'local',pending:false,attemptId:null,stepId:null};publish();
  }
  async function request(payload,{onResult=()=>{}}={}){
    cancel();const summary=requestSummary(payload);
    if(!summary||typeof fetchImpl!=='function'||typeof AbortController==='undefined')return null;
    const token=revision,abort=new AbortController();controller=abort;
    const cancelled=new Promise(resolve=>{resolveCancellation=resolve;});
    state={source:'local',pending:true,attemptId:summary.attemptId,stepId:summary.stepId};publish();
    // A timeout invalidates the request even if a fetch adapter ignores abort.
    timer=setTimeout(()=>{if(token===revision)cancel();},Math.max(1,timeoutMs));
    try{
      const result=await Promise.race([cancelled,(async()=>{
        const response=await fetchImpl('/api/practice-feedback',{method:'POST',headers:{'Content-Type':'application/json'},
          credentials:'same-origin',body:JSON.stringify(summary),signal:abort.signal});
        if(token!==revision||abort.signal.aborted||!response?.ok)return null;
        return response.json();
      })()]);
      if(token!==revision||abort.signal.aborted||!validWording(result,summary))return null;
      const wording={attemptId:result.attemptId,stepId:result.stepId,status:result.status,messages:[...result.messages],source:'factory'};
      state={...state,source:'factory',pending:false};onResult(wording);return wording;
    }catch{return null;}
    finally{
      if(token===revision){if(timer!==null)clearTimeout(timer);timer=null;controller=null;resolveCancellation=null;state={...state,pending:false};publish();}
    }
  }
  return {request,cancel,getState:()=>({...state})};
}
