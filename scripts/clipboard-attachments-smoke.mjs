import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-clipboard-'));
const screenshots = resolve('.impeccable/review');
const currentVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const errors = [], requests = [], passed = [];
let child, main, renderer, clipboardSaved = false;
const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (!(body.instructions || '').includes('会话标题生成')) requests.push(body);
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Image received.' })}\n\ndata: ${JSON.stringify({ type: 'response.completed' })}\n\n`);
});
async function connect(port) {
  let target;
  for(let i=0;i<150;i++){try{target=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(t=>t.webSocketDebuggerUrl);if(target)break;}catch{}await sleep(80);}
  assert.ok(target, `No debugger on ${port}`);
  const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let next=0;
  await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);const p=pending.get(value.id);if(!p)return;pending.delete(value.id);clearTimeout(p.timer);value.error?p.reject(new Error(value.error.message)):p.done(value.result);});
  const send=(method,params={})=>new Promise((done,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout ${method}`));},30000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;};
  return { send, evaluate, close:()=>socket.close() };
}
async function until(expression) { const end=Date.now()+30000;while(Date.now()<end){if(await renderer.evaluate(expression))return;await sleep(60);}throw new Error(`Timed out: ${expression}`); }
async function click(selector, text) {
  const element=text?`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`:`document.querySelector(${JSON.stringify(selector)})`;
  await until(`Boolean(${element})&&!(${element}).disabled`);
  await renderer.evaluate(`${element}.click();true`);
}
async function key(key, code, windowsVirtualKeyCode, modifiers=0) {
  await renderer.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,modifiers,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
  await renderer.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode,modifiers});
}
async function clipboardImage() {
  const png=await readFile(resolve('apps/desktop/build/icon.png'));
  await main.evaluate(`(async()=>{const{clipboard,ClipboardItem}=globalThis.__electron;clipboard.clear();await clipboard.write([new ClipboardItem({'image/png':new Blob([Buffer.from(${JSON.stringify(png.toString('base64'))},'base64')],{type:'image/png'})})]);return true})()`);
}
async function clipboardText(text) { await main.evaluate(`(async()=>{const{clipboard}=globalThis.__electron;clipboard.clear();await clipboard.writeText(${JSON.stringify(text)});return true})()`); }
async function focus() {
  await main.evaluate("(()=>{const w=globalThis.__electron.BrowserWindow.getAllWindows()[0];w.show();w.focus();return true})()");
  await sleep(80);
  await renderer.evaluate('document.querySelector(".composer textarea").focus();true');
}
async function paste() { await focus();await key('v','KeyV',86,2); }
async function rightClick(selection=false) {
  await focus();
  const point=await renderer.evaluate(`(()=>{const r=document.querySelector(".composer textarea").getBoundingClientRect();return{x:r.x+${selection?'12':'r.width-16'},y:r.y+${selection?'12':'r.height-8'}}})()`);
  await renderer.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'right',clickCount:1});
  await renderer.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'right',clickCount:1});
  await until('Boolean(document.querySelector(".composer-edit-menu"))');
}
async function shot(name) {
  await sleep(180);const value=await renderer.send('Page.captureScreenshot',{format:'png'});
  await writeFile(resolve(screenshots,`${name}.png`),Buffer.from(value.data,'base64'));
}
try {
  await mkdir(screenshots,{recursive:true});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  execFileSync(process.execPath,[resolve('scripts/prepare-experimental-runtime.cjs')],{windowsHide:true,stdio:'pipe'});
  const env={...process.env,MSH_EXPERIMENTAL:'1',MSH_USER_DATA_DIR:resolve(temporary,'profile'),MSH_DISABLE_AUTO_DEPENDENCIES:'1',MSH_NOTIFICATION_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),['--inspect=9388','.','--remote-debugging-port=9387'],{cwd:resolve('apps/desktop'),env,windowsHide:true,stdio:'ignore'});
  main=await connect(9388);
  await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  await main.evaluate('(async()=>{globalThis.__electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");const{clipboard,ClipboardItem}=globalThis.__electron;globalThis.__clipboardBackup=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));return true})()');clipboardSaved=true;
  renderer=await connect(9387);await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button','同意并继续');await click('.policy-dialog button','开始使用');await until('!document.querySelector(".policy-dialog")');
  const fixture=await renderer.evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Clipboard fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-clipboard-fixture',keyLabel:'Fixture',neverReveal:true});const provider=await window.mingshen.createModel({providerId:p.id,modelId:'vision',displayName:'Vision',contextWindow:128000,maxOutputTokens:1024,inputModalities:['text','image'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});const session=await window.mingshen.createSession({title:'Clipboard attachments',providerId:p.id,modelId:provider.models[0].id,workspacePath:null,permissionMode:'full_access',reasoningLevel:null});for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);return{sessionId:session.id,providerId:p.id,modelId:provider.models[0].id}})()`);
  const sid=JSON.stringify(fixture.sessionId);
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".composer textarea"))');
  await clipboardText('Clipboard text 中文');await paste();await until('document.querySelector(".composer textarea").value==="Clipboard text 中文"');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".draft-attachment").length'),0);
  passed.push('Real Ctrl+V preserves plain text and does not create an attachment');
  await clipboardImage();await paste();await until('document.querySelectorAll(".draft-attachment").length===1');
  assert.equal(await renderer.evaluate('document.querySelector(".composer textarea").value'),'Clipboard text 中文');
  await paste();await until('document.querySelectorAll(".draft-attachment").length===2');
  assert.equal(new Set(await renderer.evaluate('[...document.querySelectorAll(".draft-attachment strong")].map(e=>e.textContent)')).size,2);
  passed.push('Real Windows clipboard image pastes with Ctrl+V, retains text and supports repeated distinct image attachments');
  await rightClick();await shot('v129-clipboard-menu-zh-night');await click('.composer-edit-menu button','粘贴');await until('document.querySelectorAll(".draft-attachment").length===3');
  assert.equal(await renderer.evaluate('document.activeElement===document.querySelector(".composer textarea")'),true);
  passed.push('Real right-click themed Paste uses the same image path and restores composer focus');
  await click('.draft-attachment button');await until('document.querySelectorAll(".draft-attachment").length===2');
  await click('.send-button');
  for(let i=0;i<300&&!requests.length;i++)await sleep(50);
  await until(`window.mingshen.getSession(${sid}).then(s=>s.status==='idle')`);
  assert.equal(requests.length,1);const content=requests[0].input.find(m=>m.role==='user').content;
  assert.equal(content.filter(p=>p.type==='input_image').length,2);assert.ok(content.some(p=>p.type==='input_text'&&p.text.includes('Clipboard text 中文')));
  const messages=await renderer.evaluate(`window.mingshen.getSessionMessages(${sid})`);
  assert.equal(messages.find(m=>m.role==='user').parts.filter(p=>p.type==='attachment').length,2);
  await until('document.querySelectorAll(".draft-attachment").length===0');
  passed.push('Remove and Send work; two image payloads reach the local model and saved message exactly once');
  await clipboardText('right menu text');await rightClick();await click('.composer-edit-menu button','粘贴');await until('document.querySelector(".composer textarea").value==="right menu text"');
  await renderer.evaluate('document.querySelector(".composer textarea").setSelectionRange(0,5);true');await rightClick(true);await click('.composer-edit-menu button','复制');
  for(let i=0;i<100&&(await main.evaluate('globalThis.__electron.clipboard.readText()'))!=='right';i++)await sleep(50);
  assert.equal(await main.evaluate('globalThis.__electron.clipboard.readText()'),'right');
  await rightClick(true);await click('.composer-edit-menu button','剪切');await until('document.querySelector(".composer textarea").value===" menu text"');
  await rightClick();await click('.composer-edit-menu button','全选');
  assert.deepEqual(await renderer.evaluate('(()=>{const t=document.querySelector(".composer textarea");return[t.selectionStart,t.selectionEnd]})()'),[0,10]);
  passed.push('Right-click text Paste, Copy, Cut and Select all preserve native editing and selection');
  await rightClick();await key('Escape','Escape',27);await until('!document.querySelector(".composer-edit-menu")');
  assert.equal(await renderer.evaluate('document.activeElement===document.querySelector(".composer textarea")'),true);
  await assert.rejects(renderer.evaluate('window.mingshen.editCommand("execute")'),/Invalid edit command/);
  passed.push('Escape closes the menu and restores focus; IPC rejects unsupported commands');
  const blocked=await renderer.evaluate('(()=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(25*1024*1024+1)],"large.png",{type:"image/png"}));const e=new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true});document.querySelector(".composer textarea").dispatchEvent(e);return e.defaultPrevented})()');
  assert.equal(blocked,true);await until('document.querySelector(".composer-error")?.textContent.includes("25 MiB")');assert.equal(await renderer.evaluate('document.querySelectorAll(".draft-attachment").length'),0);
  passed.push('A synthetic oversized clipboard image is rejected at 25 MiB before attaching or sending');
  const textOnly=await renderer.evaluate(`window.mingshen.createModel({providerId:${JSON.stringify(fixture.providerId)},modelId:'text-only',displayName:'Text only',contextWindow:128000,maxOutputTokens:1024,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'})`);
  const textModel=textOnly.models.find(m=>m.modelId==='text-only');
  await renderer.evaluate(`window.mingshen.updateSession({sessionId:${sid},providerId:${JSON.stringify(fixture.providerId)},modelId:${JSON.stringify(textModel.id)}})`);
  await clipboardImage();await paste();await until('Boolean(document.querySelector(".draft-attachment--incompatible"))');assert.equal(await renderer.evaluate('document.querySelector(".send-button").disabled'),true);
  passed.push('Text-only model marks pasted image incompatible and blocks Send');
  await renderer.evaluate(`window.mingshen.updateSession({sessionId:${sid},providerId:${JSON.stringify(fixture.providerId)},modelId:${JSON.stringify(fixture.modelId)}})`);
  await renderer.evaluate('window.mingshen.desktopAction("locale","en").then(()=>{localStorage.setItem("mingshen.locale","en");localStorage.setItem("mingshen.theme","day")})');
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".composer textarea"))');
  await renderer.send('Emulation.setDeviceMetricsOverride',{width:1040,height:680,deviceScaleFactor:1,mobile:false});
  await clipboardImage();await rightClick();
  assert.deepEqual(await renderer.evaluate('[...document.querySelectorAll(".composer-edit-menu button")].map(e=>e.textContent)'),['Cut','Copy','Paste','Select all']);
  assert.ok(await renderer.evaluate('(()=>{const r=document.querySelector(".composer-edit-menu").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'));
  await shot('v129-clipboard-menu-en-day');await key('End','End',35);await key('Home','Home',36);await key('Enter','Enter',13);await until('document.querySelectorAll(".draft-attachment").length===1');
  passed.push('English day compact menu stays inside viewport; Home/End/Enter operate Paste with disabled items skipped');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({version:currentVersion,passed,requests:requests.length,screenshots},null,2));
} catch(cause) {
  console.error(JSON.stringify({passed,errors,body:await renderer?.evaluate('document.body.innerText').catch(()=>null)},null,2));
  if(renderer)await shot('v129-clipboard-failure').catch(()=>{});throw cause;
} finally {
  if(main&&clipboardSaved)await main.evaluate('globalThis.__electron.clipboard.write(globalThis.__clipboardBackup)').catch(error=>console.error('Clipboard restore failed',String(error)));
  if(child){const ended=new Promise(done=>child.once('exit',done));await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(()=>{});renderer?.close();main?.close();await Promise.race([ended,sleep(7000)]);if(child.exitCode===null){child.kill();await ended;}}
  await new Promise(done=>server.close(done));assert.ok(temporary.startsWith(resolve(tmpdir())+sep));await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
