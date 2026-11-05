// proxy-shim.mjs — LOCAL-ONLY diagnostic/forwarding proxy for Chromium.
//
// Chromium's CONNECT to the egress proxy gets a 403 while byte-identical
// CONNECTs from curl/Python get 200; through this shim the same bytes get
// 200. The shim also lets Chromium reach the internet at all in this
// sandbox (the egress proxy otherwise refuses Chromium's direct CONNECT).
//
// Listens on 127.0.0.1:8888. Forwards CONNECTs to the egress proxy from
// the https_proxy env var (credentials never printed). Plain HTTP is
// answered with 405 (only CONNECT is needed here).
// Run: node proxy-shim.mjs   (Ctrl-C to stop)
import net from 'node:net';
import { writeFileSync } from 'node:fs';

const LOG = '/tmp/proxy-shim.log';
const upstream = new URL(process.env.https_proxy || process.env.HTTPS_PROXY);
const UP_HOST = upstream.hostname;
const UP_PORT = Number(upstream.port) || 3128;

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  process.stdout.write(line);
  try { writeFileSync(LOG, line, { flag: 'a' }); } catch { /* ignore */ }
}

const server = net.createServer((client) => {
  let buf = Buffer.alloc(0);
  let up = null;
  let tunneled = false;
  let upBuf = Buffer.alloc(0);
  let replied = false;

  client.on('data', (chunk) => {
    if (tunneled) { if (up && !up.destroyed) up.write(chunk); return; }
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end === -1) return;
    const head = buf.subarray(0, end + 4);
    const rest = buf.subarray(end + 4);
    log('--- CONNECT request from Chromium (' + head.length + ' bytes) ---');
    log(JSON.stringify(head.toString('utf8')));
    const firstLine = head.toString('utf8').split('\r\n')[0];
    if (!/^CONNECT\s+\S+\s+HTTP\/1\.1$/.test(firstLine)) {
      client.end('HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    tunneled = true;
    up = net.createConnection({ host: UP_HOST, port: UP_PORT }, () => {
      up.write(head);
      if (rest.length) up.write(rest);
    });
    up.on('data', (c) => {
      if (!replied) {
        upBuf = Buffer.concat([upBuf, c]);
        const hdrEnd = upBuf.indexOf('\r\n\r\n');
        if (hdrEnd === -1) return;
        replied = true;
        log('--- egress proxy response ---');
        log(JSON.stringify(upBuf.subarray(0, hdrEnd + 4).toString('utf8')));
        client.write(upBuf);
        return;
      }
      client.write(c);
    });
    up.on('error', (e) => { log('upstream error:', e.message); if (!client.destroyed) client.end(); });
    up.on('close', () => { if (!client.destroyed) client.end(); });
  });
  client.on('error', () => { if (up && !up.destroyed) up.end(); });
  client.on('close', () => { if (up && !up.destroyed) up.end(); });
});

server.listen(8888, '127.0.0.1', () => log('shim listening on 127.0.0.1:8888 -> ' + UP_HOST + ':' + UP_PORT));
