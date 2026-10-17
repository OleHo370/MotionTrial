import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'artifacts/follow-teacher-review');
const baseline=JSON.parse(await readFile(path.join(output,'protected-before.json'),'utf8'));
const sha=async(p)=>createHash('sha256').update(await readFile(p)).digest('hex');
const files=[];
for(const before of baseline.files){
  const after=await sha(path.join(root,before.path));
  files.push({path:before.path,beforeSha256:before.sha256,afterSha256:after,unchanged:before.sha256===after});
}
const manifest=JSON.parse(await readFile(path.join(root,'public/practice-media/dual-view/manifest.json'),'utf8'));
const originals=[];
for(const view of ['front','back']){
  const original=path.resolve(root,'../../',`${view}.mp4`);
  const actual=await sha(original);
  originals.push({path:original,expectedSha256:manifest.sources[view].sha256,actualSha256:actual,unchanged:actual===manifest.sources[view].sha256});
}
const assets=JSON.parse(await readFile(path.join(root,'public/mediapipe/manifest.json'),'utf8'));
const modelAssets=[];
for(const asset of assets.assets){
  const actual=await sha(path.join(root,'public',asset.path));
  modelAssets.push({path:asset.path,expectedSha256:asset.sha256,actualSha256:actual,unchanged:actual===asset.sha256});
}
const unchanged=[...files,...originals,...modelAssets].every((f)=>f.unchanged);
await writeFile(path.join(output,'protected-after.json'),JSON.stringify({result:unchanged?'PASS':'FAIL',checkedAt:new Date().toISOString(),baselineRecordedAt:baseline.recordedAtUtc,protectedFileCount:files.length,files,originals,modelAssets},null,2)+'\n');
assert.ok(unchanged,'All protected old files, original sources and pinned model assets must remain unchanged.');
console.log(`PASS: ${files.length} protected before/after hashes, both original videos and ${modelAssets.length} pinned model/WASM assets unchanged.`);
