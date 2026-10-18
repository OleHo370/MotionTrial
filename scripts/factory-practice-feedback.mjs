import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const names = {15:'Left hand',16:'Right hand',27:'Left foot',28:'Right foot',33:'Left hand',34:'Right hand',35:'Left foot',36:'Right foot'};
const stepIds = new Set(['first-three-01','first-three-02','first-three-03','first-six-04','first-six-05']);
// A closed vocabulary makes wording validation deterministic. Droid never decides
// whether the motion passed, and never receives the camera or landmark data.
const sentenceBuilders = Object.freeze({
  too_fast:limb => [
    `Your ${limb} moved faster than the demonstration. Slow down to follow the teacher's pace.`,
    `Your ${limb} moved too quickly. Move more slowly with the teacher.`,
  ],
  too_slow:limb => [
    `Your ${limb} moved more slowly than the demonstration. Move a little faster with the teacher.`,
    `Your ${limb} moved too slowly. Follow the teacher's pace more closely.`,
  ],
  late_start:limb => [
    `Your ${limb} began moving after the teacher. Start moving sooner with the demonstration.`,
    `Your ${limb} started late. Begin its movement when the teacher begins.`,
  ],
  off_guide:limb => [
    `Your ${limb} moved outside the progress beam. Keep it within the beam as you move.`,
    `Your ${limb} left the progress beam. Follow the beam more closely.`,
  ],
  hold_drift:limb => [
    `Your ${limb} moved away from its hold position. Keep it steady there.`,
    `Your ${limb} left its hold position. Keep it steady in place.`,
  ],
  endpoint_unreached:limb => [
    `Your ${limb} did not reach its target triangle. Move it into the triangle.`,
    `Your ${limb} missed its target triangle. Move it into the triangle.`,
  ],
  movement_incomplete:limb => [
    `Your ${limb} did not complete its movement. Follow the whole movement on your retry.`,
    `Your ${limb} did not finish its movement. Complete it on retry.`,
  ],
});
const unknownCodes = new Set(['reference_unknown','tracking_unknown','attempt_incomplete']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const plainText = (value,max) => typeof value === 'string' && value.length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f<>]/.test(value);
const allowedKeys = (value,keys) => Object.keys(value).every(key => keys.includes(key));

// Each wording carries its anatomical side and only the fact measured by its
// issue code. Corrections are approved here rather than invented by the model.
export function factoryIssueSentences(issue) {
  if (!object(issue) || !Object.hasOwn(names,issue.index) || issue.limb !== names[issue.index]
    || !Object.hasOwn(sentenceBuilders,issue.code)) return [];
  return Object.freeze(sentenceBuilders[issue.code](issue.limb.toLowerCase()));
}

export function normalizeFeedbackRequest(value) {
  if (!object(value) || !allowedKeys(value,['attemptId','stepId','status','messages','issues'])
    || typeof value.attemptId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.attemptId)
    || !(stepIds.has(value.stepId) || Number.isInteger(value.stepId) && value.stepId >= 1 && value.stepId <= 5)
    || !['match','mismatch','unknown'].includes(value.status)
    || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 8
    || !value.messages.every(message => plainText(message,180)) || value.messages.join(' ').length > 800
    || !Array.isArray(value.issues) || value.issues.length > 16) return null;
  const issues=[];
  const seenIssues=new Set();
  for (const source of value.issues) {
    if (!object(source) || !allowedKeys(source,['index','code','message'])
      || typeof source.code !== 'string' || !(Object.hasOwn(sentenceBuilders,source.code) || unknownCodes.has(source.code))
      || !(source.index == null || Number.isInteger(source.index) && Object.hasOwn(names,source.index))
      || source.message !== undefined && !plainText(source.message,500)) return null;
    const identity=`${names[source.index] ?? 'general'}:${source.code}`;
    if (seenIssues.has(identity)) return null;
    seenIssues.add(identity);
    issues.push({issueId:`issue-${issues.length}`,index:source.index ?? null,code:source.code,
      limb:names[source.index] ?? null});
  }
  return {attemptId:value.attemptId,stepId:value.stepId,status:value.status,messages:[...value.messages],issues};
}

export function validateFactoryFeedbackOutput(output,request) {
  if (!object(output) || !allowedKeys(output,['entries']) || !Array.isArray(output.entries)
    || output.entries.length !== request.issues.length) return null;
  const supplied = new Map(request.issues.map(issue => [issue.issueId,issue]));
  const accepted = new Map();
  for (const entry of output.entries) {
    if (!object(entry) || !allowedKeys(entry,['issueId','text']) || accepted.has(entry.issueId)) return null;
    const issue=supplied.get(entry.issueId);
    if (!issue || !factoryIssueSentences(issue).includes(entry.text)) return null;
    accepted.set(entry.issueId,entry.text);
  }
  const groups=new Map();
  for (const issue of request.issues) {
    if (!accepted.has(issue.issueId)) return null;
    if (!groups.has(issue.limb)) groups.set(issue.limb,new Set());
    groups.get(issue.limb).add(accepted.get(issue.issueId));
  }
  const messages=[...groups.values()].map(parts => [...parts].join(' '));
  const text=messages.join(' ');
  return messages.length && messages.length <= 4 && messages.every(message => plainText(message,600))
    && text.length <= 2400 && text.split(/\s+/).length <= 200 ? messages : null;
}

export async function resolveDroidExecutable() {
  if (process.platform !== 'win32') return 'droid';
  const { stdout } = await execFileAsync('where.exe',['droid.cmd'],{windowsHide:true,timeout:5000,maxBuffer:8192});
  for (const shim of stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    try {
      const platform=require(path.join(path.dirname(shim),'node_modules','droid','platform.js'));
      const executable=platform.getBinaryPath();
      if (typeof executable === 'string' && (await stat(executable)).isFile()) return executable;
    } catch { /* Try the next installed npm shim without exposing paths/errors. */ }
  }
  throw new Error('Factory executable unavailable.');
}

const json = (res,status,value) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));
};
function sameOrigin(req) {
  try {
    const host=new URL(`http://${req.headers.host}`);
    if (!['localhost','127.0.0.1','[::1]'].includes(host.hostname) || host.username || host.password) return false;
    return (!req.headers.origin || req.headers.origin === host.origin)
      && (!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']));
  } catch { return false; }
}
function aborted(signal) {
  if (signal.aborted) throw new Error('Factory request canceled.');
}
function bound(promise,signal) {
  aborted(signal);
  return new Promise((resolve,reject) => {
    const cancel=() => reject(new Error('Factory request canceled.'));
    signal.addEventListener('abort',cancel,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort',cancel));
  });
}
async function readBody(req,maxBytes,signal) {
  if (Number(req.headers['content-length']) > maxBytes) throw Object.assign(new Error('Body too large.'),{httpStatus:413});
  let length=0;
  const chunks=[];
  for await (const chunk of req) {
    aborted(signal);
    length+=chunk.length;
    if (length > maxBytes) throw Object.assign(new Error('Body too large.'),{httpStatus:413});
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function outputSchema(issues) {
  return {type:'object',properties:{entries:{type:'array',minItems:issues.length,maxItems:issues.length,
    items:{oneOf:issues.map(issue => ({type:'object',properties:{issueId:{const:issue.issueId},
      text:{type:'string',enum:factoryIssueSentences(issue)}},required:['issueId','text'],additionalProperties:false}))}}},
    required:['entries'],additionalProperties:false};
}
function catalogOnlyException(tool) {
  // SDK 0.9.1 / Droid 0.244.0 retain this catalog-schema loader even when its
  // ID is disabled. All data/action tools must still report allowed:false.
  // No invocation of the loader is accepted: the stream guard cancels it.
  return tool.id === 'ToolSearch' && tool.allowed === true && typeof tool.description === 'string'
    && tool.description.startsWith('Load schemas for deferred tools');
}
function hasToolActivity(item) {
  if (['tool_call','tool_call_delta','tool_result','tool_progress'].includes(item?.type)) return true;
  const content=item?.message?.content ?? item?.content;
  return Array.isArray(content) && content.some(block => ['tool_use','tool_result'].includes(block?.type));
}

export function createFactoryPracticeFeedbackService({
  sdkLoader=() => import('@factory/droid-sdk/node'),
  configured=() => Boolean(process.env.FACTORY_API_KEY) && process.env.FACTORY_FEEDBACK_ENABLED !== '0',
  resolveExecPath=resolveDroidExecutable,
  modelId=process.env.FACTORY_FEEDBACK_MODEL || undefined,
  cwd,
  now=Date.now,
  maxBodyBytes=12288,
  maxConcurrent=1,
  minRequestIntervalMs=5000,
  maxRequestsPerMinute=6,
  modelTimeoutMs=15000,
  totalTimeoutMs=40000,
  bodyTimeoutMs=10000,
} = {}) {
  let closed=false,active=0,lastRequest=-Infinity;
  const requests=[],controllers=new Set(),cache=new Map();
  const isConfigured=() => !closed && Boolean(typeof configured === 'function' ? configured() : configured);
  const local=(request,reason) => ({attemptId:request.attemptId,stepId:request.stepId,status:request.status,
    messages:request.messages,source:'local',reason});
  async function explain(request,controller) {
    let session,isolatedDirectory,modelTimer;
    const signal=controller.signal;
    try {
      const sdk=await bound(sdkLoader(),signal);
      const execPath=await bound(resolveExecPath(),signal);
      const workingDirectory=cwd || (isolatedDirectory=await bound(mkdtemp(path.join(tmpdir(),'motiontrial-feedback-')),signal));
      const pendingSession=sdk.createSession({execPath,cwd:workingDirectory,modelId,
        autonomyLevel:sdk.AutonomyLevel.Off,permissionHandler:() => {
          controller.abort();return sdk.ToolConfirmationOutcome.Cancel;
        },
        autoRejectPermissionRequests:true,disableBuiltinSkills:true,mcpServers:[],abortSignal:signal,
        systemPrompt:'Rewrite only the supplied measured movement issues. Return JSON entries containing each issueId exactly once. '
          + 'Choose one supplied allowedText entry for that issue; each contains complete descriptive sentences and a gentle correction. '
          + 'Prefer the shorter alternative when needed to keep all selected text within 200 words total. '
          + 'Keep the anatomical limb name exactly as supplied. Do not add issues, sides, numeric claims, diagnosis or other advice. '
          + 'Do not use tools or read files.'});
      // If startup finishes after cancellation, still dispose the late session.
      Promise.resolve(pendingSession).then(async value => {
        if (signal.aborted) {try {await value.close();} catch { /* Dispose a late canceled session. */ }}
      },() => {});
      session=await bound(pendingSession,signal);
      const tools=await bound(session.listTools(),signal);
      if (!Array.isArray(tools) || tools.some(tool => typeof tool.id !== 'string')) throw new Error('Tool controls unavailable.');
      await bound(session.updateSettings({disabledToolIds:[...new Set(tools.map(tool => tool.id))]}),signal);
      const remaining=await bound(session.listTools(),signal);
      if (!Array.isArray(remaining) || remaining.some(tool => tool.allowed !== false && !catalogOnlyException(tool)))
        throw new Error('Data or action tools still enabled.');
      modelTimer=setTimeout(() => controller.abort(),modelTimeoutMs);
      const prompt=JSON.stringify({stepId:request.stepId,status:request.status,issues:request.issues.map(issue =>
        ({issueId:issue.issueId,limb:issue.limb,code:issue.code,allowedText:factoryIssueSentences(issue)}))});
      const iterator=session.stream(prompt,{abortSignal:signal,outputFormat:{type:sdk.OutputFormatType.JsonSchema,
        schema:outputSchema(request.issues)}})[Symbol.asyncIterator]();
      while (true) {
        const item=await bound(iterator.next(),signal);
        if (item.done) break;
        if (hasToolActivity(item.value)) {
          controller.abort();return local(request,'factory-tool-call-rejected');
        }
        if (item.value.type === sdk.DroidMessageType.Result) {
          if (!item.value.success) return local(request,'factory-unavailable');
          const messages=validateFactoryFeedbackOutput(item.value.structuredOutput,request);
          return messages ? {attemptId:request.attemptId,stepId:request.stepId,status:request.status,
            messages,source:'factory',reason:'measured-issues-reworded'} : local(request,'invalid-factory-output');
        }
      }
      return local(request,'factory-unavailable');
    } catch {
      return local(request,signal.aborted ? 'factory-canceled-or-timed-out' : 'factory-unavailable');
    } finally {
      clearTimeout(modelTimer);
      if (session) {
        let closeTimer;
        try { await Promise.race([session.close(),new Promise(resolve => {closeTimer=setTimeout(resolve,1500);})]); }
        catch { /* Keep local feedback. */ }
        finally {clearTimeout(closeTimer);}
      }
      if (isolatedDirectory) {
        const cleanupTarget=path.resolve(isolatedDirectory),temporaryBase=path.resolve(tmpdir());
        // Verify the absolute recursive-delete target stays inside the temp
        // directory, and is the dedicated directory this adapter created.
        if (path.dirname(cleanupTarget) === temporaryBase && path.basename(cleanupTarget).startsWith('motiontrial-feedback-')) {
          try { await rm(cleanupTarget,{recursive:true,force:true}); } catch { /* A temp directory may still be in use. */ }
        }
      }
    }
  }
  return {
    async handle(req,res) {
      const url=new URL(req.url,'http://127.0.0.1');
      if (!['/api/practice-feedback','/api/practice-feedback/status'].includes(url.pathname)) return false;
      if (!sameOrigin(req)) { json(res,403,{error:'Same-origin loopback requests only.'});return true; }
      if (url.pathname.endsWith('/status')) {
        if (req.method !== 'GET') {json(res,405,{error:'GET required.'});return true;}
        json(res,200,{configured:isConfigured(),provider:'factory',mode:'measured-issues-only'});return true;
      }
      if (req.method !== 'POST') {json(res,405,{error:'POST required.'});return true;}
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
        json(res,415,{error:'JSON required.'});return true;
      }
      const controller=new AbortController();
      const disconnect=() => { if (!res.writableEnded) controller.abort(); };
      req.once('aborted',disconnect);res.once('close',disconnect);
      let timer=setTimeout(() => controller.abort(),bodyTimeoutMs);
      try {
        const body=await bound(readBody(req,maxBodyBytes,controller.signal),controller.signal);
        const request=normalizeFeedbackRequest(body);
        if (!request) {json(res,400,{error:'Invalid measured feedback request.'});return true;}
        clearTimeout(timer);
        if (!isConfigured()) {json(res,200,local(request,'factory-not-configured'));return true;}
        if (request.status !== 'mismatch' || !request.issues.length
          || request.issues.some(issue => !issue.limb || !Object.hasOwn(sentenceBuilders,issue.code))) {
          json(res,200,local(request,'local-review-kept'));return true;
        }
        const timestamp=now();
        for (const [key,value] of cache) if (timestamp - value.time > 120000) cache.delete(key);
        const cacheKey=JSON.stringify(request);
        if (cache.has(cacheKey)) {json(res,200,cache.get(cacheKey).result);return true;}
        if (active >= maxConcurrent) {json(res,200,local(request,'factory-busy'));return true;}
        while (requests.length && timestamp - requests[0] >= 60000) requests.shift();
        if (timestamp-lastRequest < minRequestIntervalMs || requests.length >= maxRequestsPerMinute) {
          json(res,200,local(request,'factory-rate-limited'));return true;
        }
        lastRequest=timestamp;requests.push(timestamp);active++;controllers.add(controller);
        timer=setTimeout(() => controller.abort(),totalTimeoutMs);
        try {
          const result=await explain(request,controller);
          if (result.source === 'factory') {
            if (cache.size >= 128) cache.delete(cache.keys().next().value);
            cache.set(cacheKey,{time:now(),result});
          }
          json(res,200,result);
        } finally {active--;controllers.delete(controller);}
      } catch (error) {
        json(res,error.httpStatus ?? 400,{error:controller.signal.aborted ? 'Request canceled or timed out.' : 'Invalid JSON request.'});
      } finally {
        clearTimeout(timer);req.removeListener('aborted',disconnect);res.removeListener('close',disconnect);
      }
      return true;
    },
    async close() {closed=true;for (const controller of controllers) controller.abort();cache.clear();},
  };
}
