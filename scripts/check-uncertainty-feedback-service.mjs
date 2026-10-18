// Software fixtures only: no camera, hardware, API key, or paid model request.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFactoryPracticeFeedbackService, normalizeFeedbackRequest,
  factoryIssueSentences, validateFactoryFeedbackOutput } from './factory-practice-feedback.mjs';

const activity={sessions:0,modelCalls:0,closed:0,nextOutput:null,prompts:[]};
const sdk={AutonomyLevel:{Off:'off'},ToolConfirmationOutcome:{Cancel:'cancel'},
  OutputFormatType:{JsonSchema:'json-schema'},DroidMessageType:{Result:'result'},
  async createSession(options){
    activity.sessions++;
    assert.equal(options.autonomyLevel,'off');
    assert.equal(options.autoRejectPermissionRequests,true);
    assert.deepEqual(options.mcpServers,[]);
    return {
      async listTools(){return [];},
      async updateSettings(settings){assert.deepEqual(settings.disabledToolIds,[]);},
      async *stream(prompt,options){
        activity.modelCalls++;
        const evidence=JSON.parse(prompt);activity.prompts.push(evidence);
        assert.equal(options.outputFormat.type,'json-schema');
        assert.equal(evidence.task,'rewrite-grounded-feedback');
        assert.ok(evidence.issues.every(issue=>issue.allowedText.length===2));
        const output=activity.nextOutput??{entries:evidence.issues.map(issue=>({
          issueId:issue.issueId,text:issue.allowedText[1],
        }))};
        activity.nextOutput=null;
        yield {type:'result',success:true,structuredOutput:output};
      },
      async close(){activity.closed++;},
    };
  },
};
const service=createFactoryPracticeFeedbackService({sdkLoader:async()=>sdk,configured:true,
  resolveExecPath:async()=> 'software-fixture-droid',minRequestIntervalMs:0,maxRequestsPerMinute:100});
const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res))res.writeHead(404).end();});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let fixtureId=0,checks=0;
const payload=(status,issues)=>({attemptId:`uncertainty-fixture-${++fixtureId}`,stepId:'first-three-01',
  status,messages:['Software fixture review.'],issues});
async function post(value){
  const response=await fetch(`${base}/api/practice-feedback`,{method:'POST',
    headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(value)});
  return {status:response.status,body:await response.json()};
}
function approved(request){
  const normalized=normalizeFeedbackRequest(request);
  assert.ok(normalized);
  const output={entries:normalized.issues.map(issue=>({issueId:issue.issueId,text:factoryIssueSentences(issue)[1]}))};
  return validateFactoryFeedbackOutput(output,normalized);
}
try{
  const foot=payload('unknown',[{index:28,code:'tracking_unknown'}]);
  const footResponse=await post(foot);
  assert.equal(footResponse.status,200);assert.equal(footResponse.body.source,'factory');
  assert.equal(footResponse.body.status,'unknown');assert.equal(footResponse.body.attemptId,foot.attemptId);
  assert.deepEqual(footResponse.body.messages,approved(foot));
  assert.match(footResponse.body.messages[0],/right foot.*tracking was unclear/);
  assert.doesNotMatch(footResponse.body.messages.join(' '),/too (?:fast|slow)|moved (?:faster|slower)/);
  checks++;

  const mixed=payload('unknown',[{index:28,code:'tracking_unknown'},{index:33,code:'too_fast'}]);
  const mixedResponse=await post(mixed);
  assert.equal(mixedResponse.body.source,'factory');assert.equal(mixedResponse.body.status,'unknown');
  assert.deepEqual(mixedResponse.body.messages,approved(mixed));
  assert.match(mixedResponse.body.messages[0],/right foot/);
  assert.match(mixedResponse.body.messages[1],/left hand moved too quickly/);
  checks++;

  const timing=payload('match',[{index:33,code:'timing_unknown'}]);
  const timingResponse=await post(timing);
  assert.equal(timingResponse.body.source,'factory');assert.equal(timingResponse.body.status,'match');
  assert.deepEqual(timingResponse.body.messages,approved(timing));
  assert.match(timingResponse.body.messages[0],/not enough timing evidence.*left hand.*speed was not assessed/);
  assert.doesNotMatch(timingResponse.body.messages.join(' '),/too (?:fast|slow)|moved (?:faster|slower)/);
  checks++;

  for(const code of ['tracking_unknown','reference_unknown','attempt_incomplete']){
    const general=payload('unknown',[{index:null,code}]);
    const result=await post(general);
    assert.equal(result.body.source,'factory');assert.equal(result.body.status,'unknown');
    assert.deepEqual(result.body.messages,approved(general));
    assert.ok(result.body.messages[0].split('. ').length>=2);
    checks++;
  }

  const fiveGroups=payload('unknown',[...[[33,'tracking_unknown'],[34,'tracking_unknown'],
    [35,'tracking_unknown'],[36,'tracking_unknown'],[null,'reference_unknown']]
    .map(([index,code])=>({index,code}))]);
  const groupedResponse=await post(fiveGroups);
  assert.equal(groupedResponse.body.source,'factory');assert.equal(groupedResponse.body.messages.length,5);
  assert.deepEqual(groupedResponse.body.messages,approved(fiveGroups));
  checks++;

  const callsBefore=activity.modelCalls;
  const unchanged=await post(payload('match',[]));
  assert.equal(unchanged.body.source,'local');assert.equal(unchanged.body.status,'match');
  assert.equal(activity.modelCalls,callsBefore);
  checks++;

  for(const invalid of [{index:null,code:'timing_unknown'},{index:33,code:'reference_unknown'},
    {index:null,code:'too_fast'},{index:31,code:'tracking_unknown'}]){
    const result=await post(payload('unknown',[invalid]));
    assert.equal(result.status,400);
  }
  checks++;

  activity.nextOutput={entries:[{issueId:'issue-0',text:'Your right foot moved too quickly. Move more slowly with the teacher.'}]};
  const inventedTempo=await post(payload('unknown',[{index:28,code:'tracking_unknown'}]));
  assert.equal(inventedTempo.body.source,'local');assert.equal(inventedTempo.body.reason,'invalid-factory-output');
  assert.equal(inventedTempo.body.status,'unknown');
  checks++;

  activity.nextOutput={entries:[{issueId:'issue-0',text:'I could not reliably assess your left foot because its tracking was unclear. Keep it visible from start to finish and try again.'}]};
  const wrongSide=await post(payload('unknown',[{index:28,code:'tracking_unknown'}]));
  assert.equal(wrongSide.body.source,'local');assert.equal(wrongSide.body.reason,'invalid-factory-output');
  assert.equal(wrongSide.body.status,'unknown');
  checks++;

  assert.equal(activity.closed,activity.sessions);
  console.log(JSON.stringify({softwareFixture:true,checks,modelCalls:activity.modelCalls,
    assertions:'Factory wording accepts grounded uncertainty without changing assessment status or inventing speed.'}));
}finally{
  await service.close();
  await new Promise(resolve=>server.close(resolve));
}
