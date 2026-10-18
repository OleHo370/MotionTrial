/** Explicit software fixtures: no Factory account, webcam, audio or Arduino is used. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDualViewServer} from './serve-dual-view.mjs';
import {createFactoryPracticeFeedbackService} from './factory-practice-feedback.mjs';
import {normalizePracticeSummaryRequest,practiceSummaryEvidence,practiceSummaryOutputSchema,
  validatePracticeSummaryOutput,localPracticeSummary} from './factory-practice-summary.mjs';

const checks=[],steps=['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05'];
const privateFixture='CONSTRUCTED_PRIVATE_CREDENTIAL_NOT_A_REAL_FACTORY_KEY';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(condition,message='Software fixture condition did not arrive',timeout=1500){
  const until=Date.now()+timeout;
  while(!condition()){if(Date.now()>until)throw new Error(message);await delay(3);}
}
async function check(name,run){await run();checks.push(name);console.log(`PASS: ${name}`);}
const attempt=(attemptId,stepId=steps[0],changes={})=>({attemptId,stepId,status:'mismatch',
  messages:['Your left hand moved too quickly. Move more slowly with the teacher.'],issues:[{index:33,code:'too_fast'}],...changes});
const payload=(sessionId='software-session')=>({sessionId,attempts:[
  attempt('retry-1'),attempt('retry-2',steps[1],{issues:[{index:33,code:'too_fast'},{index:28,code:'off_guide'}]}),
  attempt('unclear-1',steps[1],{status:'unknown',messages:['Tracking unclear.'],issues:[{index:16,code:'tracking_unknown'}]}),
  ...steps.map((stepId,i)=>attempt(`matched-${i}`,stepId,{status:'match',messages:['Targets reached.'],issues:[]}))
],results:steps.map(stepId=>({stepId,status:'matched'}))});
const movement=(attemptId='software-movement')=>({attemptId,stepId:steps[0],status:'mismatch',
  messages:['Left hand: too fast.'],issues:[{index:33,code:'too_fast'}]});
const structured=evidence=>({entries:evidence.entries.map(entry=>({entryId:entry.entryId,text:entry.allowedText[0]}))});

function sdkFixture(){
  const state={sessions:[],prompts:[],outputs:[],events:[],mode:'normal',loads:0,execLoads:0,closeCalls:0,startGate:null,streamGate:null};
  const sdk={AutonomyLevel:{Off:'off'},ToolConfirmationOutcome:{Cancel:'cancel'},OutputFormatType:{JsonSchema:'json_schema'},
    DroidMessageType:{Result:'result'},async createSession(options){
      const record={options,settings:[],closed:false};state.sessions.push(record);
      const api={async listTools(){return ['Execute','Read','Write'].map(id=>({id,allowed:!record.settings.length||state.mode==='tools-active'}));},
        async updateSettings(settings){record.settings.push(settings);},
        async *stream(prompt,options){
          record.prompt=prompt;state.prompts.push({prompt,options,session:record});
          if(state.mode==='error')throw new Error(`Constructed private error ${privateFixture}`);
          if(state.mode==='hold')await new Promise((resolve,reject)=>{
            const cancel=()=>reject(new Error('Constructed stream cancellation'));
            if(options.abortSignal.aborted){cancel();return;}
            options.abortSignal.addEventListener('abort',cancel,{once:true});
            state.streamGate=()=>{options.abortSignal.removeEventListener('abort',cancel);resolve();};
          });
          for(const event of state.events.splice(0))yield event;
          const body=JSON.parse(prompt),output=body.entries?{entries:(body.conversationEntries??body.entries).map(entry=>({entryId:entry.entryId,text:entry.allowedText[0]}))}:
            {entries:body.issues.map(issue=>({issueId:issue.issueId,text:issue.allowedText[0]}))};
          yield {type:'result',success:true,structuredOutput:state.outputs.shift()??output};
        },async close(){if(!record.closed){record.closed=true;state.closeCalls++;}}};
      if(state.mode==='delayed-start')await new Promise(resolve=>{state.startGate=resolve;});
      return api;
    }};
  return {sdk,state};
}

async function serverFixture(options={}){
  const {sdk,state}=sdkFixture();
  const feedback=createFactoryPracticeFeedbackService({configured:true,sdkLoader:async()=>{state.loads++;return sdk;},
    resolveExecPath:async()=>{state.execLoads++;return 'CONSTRUCTED_EXECUTABLE_NEVER_LAUNCHED';},
    minRequestIntervalMs:0,maxRequestsPerMinute:1000,maxSummariesPerMinute:1000,
    modelTimeoutMs:1000,totalTimeoutMs:1200,warmupTimeoutMs:1000,warmupLifetimeMs:2000,...options});
  const server=createDualViewServer({publicRoot:resolve(fileURLToPath(new URL('../public/',import.meta.url))),
    relay:{async handle(){return false;},async close(){}},feedback});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  function request(pathname='/api/practice-summary',{body=payload(),method='POST',headers={},raw,signal}={}){
    const bytes=raw??JSON.stringify(body);
    return new Promise((resolve,reject)=>{
      const requestHeaders={Host:`127.0.0.1:${port}`,Origin:origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes),...headers};
      const req=http.request({hostname:'127.0.0.1',port,path:pathname,method,headers:requestHeaders,signal},res=>{
        const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>{
          const text=Buffer.concat(parts).toString('utf8');let json;try{json=JSON.parse(text);}catch{}
          assert.ok(!text.includes(privateFixture),'Private fixture failure must not reach HTTP');
          resolve({status:res.statusCode,json,text});
        });
      });req.on('error',reject);req.end(bytes);
    });
  }
  return {feedback,server,state,origin,request,async close(){state.startGate?.();await feedback.close();server.closeAllConnections?.();await server.shutdown();}};
}

await check('Summary validation accepts only bounded known lesson history and verified matching result evidence',()=>{
  const body=payload();assert.ok(normalizePracticeSummaryRequest(body));
  for(const changed of [{...body,sessionId:'../private'},{...body,frames:[]},{...body,results:[{stepId:steps[0],status:'passed'}]},
    {...body,results:[body.results[0],body.results[0]]},{...body,attempts:[body.attempts[0],body.attempts[0]]},
    {...body,attempts:[{...body.attempts[0],stepId:'first-six-06'}]},
    {...body,attempts:[{...body.attempts[0],landmarks:[]}]},
    {...body,attempts:[{...body.attempts[0],issues:[{index:33,code:'invented'}]}]},
    {...body,attempts:[{...body.attempts[0],issues:[{index:null,code:'too_fast'}]}]},
    {...body,attempts:[{...body.attempts[0],issues:[{index:null,code:'timing_unknown'}]}]},
    {...body,attempts:[{...body.attempts[0],issues:[{index:33,code:'too_fast'},{index:15,code:'too_fast'}]}]},
    {...body,attempts:[{...body.attempts[0],messages:['<script>unsafe</script>']}]},
    {...body,attempts:[body.attempts[0]],results:[{stepId:steps[0],status:'matched'}]}])assert.equal(normalizePracticeSummaryRequest(changed),null);
  const manual=normalizePracticeSummaryRequest({sessionId:'manual',attempts:[],results:[{stepId:steps[0],status:'manual'}]});
  assert.ok(manual);assert.equal(practiceSummaryEvidence(manual).matched,0);
});
await check('All retries, selected wording, anatomical issue counts and unassessed timing reach the summary evidence',()=>{
  const body=payload();body.attempts.push(attempt('fast-and-slow',steps[2],{issues:[{index:15,code:'too_slow'}]}));
  body.attempts.at(-2).messages.push('Left hand: timing unclear.');
  const request=normalizePracticeSummaryRequest(body),evidence=practiceSummaryEvidence(request);
  assert.equal(evidence.attemptCount,9);assert.equal(evidence.matched,5);assert.equal(evidence.unknown,1);assert.equal(evidence.uncertainTiming,1);
  assert.deepEqual(evidence.transcript.map(item=>item.messages),body.attempts.map(item=>item.messages));
  const hand=evidence.entries.find(entry=>entry.entryId==='limb-left-hand');
  assert.deepEqual(hand.facts.map(({code,count})=>({code,count})),[{code:'too_fast',count:2},{code:'too_slow',count:1}]);
  assert.ok(hand.allowedText.every(text=>/follow the teacher's pace more closely\./i.test(text)));
  assert.ok(!hand.allowedText.some(text=>/improved|perfect|resolved|diagnos/i.test(text)));
});
await check('Later target completion is described only when a matching attempt follows an observed correction on that same step',()=>{
  const retry=attempt('chronological-retry'),matched=attempt('chronological-match',steps[0],
    {status:'match',messages:['Targets reached.','Left hand: timing unclear.'],issues:[]});
  const build=attempts=>practiceSummaryEvidence(normalizePracticeSummaryRequest({sessionId:'chronological-session',
    attempts,results:[{stepId:steps[0],status:'matched'}]}));
  const after=build([retry,matched]);assert.deepEqual(after.laterReachedSteps,[1]);assert.equal(after.repeatAttempts,1);
  assert.match(after.entries[0].allowedText[0],/later attempts reached the targets in step 1/);
  assert.ok(after.entries.some(entry=>entry.entryId==='uncertainty'));
  const before=build([matched,retry]);assert.deepEqual(before.laterReachedSteps,[]);
  assert.doesNotMatch(before.entries[0].allowedText[0],/After earlier corrections|later attempts/);
  const differentStep=build([{...retry,stepId:steps[1]},matched]);assert.deepEqual(differentStep.laterReachedSteps,[]);
  const unknown=build([attempt('chronological-unknown',steps[0],{status:'unknown',issues:[{index:15,code:'tracking_unknown'}]}),matched]);
  assert.deepEqual(unknown.laterReachedSteps,[]);assert.doesNotMatch(after.entries.map(entry=>entry.allowedText[0]).join(' '),/timing improved|timing resolved|pace corrected/i);
});
await check('A mixed unclear attempt retains its measured hand correction and separates the unobserved right foot',()=>{
  const mixed=attempt('mixed-unclear',steps[0],{status:'unknown',issues:[{index:33,code:'too_fast'},{index:36,code:'tracking_unknown'}],
    messages:["Your left hand moved faster than the demonstration. Slow down to follow the teacher's pace.",
      'The camera could not clearly track your right foot throughout this attempt. Keep that foot visible from start to finish before trying again.']});
  const completed=attempt('mixed-later-match',steps[0],{status:'match',issues:[],messages:['You reached all ending targets. This movement is complete.']});
  const request=normalizePracticeSummaryRequest({sessionId:'mixed-unclear-session',attempts:[mixed,completed],results:[{stepId:steps[0],status:'matched'}]});
  const evidence=practiceSummaryEvidence(request),hand=evidence.entries.find(entry=>entry.entryId==='limb-left-hand');
  assert.equal(evidence.unknown,1);assert.equal(evidence.matched,1);assert.deepEqual(evidence.laterReachedSteps,[1]);
  assert.deepEqual(hand.facts.map(({code,count})=>({code,count})),[{code:'too_fast',count:1}]);
  assert.ok(!evidence.entries.some(entry=>entry.entryId==='limb-right-foot'),'Unclear tracking does not create a measured foot correction');
  const wording=validatePracticeSummaryOutput(structured(evidence),evidence).join(' ');
  assert.match(wording,/left hand/i);assert.match(wording,/unclear/i);assert.match(wording,/measured movement mistakes/i);
  assert.doesNotMatch(wording,/right foot.*(?:too fast|too slow)|timing improved|resolved|perfect/i);
  assert.deepEqual(evidence.transcript[0].messages,mixed.messages);
});
await check('Typed timing uncertainty remains visible in a completed match summary even with full-sentence feedback',()=>{
  const completed=attempt('timing-unknown-match',steps[0],{status:'match',issues:[{index:34,code:'timing_unknown'}],
    messages:['The camera could not determine the timing of your right hand in this attempt, so its speed was not assessed.']});
  const request=normalizePracticeSummaryRequest({sessionId:'typed-timing-session',attempts:[completed],results:[{stepId:steps[0],status:'matched'}]});
  assert.ok(request);const evidence=practiceSummaryEvidence(request);assert.equal(evidence.matched,1);assert.equal(evidence.unknown,0);
  assert.equal(evidence.uncertainTiming,1);assert.equal(evidence.entries.filter(entry=>entry.kind==='limb').length,0);
  const wording=validatePracticeSummaryOutput(structured(evidence),evidence).join(' ');
  assert.match(wording,/timing was unclear/i);assert.doesNotMatch(wording,/too fast|too slow|pace corrected|timing improved/i);
});
await check('Structured summary output covers every factual theme and rejects extra, clinical or unsupported claims',()=>{
  const evidence=practiceSummaryEvidence(normalizePracticeSummaryRequest(payload())),output=structured(evidence);
  const expected=evidence.entries.map(entry=>entry.allowedText[0]);
  assert.deepEqual(validatePracticeSummaryOutput(output,evidence),expected);
  assert.deepEqual(validatePracticeSummaryOutput({entries:[...output.entries].reverse()},evidence),expected);
  for(const invalid of [{...output,score:99},{entries:output.entries.slice(1)},
    {entries:[...output.entries,output.entries[0]]},{entries:output.entries.map((entry,i)=>i?entry:{...entry,text:'You have a neurological condition.'})},
    {entries:output.entries.map((entry,i)=>i?entry:{...entry,text:'Your timing improved and is now perfect.'})},
    {entries:output.entries.map((entry,i)=>i?entry:{...entry,entryId:'wrong-session-theme'})},
    {entries:output.entries.map((entry,i)=>i?entry:{...entry,text:'Your right hand moved too fast.'})}])
    assert.equal(validatePracticeSummaryOutput(invalid,evidence),null);
  const schema=practiceSummaryOutputSchema(evidence);assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.entries.minItems,(evidence.conversationEntries??evidence.entries).length);
});
await check('Conversational summary synthesizes a practice priority without narrating the numeric ledger or inventing confidence',()=>{
  const body=payload('conversational-summary'),evidence=practiceSummaryEvidence(normalizePracticeSummaryRequest(body));
  assert.equal(evidence.conversationEntries.length,3);
  const model={entries:evidence.conversationEntries.map(entry=>({entryId:entry.entryId,text:entry.allowedText[0]}))};
  const messages=validatePracticeSummaryOutput(model,evidence);assert.ok(messages);
  assert.equal(messages.length,3);assert.ok(messages.every(text=>text.length>35));
  const text=messages.join(' ');
  assert.match(text,/pace|timing/i);assert.match(text,/next|practice|try/i);
  assert.doesNotMatch(text,/\b\d+ attempts?\b|[1-5] of 5|confidence|afraid|fear|nervous|diagnos|cured|perfect/i);
  const altered={entries:model.entries.map((entry,index)=>index===1?{...entry,text:'Be confident and make your hand movements larger because you were afraid to move.'}:entry)};
  assert.equal(validatePracticeSummaryOutput(altered,evidence),null);
});
await check('The full 200-attempt limit retains early corrections; 201 attempts are rejected without truncation',()=>{
  const body=payload();
  while(body.attempts.length<200)body.attempts.push(attempt(`extra-${body.attempts.length}`,steps[4],{issues:[{index:28,code:'hold_drift'}]}));
  const request=normalizePracticeSummaryRequest(body);assert.ok(request);assert.equal(request.attempts.length,200);
  assert.equal(practiceSummaryEvidence(request).transcript[0].attemptId,'retry-1');
  body.attempts.push(attempt('too-many'));assert.equal(normalizePracticeSummaryRequest(body),null);
});
await check('All 28 limb/code correction themes plus uncertainty remain inside final six-paragraph speech bounds',()=>{
  const codes=['too_fast','too_slow','late_start','off_guide','hold_drift','endpoint_unreached','movement_incomplete'];
  const body=payload();body.attempts.push(attempt('dense-hands',steps[0],{issues:[33,34].flatMap(index=>codes.map(code=>({index,code})))}),
    attempt('dense-feet',steps[1],{issues:[35,36].flatMap(index=>codes.map(code=>({index,code})))}));
  const evidence=practiceSummaryEvidence(normalizePracticeSummaryRequest(body)),messages=validatePracticeSummaryOutput(structured(evidence),evidence);
  assert.ok(messages);assert.equal(messages.length,6);assert.ok(messages.every(text=>text.length<=800));
  assert.ok(messages.join(' ').trim().split(/\s+/).length<=350);assert.equal(evidence.entries.filter(entry=>entry.kind==='limb').length,4);
});

const fixture=await serverFixture();
try{
  await check('Summary and warmup routes reject foreign origin, invalid bodies, methods and MIME before SDK work',async()=>{
    for(const path of ['/api/practice-summary','/api/practice-feedback/warmup']){
      for(const headers of [{Origin:'https://foreign.example'},{'Sec-Fetch-Site':'cross-site'},{Host:'foreign.example',Origin:'http://foreign.example'}])
        assert.equal((await fixture.request(path,{body:path.endsWith('warmup')?{}:payload(),headers})).status,403);
      assert.equal((await fixture.request(path,{method:'GET',raw:''})).status,405);
      assert.equal((await fixture.request(path,{headers:{'Content-Type':'text/plain'},body:{}})).status,415);
      assert.equal((await fixture.request(path,{raw:'{'})).status,400);
    }
    assert.equal((await fixture.request(undefined,{raw:'x'.repeat(98305)})).status,413);
    assert.equal((await fixture.request('/api/practice-feedback/warmup',{body:{sessionId:'not-accepted'}})).status,400);
    assert.equal(fixture.state.sessions.length,0);
  });
  await check('Warmup prepares one fresh tool-disabled session without streaming a model or sending practice history',async()=>{
    const [a,b]=await Promise.all([fixture.feedback.warmup(),fixture.feedback.warmup()]);assert.equal(a,true);assert.equal(b,true);
    assert.equal(fixture.state.sessions.length,1);assert.equal(fixture.state.prompts.length,0);
    assert.deepEqual([...fixture.state.sessions[0].settings[0].disabledToolIds].sort(),['Execute','Read','Write']);
    assert.equal(fixture.state.sessions[0].closed,false);assert.equal(fixture.state.loads,1);assert.equal(fixture.state.execLoads,1);
    const api=await fixture.request('/api/practice-feedback/warmup',{body:{}});
    assert.deepEqual(api.json,{configured:true,ready:true,modelRequested:false});assert.equal(fixture.state.sessions.length,1);
  });
  await check('A warm session is consumed once; a completed attempt is closed and its context cannot become the final summary session',async()=>{
    const first=await fixture.request('/api/practice-feedback',{body:movement()});assert.equal(first.json.source,'factory');
    assert.equal(fixture.state.sessions.length,1);assert.ok(fixture.state.sessions[0].closed);
    const summary=await fixture.request();assert.equal(summary.json.source,'factory');assert.equal(summary.json.sessionId,'software-session');
    assert.equal(fixture.state.sessions.length,2);assert.ok(fixture.state.sessions[1].closed);
    assert.equal(fixture.state.prompts.length,2);assert.equal(JSON.parse(fixture.state.prompts[1].prompt).task,'summarize-complete-lesson-history');
    assert.equal(JSON.parse(fixture.state.prompts[1].prompt).transcript.length,payload().attempts.length);
    assert.equal(fixture.state.loads,1);assert.equal(fixture.state.execLoads,1);
    assert.notEqual(fixture.state.prompts[0].session,fixture.state.prompts[1].session);
  });
  await check('A second warmup is fresh and final summary consumes it once; identical final history uses cached wording',async()=>{
    await fixture.feedback.warmup();assert.equal(fixture.state.sessions.length,3);assert.equal(fixture.state.prompts.length,2);
    const body=payload('second-software-session'),result=await fixture.request(undefined,{body});
    assert.equal(result.json.source,'factory');assert.equal(fixture.state.sessions.length,3);assert.equal(fixture.state.prompts.length,3);
    assert.ok(fixture.state.sessions[2].closed);const cached=await fixture.request(undefined,{body});
    assert.deepEqual(cached.json,result.json);assert.equal(fixture.state.sessions.length,3);assert.equal(fixture.state.prompts.length,3);
  });
  await check('Contradictory summary text and attempted tool actions retain the grounded local recap without exposing private errors',async()=>{
    const evidence=practiceSummaryEvidence(normalizePracticeSummaryRequest(payload('invalid-output')));
    fixture.state.outputs.push({entries:structured(evidence).entries.map((entry,i)=>i?entry:{...entry,text:'All movement was perfect; your condition is cured.'})});
    const invalid=await fixture.request(undefined,{body:payload('invalid-output')});assert.equal(invalid.json.source,'local');
    assert.equal(invalid.json.reason,'invalid-factory-output');assert.deepEqual(invalid.json.messages,localPracticeSummary(normalizePracticeSummaryRequest(payload('invalid-output'))).messages);
    fixture.state.events.push({type:'tool_call',toolName:'Execute'});
    const action=await fixture.request(undefined,{body:payload('tool-action')});assert.equal(action.json.source,'local');
    assert.equal(action.json.reason,'factory-tool-call-rejected');assert.ok(fixture.state.sessions.at(-1).closed);
    fixture.state.mode='error';const failure=await fixture.request(undefined,{body:payload('private-error')});
    assert.equal(failure.json.source,'local');assert.doesNotMatch(failure.text,new RegExp(privateFixture));fixture.state.mode='normal';
  });
}finally{await fixture.close();}

await check('Final summaries bypass step spacing and its exhausted step budget, while their independent budget prevents repeated paid recaps',async()=>{
  let time=1000;const f=await serverFixture({now:()=>time,minRequestIntervalMs:5000,maxRequestsPerMinute:1,maxSummariesPerMinute:2});
  try{
    assert.equal((await f.request('/api/practice-feedback',{body:movement()})).json.source,'factory');
    const first=await f.request(undefined,{body:payload('budget-summary-1')});assert.equal(first.json.source,'factory');
    const second=await f.request(undefined,{body:payload('budget-summary-2')});assert.equal(second.json.source,'factory');
    const limited=await f.request(undefined,{body:payload('budget-summary-3')});assert.equal(limited.json.source,'local');assert.equal(limited.json.reason,'factory-rate-limited');
    const cached=await f.request(undefined,{body:payload('budget-summary-1')});assert.equal(cached.json.source,'factory');assert.equal(f.state.sessions.length,3);
    time+=60001;assert.equal((await f.request(undefined,{body:payload('budget-summary-3')})).json.source,'factory');
  }finally{await f.close();}
});
await check('Summary and movement requests share one paid-call concurrency slot',async()=>{
  const f=await serverFixture();try{
    f.state.mode='hold';const pending=f.request();await waitFor(()=>f.state.prompts.length===1);
    const busy=await f.request('/api/practice-feedback',{body:movement('concurrent-step')});assert.equal(busy.json.reason,'factory-busy');
    assert.equal(f.state.sessions.length,1);f.state.streamGate();assert.equal((await pending).json.source,'factory');
    f.state.mode='normal';assert.equal((await f.request('/api/practice-feedback',{body:movement('after-summary')})).json.source,'factory');
  }finally{await f.close();}
});
await check('An idle warmed session expires and cannot be consumed later or reused as conversation history',async()=>{
  const f=await serverFixture({warmupLifetimeMs:20});try{
    await f.feedback.warmup();await waitFor(()=>f.state.sessions[0].closed);
    assert.equal(f.state.prompts.length,0);assert.equal((await f.request()).json.source,'factory');
    assert.equal(f.state.sessions.length,2);assert.ok(f.state.sessions.every(session=>session.closed));
  }finally{await f.close();}
});
await check('Warmup failure to disable tools never sends a model request',async()=>{
  const f=await serverFixture();try{
    f.state.mode='tools-active';assert.equal(await f.feedback.warmup(),false);assert.equal(f.state.prompts.length,0);
    assert.ok(f.state.sessions[0].closed);const result=await f.request();assert.equal(result.json.source,'local');
    assert.equal(f.state.prompts.length,0);assert.ok(f.state.sessions.every(session=>session.closed));
  }finally{await f.close();}
});
await check('Shutdown cancels warmup startup and closes a late SDK session without any model generation',async()=>{
  const f=await serverFixture();try{
    f.state.mode='delayed-start';const warming=f.feedback.warmup();await waitFor(()=>f.state.sessions.length===1);
    await f.feedback.close();assert.equal(await warming,false);assert.ok(f.state.sessions[0].options.abortSignal.aborted);
    f.state.startGate();await waitFor(()=>f.state.sessions[0].closed);assert.equal(f.state.prompts.length,0);assert.equal(f.state.closeCalls,1);
  }finally{await f.close();}
});
await check('Shutdown cancels an active final summary and retains a bounded local recap',async()=>{
  const f=await serverFixture();try{
    f.state.mode='hold';const pending=f.request();await waitFor(()=>f.state.prompts.length===1);
    await f.feedback.close();const result=await pending;assert.equal(result.json.source,'local');
    assert.equal(result.json.reason,'factory-canceled-or-timed-out');assert.ok(f.state.sessions[0].closed);
  }finally{await f.close();}
});
await check('An unconfigured service neither prepares Droid nor streams a summary',async()=>{
  const f=await serverFixture({configured:false});try{
    assert.equal(await f.feedback.warmup(),false);const warm=await f.request('/api/practice-feedback/warmup',{body:{}});
    assert.deepEqual(warm.json,{configured:false,ready:false,modelRequested:false});
    const summary=await f.request();assert.equal(summary.json.source,'local');assert.equal(summary.json.reason,'factory-not-configured');
    assert.equal(f.state.sessions.length,0);assert.equal(f.state.loads,0);assert.equal(f.state.execLoads,0);
  }finally{await f.close();}
});

await mkdir('artifacts/factory-session-summary-review',{recursive:true});
await writeFile('artifacts/factory-session-summary-review/verification.json',JSON.stringify({
  provenance:'Constructed SDK sessions and HTTP-only loopback fixtures; no live Factory, learner, audio or hardware checks.',
  passed:true,checks:checks.length,details:checks},null,2)+'\n');
console.log(JSON.stringify({passed:true,checks:checks.length,report:'artifacts/factory-session-summary-review/verification.json'}));
