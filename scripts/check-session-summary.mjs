/** Pure software checks: no Factory call, microphone, webcam or Arduino access. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createPracticeSessionHistory,createPracticeSummaryClient,localPracticeSessionSummary,practiceSummaryPayload}
  from '../public/practice-session-summary.js';

const checks=[];
const steps=['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05'];
const attempt=(id='attempt-1',changes={})=>({attemptId:id,stepId:steps[0],status:'mismatch',
  messages:['Your left hand moved too quickly. Move more slowly with the teacher.'],
  issues:[{index:15,code:'too_fast'}],...changes});
const fixture=()=>({sessionId:'session-software-fixture',attempts:[attempt()],
  results:steps.map(stepId=>({stepId,status:'matched'}))});
const response=(payload,changes={})=>({source:'factory',sessionId:payload.sessionId,
  messages:['You completed all five movements with matching feedback.','Your left hand needed a slower pace on one attempt. Follow the teacher\'s pace next time.'],...changes});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

{
  const history=createPracticeSessionHistory({sessionId:'session-1'}),first=attempt();
  assert.equal(history.record(first),true);
  assert.equal(history.record({...first,messages:['Changed by a resume callback.']}),false);
  first.messages[0]='Caller mutation';first.issues[0].code='too_slow';
  const saved=history.getAttempts();assert.equal(saved.length,1);assert.match(saved[0].messages[0],/too quickly/);
  assert.equal(saved[0].issues[0].code,'too_fast');saved[0].messages[0]='Snapshot mutation';
  assert.match(history.getAttempts()[0].messages[0],/too quickly/);
  checks.push('A retry is retained once per attempt identifier; pauses/resumes cannot overwrite it, and callers cannot mutate retained history.');
}
{
  const history=createPracticeSessionHistory({sessionId:'session-2'});
  history.record({...attempt(),landmarks:[{x:0.5,y:0.5}],image:'not a frame',review:{percent:91}});
  const results=new Map([[steps[0],{stepId:steps[0],status:'matched',review:{landmarks:[{}]}}],
    [steps[1],{stepId:steps[1],status:'manual',secret:'not sent'}]]);
  const snapshot=history.snapshot(results);
  assert.deepEqual(Object.keys(snapshot.attempts[0]),['attemptId','stepId','status','messages','issues']);
  assert.deepEqual(Object.keys(snapshot.results[0]),['stepId','status']);
  assert.equal(snapshot.results[1].status,'manual');
  assert.doesNotMatch(JSON.stringify(snapshot),/landmarks|image|secret|percent/);
  checks.push('Session snapshots preserve selected wording, issues and manual transitions while stripping frames, landmarks, scores and unrelated fields.');
}
{
  const history=createPracticeSessionHistory({sessionId:'old-session'});history.record(attempt());
  history.clear('new-session');assert.equal(history.getSessionId(),'new-session');assert.deepEqual(history.getAttempts(),[]);
  assert.equal(history.record(attempt()),true);assert.equal(history.snapshot().sessionId,'new-session');
  assert.throws(()=>history.clear('unsafe id'));assert.throws(()=>createPracticeSessionHistory({sessionId:'<script>'}));
  assert.throws(()=>history.snapshot([{stepId:steps[0],status:'matched'},{stepId:steps[0],status:'manual'}]));
  checks.push('Starting a new lesson clears attempt identifiers and requires a fresh valid session; duplicate result steps are rejected.');
}
{
  const payload=fixture();
  payload.attempts.push(attempt('unknown-1',{status:'unknown',messages:['Tracking unclear.'],
    issues:[{index:16,code:'too_slow'},{index:28,code:'tracking_unknown'}]}));
  payload.attempts.push(attempt('retry-2',{issues:[{index:15,code:'too_fast'},{index:33,code:'too_fast'},
    {index:28,code:'off_guide'}]}));
  payload.attempts.push(attempt('match-1',{status:'match',messages:['Targets reached.'],issues:[]}));
  const result=localPracticeSessionSummary(payload),text=result.messages.join(' ');
  assert.equal(result.source,'local');assert.equal(result.sessionId,payload.sessionId);
  assert.match(text,/5 of 5 movements with matching feedback/);assert.match(text,/4 attempts/);
  assert.match(text,/2 attempts that needed another try/);assert.match(text,/left hand moved too fast on 2 attempts/);
  assert.match(text,/right foot moved away from the beam on 1 attempt/);
  assert.match(text,/right hand moved too slowly on 1 attempt/);
  assert.match(text,/Tracking was unclear on 1 attempt/);
  assert.match(text,/Those unclear observations were kept separate from measured movement mistakes/);
  assert.doesNotMatch(text,/right foot moved too slowly|right foot moved too fast|improved|corrected|perfect/);
  checks.push('Local final wording includes retries, successful attempts and anatomical issue counts; aliases do not double-count, and a measured hand error remains distinct from uncertain foot tracking in the same review.');
}
{
  const payload=fixture();payload.attempts.push(attempt('retry-slow',{issues:[{index:33,code:'too_slow'}]}));
  const text=localPracticeSessionSummary(payload).messages.join(' ');
  assert.match(text,/moved too fast on 1 attempt and moved too slowly on 1 attempt/);
  assert.equal((text.match(/match the teacher's pace/g)??[]).length,1);
  assert.doesNotMatch(text,/slow down.*keep up|keep up.*slow down/);
  checks.push('Fast and slow observations across separate attempts are retained, while the next-practice advice gives one coherent pacing instruction.');
}
{
  const payload=fixture();payload.attempts=[attempt('matched-uncertain',{status:'match',
    messages:['Targets reached.','Left hand: timing unclear.'],issues:[]})];
  const text=localPracticeSessionSummary(payload).messages.join(' ');
  assert.match(text,/One completed attempt reached the targets while timing was unclear/);
  assert.doesNotMatch(text,/timing matched|pace was correct|tracking was unclear/i);
  checks.push('A matching endpoint with unassessed timing retains that uncertainty without inventing a timing pass or tracking failure.');
}
{
  const payload=fixture();payload.results[0].status='manual';
  const text=localPracticeSessionSummary(payload).messages.join(' ');
  assert.match(text,/4 of 5/);assert.match(text,/One movement was advanced manually/);assert.match(text,/not verified as a match/);
  checks.push('Manual advancement reduces the verified completion count and is explicitly distinguished from a matching movement.');
}
{
  const history=createPracticeSessionHistory({sessionId:'long-lesson'});
  for(let i=0;i<201;i++)history.record(attempt(`retry-${i}`,{issues:[{index:28,code:'too_slow'}]}));
  const snapshot=history.snapshot();assert.equal(snapshot.attempts.length,201);
  assert.equal(practiceSummaryPayload(snapshot),null);
  assert.match(localPracticeSessionSummary(snapshot).messages.join(' '),/right foot moved too slowly on 201 attempts/);
  checks.push('All local retries are retained beyond the remote cap; an oversized lesson uses every local attempt rather than silently omitting early feedback.');
}
{
  const payload=fixture();payload.attempts=Array.from({length:200},(_,i)=>attempt(`large-${i}`,
    {messages:['word '.repeat(119).trim(),'word '.repeat(79).trim()]}));
  assert.equal(practiceSummaryPayload(payload),null,'Byte-size cap is independent of attempt-count cap');
  checks.push('The 96 KiB remote request limit is enforced even when attempt count and individual wording bounds pass.');
}
{
  const payload=fixture();payload.attempts[0].messages=Array.from({length:5},(_,i)=>i?'Left hand: timing unclear.':'Targets reached.');
  assert.ok(practiceSummaryPayload(payload));
  for(const change of [{stepId:'first-six-06'},{status:'made-up'},{issues:[{index:999,code:'too_fast'}]},
    {messages:['<script>unsafe</script>']},{issues:[{index:15,code:'invented'}]}]){
    assert.equal(practiceSummaryPayload({...fixture(),attempts:[attempt('bad-attempt',change)]}),null);
  }
  assert.equal(practiceSummaryPayload({...fixture(),attempts:[attempt(),attempt()]}),null);
  checks.push('Bounded local timing messages are accepted; unknown movements, malformed wording, unsupported issues and duplicate attempt identifiers cannot reach Factory.');
}
{
  const payload=fixture(),states=[],calls=[];
  const client=createPracticeSummaryClient({onState:value=>states.push(value),fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>response(payload)};
  }});
  const result=await client.request(payload);assert.deepEqual(result,response(payload));
  assert.equal(calls[0].url,'/api/practice-summary');assert.equal(calls[0].options.credentials,'same-origin');
  assert.deepEqual(JSON.parse(calls[0].options.body),payload);assert.equal(client.getState().source,'factory');
  assert.equal(client.getState().pending,false);assert.ok(states.some(state=>state.pending));
  client.cancel();assert.deepEqual(client.getState(),{source:'local',pending:false,sessionId:null});
  checks.push('The optional summary request sends the sanitized whole-lesson payload to the same-origin endpoint and publishes bounded pending/source state.');
}
{
  const payload=fixture();let calls=0;
  const client=createPracticeSummaryClient({fetchImpl:async()=>{calls++;throw Error('Must not be called');}});
  assert.equal(await client.request({...payload,sessionId:'unsafe id'}),null);assert.equal(calls,0);
  checks.push('Invalid lesson evidence is rejected before any network call.');
}
{
  const payload=fixture();
  const invalid=[{source:'other'},{sessionId:'stale-session'},{messages:[]},{messages:['<b>Not plain text</b>']},
    {messages:['x'.repeat(801)]},{messages:Array.from({length:7},()=> 'Another paragraph.')},
    {messages:Array.from({length:6},()=> 'word '.repeat(60).trim())}];
  for(const changes of invalid){
    const client=createPracticeSummaryClient({fetchImpl:async()=>({ok:true,json:async()=>response(payload,changes)})});
    assert.equal(await client.request(payload),null);assert.equal(client.getState().source,'local');
  }
  checks.push('Wrong-session or provider replies and malformed, excessive or non-plain-text wording fall back to the grounded local summary.');
}
{
  const payload=fixture(),pending=deferred();let delivered=0,signal;
  const client=createPracticeSummaryClient({fetchImpl:(_url,options)=>{signal=options.signal;return pending.promise;}});
  const request=client.request(payload,{onResult:()=>delivered++});client.cancel();
  assert.equal(await request,null);assert.equal(signal.aborted,true);
  pending.resolve({ok:true,json:async()=>response(payload)});await Promise.resolve();await Promise.resolve();
  assert.equal(delivered,0);assert.equal(client.getState().source,'local');
  checks.push('Cancellation settles promptly even if the fetch adapter ignores abort; a late reply cannot be delivered to a restarted lesson.');
}
{
  const payload=fixture(),pending=deferred();let delivered=0;
  const client=createPracticeSummaryClient({timeoutMs:5,fetchImpl:()=>pending.promise});
  assert.equal(await client.request(payload,{onResult:()=>delivered++}),null);
  pending.resolve({ok:true,json:async()=>response(payload)});await Promise.resolve();
  assert.equal(delivered,0);assert.equal(client.getState().pending,false);
  checks.push('A timeout also settles an uncooperative fetch and prevents late AI wording from replacing the fallback.');
}
{
  const first=fixture(),second={...fixture(),sessionId:'next-session'},pending=deferred();let count=0;
  const client=createPracticeSummaryClient({fetchImpl:()=>++count===1?pending.promise:
    Promise.resolve({ok:true,json:async()=>response(second)})});
  const old=client.request(first),fresh=client.request(second);assert.equal(await old,null);
  assert.equal((await fresh).sessionId,'next-session');
  pending.resolve({ok:true,json:async()=>response(first)});await Promise.resolve();await Promise.resolve();
  assert.equal(client.getState().sessionId,'next-session');assert.equal(client.getState().source,'factory');
  checks.push('A newer summary invalidates an older request; late old responses cannot reset or overwrite the new session state.');
}

const report={provenance:'Pure software fixtures; no live movement, Factory, audio or hardware checks.',checks:checks.length,passed:true,details:checks};
await mkdir('artifacts/session-summary-review',{recursive:true});
await writeFile('artifacts/session-summary-review/verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,checks:checks.length,report:'artifacts/session-summary-review/verification.json'}));
