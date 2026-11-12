import { execFile, spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

const profile = resolve(`.tmp-notification-smoke-${Date.now()}`);
const port = 9341;
const delay = ms => new Promise(done => setTimeout(done, ms));
const requests = [];
execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
const electronExecutable = resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe');
let responseDelay = 700;
const nativeProbe = async extra => {
  const result = await promisify(execFile)('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', resolve('scripts/windows-notification-probe.ps1'), ...extra,
  ], { windowsHide: true, timeout: 15000 });
  return result.stdout.trim();
};
const server = createServer(async (req, res) => {
  const buffers = []; for await (const value of req) buffers.push(Buffer.from(value));
  const body = JSON.parse(Buffer.concat(buffers).toString() || '{}');
  requests.push(body);
  await delay(responseDelay);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Notification test complete. Reply here to continue this conversation.' })}\n\n`);
  res.end(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 8, output_tokens: 6, total_tokens: 14 } } })}\n\n`);
});
await new Promise(done => server.listen(43129, '127.0.0.1', done));
const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExecutable, ['.', `--remote-debugging-port=${port}`], { cwd: resolve('apps/desktop'), env, windowsHide: false, stdio: 'ignore' });
let socket; let id = 0; const pending = new Map();
try {
  let target; for (let i = 0; i < 100; i++) { try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch {} await delay(100); }
  assert.ok(target); socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(done => socket.addEventListener('open', done, { once: true }));
  socket.addEventListener('message', e => { const m = JSON.parse(String(e.data)); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p?.reject(new Error(m.error.message)) : p?.resolve(m.result); } });
  const send = (method, params = {}) => new Promise((done, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timeout: ${method}`)); }, 20_000); pending.set(key, { resolve: value => { clearTimeout(timer); done(value); }, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  await send('Page.enable'); await delay(300);
  await evaluate(`window.mingshen.readPolicy('terms')`); await delay(5200);
  await evaluate(`window.mingshen.acceptPolicies({terms:true,privacy:true,disclaimer:true})`);
  await send('Page.reload'); await delay(600);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Notification fixture',baseUrl:'http://127.0.0.1:43129/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-fixture-only',keyLabel:'fixture',neverReveal:true});const m=await window.mingshen.createModel({providerId:p.id,modelId:'notification-fixture',displayName:'Notification fixture',contextWindow:16000,maxOutputTokens:1024,inputModalities:['text'],toolCalls:false,parallelToolCalls:false,reasoningLevels:['none'],anthropicNoneBehavior:'disabled'});window.__a=await window.mingshen.createSession({title:'当前查看的会话',providerId:p.id,modelId:m.models[0].id,workspacePath:null,reasoningLevel:null,permissionMode:'request_approval'});window.__b=await window.mingshen.createSession({title:'通知功能测试',providerId:p.id,modelId:m.models[0].id,workspacePath:null,reasoningLevel:null,permissionMode:'request_approval'});return true})()`);
  const ids = await evaluate(`({a:window.__a.id,b:window.__b.id})`);
  await send('Page.reload'); await delay(600);
  await evaluate(`(()=>{[...document.querySelectorAll('.session-row')].find(b=>b.textContent.includes('当前查看的会话')).click();return true})()`);
  await evaluate(`window.mingshen.setActiveNotificationSession(${JSON.stringify(ids.a)})`);
  await evaluate(`window.mingshen.desktopAction('show')`);
  await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(ids.b)},text:'NOTIFICATION_FIXTURE_FIRST_TURN'})`);
  let state;
  for (let i = 0; i < 100; i++) { state = await evaluate('window.mingshen.getCompletionNotifications()'); if (state.unread.length && state.lastDelivery !== 'pending') break; await delay(100); }
  assert.equal(state.unread.length, 1); assert.equal(state.badgeCount, 1); assert.equal(state.unread[0].sessionId, ids.b);
  assert.equal(state.lastDelivery, 'shown', JSON.stringify(state));
  assert.equal(await evaluate(`Boolean(document.querySelector('.session-row--unread'))`), true);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await mkdir('.impeccable/review', { recursive: true });
  const image = await send('Page.captureScreenshot', { format: 'png' }); await writeFile('.impeccable/review/notification-unread.png', Buffer.from(image.data, 'base64'));
  console.log('NOTIFICATION_READY', JSON.stringify({ port, profile, state, sessionId: ids.b, expectedReply: 'NOTIFY_REPLY_VALIDATED' }));
  if (process.argv.includes('--native') || process.argv.includes('--failure')) {
    const db = new DatabaseSync(resolve(profile, 'mingshen.db'), { readOnly: true });
    const routes = JSON.parse(db.prepare("select value_json from app_settings where key = 'desktop.notificationRoutes'").get().value_json);
    db.close();
    const route = routes.find(r => r.sessionId === ids.b && !r.consumed);
    assert.ok(route);
    const raw = await nativeProbe([]);
    const history = raw ? JSON.parse(raw) : [];
    const notification = (Array.isArray(history) ? history : [history]).find(n => n.xml.includes(route.id));
    assert.ok(notification, 'Native notification must exist in Windows history');
    assert.match(notification.xml, /input id="reply"/);
    assert.match(notification.xml, /hint-inputId="reply"/);
    const replyText = process.argv.includes('--failure') ? 'NOTIFY_REPLY_PRESERVED' : 'NOTIFY_REPLY_VALIDATED';
    if (process.argv.includes('--failure')) {
      responseDelay = 4500;
      await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(ids.b)},text:'BUSY_CONVERSATION_FIXTURE'})`);
    }
    await nativeProbe(['-Tag', route.id, '-Reply', replyText, '-Activator', '{6094CEE7-98E1-4D01-97A6-68A726EBA51E}']);
    if (process.argv.includes('--failure')) {
      let failed;
      for (let i = 0; i < 80; i++) {
        failed = await evaluate('window.mingshen.getCompletionNotifications()');
        if (failed.replyDraft) break;
        await delay(100);
      }
      assert.equal(failed.replyDraft?.text, replyText);
      assert.equal(await evaluate(`document.querySelector('.composer textarea').value`), replyText);
      await send('Page.reload'); await delay(600);
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      assert.equal(await evaluate(`document.querySelector('.composer textarea').value`), replyText);
      await delay(4600);
      assert.equal(await evaluate(`document.querySelector('.composer textarea').value`), replyText, 'State updates must not duplicate the recovered draft');
      assert.ok(await evaluate(`document.querySelector('.composer-error')?.textContent`));
      responseDelay = 700;
      await evaluate(`document.querySelector('.send-button').click()`);
      for (let i = 0; i < 80; i++) {
        if (!(await evaluate('window.mingshen.getCompletionNotifications()')).replyDraft) break;
        await delay(100);
      }
      assert.equal((await evaluate('window.mingshen.getCompletionNotifications()')).replyDraft, null);
      assert.equal(await evaluate(`document.querySelector('.composer textarea').value`), '');
      const messages = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(ids.b)})`);
      assert.ok(messages.some(m => m.role === 'user' && m.parts.some(p => p.type === 'text' && p.text === replyText)));
      console.log('PASS: Failed native reply persisted, restored once after renderer reload, and cleared after manual send.');
    } else {
    let accepted = false;
    for (let i = 0; i < 100; i++) {
      const messages = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(ids.b)})`);
      if (messages.some(m => m.role === 'user' && m.parts.some(p => p.type === 'text' && p.text === 'NOTIFY_REPLY_VALIDATED'))) { accepted = true; break; }
      await delay(100);
    }
    assert.equal(accepted, true, 'COM quick reply must reach its original conversation');
    for (let i = 0; i < 100 && requests.length < 2; i++) await delay(100);
    assert.ok(requests.length >= 2, 'Quick reply must trigger the original model');
    await delay(1200);
    assert.equal((await evaluate('window.mingshen.getCompletionNotifications()')).badgeCount, 0);
    console.log('PASS: Native Windows toast XML, COM quick reply, original model continuation and cleared badge.');
    }
  } else if (process.argv.includes('--interactive')) {
    let replied = false;
    for (let i = 0; i < 2400; i++) {
      const messages = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(ids.b)})`);
      if (messages.some(m => m.role === 'user' && m.parts.some(p => p.type === 'text' && p.text === 'NOTIFY_REPLY_VALIDATED'))) { replied = true; break; }
      await delay(100);
    }
    assert.equal(replied, true, 'Native quick reply must reach its original conversation');
    await delay(1200);
    const final = await evaluate('window.mingshen.getCompletionNotifications()');
    assert.equal(final.badgeCount, 0);
    assert.ok(requests.length >= 2);
    console.log('PASS: Native Windows quick reply reached original conversation and triggered the local model. Badge cleared.');
  } else {
    await evaluate(`window.mingshen.desktopAction('show')`);
    await evaluate(`(()=>{[...document.querySelectorAll('.session-row')].find(b=>b.textContent.includes('通知功能测试')).click();return true})()`);
    await delay(300); assert.equal((await evaluate('window.mingshen.getCompletionNotifications()')).badgeCount, 0);
    console.log('PASS: Completion marker, numeric badge and native notification delivery.', JSON.stringify(state));
  }
  await evaluate(`(()=>{document.querySelector('.topbar-actions button[aria-label="打开设置"]').click();return true})()`);
  await delay(300);
  assert.equal(await evaluate(`document.querySelector('.settings-workspace').textContent.includes('任务与交互通知')`), true);
  await evaluate(`(()=>{[...document.querySelectorAll('.settings-block')].find(s=>s.textContent.includes('任务与交互通知')).scrollIntoView({block:'center'});return true})()`);
  const settingsImage = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile('.impeccable/review/notification-settings-zh.png', Buffer.from(settingsImage.data, 'base64'));
  await evaluate(`(()=>{document.querySelector('.desktop-caption button[aria-label="中文 / English"]').click();return true})()`);
  await delay(300);
  assert.equal(await evaluate(`document.querySelector('.settings-workspace').textContent.includes('Task and interaction notifications')`), true);
  const englishImage = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile('.impeccable/review/notification-settings-en.png', Buffer.from(englishImage.data, 'base64'));
  console.log('PASS: Chinese and English completion notification settings.');
  await evaluate(`window.dispatchEvent(new CustomEvent('mingshen:document',{detail:'manual'}))`);
  await delay(300);
  assert.equal(await evaluate(`document.body.textContent.includes('Task completion notifications and quick replies')`), true);
  console.log('PASS: Updated notification guide is embedded in the application.');
  if (process.argv.includes('--review')) {
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    console.log('REVIEW_READY');
    await delay(45000);
  }
  await evaluate(`window.mingshen.desktopAction('quit')`).catch(() => undefined);
  await Promise.race([new Promise(done => child.once('exit', done)), delay(2500)]);
} finally { socket?.close(); child.kill(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
