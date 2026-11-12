import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { createServer } from 'node:http';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-v128-'));
const profile = resolve(temporary, 'profile'), project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review');
const passed = [], errors = [], timings = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, main, renderer;
const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  if ((body.instructions || '').includes('会话标题生成')) event({ type: 'response.output_text.delta', delta: 'Workspace UI verification' });
  else for (let i = 0; i < 24 && !response.destroyed; i++) {
    event({ type: 'response.reasoning_summary_text.delta', delta: `Verification step ${i}.\n` });
    event({ type: 'response.output_text.delta', delta: `Output ${i}: layout state stays stable during streaming.\n\n` });
    await sleep(90);
  }
  if (!response.destroyed) { event({ type: 'response.completed', response: { usage: { input_tokens: 2400, output_tokens: 300, total_tokens: 2700 } } }); response.end(); }
});
async function connect(port) {
  let target;
  for (let i = 0; i < 140; i++) { try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.webSocketDebuggerUrl); if (target) break; } catch {} await sleep(100); }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let next = 0;
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => { const value = JSON.parse(String(event.data)); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text); const p = pending.get(value.id); if (!p) return; pending.delete(value.id); clearTimeout(p.timer); value.error ? p.reject(new Error(value.error.message)) : p.done(value.result); });
  const send = (method, params = {}) => new Promise((done, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 30000); pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  return { send, evaluate, close: () => socket.close() };
}
async function until(expression, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await renderer.evaluate(expression)) return; await sleep(60); } throw new Error(`Timed out: ${expression}`); }
async function click(selector, text) { const target = text ? `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})` : `document.querySelector(${JSON.stringify(selector)})`; await until(`Boolean(${target})&& !(${target}).disabled`); await renderer.evaluate(`${target}.click();true`); }
async function shot(name) { await sleep(250); const image = await renderer.send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); }
async function mode(value) { const start = Date.now(); await click(`.app-topbar [data-layout="${value}"]`); await until(`document.querySelector('.app-shell').dataset.layout===${JSON.stringify(value)}`); timings.push(Date.now() - start); }
async function viewport(width, height, scale = 1) { await renderer.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }); await renderer.evaluate('window.dispatchEvent(new Event("resize"));true'); await sleep(250); }
async function assertBounds() {
  const result = await renderer.evaluate(`(()=>{const box=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}:null};return{width:innerWidth,height:innerHeight,title:box('.desktop-caption'),chat:box('.chat-view'),composer:box('.composer'),caption:box('.desktop-caption__actions'),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.equal(result.title.h, 48); assert.equal(result.overflow, false, JSON.stringify(result));
  assert.ok(result.composer.x >= 0 && result.composer.right <= result.width + 1 && result.composer.bottom <= result.height + 1, JSON.stringify(result));
  assert.ok(result.chat.w >= 480 || result.width < 700, JSON.stringify(result));
  assert.equal(await renderer.evaluate('(()=>{const mark=document.querySelector(".conversation-empty__mark"),scroll=document.querySelector(".conversation-scroll");return !mark||!scroll||mark.getBoundingClientRect().top>=scroll.getBoundingClientRect().top-1})()'),true,'Empty session brand mark was scrolled outside the viewport');
  return result;
}
try {
  await mkdir(project, { recursive: true }); await mkdir(screenshots, { recursive: true });
  await writeFile(resolve(project, 'evidence.txt'), 'Evidence for stable editor drafts.\n');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9382', '.', '--remote-debugging-port=9381'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9382); await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  renderer = await connect(9381); await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))'); await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用'); await until('!document.querySelector(".policy-dialog")');
  const fixture = await renderer.evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Workbench fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-ui-fixture',keyLabel:'Fixture',neverReveal:true});const m=await window.mingshen.createModel({providerId:p.id,modelId:'ui-model',displayName:'Workbench model',contextWindow:128000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['none','low','high'],anthropicNoneBehavior:'disabled'});for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);const session=await window.mingshen.createSession({title:'1.2.8 工作区验收',workspacePath:${JSON.stringify(project)},providerId:p.id,modelId:m.models[0].id,permissionMode:'full_access',reasoningLevel:null});return{sessionId:session.id,providerId:p.id}})()`);
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer textarea"))'); await viewport(1440, 900);
  assert.equal(await renderer.evaluate('document.querySelectorAll(".chat-controlbar").length'), 0);
  assert.equal(await renderer.evaluate('document.querySelectorAll(".chat-model-picker").length'), 1);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".task-workbench"))'), false);
  await assertBounds(); passed.push('Single 48px titlebar, unique composer model/Agent controls and hidden empty task band');
  await renderer.evaluate('window.__composer=document.querySelector(".composer textarea");window.__composer.focus();true');
  await renderer.send('Input.insertText', { text: '保持中文草稿与布局状态' });
  for (const layout of ['code', 'agents', 'chat']) { await mode(layout); assert.equal(await renderer.evaluate('document.querySelector(".composer textarea")===window.__composer&&window.__composer.value==="保持中文草稿与布局状态"'), true); await assertBounds(); }
  passed.push('Three layouts keep the same composer element and Chinese draft without remounting');
  await mode('code');
  await renderer.evaluate(`document.querySelector('.workspace-tabs [role=tab][aria-selected=true]')?.click();true`);
  await until('Boolean(document.querySelector(".tree-row"))'); await click('.tree-row'); await until('Boolean(document.querySelector(".editor-textarea"))');
  await renderer.evaluate('window.__editor=document.querySelector(".editor-textarea");window.__editor.focus();true'); await renderer.send('Input.insertText', { text: 'Unsaved change. ' });
  for (const layout of ['chat', 'agents', 'code']) await mode(layout);
  assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea")===window.__editor&&window.__editor.value.includes("Unsaved change.")'), true);
  passed.push('Inspector editor keeps unsaved content across hide/show and all layout changes');
  const splitter = await renderer.evaluate('(()=>{const r=document.querySelector(".panel-resize--right").getBoundingClientRect();return{x:r.x+2,y:r.y+100}})()');
  await renderer.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...splitter, button: 'left', clickCount: 1 });
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: splitter.x - 36, y: splitter.y, button: 'left', buttons: 1 });
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: splitter.x - 36, y: splitter.y, button: 'left', clickCount: 1 });
  await until('window.mingshen.getUiPreferences().then(p=>Object.values(p.projects).some(x=>x.inspectorWidth===496))');
  passed.push('Real pointer resizing persists the project inspector width through guarded IPC');
  await click('.app-topbar button[aria-label="打开设置"]'); await until('Boolean(document.querySelector(".settings-workspace"))');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".settings-nav__group").length'), 6);
  await renderer.evaluate('document.querySelector(".settings-search input").focus();true'); await renderer.send('Input.insertText', { text: 'MCP' });
  assert.equal(await renderer.evaluate('document.querySelectorAll(".settings-nav__item").length'), 1);
  await click('.settings-nav__item', 'MCP Servers');
  await click('.settings-content__header button');
  await click('.app-topbar button[aria-label="打开设置"]'); await click('.settings-nav__item', '供应商与模型');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".provider-detail-tabs [role=tab]").length'), 3);
  await click('.provider-detail-tabs button', 'API Keys'); await click('.key-row button[title="编辑 API Key"]');
  await renderer.evaluate('window.__input=document.querySelector(".key-edit-form input");window.__input.focus();window.__input.select();true');
  for (const text of ['中','文','标','签','-','s','t','a','b','l','e']) { await renderer.send('Input.insertText', { text }); await sleep(300); assert.equal(await renderer.evaluate('document.activeElement===window.__input'), true); }
  await shot('v128-provider-zh-night'); passed.push('Six settings groups, search direct navigation, provider tabs and real Chinese typing across background refresh');
  await click('.settings-content__header button');
  for (const locale of ['zh-CN', 'en']) for (const theme of ['night', 'day']) {
    await renderer.evaluate(`window.mingshen.desktopAction('locale',${JSON.stringify(locale)}).then(()=>{localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});localStorage.setItem('mingshen.theme',${JSON.stringify(theme)})})`);
    await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer textarea"))');
    for (const layout of ['chat', 'code', 'agents']) {
      await viewport(1440, 900); await mode(layout); await assertBounds(); await shot(`v128-${layout}-${locale}-${theme}`);
      await viewport(1024, 640, 1.25); await assertBounds(); await shot(`v128-${layout}-${locale}-${theme}-compact`);
    }
  }
  passed.push('3 layouts × 2 themes × 2 languages at desktop and compact 125% pixel scale: 24 bounded screenshots');
  for (const [width,height,scale] of [[1366,768,1],[1920,1080,1.5],[2560,1080,2],[800,600,1]]) { await viewport(width,height,scale); await assertBounds(); }
  passed.push('Additional laptop, wide and 200% pixel-scale viewports remain bounded');
  await viewport(1440,900); await mode('agents');
  await renderer.evaluate(`window.mingshen.updatePlan({sessionId:${JSON.stringify(fixture.sessionId)},revision:0,steps:[{id:'step1',content:'Verify workbench state',status:'in_progress',priority:'high'},{id:'step2',content:'Review output',status:'pending',priority:'medium'}]})`);
  await until('document.querySelectorAll(".plan-step").length===2');
  await shot('v128-plan-en-day');
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".task-workbench--docked"))');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".plan-step").length'),2);
  passed.push('Project mode, inspector size and structured plan survive renderer reload');
  await renderer.evaluate(`(async()=>window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),motion:'off'}))()`); await renderer.send('Page.reload'); await until('document.documentElement.dataset.motion==="off"&&Boolean(document.querySelector(".composer"))');
  assert.equal(await renderer.evaluate('getComputedStyle(document.querySelector(".layout-picker button")).transitionDuration'),'0s');
  passed.push('Reduced-motion preference persists and removes UI transitions');
  await renderer.evaluate(`window.mingshen.desktopAction('locale','zh-CN').then(()=>{localStorage.setItem('mingshen.locale','zh-CN');localStorage.setItem('mingshen.theme','night')})`);
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer textarea"))'); await mode('chat');
  await renderer.evaluate(`(async()=>{const state=await window.mingshen.getWorkbench(${JSON.stringify(fixture.sessionId)});await window.mingshen.updatePlan({sessionId:${JSON.stringify(fixture.sessionId)},revision:state.plan.revision,steps:[]})})()`);
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.sessionId)},text:'Stream the local workbench verification.'})`);
  await until('document.querySelectorAll(".message--assistant").length>0||Boolean(document.querySelector(".message--streaming"))');
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(s=>s.status==='idle')`);
  assert.ok(await renderer.evaluate('document.querySelector(".conversation")?.textContent.includes("Output 23")'));
  passed.push('Real local SSE text and reasoning render to completion in the redesigned timeline');
  await click('.app-topbar button[aria-label="打开设置"]');
  for (let i = 0; i < 16; i++) {
    await renderer.evaluate(`document.querySelectorAll('.settings-nav__item')[${i}].click();true`);
    await sleep(180);
    assert.equal(await renderer.evaluate('document.querySelector(".settings-content").scrollWidth>document.querySelector(".settings-content").clientWidth+1'),false);
    await shot(`v128-settings-${i}-zh-night`);
  }
  await click('.settings-nav__item','MCP Servers'); await click('.connection-select');
  await until('Boolean(document.querySelector(".mcp-card--detail"))'); await shot('v128-mcp-detail-zh-night');
  await click('.settings-nav__item','定时任务'); await click('.scheduled-settings button','新建任务');
  await until('Boolean(document.querySelector(".schedule-form"))'); await shot('v128-schedule-form-zh-night');
  await click('.settings-content__header button');
  passed.push('All 16 settings pages and MCP detail/schedule creation fit the continuous settings workspace');
  await main.evaluate(`(()=>{const db=new(process.getBuiltinModule('node:sqlite').DatabaseSync)(${JSON.stringify(resolve(profile,'mingshen.db'))});
    const base=db.prepare('select * from sessions where id=?').get(${JSON.stringify(fixture.sessionId)}),columns=Object.keys(base),insert=db.prepare('insert into sessions('+columns.join(',')+') values('+columns.map(()=>'?').join(',')+')');
    db.exec('begin');for(let i=0;i<10000;i++){const row={...base,id:'perf-session-'+i,title:'Performance indexed session '+i,workspace_path:${JSON.stringify(project)},last_opened_at:'2020-01-01T00:00:00.000Z',updated_at:'2020-01-01T00:00:00.000Z',parent_session_id:null};insert.run(...columns.map(k=>row[k]));}
    for(let i=0;i<8;i++){const row={...base,id:'perf-worker-'+i,title:'Fixture worker '+i,parent_session_id:base.id,status:'interrupted',last_opened_at:'2020-01-01T00:00:00.000Z'};insert.run(...columns.map(k=>row[k]));}
    const event=db.prepare('insert into trajectories(id,session_id,run_id,sequence,type,summary,payload_json,created_at) values(?,?,?,?,?,?,?,?)');
    event.run('perf-start',base.id,'perf-review',0,'run_started','Fixture run started','{}',new Date().toISOString());
    for(let i=0;i<1000;i++){const activity={id:'perf-activity-'+i,sessionId:base.id,runId:'perf-review',kind:'command',status:'completed',title:'Fixture check '+i,detail:'Verified local fixture output '+i};event.run('perf-event-'+i,base.id,'perf-review',i+1,'activity',activity.title,JSON.stringify({type:'activity',activity}),new Date().toISOString());}
    event.run('perf-end',base.id,'perf-review',1001,'run_completed','Fixture run completed','{}',new Date().toISOString());
    const summary={runId:'perf-review',toolCount:1000,fileChanges:[{path:'evidence.txt',changeType:'modified',additions:1,deletions:1,diff:{truncated:false,lines:[{type:'removed',oldLine:1,newLine:null,text:'Evidence'},{type:'added',oldLine:null,newLine:1,text:'Verified evidence'}]}}],durationMs:1200};
    const seq=db.prepare('select max(seq) as seq from messages where session_id=?').get(base.id).seq||0;
    db.prepare('insert into messages(id,session_id,seq,role,parts_json,created_at) values(?,?,?,?,?,?)').run('perf-summary',base.id,seq+1,'assistant',JSON.stringify([{type:'run_summary',summary}]),new Date().toISOString());
    db.exec('commit');db.close();return true})()`);
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer"))');
  const perf=await renderer.evaluate(`(async()=>{const times=[];for(let i=0;i<20;i++){const t=performance.now();const page=await window.mingshen.listSessionPage({limit:100,query:'Performance indexed session'});if(page.total!==10000)throw new Error('Missing fixture records: '+page.total);times.push(performance.now()-t);}return{times,rows:document.querySelectorAll('.session-row').length}})()`);
  assert.ok(perf.rows<150,JSON.stringify(perf));
  await mode('agents'); await click('.task-workbench__toolbar button','Agent 任务树');
  await until('document.querySelectorAll(".agent-task-tree__child").length===8'); await shot('v128-eight-workers-zh-night');
  await mode('code'); await click('.workspace-tabs button','审查');
  await until('document.querySelectorAll(".review-file").length===1'); await click('.review-file__toggle');
  await until('Boolean(document.querySelector(".activity-diff"))');
  await until('document.querySelectorAll(".review-checks details").length===100');
  for (let i=0;i<9;i++) await click('.review-checks button','显示更多步骤');
  await until('document.querySelectorAll(".review-checks details").length===1000');
  await shot('v128-review-zh-night');
  passed.push('10,000 indexed sessions stay paged; eight child tasks render; saved diff and 1,000 command records restore after reload');
  await click('.app-topbar button[aria-label="打开设置"]'); await click('.settings-nav__item','快照与轨迹');
  await until('document.querySelectorAll(".trajectory-row").length>0');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".trajectory-row ol li").length'),0);
  await renderer.evaluate('document.querySelector(".trajectory-row").open=true;true');
  await until('document.querySelectorAll(".trajectory-row ol li").length===100'); await click('.trajectory-row button','显示更多步骤');
  await until('document.querySelectorAll(".trajectory-row ol li").length===200');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".trajectory-steps span").length'),0);
  await renderer.evaluate('document.querySelector(".trajectory-summary").open=true;true');
  await until('document.querySelectorAll(".trajectory-steps span").length===200');
  await renderer.evaluate('document.querySelector(".trajectory-summary").open=false;true');
  await until('document.querySelectorAll(".trajectory-steps span").length===0');
  await shot('v128-history-1000-events-zh-night');
  passed.push('Long trajectory events and optional summaries mount on demand in bounded batches of 100');
  await click('.settings-content__header button');
  await click('.desktop-caption button[aria-label="使用手册与更新日志"]');
  await until('document.querySelectorAll(".document-reader__contents button").length>5');
  await renderer.evaluate('document.querySelectorAll(".document-reader__contents button")[4].click();true');
  assert.ok(await renderer.evaluate('document.querySelector(".policy-dialog__body").scrollTop>0'));
  await shot('v128-guide-contents-zh-night');
  await click('.policy-dialog__navigation button','更新日志');
  await until('document.querySelector(".document-reader__contents")?.textContent.includes("1.2.8")');
  await shot('v128-changelog-contents-zh-night');
  passed.push('Offline manual/changelog chapter navigation scrolls within the document reader');
  await click('.policy-dialog header button');
  console.log(JSON.stringify({catalogPerformanceMs:perf.times,p95Ms:[...perf.times].sort((a,b)=>a-b)[18],sessionDomRows:perf.rows}));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ version:'1.2.8',passed,screenshots,layoutFeedbackMs:timings },null,2));
} catch (cause) {
  console.error(JSON.stringify({ passed,errors,body:await renderer?.evaluate('document.body.innerText').catch(()=>null) },null,2));
  if(renderer) await shot('v128-failure').catch(()=>{}); throw cause;
} finally {
  if(child) { const done=new Promise(resolve=>child.once('exit',resolve)); await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(()=>{}); renderer?.close();main?.close();await Promise.race([done,sleep(7000)]);if(child.exitCode===null){child.kill();await done;} }
  await new Promise(done=>server.close(done));
  if(!temporary.startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe cleanup'); await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
