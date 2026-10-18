# Qi Mirror pages

These additions integrate both supplied source packages alongside the original
MotionTrial snapshot `264eec7e9ba0ca15e42579d9947e192ce6f5b337`. Every file in that
snapshot is preserved. No existing route, navigation, configuration, dependency,
practice controller, reference asset, database, or Arduino transport is replaced.

## New routes

| Route | Content |
| --- | --- |
| `/qi-mirror` | Four-scene homepage from the dedicated homepage package |
| `/qi-mirror/cover` | Original ink-landscape cover from the UI package |
| `/qi-mirror/levels` | Discrete 24-form wheel and original-color previews |
| `/qi-mirror/enter?form=1` | Resource-backed bamboo loading before the selected form |
| `/qi-mirror/practice?mode=guided&form=1` | Separate imported guided-learning UI |
| `/qi-mirror/practice?mode=forms&routine=original24` | Separate imported whole-form UI |

The existing `/` remains the recording review workspace; `/practice` remains the
original practice page. The new pages include a small **MotionTrial pages** menu
for returning to these routes or opening the existing USB lesson.

The USB lesson remains `http://127.0.0.1:8766/first-three.html`, served by the
existing `scripts/serve-dual-view.mjs`. Its USB relay endpoints are provided by
that local server. This integration does not start it, change its firmware, or
move the lesson to a different origin.

## Isolation

- New components and the imported practice helpers live under `features/qi-mirror`.
- Shared original model, teaching, camera, comparison, and overlay helpers are
  read through existing imports. Their source and behavior are unchanged.
- New styles match only while `[data-qimirror-root]` is present. This includes
  document/shell rules, so retained Next.js styles cannot alter existing pages
  after client navigation back. New keyframe names use the `qimirror-` prefix.
- Images and fonts live under `public/qi-mirror`. Original teacher clips, pose
  references, model files, and WASM keep their existing URLs and bytes.
- The archive's replacements for the original layout, review/capture/about
  workflow, tests, and TypeScript configuration remain documented as source
  reference; the integrated pages use the project structure described above.
- Font licenses and image provenance are included. The shared Chinese fonts are
  deduplicated, with both source metadata records retained.

## Checks

From the project root:

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
node scripts/check-qi-mirror-preservation.mjs
```

For the new browser checks, start a separately built test instance on port 3100
with an empty test data directory, then run:

```powershell
$env:MOTIONTRIAL_DATA_DIR = "$PWD/.test-data/qi-mirror-browser"
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
# In another terminal:
node node_modules/@playwright/test/cli.js test --config=playwright.qi-mirror.config.ts
```

The browser checks cover narrow layouts, form navigation, instructions without
camera activation, and restoration of original workspace/practice styles after
client navigation. They do not assess human movement or activate USB hardware.

The integration was built in an isolated QA copy to preserve the original
running/build directory and private data. That copy used shared installed
dependencies and a QA-only `turbopack.root` setting for their filesystem paths.
The repository's `next.config.ts` is unchanged.

The supplied merge guide and provenance documents are retained under this
directory. The imported pages and assets are versioned directly. Original ZIP
packages are local-only backups excluded from Git; their exact names, sizes and
SHA-256 identities are recorded in the [source-package manifest](source-packages/README.md).
The original guide's replacement instructions describe its author's integration;
the additive route map above implements the user's requirement to preserve the
existing project. See the [current route map](../routes.md) for active and retained
earlier experiences.
