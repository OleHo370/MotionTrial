import { execFileSync } from 'node:child_process';

const baseline = '264eec7e9ba0ca15e42579d9947e192ce6f5b337';
const changed = execFileSync('git', ['diff', '--name-status', '--diff-filter=CDMRTUXB', baseline, '--'], { encoding: 'utf8' }).trim();
if (changed) throw new Error(`Existing snapshot files changed:\n${changed}`);
const originals = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline], { encoding: 'utf8' }).trim().split('\n');
console.log(`PASS: all ${originals.length} files from the original GitHub snapshot remain unchanged.`);
