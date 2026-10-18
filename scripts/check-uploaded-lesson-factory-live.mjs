// Explicit integration diagnostic: one authenticated Factory summary request.
// Labeled software issues only. No camera, learner frames, USB or API-key output.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.UPLOAD_FACTORY_TEST_URL||'http://127.0.0.1:8766';
const payload={sessionId:`upload-live-software-${Date.now()}`,lessonStepCount:1,
  attempts:[{attemptId:'upload-software-attempt-1',stepId:'first-three-01',status:'mismatch',
    messages:['Your left hand moved too quickly. Follow the teacher’s pace.'],issues:[{index:33,code:'too_fast'}]}],results:[]};
const started=Date.now();let report;
try{
  const response=await fetch(`${base}/api/practice-summary`,{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
  const result=await response.json();
  report={passed:false,status:response.status,source:result.source??null,reason:result.reason??result.error??null,
    messages:result.messages??[],elapsedMs:Date.now()-started,lessonStepCount:1,
    provenance:'One real authenticated Factory request with explicitly labeled software issues for a one-step uploaded instructor lesson. No physical movement, camera, audio or Arduino.'};
  assert.equal(response.status,200,report.reason);assert.equal(result.source,'factory',report.reason);
  assert.ok(Array.isArray(result.messages)&&result.messages.length===3);
  assert.doesNotMatch(result.messages.join(' '),/five steps|all five|five movements/i);
  report.passed=true;
}catch(error){report={...report,passed:false,error:error.message,elapsedMs:Date.now()-started};process.exitCode=1;}
await mkdir(new URL('../artifacts/instructor-upload-review/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/instructor-upload-review/live-factory-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
