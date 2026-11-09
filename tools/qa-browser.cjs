'use strict';
// Small CDP harness shared by focused visual regression checks. Uses an isolated,
// headless browser profile; never attaches to the player's browser session.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openBrowser({ outDir, width = 1280, height = 800 } = {}) {
  outDir ||= path.resolve(__dirname, '../output/qa-items');
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(outDir, 'chrome-'));
  const executable = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = spawn(executable, ['--headless=new', '--mute-audio', '--no-first-run',
    '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  const errors = [];
  const close = async () => { if (socket) socket.close(); browser.kill(); };
  try {
    let port;
    for (let i = 0; i < 150 && !port; i++) {
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
      catch { await sleep(100); }
    }
    if (!port) throw new Error('Chrome debugging port did not open');
    const version = await (await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(5000) })).json();
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome debugging socket did not open')), 5000);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = event => { clearTimeout(timer); reject(new Error('Chrome debugging socket failed')); };
    });
    let id = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push((d.exception && d.exception.description) || d.text);
      }
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const rid = ++id;
      const timer = setTimeout(() => { pending.delete(rid); reject(new Error('Chrome command timed out: ' + method)); }, 30000);
      pending.set(rid, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: rid, method, params, sessionId }));
    });
    const targets = await send('Target.getTargets');
    const target = targets.targetInfos.find(t => t.type === 'page');
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const cmd = (method, params) => send(method, params, sessionId);
    await cmd('Page.enable'); await cmd('Runtime.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const evaluate = async expression => {
      const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expression, timeout = 15000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(50); }
      throw new Error('Timed out: ' + expression);
    };
    const shot = async filename => {
      const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
      const file = path.isAbsolute(filename) ? filename : path.join(outDir, filename);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    };
    return { cmd, evaluate, waitFor, shot, errors, close, outDir, sleep, version: version.Browser };
  } catch (error) { await close(); throw error; }
}
module.exports = { openBrowser, sleep };
