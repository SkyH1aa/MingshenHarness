import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-agent-questions-'));
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const calls = new Map();
const requests = [];
let child;
let renderer;
let main;
const options = Array.from({ length: 4 }, (_, n) => ({ label: `Option ${n + 1}`, description: `Result ${n + 1}: ${n === 0 ? '保留现有内容并验证结果。' : 'Choose this independent outcome.'}` }));
const question = (id = 'choice', multiple = false, choices = options) => ({ id, header: '工作范围 / Scope', question: `Which result for ${id}?`, multi_select: multiple, options: choices });
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const protocol = request.url.endsWith('/messages') ? 'anthropic' : request.url.endsWith('/chat/completions') ? 'chat' : 'responses';
  const prompt = String(body.instructions || body.system || body.messages?.find(item => item.role === 'system')?.content || '');
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const finish = tool => {
    if (protocol === 'responses') event({ type: 'response.completed', response: { usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 } } });
    else if (protocol === 'chat') { event({ choices: [{ delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 } }); response.write('data: [DONE]\n\n'); }
    else { event({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 20 } }); event({ type: 'message_stop' }); }
    response.end();
  };
  if (protocol === 'anthropic') event({ type: 'message_start', message: { usage: { input_tokens: 40, output_tokens: 0 } } });
  const output = text => {
    if (protocol === 'responses') event({ type: 'response.output_text.delta', delta: text });
    else if (protocol === 'chat') event({ choices: [{ delta: { content: text }, finish_reason: null }] });
    else { event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }); event({ type: 'content_block_stop', index: 0 }); }
  };
  if (prompt.trim().startsWith('# 会话标题生成')) { output('Question test'); finish(false); return; }
  const scenario = [...JSON.stringify(body.input || body.messages).matchAll(/SCENARIO:([a-z]+)/g)].at(-1)?.[1] || 'default';
  const round = (calls.get(scenario) || 0) + 1;
  calls.set(scenario, round); requests.push({ scenario, round, protocol, body });
  const tool = body.tools.find(item => (item.function?.name || item.name) === 'ask_user');
  assert.ok(tool, `${scenario}: missing ask_user tool`);
  assert.match(prompt, /应主动调用它向用户澄清/);
  const schema = tool.function?.parameters || tool.parameters || tool.input_schema;
  assert.equal(schema.properties.questions.maxItems, 3);
  assert.equal(schema.properties.questions.items.properties.options.maxItems, 4);
  if (round === 1 || (scenario === 'invalid' && round === 2)) {
    const args = scenario === 'text' ? { question: 'Please describe the requested output.', header: 'Free text', options: [] }
      : scenario === 'batch' ? { questions: [question('format', false, options.slice(0, 2)), question('checks', true), question('details', false, [])] }
      : scenario === 'invalid' && round === 1 ? { questions: [question('invalid', false, [...options, { label: 'Fifth', description: 'This must be rejected.' }])] }
      : { questions: [question(scenario, ['multi', 'anthropic'].includes(scenario))] };
    const argsText = JSON.stringify(args);
    if (protocol === 'responses') {
      event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: `${scenario}-${round}`, name: 'ask_user', arguments: '' } });
      event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: argsText });
    } else if (protocol === 'chat') event({ choices: [{ delta: { tool_calls: [{ index: 0, id: `${scenario}-${round}`, type: 'function', function: { name: 'ask_user', arguments: argsText } }] }, finish_reason: null }] });
    else {
      event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `${scenario}-${round}`, name: 'ask_user', input: {} } });
      event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: argsText } }); event({ type: 'content_block_stop', index: 0 });
    }
    finish(true); return;
  }
  output(`Completed ${scenario} after user answer.`); finish(false);
});

async function connect(port) {
  let target;
  for (let n = 0; n < 120; n++) { try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(x => x.json())).find(x => x.webSocketDebuggerUrl); if (target) break; } catch {} await sleep(100); }
  assert.ok(target, `Missing debugger ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let id = 0;
  socket.addEventListener('message', e => { const value = JSON.parse(String(e.data)); const waiter = pending.get(value.id); if (!waiter) return; pending.delete(value.id); clearTimeout(waiter.timer); value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result); });
  const send = (method, params = {}) => new Promise((done, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timeout ${method}`)); }, 30000); pending.set(key, { done, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result.value; };
  return { send, evaluate, close: () => socket.close() };
}

try {
  await mkdir(screenshots, { recursive: true }); await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9362', '.', '--remote-debugging-port=9361'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9362);
  await main.evaluate(`globalThis.__fetch=fetch;globalThis.fetch=(url,opts)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,opts);globalThis.__electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');true`);
  renderer = await connect(9361); const { evaluate, send } = renderer;
  const until = async (expression, timeout = 20000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(70); } throw new Error(`Timed out: ${expression}`); };
  const click = async (selector, text) => until(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>!x.disabled&&x.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true;})()`);
  const select = async value => evaluate(`document.querySelector('.question-option input[value=${JSON.stringify(value)}]').click();true`);
  const typeOther = async text => evaluate(`(()=>{const el=document.querySelector('.question-panel textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const shot = async name => { const value = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(value.data, 'base64')); };
  await until("Boolean(document.querySelector('.policy-consents'))"); await evaluate("document.querySelectorAll('.policy-consents input').forEach(x=>x.click());true"); await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  const fixture = await evaluate(`(async()=>{
    const configs={};for(const protocol of ['openai_responses','openai_chat_completions','anthropic_messages']){
      const p=await window.mingshen.createProvider({name:'Local '+protocol,baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol,authMode:'bearer',apiKey:'local-test-key',keyLabel:'Local',neverReveal:true});
      await window.mingshen.createModel({providerId:p.id,modelId:'question-model',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
      const provider=(await window.mingshen.bootstrap()).providers.find(x=>x.id===p.id);configs[protocol]={providerId:p.id,modelId:provider.models[0].id,workspacePath:null,reasoningLevel:null,permissionMode:'request_approval'};
    }
    const sessions={};for(const name of ['single','multi','batch','text','anthropic','invalid','failure','cancel','plan'])sessions[name]=await window.mingshen.createSession({...configs[name==='text'?'openai_chat_completions':name==='anthropic'?'anthropic_messages':'openai_responses'],title:'Question '+name,...(name==='plan'?{agentProfileId:'plan'}:{})});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    return sessions;
  })()`);
  await send('Page.reload'); await until("Boolean(document.querySelector('.session-group__show-all'))");
  await evaluate("document.querySelector('.session-group__show-all[aria-expanded=false]')?.click();true");
  await until("document.querySelectorAll('.session-row').length===9");
  const start = async scenario => { const session = fixture[scenario]; await click('.session-row__title', session.title); await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(`SCENARIO:${scenario} prepare the requested work and clarify missing details.`)}})`); await until("Boolean(document.querySelector('.question-panel'))"); };
  const finish = async scenario => { await until(`window.mingshen.bootstrap().then(x=>x.sessions.find(s=>s.id===${JSON.stringify(fixture[scenario].id)})?.status==='idle')`); assert.match(JSON.stringify(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture[scenario].id)})`)), /Completed/); };
  const result = scenario => { const all = requests.filter(x => x.scenario === scenario); const body = all.at(-1).body; const messages = body.input || body.messages; const texts = JSON.stringify(messages); assert.match(texts, /answered/); return texts; };

  await start('single');
  assert.equal(await evaluate("document.querySelectorAll('.question-option').length"), 5);
  assert.equal(await evaluate("document.querySelectorAll('.question-option input[type=radio]').length"), 5);
  assert.ok(await evaluate("document.querySelector('.question-panel button[type=submit]').disabled"));
  await sleep(3200); assert.equal(calls.get('single'), 1, 'No model request before user answers');
  await select('Option 1'); await select('Option 3');
  assert.equal(await evaluate("document.querySelectorAll('.question-option input:checked').length"), 1);
  await evaluate("document.querySelector('.question-option input[value=\"Option 3\"]').focus();true");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  await until("document.querySelector('.question-option input:checked')?.value==='Option 2'");
  await select('Option 3');
  assert.match(await evaluate("document.querySelector('.session-row--selected').textContent"), /等待回答/);
  await shot('agent-question-single-zh-night');
  await click('.question-panel button', '提交回答'); await finish('single'); assert.match(result('single'), /Option 3/);
  passed.push('Model receives schema and proactive instructions; 4 title/description choices plus Other render, one radio stays selected and the run waits for a real answer');

  await start('multi'); await select('Option 1'); await select('Option 2'); await select('Option 4'); await select('Option 2'); await select('__other__');
  assert.ok(await evaluate("document.querySelector('.question-panel button[type=submit]').disabled"));
  await typeOther('补充：只检查当前任务，不发布。'); await shot('agent-question-multi-zh-night');
  await click('.question-panel button', '提交回答'); await finish('multi');
  const multi = result('multi'); assert.match(multi, /Option 1/); assert.match(multi, /Option 4/); assert.match(multi, /不发布/);
  passed.push('Multi-select supports checking/unchecking choices plus Other text; structured answers resume the original task');

  await start('batch'); await select('Option 2'); await click('.question-panel button', '下一题');
  await select('Option 1'); await select('Option 3');
  await evaluate("document.querySelector('.question-panel button[aria-label=\"上一题\"]').click();true");
  assert.equal(await evaluate("document.querySelector('.question-option input:checked').value"), 'Option 2');
  await click('.question-panel button', '下一题'); await click('.question-panel button', '下一题'); await typeOther('Audience: first-time users.');
  await click('.question-panel button', '提交回答'); await finish('batch');
  assert.match(result('batch'), /first-time users/); assert.match(result('batch'), /format/); assert.match(result('batch'), /checks/);
  passed.push('Three related questions preserve answers across pages and return by stable id only after all are complete');

  await start('text'); await typeOther('<img src=x onerror="window.__questionXss=true">中文答案');
  assert.equal(await evaluate('window.__questionXss===true'), false);
  await click('.question-panel button', '提交回答'); await finish('text'); assert.match(result('text'), /中文答案/);
  passed.push('Legacy free-text questions and Chat Completions round-trip work; custom text stays inert');

  await start('anthropic'); await select('Option 2'); await select('Option 3'); await click('.question-panel button', '提交回答'); await finish('anthropic'); assert.match(result('anthropic'), /Option 3/);
  passed.push('Anthropic Messages receives the same tool schema and continues with structured multi-select answers');

  await start('invalid'); assert.equal(calls.get('invalid'), 2); assert.equal(await evaluate("document.querySelectorAll('.question-option').length"), 5);
  await select('Option 1'); await click('.question-panel button', '提交回答'); await finish('invalid');
  const invalidMessages = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.invalid.id)})`);
  assert.match(JSON.stringify(invalidMessages), /at most 4/);
  passed.push('A model-generated fifth option is rejected as a tool error; a corrected call works without entering a broken wait');

  await start('failure'); await select('Option 2');
  await main.evaluate("globalThis.__answerHandler=globalThis.__electron.ipcMain._invokeHandlers.get('question:answer');globalThis.__electron.ipcMain._invokeHandlers.set('question:answer',()=>{throw new Error('Fixture answer failure');});true");
  await click('.question-panel button', '提交回答'); await until("document.querySelector('.question-panel .form-error')?.textContent.includes('Fixture answer failure')");
  assert.equal(await evaluate("document.querySelector('.question-option input:checked').value"), 'Option 2');
  assert.equal(await evaluate("document.querySelector('.question-panel button[type=submit]').disabled"), false);
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await shot('agent-question-error-zh-night-compact');
  assert.ok(await evaluate("document.querySelector('.question-panel button[type=submit]').getBoundingClientRect().bottom<=innerHeight"));
  await send('Emulation.clearDeviceMetricsOverride');
  await main.evaluate("globalThis.__electron.ipcMain._invokeHandlers.set('question:answer',globalThis.__answerHandler);true");
  await click('.question-panel button', '提交回答'); await finish('failure');
  passed.push('Submission error preserves selection, shows inline feedback and re-enables retry');

  await start('plan'); await select('__other__'); await typeOther('Use the accessible layout.');
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click();document.documentElement.dataset.theme='day';true");
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false }); await shot('agent-question-plan-en-day-compact');
  const bounds = await evaluate("(()=>{const p=document.querySelector('.question-panel');const b=p.querySelector('button[type=submit]').getBoundingClientRect();return {bottom:b.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,mode:p.querySelector('.question-panel__mode').textContent};})()");
  if(bounds.bottom>bounds.height) console.error(await evaluate("['html','body','#root','.desktop-shell','.desktop-content','.app-shell','.app-body','.session-sidebar','.chat-view','.chat-controlbar','.conversation-viewport','.composer-wrap','.question-panel','.question-panel__body','.composer','.composer__footer'].map(s=>{const el=document.querySelector(s);if(!el)return {s};const r=el.getBoundingClientRect();const c=getComputedStyle(el);return {s,y:r.y,h:r.height,b:r.bottom,rows:c.gridTemplateRows,min:c.minHeight,max:c.maxHeight,display:c.display,overflow:c.overflow};})"));
  assert.ok(bounds.bottom <= bounds.height && !bounds.overflow, JSON.stringify(bounds)); assert.equal(bounds.mode, 'Single choice');
  await evaluate("document.querySelector('.question-panel textarea').focus();true");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13 });
  await finish('plan');
  passed.push('Read-only Plan can ask; English/day compact layout keeps submission visible without changing permissions');

  await start('cancel'); await send('Page.reload'); await until("Boolean(document.querySelector('.question-panel'))");
  await evaluate(`window.mingshen.stopChat(${JSON.stringify(fixture.cancel.id)})`); await until("!document.querySelector('.question-panel')");
  assert.equal(await evaluate('window.mingshen.getQuestionState().then(x=>x.requests.length)'), 0);
  assert.equal(calls.get('cancel'), 1);
  passed.push('Reload restores a pending question; stopping cancels it without inventing an answer or making another model call');
  console.log(JSON.stringify({ passed, calls: Object.fromEntries(calls), screenshots }, null, 2));
  await evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true'); renderer.close(); renderer = null; main.close(); main = null;
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
} finally {
  renderer?.close(); main?.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  server.closeAllConnections(); await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
