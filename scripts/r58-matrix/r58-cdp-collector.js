// r58-cdp-collector.js
// External black-box console collector for the R58 A1 matrix runner.
// Connects to a Typora renderer via Chromium DevTools Protocol (CDP),
// streams Runtime.consoleAPICalled / Runtime.exceptionThrown to a log file,
// and emits a single JSON summary line on completion.
//
// Usage:
//   node r58-cdp-collector.js --port 9222 --out <logfile> [--fixture <name>] [--duration <ms>]
//
// Node.js >= 21 (global fetch + WebSocket). Tested on Node v22.

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { port: 9222, out: null, fixture: '', duration: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--fixture') args.fixture = argv[++i];
    else if (a === '--duration') args.duration = parseInt(argv[++i], 10);
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtArg(arg) {
  if (!arg) return '';
  switch (arg.type) {
    case 'string':
      return arg.value;
    case 'number':
    case 'boolean':
      return String(arg.value);
    case 'undefined':
      return 'undefined';
    case 'null':
      return 'null';
    case 'object':
    case 'function':
    case 'symbol':
    case 'bigint':
      if (arg.description) return arg.description;
      try { return JSON.stringify(arg.preview || arg.value || {}); } catch { return String(arg.value); }
    default:
      return String(arg.value ?? arg.description ?? '');
  }
}

function formatConsoleEvent(params) {
  const type = params.type || 'log';
  const message = (params.args || []).map(fmtArg).join(' ').trim();
  let location = '';
  const frame = params.stackTrace && params.stackTrace.callFrames && params.stackTrace.callFrames[0];
  if (frame) {
    let url = frame.url || '';
    const base = path.basename(url.split('?')[0]) || 'console';
    location = `${base}:${frame.lineNumber !== undefined ? frame.lineNumber + 1 : 0}`;
  }
  const ts = new Date().toISOString();
  const line = location ? `${location} ${message}` : message;
  return { ts, type, line };
}

function formatExceptionEvent(params) {
  const desc = params.exceptionDetails && params.exceptionDetails.exception
    ? fmtArg(params.exceptionDetails.exception) : 'exception';
  const text = params.exceptionDetails && params.exceptionDetails.text
    ? params.exceptionDetails.text : desc;
  let location = '';
  const frame = params.exceptionDetails && params.exceptionDetails.stackTrace
    && params.exceptionDetails.stackTrace.callFrames && params.exceptionDetails.stackTrace.callFrames[0];
  if (frame) {
    const base = path.basename((frame.url || '').split('?')[0]) || 'console';
    location = `${base}:${frame.lineNumber !== undefined ? frame.lineNumber + 1 : 0}`;
  }
  return { ts: new Date().toISOString(), type: 'exception', line: location ? `${location} EXCEPTION: ${text}` : `EXCEPTION: ${text}` };
}

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list failed: ${res.status}`);
  return res.json();
}

function pickTarget(targets, fixture) {
  const pages = targets.filter((t) => t.type === 'page');
  if (!pages.length) return null;
  if (fixture) {
    const hit = pages.find((t) => (t.title || '').includes(fixture)) || pages.find((t) => (t.url || '').includes(fixture));
    if (hit) return hit;
  }
  // prefer the page whose title looks like a markdown document
  const md = pages.find((t) => /\.md/.test(t.title || '') || /\.md/.test(t.url || ''));
  return md || pages[0];
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.out) {
    console.error('missing --out');
    process.exit(2);
  }
  const outStream = fs.createWriteStream(args.out, { flags: 'a' });
  let target = null;
  const deadline = Date.now() + 30000;
  while (!target && Date.now() < deadline) {
    try {
      const targets = await listTargets(args.port);
      target = pickTarget(targets, args.fixture);
    } catch (e) {
      // CDP not ready yet
    }
    if (!target) await sleep(500);
  }
  if (!target) {
    console.error('NO_CDP_TARGET');
    process.exit(3);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let started = false;
  const counts = { console: 0, exception: 0 };

  const startAt = Date.now();

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    started = true;
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      counts.console++;
      const f = formatConsoleEvent(msg.params);
      outStream.write(`${f.line}\n`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      counts.exception++;
      const f = formatExceptionEvent(msg.params);
      outStream.write(`${f.line}\n`);
    }
  });

  ws.addEventListener('error', (e) => {
    outStream.write(`CDP_WS_ERROR: ${e.message || e}\n`);
  });

  const dur = args.duration > 0 ? args.duration : 60000;
  await sleep(dur);

  const summary = {
    port: args.port,
    fixture: args.fixture || '',
    targetTitle: target.title || '',
    targetUrl: target.url || '',
    started,
    consoleEvents: counts.console,
    exceptionEvents: counts.exception,
    durationMs: Date.now() - startAt,
  };
  console.log(JSON.stringify(summary));
  try { ws.close(); } catch {}
  outStream.end();
  await sleep(200);
}

main().catch((e) => {
  console.error('COLLECTOR_FATAL: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
