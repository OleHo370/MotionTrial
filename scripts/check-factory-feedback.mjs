/** Deterministic Factory integration QA. SDK sessions, credentials and camera
 * observations are constructed software fixtures. No real Factory request,
 * webcam, COM port, browser permission or physical hardware is used here. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createDualViewServer} from './serve-dual-view.mjs';
import {controllerHarness} from './check-review-flow.mjs';
import {createFactoryPracticeFeedbackService,normalizeFeedbackRequest,validateFactoryFeedbackOutput} from './factory-practice-feedback.mjs';
import {createPracticeAiFeedback} from '../public/practice-ai-feedback.js';
import {chromium} from 'playwright';

const root=new URL('../',import.meta.url),out=new URL('artifacts/factory-feedback-review/',root);
const checks=[],secretFixture='CONSTRUCTED_PRIVATE_CREDENTIAL_MUST_NOT_REACH_THE_BROWSER';
const browserEvidence={performed:false,pageErrors:[],cameraRequests:null,snapshots:{}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const payload=(changes={})=>({attemptId:'qa-attempt-1',stepId:'first-three-01',status:'mismatch',
  messages:['Left hand: too fast.','Right hand: too slow.'],
  issues:[{index:33,code:'too_fast'},{index:34,code:'too_slow'}],...changes});
const output=(entries=[{issueId:'issue-0',text:'too fast'},{issueId:'issue-1',text:'too slow'}])=>({entries});
const reply=(body,changes={})=>({attemptId:body.attemptId,stepId:body.stepId,status:body.status,
  messages:['Left hand: too fast.','Right hand: too slow.'],source:'factory',...changes});
const hash=value=>createHash('sha256').update(value).digest('hex');
async function check(name,run){await run();checks.push(name);console.log(`PASS: ${name}`);}
async function waitFor(condition,message='Constructed dependency condition not reached',timeout=1500){
  const until=Date.now()+timeout;
  while(!condition()){if(Date.now()>until)throw new Error(message);await delay(3);}
}

// A deliberately non-networking SDK adapter exercises the production session
// lifecycle and structured-output validation through its supported interface.
function sdkFixture(){
  const state={sessions:[],prompts:[],outputs:[],events:[],mode:'normal',autoOutput:false,streamGate:null,startGate:null,closeCalls:0};
  const sdk={AutonomyLevel:{Off:'off'},ToolConfirmationOutcome:{Cancel:'cancel'},
    OutputFormatType:{JsonSchema:'json_schema'},DroidMessageType:{Result:'result'},
    async createSession(options){
      const session={options,settings:[],closed:false};state.sessions.push(session);
      const api={
        async listTools(){
          const tools=['Execute','Read','Write'].map(id=>({id,allowed:!session.settings.length
            ||state.mode==='tools-active'||state.mode===`allowed-${id}`}));
          if(state.mode.startsWith('catalog'))tools.push({id:state.mode==='catalog-alias'?'toolsearch':'ToolSearch',allowed:true,
            description:state.mode==='catalog-invalid'?'An unknown capable tool':'Load schemas for deferred tools using catalog metadata'});
          return tools;
        },
        async updateSettings(settings){session.settings.push(settings);},
        async *stream(prompt,options){
          state.prompts.push({prompt,options});
          if(state.mode==='error')throw new Error(`Constructed SDK failure ${secretFixture}`);
          if(state.mode==='hold')await new Promise((resolve,reject)=>{
            const canceled=()=>reject(new Error('Constructed SDK cancellation'));
            if(options.abortSignal?.aborted){canceled();return;}
            options.abortSignal?.addEventListener('abort',canceled,{once:true});
            state.streamGate=()=>{options.abortSignal?.removeEventListener('abort',canceled);resolve();};
          });
          for(const event of state.events.splice(0))yield event;
          const automatic=state.autoOutput?{entries:JSON.parse(prompt).issues.map(issue=>({issueId:issue.issueId,text:issue.allowedText.at(-1)}))}:null;
          yield {type:'result',success:true,structuredOutput:state.outputs.shift()??automatic??output()};
        },
        async close(){if(!session.closed){session.closed=true;state.closeCalls++;}},
      };
      if(state.mode==='delayed-start')await new Promise(resolve=>{state.startGate=resolve;});
      return api;
    }};
  return {sdk,state};
}

async function serverFixture(createFeedbackService,options={}){
  const mocked=sdkFixture(),feedback=createFeedbackService({configured:true,sdkLoader:async()=>mocked.sdk,
    resolveExecPath:async()=>'CONSTRUCTED_droid_EXECUTABLE_NOT_LAUNCHED',
    minRequestIntervalMs:0,maxRequestsPerMinute:1000,modelTimeoutMs:1000,totalTimeoutMs:1200,...options});
  const server=createDualViewServer({publicRoot:resolve(fileURLToPath(new URL('public/',root))),
    relay:{async handle(){return false;},async close(){}},feedback});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  function request(pathname='/api/practice-feedback',{body=payload(),method='POST',headers={},raw,signal}={}){
    const bytes=raw??(body===undefined?'':JSON.stringify(body));
    return new Promise((resolve,reject)=>{
      const requestHeaders={Host:`127.0.0.1:${port}`,Origin:origin,'Content-Type':'application/json',
        'Content-Length':Buffer.byteLength(bytes),...headers};
      for(const key of Object.keys(requestHeaders))if(requestHeaders[key]===undefined)delete requestHeaders[key];
      const req=http.request({hostname:'127.0.0.1',port,path:pathname,method,signal,headers:requestHeaders},res=>{
        const parts=[];res.on('data',chunk=>parts.push(chunk));res.on('end',()=>{
          const text=Buffer.concat(parts).toString('utf8');let json;try{json=JSON.parse(text);}catch{}
          assert.ok(!text.includes(secretFixture),'Constructed private SDK error must not reach HTTP responses');
          resolve({status:res.statusCode,headers:res.headers,text,json});
        });
      });req.on('error',reject);req.end(bytes);
    });
  }
  return {feedback,server,request,origin,...mocked,async close(){
    await feedback.close();server.closeAllConnections?.();await server.shutdown();
  }};
}

async function serviceChecks(){
  await check('Only the five lesson steps and bounded measured summaries pass request validation',()=>{
    for(const stepId of ['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05',1,2,3,4,5])
      assert.ok(normalizeFeedbackRequest(payload({stepId})));
    for(const changes of [{stepId:'first-six-06'},{stepId:6},{stepId:0},{attemptId:''},{attemptId:'../key'},
      {status:'passed'},{messages:[]},{messages:['<script>unsafe</script>']},{messages:['x'.repeat(181)]},
      {issues:[{index:37,code:'too_fast'}]},{issues:[{index:33,code:'made_up'}]},
      {issues:[{index:33,code:'too_fast'},{index:33,code:'too_fast'}]},
      {landmarks:[{x:1,y:1}]},{passed:true},{frames:['CONSTRUCTED frame must not leave browser']}])
      assert.equal(normalizeFeedbackRequest(payload(changes)),null,JSON.stringify(changes));
    const raw=payload({issues:[{index:33,code:'too_fast',message:'CONSTRUCTED arbitrary prose ignored'}]});
    const normalized=normalizeFeedbackRequest(raw);
    assert.equal(normalized.issues[0].message,undefined);assert.equal(normalized.issues[0].limb,'Left hand');
  });
  await check('Structured wording preserves exact measured issues, anatomical side and uncertainty',()=>{
    const measured=normalizeFeedbackRequest(payload());
    assert.deepEqual(validateFactoryFeedbackOutput(output(),measured),payload().messages);
    assert.deepEqual(validateFactoryFeedbackOutput(output([
      {issueId:'issue-1',text:'moved too slowly'},{issueId:'issue-0',text:'moved too quickly'}]),measured),
      ['Left hand: moved too quickly.','Right hand: moved too slowly.']);
    for(const malformed of [output([]),output([{issueId:'issue-0',text:'too slow'},{issueId:'issue-1',text:'too fast'}]),
      output([{issueId:'issue-0',text:'too fast'},{issueId:'issue-0',text:'too fast'}]),
      output([{issueId:'issue-0',text:'too fast'},{issueId:'issue-2',text:'too slow'}]),
      {...output(),status:'match'},output([{issueId:'issue-0',text:'Right foot moved too fast'},{issueId:'issue-1',text:'too slow'}])])
      assert.equal(validateFactoryFeedbackOutput(malformed,measured),null);
    const uncertain=normalizeFeedbackRequest(payload({issues:[{index:33,code:'tracking_unknown'}]}));
    assert.equal(validateFactoryFeedbackOutput(output([{issueId:'issue-0',text:'too fast'}]),uncertain),null);
  });
  const fixture=await serverFixture(createFactoryPracticeFeedbackService);
  try{
    await check('HTTP handler rejects foreign origins, remote hosts, wrong methods, MIME and oversized bodies before SDK use',async()=>{
      for(const headers of [{Origin:'https://foreign.example'},{Origin:fixture.origin.replace('127.0.0.1','localhost')},
        {Host:'foreign.example',Origin:'http://foreign.example'},{'Sec-Fetch-Site':'cross-site'}])
        assert.equal((await fixture.request(undefined,{headers})).status,403);
      assert.equal((await fixture.request(undefined,{method:'GET'})).status,405);
      assert.equal((await fixture.request(undefined,{headers:{'Content-Type':'text/plain'}})).status,415);
      assert.equal((await fixture.request(undefined,{raw:'{'})).status,400);
      assert.equal((await fixture.request(undefined,{raw:'x'.repeat(14000)})).status,413);
      assert.equal((await fixture.request(undefined,{body:payload({landmarks:[]})})).status,400);
      assert.equal(fixture.state.sessions.length,0);
      const status=await fixture.request('/api/practice-feedback/status',{method:'GET',raw:''});
      assert.deepEqual(status.json,{configured:true,provider:'factory',mode:'measured-issues-only'});
    });
    await check('Match, unknown, no issues and any uncertain evidence keep local feedback without an AI call',async()=>{
      for(const body of [payload({status:'match'}),payload({status:'unknown'}),payload({issues:[]}),
        payload({issues:[{index:33,code:'tracking_unknown'},{index:34,code:'too_fast'}]}),
        payload({issues:[{index:null,code:'reference_unknown'}]})]){
        const response=await fixture.request(undefined,{body});
        assert.equal(response.status,200);assert.equal(response.json.source,'local');
        assert.equal(response.json.status,body.status);assert.deepEqual(response.json.messages,body.messages);
      }
      assert.equal(fixture.state.sessions.length,0);
    });
    await check('Factory rewrites only verified issues with all tools disabled and never changes the local outcome',async()=>{
      const body=payload({messages:['CONSTRUCTED_LOCAL_TEXT_NOT_A_PROMPT'],
        issues:[{index:33,code:'too_fast',message:'CONSTRUCTED_ISSUE_PROSE_NOT_A_PROMPT'},{index:34,code:'too_slow'}]});
      fixture.state.outputs.push(output([{issueId:'issue-1',text:'moved too slowly'},{issueId:'issue-0',text:'moved too quickly'}]));
      const response=await fixture.request(undefined,{body});
      assert.equal(response.status,200);assert.equal(response.json.source,'factory');
      assert.equal(response.json.status,'mismatch');assert.equal(response.json.attemptId,body.attemptId);
      assert.equal(response.json.stepId,body.stepId);
      assert.deepEqual(response.json.messages,['Left hand: moved too quickly.','Right hand: moved too slowly.']);
      const session=fixture.state.sessions[0];
      assert.equal(session.options.autonomyLevel,'off');assert.equal(session.options.permissionHandler(),'cancel');
      assert.equal(session.options.autoRejectPermissionRequests,true);assert.equal(session.options.disableBuiltinSkills,true);
      assert.deepEqual(session.options.mcpServers,[]);
      assert.deepEqual([...session.settings[0].disabledToolIds].sort(),['Execute','Read','Write']);
      assert.ok(session.closed);assert.doesNotMatch(fixture.state.prompts[0].prompt,/CONSTRUCTED_LOCAL_TEXT|CONSTRUCTED_ISSUE_PROSE/);
      const prompt=JSON.parse(fixture.state.prompts[0].prompt);
      assert.deepEqual(Object.keys(prompt).sort(),['issues','status','stepId']);
      assert.ok(!Object.hasOwn(response.json,'passed'));
    });
    await check('Invented, contradictory, missing, duplicate and extra structured output always retains exact local messages',async()=>{
      const malformed=[{messages:['Everything passed']},{...output(),status:'match'},output([]),
        output([{issueId:'issue-0',text:'too slow'},{issueId:'issue-1',text:'too slow'}]),
        output([{issueId:'issue-0',text:'too fast'},{issueId:'issue-0',text:'too fast'}]),
        output([{issueId:'issue-0',text:'Left hand: too fast'},{issueId:'issue-1',text:'too slow'}]),
        output([{issueId:'issue-0',text:'<script>alert(1)</script>'},{issueId:'issue-1',text:'too slow'}])];
      for(const [index,model]of malformed.entries()){
        const body=payload({attemptId:`qa-invalid-${index}`});fixture.state.outputs.push(model);
        const response=await fixture.request(undefined,{body});
        assert.equal(response.status,200);assert.equal(response.json.source,'local');
        assert.equal(response.json.status,body.status);assert.deepEqual(response.json.messages,body.messages);
        assert.equal(response.json.reason,'invalid-factory-output');
      }
    });
    await check('Private SDK errors and failed tool-disable verification expose no credential and use local feedback',async()=>{
      for(const mode of ['error','tools-active']){
        fixture.state.mode=mode;const before=fixture.state.prompts.length;
        const response=await fixture.request(undefined,{body:payload({attemptId:`qa-${mode}`})});
        assert.equal(response.json.source,'local');assert.deepEqual(response.json.messages,payload().messages);
        assert.equal(response.json.reason,'factory-unavailable');assert.ok(!response.text.includes(secretFixture));
        if(mode==='tools-active')assert.equal(fixture.state.prompts.length,before,'No model request before all tools disabled');
      }
      fixture.state.mode='normal';
    });
    await check('Static HTML and range/HEAD responses still serve exact local bytes and private server files are unreachable',async()=>{
      const bytes=await readFile(new URL('public/first-three.html',root));
      const response=await fixture.request('/first-three.html',{method:'GET',raw:''});
      assert.equal(response.status,200);assert.equal(hash(response.text),hash(bytes));
      assert.match(response.headers['content-type'],/text\/html/);
      const range=await fixture.request('/first-three.html',{method:'GET',raw:'',headers:{Range:'bytes=0-31'}});
      assert.equal(range.status,206);assert.equal(range.text,bytes.subarray(0,32).toString());
      const head=await fixture.request('/first-three.html',{method:'HEAD',raw:''});
      assert.equal(head.status,200);assert.equal(head.text,'');assert.equal(Number(head.headers['content-length']),bytes.length);
      for(const pathname of ['/.env.factory','/%2e%2e/.env.factory','/scripts/factory-practice-feedback.mjs']){
        const denied=await fixture.request(pathname,{method:'GET',raw:''});assert.ok(denied.status>=400);
      }
    });
  }finally{await fixture.close();}
  await check('Unconfigured service does not load or authenticate the SDK',async()=>{
    const f=await serverFixture(createFactoryPracticeFeedbackService,{configured:false});
    try{const response=await f.request();assert.equal(response.json.source,'local');
      assert.equal(response.json.reason,'factory-not-configured');assert.equal(f.state.sessions.length,0);
    }finally{await f.close();}
  });
  await check('Only the exact verified ToolSearch catalog descriptor may remain enabled; actionable tools and aliases prevent model calls',async()=>{
    const f=await serverFixture(createFactoryPracticeFeedbackService);
    try{
      f.state.mode='catalog';const accepted=await f.request();assert.equal(accepted.json.source,'factory');
      assert.ok(f.state.sessions[0].settings[0].disabledToolIds.includes('ToolSearch'));
      for(const mode of ['allowed-Read','allowed-Execute','allowed-Write','catalog-invalid','catalog-alias']){
        f.state.mode=mode;const before=f.state.prompts.length;
        const rejected=await f.request(undefined,{body:payload({attemptId:`qa-${mode}`})});
        assert.equal(rejected.json.source,'local');assert.equal(rejected.json.reason,'factory-unavailable');
        assert.equal(f.state.prompts.length,before);
      }
    }finally{await f.close();}
  });
  await check('Any tool activity in the stream aborts Factory wording even if a valid result follows',async()=>{
    const f=await serverFixture(createFactoryPracticeFeedbackService);
    try{
      f.state.mode='catalog';
      const events=['tool_call','tool_call_delta','tool_result','tool_progress'].map(type=>({type,toolName:'ToolSearch'}));
      events.push({type:'assistant',message:{content:[{type:'tool_use',id:'qa-call',name:'ToolSearch',input:{}}]},text:''},
        {type:'assistant',content:[{type:'tool_result',tool_use_id:'qa-call',content:'CONSTRUCTED metadata'}]});
      for(const [index,event]of events.entries()){
        f.state.events.push(event);const body=payload({attemptId:`qa-tool-event-${index}`});
        const rejected=await f.request(undefined,{body});
        assert.equal(rejected.json.source,'local');assert.deepEqual(rejected.json.messages,body.messages);
        assert.ok(f.state.sessions.at(-1).options.abortSignal.aborted);assert.ok(f.state.sessions.at(-1).closed);
      }
    }finally{await f.close();}
  });
  await check('Model timeout aborts and disposes its session, retaining a retryable local result',async()=>{
    const f=await serverFixture(createFactoryPracticeFeedbackService,{modelTimeoutMs:25,totalTimeoutMs:100});
    try{f.state.mode='hold';const start=Date.now(),response=await f.request();
      assert.equal(response.json.source,'local');assert.deepEqual(response.json.messages,payload().messages);
      assert.equal(response.json.reason,'factory-canceled-or-timed-out');assert.ok(Date.now()-start<1000);
      assert.equal(f.state.sessions.length,1);assert.ok(f.state.sessions[0].closed);
    }finally{await f.close();}
  });
  await check('A late startup that ignores cancellation is closed without generating paid wording',async()=>{
    const f=await serverFixture(createFactoryPracticeFeedbackService,{modelTimeoutMs:25,totalTimeoutMs:50});
    try{f.state.mode='delayed-start';const response=await f.request();
      assert.equal(response.json.source,'local');assert.equal(response.json.reason,'factory-canceled-or-timed-out');
      assert.equal(f.state.sessions.length,1);assert.equal(f.state.prompts.length,0);
      assert.ok(f.state.sessions[0].options.abortSignal.aborted);
      f.state.startGate();await waitFor(()=>f.state.sessions[0].closed);
      assert.equal(f.state.prompts.length,0);assert.equal(f.state.closeCalls,1);
    }finally{f.state.startGate?.();await f.close();}
  });
  await check('Minimum request spacing and per-minute limits prevent extra SDK calls while local retries still work',async()=>{
    let fixtureNow=1000;
    const f=await serverFixture(createFactoryPracticeFeedbackService,{now:()=>fixtureNow,minRequestIntervalMs:5000,maxRequestsPerMinute:1});
    try{assert.equal((await f.request()).json.source,'factory');
      const spaced=await f.request(undefined,{body:payload({attemptId:'qa-spacing'})});
      assert.equal(spaced.json.source,'local');assert.equal(spaced.json.reason,'factory-rate-limited');
      fixtureNow+=5100;const limited=await f.request(undefined,{body:payload({attemptId:'qa-minute-limit'})});
      assert.equal(limited.json.source,'local');assert.equal(limited.json.reason,'factory-rate-limited');
      assert.equal(f.state.sessions.length,1);fixtureNow+=60000;
      assert.equal((await f.request(undefined,{body:payload({attemptId:'qa-after-limit'})})).json.source,'factory');
      assert.equal(f.state.sessions.length,2);
    }finally{await f.close();}
  });
  await check('Concurrent requests do not start extra paid sessions and a repeated successful request uses its cache',async()=>{
    const f=await serverFixture(createFactoryPracticeFeedbackService);
    try{f.state.mode='hold';const first=f.request();await waitFor(()=>f.state.prompts.length===1);
      const second=await f.request(undefined,{body:payload({attemptId:'qa-concurrent-other'})});
      assert.equal(second.json.source,'local');assert.equal(second.json.reason,'factory-busy');
      assert.equal(f.state.sessions.length,1);f.state.streamGate();const completed=await first;
      assert.equal(completed.json.source,'factory');f.state.mode='normal';
      const cached=await f.request();assert.deepEqual(cached.json,completed.json);assert.equal(f.state.sessions.length,1);
    }finally{await f.close();}
  });
  await check('Disconnected callers cancel their own model session and release concurrency for the next learner attempt',async()=>{
    const f=await serverFixture(createFactoryPracticeFeedbackService);
    try{f.state.mode='hold';const controller=new AbortController();
      const disconnected=f.request(undefined,{signal:controller.signal}).catch(error=>error);
      await waitFor(()=>f.state.prompts.length===1);controller.abort();const error=await disconnected;
      assert.ok(error instanceof Error);await waitFor(()=>f.state.sessions[0]?.closed);
      f.state.mode='normal';let retry;
      // close() happens before the isolated working directory finishes cleanup;
      // concurrency must become available within a bounded cleanup interval.
      for(let n=0;n<30;n++){
        retry=await f.request(undefined,{body:payload({attemptId:'qa-after-disconnect'})});
        if(retry.json.reason!=='factory-busy')break;await delay(10);
      }
      assert.equal(retry.json.source,'factory');assert.equal(f.state.sessions.length,2);
    }finally{await f.close();}
  });
}

async function browserHelperChecks(){
  await check('Browser sends only the compact summary and optional AI wording preserves every local evidence field',async()=>{
    const sent=[],applied=[];
    const ai=createPracticeAiFeedback({fetchImpl:async(url,options)=>{sent.push({url,options});
      const body=JSON.parse(options.body);return {ok:true,json:async()=>reply(body)};}});
    const body=payload({cameraFrames:['CONSTRUCTED data ignored by summary serializer'],
      landmarks:[{x:1,y:1}],issues:[{index:33,code:'too_fast',message:'CONSTRUCTED raw issue text omitted'},
        {index:34,code:'too_slow'}]});
    const result=await ai.request(body,{onResult:value=>applied.push(value)});
    assert.equal(result.source,'factory');assert.equal(applied.length,1);assert.equal(sent.length,1);
    assert.equal(sent[0].url,'/api/practice-feedback');assert.equal(sent[0].options.credentials,'same-origin');
    assert.deepEqual(JSON.parse(sent[0].options.body),payload());
    assert.equal(ai.getState().pending,false);assert.equal(ai.getState().source,'factory');ai.cancel();
  });
  await check('Invalid, failed, mismatched-identity or changed-outcome browser responses cannot replace local feedback',async()=>{
    for(const response of [reply(payload(),{attemptId:'other'}),reply(payload(),{stepId:'first-three-02'}),
      reply(payload(),{status:'match'}),reply(payload(),{source:'local'}),reply(payload(),{messages:[]}),
      reply(payload(),{messages:['<script>unsafe</script>']}),reply(payload(),{messages:['x'.repeat(181)]})]){
      const applied=[],ai=createPracticeAiFeedback({fetchImpl:async()=>({ok:true,json:async()=>response})});
      assert.equal(await ai.request(payload(),{onResult:value=>applied.push(value)}),null);
      assert.deepEqual(applied,[]);assert.equal(ai.getState().source,'local');assert.equal(ai.getState().pending,false);ai.cancel();
    }
    for(const fetchImpl of [null,async()=>{throw new Error('Constructed fetch failure');},async()=>({ok:false})]){
      const ai=createPracticeAiFeedback({fetchImpl});assert.equal(await ai.request(payload()),null);ai.cancel();
    }
  });
  await check('Browser timeout settles immediately and a late fetch that ignores abort cannot apply stale wording',async()=>{
    const late=deferred(),applied=[],signals=[];
    const ai=createPracticeAiFeedback({timeoutMs:15,fetchImpl:(_url,options)=>{signals.push(options.signal);return late.promise;}});
    const start=Date.now(),pending=ai.request(payload(),{onResult:value=>applied.push(value)});
    assert.equal(await pending,null);assert.ok(Date.now()-start<1000);assert.ok(signals[0].aborted);
    late.resolve({ok:true,json:async()=>reply(payload())});await delay(10);
    assert.deepEqual(applied,[]);assert.equal(ai.getState().pending,false);ai.cancel();
  });
  await check('Retry and newer requests abort and supersede old response identities even when fetch ignores cancellation',async()=>{
    const requests=[],applied=[];
    const ai=createPracticeAiFeedback({fetchImpl:(_url,options)=>{const gate=deferred();requests.push({gate,options});return gate.promise;}});
    const first=ai.request(payload(),{onResult:value=>applied.push(value)});
    const secondBody=payload({attemptId:'qa-new-attempt',stepId:'first-three-02'});
    const second=ai.request(secondBody,{onResult:value=>applied.push(value)});
    assert.equal(await first,null);assert.ok(requests[0].options.signal.aborted);
    requests[0].gate.resolve({ok:true,json:async()=>reply(payload())});await delay(3);assert.deepEqual(applied,[]);
    requests[1].gate.resolve({ok:true,json:async()=>reply(secondBody)});assert.equal((await second).attemptId,'qa-new-attempt');
    assert.equal(applied.length,1);assert.equal(applied[0].stepId,'first-three-02');ai.cancel();
  });
}

async function controllerChecks(){
  function fixture(){
    const sent=[];
    const ai=createPracticeAiFeedback({fetchImpl:(_url,options)=>{const gate=deferred();
      sent.push({gate,options,body:JSON.parse(options.body)});return gate.promise;}});
    const h=controllerHarness({overrides:{aiFeedback:ai},speechOptions:{enabled:true}});
    const review={status:'mismatch',passed:false,percent:null,issues:payload().issues,
      messages:payload().messages,reason:payload().messages[0],limbs:[{index:33,timingAssessed:true}],
      ruleVersion:'CONSTRUCTED actual-controller integration fixture'};
    return {h,sent,ai,review};
  }
  await check('Actual controller shows local feedback immediately, then speaks final AI wording without changing pass/score/progression',async()=>{
    const {h,sent,ai,review}=fixture();try{
      await h.call('beginReview',review,'retry');assert.equal(h.state.phase,'feedback');
      assert.deepEqual([...h.state.feedback.messages],payload().messages);assert.equal(sent.length,1);
      const before=structuredClone(h.state.feedback),speechCount=h.speech.calls.length;
      const messages=['Left hand: moved too quickly.','Right hand: moved too slowly.'];
      sent[0].gate.resolve({ok:true,json:async()=>reply(sent[0].body,{messages})});await h.flush();
      assert.deepEqual([...h.state.feedback.messages],messages);assert.equal(h.env.feedbackWordingSource,'factory');
      for(const key of ['status','passed','percent','issues','limbs','ruleVersion'])
        assert.deepEqual(h.state.feedback[key],before[key],key);
      assert.equal(h.state.phase,'feedback');assert.equal(h.state.index,0);assert.equal(h.state.results.size,0);
      assert.equal(h.state.reviewAction,'retry');assert.equal(speechCount,0);
      assert.equal(h.speech.calls.length,1);assert.deepEqual([...h.speech.calls[0].args[0].messages],messages);
    }finally{ai.cancel();}
  });
  await check('Actual Try again discards the pending request and an old result cannot repaint the retry',async()=>{
    const {h,sent,ai,review}=fixture();try{
      await h.call('beginReview',review,'retry');await h.call('feedbackRetryAction');
      assert.equal(h.state.phase,'positioning');assert.equal(h.state.feedback,null);assert.ok(sent[0].options.signal.aborted);
      sent[0].gate.resolve({ok:true,json:async()=>reply(sent[0].body)});await h.flush();
      assert.equal(h.state.phase,'positioning');assert.equal(h.state.feedback,null);assert.equal(h.state.results.size,0);
      assert.equal(h.env.feedbackWordingSource,'local');
    }finally{ai.cancel();}
  });
  await check('Actual step change and replacement review reject late results for the prior attempt',async()=>{
    const {h,sent,ai,review}=fixture();try{
      await h.call('beginReview',review,'retry');await h.call('choose',1);
      assert.equal(h.state.index,1);assert.ok(sent[0].options.signal.aborted);
      sent[0].gate.resolve({ok:true,json:async()=>reply(sent[0].body)});await h.flush();
      assert.equal(h.state.feedback,null);assert.notEqual(h.state.phase,'feedback');
      await h.call('beginReview',review,'retry');await h.call('beginReview',review,'retry');
      assert.ok(sent[1].options.signal.aborted);
      sent[1].gate.resolve({ok:true,json:async()=>reply(sent[1].body,{messages:['Left hand: moved too quickly.']})});await h.flush();
      assert.deepEqual([...h.state.feedback.messages],payload().messages);
      assert.equal(h.env.feedbackWordingSource,'local');
      sent[2].gate.resolve({ok:true,json:async()=>reply(sent[2].body)});await h.flush();
      assert.equal(h.env.feedbackWordingSource,'factory');assert.equal(h.state.index,1);
    }finally{ai.cancel();}
  });
  await check('Pausing and losing the camera cancel pending wording while local uncertainty and retry behavior remain available',async()=>{
    const {h,sent,ai,review}=fixture();try{
      await h.call('beginReview',review,'retry');await h.call('pause');assert.ok(sent[0].options.signal.aborted);
      sent[0].gate.resolve({ok:true,json:async()=>reply(sent[0].body)});await h.flush();
      assert.equal(h.env.feedbackWordingSource,'local');assert.deepEqual([...h.state.feedback.messages],payload().messages);
      await h.call('pause');await h.call('beginReview',review,'retry');
      await h.emitCameraState({running:false,generation:2});assert.ok(sent[1].options.signal.aborted);
      sent[1].gate.resolve({ok:true,json:async()=>reply(sent[1].body)});await h.flush();
      assert.equal(h.state.feedback.status,'unknown');assert.equal(h.env.feedbackWordingSource,'local');
      assert.equal(h.state.results.size,0);
    }finally{ai.cancel();}
  });
}

const cameraFixture=`// CONSTRUCTED software QA adapter. No camera acquisition.
export function createFollowCamera(options){
  let running=false,generation=0,observations=0;
  Object.defineProperty(options.video,'videoWidth',{configurable:true,get:()=>450});
  Object.defineProperty(options.video,'videoHeight',{configurable:true,get:()=>360});
  const getState=()=>({running,generation,phase:running?'running':'idle',tracking:running?'constructed-qa':'off',
    message:'CONSTRUCTED QA adapter; no physical camera',provenance:'CONSTRUCTED software fixture',
    inferenceCount:observations,streamStarts:0,stoppedTracks:0,overlayJoints:[],tracks:[]});
  const stop=()=>{running=false;options.video.srcObject=null;options.onObservation(null);options.onState(getState());};
  options.startButton.addEventListener('click',()=>{running=true;generation++;options.video.srcObject=new MediaStream();options.onState(getState());});
  options.stopButton.addEventListener('click',stop);
  window.qaCameraFixture={getState,emit(landmarks){if(!running)throw new Error('QA adapter is stopped');
    const now=performance.now();observations++;options.onObservation({observedAtMs:now,aspectRatio:1.25,
      provenance:'CONSTRUCTED QA target observations, not live inference',sample:{status:'pose',tMs:now,landmarks}});}};
  return {getState,stop,destroy:stop};
}`;

async function browserChecks(){
  const fixture=await serverFixture(createFactoryPracticeFeedbackService,{modelTimeoutMs:1000,totalTimeoutMs:2000});
  fixture.state.autoOutput=true;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
  browserEvidence.performed=true;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(30000);
    page.on('pageerror',error=>browserEvidence.pageErrors.push(error.message));
    await page.addInitScript(()=>{
      window.qaCameraRequests=0;
      class FakeUtterance{constructor(text){this.text=text;}}
      Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:FakeUtterance});
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
        getVoices:()=>[{name:'CONSTRUCTED software QA English voice',lang:'en-US',localService:true}],
        speak(){},cancel(){},addEventListener(){},removeEventListener(){}}});
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{
        window.qaCameraRequests++;throw new DOMException('QA blocks physical camera access','NotAllowedError');
      };
    });
    await page.route('**/first-three-center-camera.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:cameraFixture}));
    // Expose the actual review-entry function to this test only. The browser
    // first exercises the real endpoint gate, then supplies a visibly labeled
    // review fixture to test AI wiring independently of media/pose quality.
    const controller=await readFile(new URL('public/first-three.js',root),'utf8');
    await page.route('**/first-three.js',route=>route.fulfill({status:200,contentType:'text/javascript',
      body:controller+'\n// CONSTRUCTED SDK wiring review entry; QA only.\nwindow.qaEnterConstructedReview=review=>beginReview(review,"retry");\n'}));
    await page.route('**/api/arduino/**',route=>route.fulfill({status:503,contentType:'application/json',
      body:JSON.stringify({connected:false,state:'off',message:'CONSTRUCTED disconnected USB fixture; no physical hardware.'})}));
    await page.goto(`${fixture.origin}/first-three.html?step=1`);
    await page.waitForFunction(()=>window.firstThreeDiagnostics?.ready&&!window.firstThreeDiagnostics.loading);
    await page.evaluate(()=>{
      const banner=document.createElement('div');banner.textContent='SOFTWARE QA FIXTURE · constructed review + simulated SDK · no camera or hardware';
      banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:10000;text-align:center;background:#fff0bc;color:#302a13;font:12px sans-serif;padding:3px';
      document.body.append(banner);document.getElementById('spoken-feedback').checked=true;
      document.getElementById('spoken-feedback').dispatchEvent(new Event('change'));
      window.qaEmitTargets=(key,progress=0)=>{
        const diagnostics=window.startPositionDiagnostics,frame=diagnostics.fixedFrame||diagnostics.screenLayout?.frame;
        if(!frame)throw new Error('Missing production target frame');
        const points=diagnostics.guidanceReference.guides.map(guide=>{
          const target=key==='move'?{x:guide.start.x+(guide.end.x-guide.start.x)*progress,
            y:guide.start.y+(guide.end.y-guide.start.y)*progress}:guide[key];
          return {index:guide.index,x:(target.x*frame.scale+frame.hip.x)/frame.aspect,
            y:target.y*frame.scale+frame.hip.y,visibility:1,presence:1};
        });
        for(const index of [11,12,23,24])points.push({index,
          x:frame.hip.x/frame.aspect+([11,23].includes(index)?-.04:.04),
          y:frame.hip.y-([11,12].includes(index)?frame.scale:0),visibility:1,presence:1});
        window.qaCameraFixture.emit(points);
      };
    });
    await check('Actual browser imports the AI helper and shows five clips without requesting physical camera access',async()=>{
      assert.equal(await page.locator('#step-list button').count(),5);
      assert.equal(await page.evaluate(()=>window.qaCameraRequests),0);
      assert.equal(await page.locator('#feedback-ai-source').count(),1);
      assert.equal(await page.locator('#practice-overlay').isVisible(),false);
      assert.equal(fixture.state.sessions.length,0);
    });
    await check('Actual browser endpoint gate and a constructed review exercise SDK wording, the AI label and manual Retry',async()=>{
      await page.click('#start-practice');await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='watching');
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='positioning'&&window.firstThreeDiagnostics.watched);
      await page.evaluate(async()=>{
        const until=performance.now()+2200;
        while(performance.now()<until&&window.firstThreeDiagnostics.phase==='positioning'){
          window.qaEmitTargets('start');await new Promise(resolve=>setTimeout(resolve,70));
        }
      });
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='demonstrating');
      // Constructed target observations exercise the real completion gate.
      // Browser/media timing is not accepted as learner-quality evidence.
      await page.evaluate(async()=>{
        for(let n=0;n<=24&&window.firstThreeDiagnostics.phase!=='feedback';n++){
          window.qaEmitTargets('move',n/24);await new Promise(resolve=>setTimeout(resolve,50));
        }
        for(let n=0;n<4&&window.firstThreeDiagnostics.phase!=='feedback';n++){
          window.qaEmitTargets('end');await new Promise(resolve=>setTimeout(resolve,50));
        }
      });
      await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='feedback');
      await page.waitForFunction(()=>!window.firstThreeDiagnostics.aiFeedback.pending);
      browserEvidence.snapshots.afterConstructedMotion=await page.evaluate(()=>window.firstThreeDiagnostics);
      const sessionsBeforeConstructedReview=fixture.state.sessions.length;
      await page.evaluate(()=>window.qaEnterConstructedReview({status:'mismatch',passed:false,percent:null,
        messages:['Left hand: too fast.','Right hand: too slow.'],
        issues:[{index:33,code:'too_fast'},{index:34,code:'too_slow'}],
        reason:'CONSTRUCTED mismatch fixture for SDK wiring only',
        provenance:'CONSTRUCTED review fixture; no real learner timing or movement validity is asserted.'}));
      await page.waitForFunction(()=>window.firstThreeDiagnostics.aiFeedback.source==='factory');
      const diagnostics=await page.evaluate(()=>window.firstThreeDiagnostics);
      assert.equal(diagnostics.feedback.status,'mismatch');assert.equal(diagnostics.feedback.passed,false);
      assert.equal(diagnostics.index,0);assert.equal(diagnostics.results.length,0);assert.equal(diagnostics.reviewAction,'retry');
      assert.equal(await page.locator('#feedback-ai-source').isVisible(),true);
      assert.equal(await page.locator('#feedback-ai-source').textContent(),'AI wording');
      assert.equal(await page.locator('#feedback-retry').isVisible(),true);assert.equal(await page.locator('#feedback-next').isVisible(),false);
      assert.equal(fixture.state.sessions.length,sessionsBeforeConstructedReview+1,'Each new measured review makes one SDK request');
      assert.ok(diagnostics.feedback.issues.length>0);
      assert.equal(await page.locator('#overlay-reason').textContent(),diagnostics.feedback.messages.join('\n'));
      browserEvidence.snapshots.aiWording=diagnostics;
      await page.screenshot({path:fileURLToPath(new URL('ai-wording-software-fixture.png',out))});
    });
    await check('Actual browser Try again removes AI wording and returns to the current clip without recording a match',async()=>{
      await page.click('#feedback-retry');await page.waitForFunction(()=>window.firstThreeDiagnostics.phase==='positioning');
      const diagnostics=await page.evaluate(()=>window.firstThreeDiagnostics);
      assert.equal(diagnostics.index,0);assert.equal(diagnostics.feedback,null);assert.equal(diagnostics.results.length,0);
      assert.equal(diagnostics.aiFeedback.source,'local');assert.equal(diagnostics.aiFeedback.pending,false);
      assert.equal(await page.locator('#practice-overlay').isVisible(),false);
      browserEvidence.cameraRequests=await page.evaluate(()=>window.qaCameraRequests);assert.equal(browserEvidence.cameraRequests,0);
      assert.deepEqual(browserEvidence.pageErrors,[]);
      await page.screenshot({path:fileURLToPath(new URL('retry-software-fixture.png',out))});
    });
  }finally{await browser.close();await fixture.close();}
}

await mkdir(out,{recursive:true});let result='PASS',failure=null;
try{await serviceChecks();await browserHelperChecks();await controllerChecks();if(!process.argv.includes('--no-browser'))await browserChecks();}
catch(error){result='FAIL';failure=error.stack??String(error);console.error(failure);process.exitCode=1;}
await writeFile(new URL('verification.json',out),JSON.stringify({result,checkedAt:new Date().toISOString(),checks,
  failure,browser:browserEvidence,provenance:'Constructed SDK sessions, camera observations and a labeled browser review outcome. Actual server, browser helper, endpoint gate and production controller/rendering are exercised. The browser review fixture verifies AI wiring only, not evaluator or learner validity. Browser camera adapter is replaced, physical getUserMedia is blocked and Arduino requests are intercepted. No real API credential is read, no Factory call or physical camera/Arduino operation is performed.',
  serviceSha256:hash(await readFile(new URL('scripts/factory-practice-feedback.mjs',root))),
  helperSha256:hash(await readFile(new URL('public/practice-ai-feedback.js',root))),
  controllerSha256:hash(await readFile(new URL('public/first-three.js',root)))},null,2)+'\n');
console.log(`Factory integration: ${checks.length} groups ${result.toLowerCase()} (constructed dependencies).`);
