import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import postcss, { type Document } from 'postcss';

const directory = path.resolve('app/qi-mirror');
const styles = [path.join(directory, 'isolation.css'), path.join(directory, 'host-links.css'),
  ...readdirSync(path.join(directory, 'styles')).filter(name => name.endsWith('.css')).map(name => path.join(directory, 'styles', name))];

test('all added styles stop matching when the Qi Mirror wrapper leaves the page', () => {
  let checked = 0;
  for (const filename of styles) {
    const root = postcss.parse(readFileSync(filename, 'utf8'), { from: filename });
    root.walkRules(rule => {
      let parent: typeof rule.parent | Document = rule.parent;
      while (parent) {
        if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
        parent = parent.parent;
      }
      for (const selector of rule.selectors) {
        assert.ok(selector.includes('[data-qimirror-root]'), `${filename}: ${selector}`);
        checked += 1;
      }
    });
    root.walkAtRules(/keyframes$/, rule => assert.ok(rule.params.startsWith('qimirror-'), `${filename}: ${rule.params}`));
  }
  assert.ok(checked > 1_500, 'Audit the full imported stylesheet set.');
});

test('added styles use only namespaced artwork and font URLs', () => {
  for (const filename of styles) {
    const source = readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /url\(\s*['"]?\/(?:fonts|landing-art)\//, filename);
  }
});
