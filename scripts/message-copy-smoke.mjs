import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-message-copy-'));
const screenshots = resolve('.impeccable/review');
const currentVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const firstCode = 'const greeting = "你好 & <world>";\n\tconsole.log(greeting);\n';
const secondCode = 'SELECT \'quote\', "double", 1 < 2;\n';
const answer = `## 复制验证\n\n**完整回复**与行内代码 \`inline-only\`。\n\n\`\`\`typescript\n${firstCode}\`\`\`\n\n\`\`\`sql\n${secondCode}\`\`\`\n\n    indented & <text>\n\n\`\`\`\n${'long_line_'.repeat(50)}\n\`\`\`\n\n末尾结论。`;
const passed = [], errors = [];
let child, main, renderer, clipboardSaved = false, streaming = false, requests = 0;
const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if ((body.instructions || '').includes('会话标题生成')) {
    response.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '复制验证' })}\n\ndata: ${JSON.stringify({ type: 'response.completed' })}\n\n`);
    return;
  }
  requests++; streaming = true;
  for (let offset = 0; offset < answer.length && !response.destroyed; offset += 35) {
    response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: answer.slice(offset, offset + 35) })}\n\n`);
    await sleep(100);
  }
  response.end(`data: ${JSON.stringify({ type: 'response.completed' })}\n\n`); streaming = false;
});
async function connect(port) {
  let target;
  for(let i=0;i<150;i++){try{target=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(t=>t.webSocketDebuggerUrl);if(target)break;}catch{}await sleep(80);}
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let next = 0;
  await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);const p=pending.get(value.id);if(!p)return;pending.delete(value.id);clearTimeout(p.timer);value.error?p.reject(new Error(value.error.message)):p.done(value.result);});
  const send=(method,params={})=>new Promise((done,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout ${method}`));},30000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;};
  return { send, evaluate, close:()=>socket.close() };
}
async function until(expression) { const end=Date.now()+30000;while(Date.now()<end){if(await renderer.evaluate(expression))return;await sleep(50);}throw new Error(`Timed out: ${expression}`); }
async function click(selector,text) {
  const element=text?`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`:`document.querySelector(${JSON.stringify(selector)})`;
  await until(`Boolean(${element})&&!(${element}).disabled`); await renderer.evaluate(`${element}.click();true`);
}
async function clipboardText() { return (await main.evaluate('globalThis.__electron.clipboard.readText()')).replaceAll('\r\n','\n'); }
async function expectClipboard(text) {
  for(let i=0;i<100&&(await clipboardText())!==text;i++)await sleep(50);
  assert.equal(await clipboardText(),text);
}
async function shot(name) { await sleep(180);const value=await renderer.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(screenshots,`${name}.png`),Buffer.from(value.data,'base64')); }
try {
  await mkdir(screenshots,{recursive:true});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  execFileSync(process.execPath,[resolve('scripts/prepare-experimental-runtime.cjs')],{windowsHide:true,stdio:'pipe'});
  const env={...process.env,MSH_EXPERIMENTAL:'1',MSH_USER_DATA_DIR:resolve(temporary,'profile'),MSH_DISABLE_AUTO_DEPENDENCIES:'1',MSH_NOTIFICATION_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),['--inspect=9390','.','--remote-debugging-port=9389'],{cwd:resolve('apps/desktop'),env,windowsHide:true,stdio:'ignore'});
  main=await connect(9390);
  await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  await main.evaluate('(async()=>{globalThis.__electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");const{clipboard,ClipboardItem}=globalThis.__electron;globalThis.__clipboardBackup=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));return true})()');clipboardSaved=true;
  renderer=await connect(9389);await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))');await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button','同意并继续');await click('.policy-dialog button','开始使用');await until('!document.querySelector(".policy-dialog")');
  const session=await renderer.evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Copy fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-copy-fixture',keyLabel:'Fixture',neverReveal:true});const provider=await window.mingshen.createModel({providerId:p.id,modelId:'copy',displayName:'Copy fixture',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);return window.mingshen.createSession({title:'复制按钮验证',providerId:p.id,modelId:provider.models[0].id,workspacePath:null,permissionMode:'full_access',reasoningLevel:null})})()`);
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".composer textarea"))');
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:'展示四种代码块，验证复制原文。'})`);
  await until('Boolean(document.querySelector(".message--streaming .markdown-code-toolbar button"))');
  assert.equal(streaming,true);assert.equal(await renderer.evaluate('document.querySelectorAll(".message--streaming .message-actions--assistant").length'),0);
  await click('.message--streaming .markdown-code-toolbar button');
  const current = await renderer.evaluate('document.querySelector(".message--streaming pre code")?.textContent');
  assert.ok(firstCode.startsWith((await clipboardText()).trimEnd()) || current?.startsWith((await clipboardText()).trimEnd()));
  await until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>s.status==='idle')`);
  await until('document.querySelectorAll(".message--assistant .markdown-code-toolbar button").length===4');
  passed.push('Streaming code blocks expose Copy without a full-reply button; updates and finalization preserve valid React/DOM state');
  await main.evaluate('(()=>{const w=globalThis.__electron.BrowserWindow.getAllWindows()[0];w.show();w.focus();return true})()');
  await click('.message-actions--assistant button');await expectClipboard(answer);
  assert.equal(await renderer.evaluate('document.querySelector(".message-actions--assistant button").title'),'已复制');
  await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop=document.querySelector(".conversation-scroll").scrollHeight;true');
  await shot('v129-message-copy-reply');
  passed.push('Completed reply copies exact original Markdown including all code blocks, Chinese and final conclusion; success feedback is visible');
  const blocks=await renderer.evaluate('[...document.querySelectorAll(".message--assistant pre code")].map(e=>e.textContent)');
  assert.equal(blocks[0],firstCode);assert.equal(blocks[1],secondCode);assert.equal(blocks[2],'indented & <text>\n');
  for(let i=0;i<blocks.length;i++) {
    await renderer.evaluate(`document.querySelectorAll('.message--assistant .markdown-code-toolbar button')[${i}].click();true`);
    await expectClipboard(blocks[i]);
  }
  assert.equal(await renderer.evaluate('document.querySelectorAll(".message--assistant .markdown-body p .markdown-code-toolbar").length'),0);
  passed.push('Every fenced, unlabeled and indented block copies only its own code, preserving tabs, newlines, quotes, angle brackets and ampersands; inline code is unchanged');
  await renderer.evaluate('globalThis.__writeText=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=()=>Promise.reject(new Error("Local clipboard fixture failure"));true');
  await click('.message-actions--assistant button');await until('Boolean(document.querySelector(".message-actions--assistant [role=alert]"))');
  assert.equal(await renderer.evaluate('document.querySelector(".message-actions--assistant button").disabled'),false);
  await renderer.evaluate('navigator.clipboard.writeText=globalThis.__writeText;true');await click('.message-actions--assistant button');await expectClipboard(answer);
  await until('!document.querySelector(".message-actions--assistant [role=alert]")');
  passed.push('Clipboard failure stays local with a retryable themed error; retry copies successfully without altering the conversation');
  await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop=0;true');
  await shot('v129-message-copy-zh-night');
  await renderer.evaluate('window.mingshen.desktopAction("locale","en").then(()=>{localStorage.setItem("mingshen.locale","en");localStorage.setItem("mingshen.theme","day")})');
  await renderer.send('Page.reload');await until('document.querySelectorAll(".message--assistant .markdown-code-toolbar button").length===4');
  await renderer.send('Emulation.setDeviceMetricsOverride',{width:1040,height:680,deviceScaleFactor:1,mobile:false});
  const button='.message--assistant .markdown-code-toolbar button';
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-label')`),'Copy code');
  assert.equal(await renderer.evaluate('document.querySelector(".message-actions--assistant button").getAttribute("aria-label")'),'Copy response');
  await renderer.evaluate(`document.querySelector(${JSON.stringify(button)}).focus();true`);
  await renderer.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await renderer.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await expectClipboard(firstCode);
  await until('document.querySelector(".markdown-code-toolbar button").title==="Copied"');
  assert.ok(await renderer.evaluate('(()=>{const e=document.querySelector(".markdown-code-toolbar [role=status]");return e.classList.contains("visually-hidden")&&e.getBoundingClientRect().width<=1})()'));
  assert.ok(await renderer.evaluate('[...document.querySelectorAll(".message--assistant .markdown-code-block")].every(e=>e.getBoundingClientRect().right<=innerWidth)'));
  await shot('v129-message-copy-en-day');
  passed.push('Reload preserves copy controls; English day compact layout and keyboard Enter work; long code scrolls without pushing controls outside the viewport');
  assert.deepEqual(errors,[]);assert.equal(requests,1);
  console.log(JSON.stringify({version:currentVersion,passed,requests,screenshots},null,2));
} catch(cause) {
  console.error(JSON.stringify({passed,errors,body:await renderer?.evaluate('document.body.innerText').catch(()=>null)},null,2));
  if(renderer)await shot('v129-message-copy-failure').catch(()=>{});throw cause;
} finally {
  if(main&&clipboardSaved)await main.evaluate('globalThis.__electron.clipboard.write(globalThis.__clipboardBackup)').catch(error=>console.error('Clipboard restore failed',String(error)));
  if(child){const ended=new Promise(done=>child.once('exit',done));await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(()=>{});renderer?.close();main?.close();await Promise.race([ended,sleep(7000)]);if(child.exitCode===null){child.kill();await ended;}}
  await new Promise(done=>server.close(done));assert.ok(temporary.startsWith(resolve(tmpdir())+sep));await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
