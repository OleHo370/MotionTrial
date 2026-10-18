// Explicit real-service diagnostic. It uses labeled software issues only.
// Run this separately; it consumes Factory usage and never opens a webcam/USB.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDualViewServer } from './serve-dual-view.mjs';
import { createFactoryPracticeFeedbackService } from './factory-practice-feedback.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.FACTORY_API_KEY) {
  try { process.loadEnvFile(path.join(root, '.env.factory.local')); }
  catch { throw new Error('Set the local Factory API key before this live diagnostic.'); }
}
assert.ok(process.env.FACTORY_API_KEY, 'Factory API key is required.');
const relay = { async handle() { return false; }, async close() {} };
const server = createDualViewServer({ relay, feedback: createFactoryPracticeFeedbackService() });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const unclear=process.argv.includes('--unclear');
const body = unclear ? {
  attemptId:'live-software-unclear-foot',stepId:'first-three-01',status:'unknown',
  messages:['Right foot: tracking unclear.'],issues:[{index:36,code:'tracking_unknown'}],
} : {
  attemptId: 'live-software-example', stepId: 'first-three-01', status: 'mismatch',
  messages: ['Left hand: too fast.', 'Right hand: too slow.'],
  issues: [{ index: 33, code: 'too_fast' }, { index: 34, code: 'too_slow' }],
};
try {
  const status = await fetch(origin + '/api/practice-feedback/status');
  assert.equal((await status.json()).configured, true);
  const started = performance.now();
  const response = await fetch(origin + '/api/practice-feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body), signal: AbortSignal.timeout(50000),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  console.log(JSON.stringify({ source: result.source, reason: result.reason,
    messages: result.messages, elapsedMs: Math.round(performance.now() - started),
    provenance: 'Labeled software example; real Factory SDK; no learner or device capture.' }, null, 2));
  assert.equal(result.source, 'factory', 'Live SDK wording should pass validation.');
  assert.equal(result.status, body.status);
  assert.equal(result.attemptId, body.attemptId);
  if(unclear){
    assert.equal(result.messages.length,1);assert.match(result.messages[0],/right foot/i);
    assert.match(result.messages[0],/unclear|clearly track/i);assert.ok(result.messages[0].length>80);
    assert.doesNotMatch(result.messages[0],/too (?:fast|slow)|left foot|matched|successful/i);
  }else{
    assert.match(result.messages[0], /^Your left hand .*\. .+\.$/);
    assert.match(result.messages[1], /^Your right hand .*\. .+\.$/);
  }
  assert.ok(result.messages.every(message => !message.includes(process.env.FACTORY_API_KEY)));
  console.log('PASS: real Factory SDK response through the practice HTTP endpoint.');
} finally {
  await server.shutdown();
}
