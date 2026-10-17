import { defineConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// A deterministic, explicitly synthetic virtual camera, never model output.
// Chromium loops these two seconds of neutral frames for the 20-second capture.
const fixture = path.resolve('tests/fixtures/virtual-camera.y4m');
mkdirSync(path.dirname(fixture), { recursive: true });
const pixels = Buffer.concat([Buffer.alloc(320 * 240, 32), Buffer.alloc(320 * 240 / 2, 128)]);
writeFileSync(fixture, Buffer.concat([Buffer.from('YUV4MPEG2 W320 H240 F10:1 Ip A1:1 C420jpeg\n'), ...Array.from({length:20},()=>Buffer.concat([Buffer.from('FRAME\n'),pixels]))]));
export default defineConfig({
 testDir: './tests', testMatch: '*.spec.ts', fullyParallel:false, workers:1, timeout:90_000,
 expect:{timeout:15_000}, reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:process.env.MOTIONTRIAL_TEST_URL||'http://127.0.0.1:3000',channel:'chrome',headless:true,viewport:{width:1440,height:900},trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${fixture}`]}}
});
