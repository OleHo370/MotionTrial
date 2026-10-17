import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Wi-Fi transport preserved for later: uncomment this import and its factory below.
// import { createArduinoFeedbackRelay } from './arduino-feedback-relay.mjs';
import { createArduinoUsbRelay } from './arduino-usb-relay.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.env.DUAL_VIEW_PORT || 8766);
const types = {'.html':'text/html; charset=utf-8','.json':'application/json','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.mp4':'video/mp4','.jpg':'image/jpeg','.png':'image/png','.task':'application/octet-stream'};
// Wi-Fi default preserved: relay = createArduinoFeedbackRelay()
export function createDualViewServer({ publicRoot = root, relay = createArduinoUsbRelay() } = {}) {
const server = http.createServer(async (req, res) => {
  try {
    if (await relay.handle(req, res)) return;
    const url = new URL(req.url, 'http://127.0.0.1');
    const target = path.resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/dual-view.html' : url.pathname));
    if (!target.startsWith(publicRoot + path.sep)) { res.writeHead(403).end(); return; }
    const info = await stat(target);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    const headers = {'Content-Type':types[path.extname(target)] || 'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = info.size - 1;
    if (match) {
      start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= info.size) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(match ? 206 : 200, headers);
    if (req.method === 'HEAD') {res.end();return;}
    const stream = createReadStream(target, {start,end});
    stream.on('error', () => res.destroy());
    req.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch { res.writeHead(404).end('File not found'); }
});
server.on('close', () => { void relay.close(); });
server.shutdown = async () => {
  await relay.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
};
return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  /* Wi-Fi pairing setup preserved; USB does not need an IP, network or pairing key.
  let defaultKey = null;
  try {
    const local = JSON.parse(await readFile(path.resolve(root, '../hardware/arduino-feedback.local.json'), 'utf8'));
    if (typeof local.key !== 'string' || !/^[a-fA-F0-9]{32,64}$/.test(local.key)) throw new Error('Invalid pairing configuration.');
    defaultKey = local.key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Check hardware/arduino-feedback.local.json; its key must be 32–64 hexadecimal characters.');
  }
  const server = createDualViewServer({ relay: createArduinoFeedbackRelay({ defaultKey }) });
  */
  const server = createDualViewServer({ relay: createArduinoUsbRelay() });
  server.listen(port, '127.0.0.1', () => console.log(`Dual-view results: http://127.0.0.1:${port}/dual-view.html`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.shutdown().finally(() => process.exit(0)); });
}
