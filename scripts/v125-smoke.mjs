import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-v125-'));
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [], errors = [];
let child, main, renderer;
async function connect(port) {
  let target;
  for (let i=0; i<120; i++) {
    try { target=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(x=>x.webSocketDebuggerUrl); if(target)break; } catch {}
    await sleep(80);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket=new WebSocket(target.webSocketDebuggerUrl), pending=new Map(); let next=0;
  await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const value=JSON.parse(String(event.data));
    if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);
    const waiter=pending.get(value.id);if(!waiter)return;pending.delete(value.id);clearTimeout(waiter.timer);
    value.error?waiter.reject(new Error(value.error.message)):waiter.done(value.result);
  });
  const send=(method,params={})=>new Promise((done,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout ${method}`));},20000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  return {send,evaluate,close:()=>socket.close()};
}
async function start() {
  const env={...process.env,MSH_EXPERIMENTAL:'1',MSH_USER_DATA_DIR:profile,MSH_DISABLE_AUTO_DEPENDENCIES:'1',MSH_NOTIFICATION_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),['--inspect=9364','.','--remote-debugging-port=9363'],{cwd:resolve('apps/desktop'),env,windowsHide:true,stdio:'ignore'});
  main=await connect(9364);
  await main.evaluate(`globalThis.__fetch=fetch;globalThis.fetch=(url,opts)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,opts);true`);
  renderer=await connect(9363);await renderer.send('Runtime.enable');
}
async function stop() {
  if(renderer)await renderer.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(()=>{});
  renderer?.close();main?.close();renderer=null;main=null;
  if(child&&child.exitCode===null){await Promise.race([new Promise(done=>child.once('exit',done)),sleep(5000)]);if(child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done));}}
  child=null;
}
async function until(expression,timeout=20000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await renderer.evaluate(expression))return;await sleep(60);}throw new Error(`Timed out: ${expression}`);
}
async function click(selector,text) {
  const expression=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)}&&!el.disabled)`;
  await until(`Boolean(${expression})`);await renderer.evaluate(`${expression}.click();true`);
}
async function key(key,code=key) {
  await renderer.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,...(key==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:{} )});
  await renderer.send('Input.dispatchKeyEvent',{type:'keyUp',key,code});
}
async function fill(text) {
  await renderer.evaluate(`(()=>{const el=document.querySelector('.composer textarea');el.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
}
async function layout(selector) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const value=await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,scroll:e.scrollHeight,client:e.clientHeight,overflow:getComputedStyle(e).overflowY,w:innerWidth,h:innerHeight}})()`);
  assert.ok(value.top>=11&&value.left>=11&&value.bottom<=value.h-11&&value.right<=value.w-11&&value.height>0,JSON.stringify(value));return value;
}
async function shot(name) {
  const result=await renderer.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(screenshots,`${name}.png`),Buffer.from(result.data,'base64'));
}
async function setting(key,value) {
  await main.evaluate(`(()=>{const db=new(process.getBuiltinModule('node:sqlite').DatabaseSync)(${JSON.stringify(resolve(profile,'mingshen.db'))});db.prepare('insert into app_settings(key,value_json,updated_at) values(?,?,?) on conflict(key) do update set value_json=excluded.value_json').run(${JSON.stringify(key)},${JSON.stringify(JSON.stringify(value))},new Date().toISOString());db.close();return true})()`);
}
try {
  await mkdir(screenshots,{recursive:true});
  execFileSync(process.execPath,[resolve('scripts/prepare-experimental-runtime.cjs')],{windowsHide:true,stdio:'pipe'});
  await start();await until('Boolean(document.querySelector(".policy-consents"))');
  assert.equal((await renderer.evaluate('window.mingshen.getDesktopState()')).accepted,false);
  await assert.rejects(renderer.evaluate('window.mingshen.bootstrap()'),/accept.*privacy policy/i);
  await assert.rejects(renderer.evaluate('window.mingshen.acceptPolicies({terms:true,privacy:true,disclaimer:true})'),/five seconds/);
  await renderer.evaluate('window.dispatchEvent(new CustomEvent("mingshen:document",{detail:"manual"}));true');
  await until('Boolean(document.querySelector(".policy-consents"))');
  assert.equal(await renderer.evaluate('[...document.querySelectorAll(".policy-dialog button")].some(el=>el.textContent.trim()==="开始使用")'),false);
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".policy-consents"))');
  for(const name of ['服务协议','隐私政策','免责协议'])await click('.policy-dialog header button',name);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await click('.policy-dialog button','同意并继续');
  await until('document.querySelector("#policy-title")?.textContent==="使用手册" && document.querySelector(".policy-dialog__body")?.textContent.includes("1.2.5")');
  assert.equal((await renderer.evaluate('window.mingshen.getDesktopState()')).manualPending,true);
  passed.push('Fresh profile gates IPC, all three checkboxes and five seconds; document navigation cannot bypass consent; acceptance loads the current embedded guide');
  await stop();await start();
  await until('document.querySelector("#policy-title")?.textContent==="使用手册"');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-consents"))'),false);
  await click('.policy-dialog button','开始使用');await until('!document.querySelector(".policy-dialog")');
  assert.equal((await renderer.evaluate('window.mingshen.getDesktopState()')).manualPending,false);
  await stop();await start();await until('Boolean(document.querySelector(".agent-guide"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-dialog"))'),false);
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".agent-guide"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-dialog"))'),false);
  passed.push('Restart restores an interrupted guide without repeating consent; completing the guide suppresses onboarding on later restart and reload');
  await main.evaluate(`(()=>{const {ipcMain}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__handlers=ipcMain._invokeHandlers;globalThis.__stateHandler=globalThis.__handlers.get('desktop:state');globalThis.__handlers.set('desktop:state',()=>{throw new Error('State fixture failed')});return true})()`);
  await renderer.send('Page.reload');await until('document.querySelector(".app-loading .form-error")?.textContent.includes("State fixture failed")');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".agent-guide"))'),false);
  await main.evaluate(`globalThis.__handlers.set('desktop:state',globalThis.__stateHandler);true`);
  await click('.app-loading button','重新加载');await until('Boolean(document.querySelector(".agent-guide"))');
  await main.evaluate(`globalThis.__policyHandler=globalThis.__handlers.get('policy:read');globalThis.__handlers.set('policy:read',()=>{throw new Error('Document fixture failed')});true`);
  await renderer.evaluate(`window.dispatchEvent(new CustomEvent('mingshen:document',{detail:'manual'}));true`);
  await until('document.querySelector(".policy-dialog .form-error")?.textContent.includes("Document fixture failed")');
  await main.evaluate(`globalThis.__handlers.set('policy:read',globalThis.__policyHandler);true`);
  await click('.policy-dialog__body button','重新加载');
  await until('document.querySelector(".policy-dialog__body")?.textContent.includes("1.2.5")');
  await click('.policy-dialog button','开始使用');await until('!document.querySelector(".policy-dialog")');
  passed.push('Desktop state and document loading errors stay visible, retry successfully and never expose a consent bypass');

  const fixture=await renderer.evaluate(`(async()=>{
    const providers=[];
    for(let i=0;i<18;i++){
      const p=await window.mingshen.createProvider({name:'Provider '+String(i+1).padStart(2,'0')+' 供应商',baseUrl:'http://127.0.0.1:9/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-fixture-key',keyLabel:'Fixture',neverReveal:true});
      let model;
      for(let j=0;j<(i===17?28:1);j++){const configured=await window.mingshen.createModel({providerId:p.id,modelId:'model-'+j,displayName:'Model '+String(j+1).padStart(2,'0'),contextWindow:128000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['none','low'],anthropicNoneBehavior:'disabled'});model=configured.models.at(-1);}
      providers.push({id:p.id,modelId:model.id});
    }
    for(let i=0;i<16;i++)await window.mingshen.saveAgentProfile({name:'Custom '+String(i+1).padStart(2,'0'),description:'Scrollable Agent fixture',role:'subagent',instructions:'Work carefully.',readOnly:true,enabled:true});
    const s=await window.mingshen.createSession({title:'Dropdown regression',providerId:providers[0].id,modelId:providers[0].modelId,workspacePath:null,reasoningLevel:null,permissionMode:'request_approval'});
    return {providers,session:s};})()`);
  const skillRoot=resolve(temporary,'skills');await mkdir(skillRoot);
  for(let i=0;i<24;i++){const folder=resolve(skillRoot,`skill-${i}`);await mkdir(folder);await writeFile(resolve(folder,'SKILL.md'),`---\nname: Fixture Skill ${i}\ndescription: Local scroll test\n---\nInspect files carefully.\n`);}
  await renderer.evaluate(`window.mingshen.importExtensions(${JSON.stringify(skillRoot)})`);
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".composer textarea"))');
  await renderer.send('Emulation.setDeviceMetricsOverride',{width:1040,height:680,deviceScaleFactor:1,mobile:false});
  await renderer.evaluate('document.querySelector(".app-topbar button[aria-label=打开设置]").click();true');
  await click('.settings-nav__item','上下文与压缩');
  await until('Boolean(document.querySelector(".context-settings__fallback .model-picker__trigger:not(:disabled)"))');
  await renderer.evaluate('document.querySelector(".context-settings__fallback .model-picker__trigger").click();true');
  const first=await layout('.model-picker__panel');assert.ok(first.scroll>first.client);
  const center=await renderer.evaluate('(()=>{const r=document.querySelector(".model-picker__panel").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await renderer.send('Input.dispatchMouseEvent',{type:'mouseWheel',...center,deltaX:0,deltaY:1800});
  await until('document.querySelector(".model-picker__panel")?.scrollTop>200');
  await renderer.evaluate('document.querySelectorAll(".model-picker__provider-toggle")[17].click();true');
  await layout('.model-picker__panel');
  await renderer.evaluate('document.querySelectorAll(".model-picker__provider-toggle")[17].focus({preventScroll:true});true');
  await key('End');await until('document.activeElement?.classList.contains("model-picker__model")');
  await layout('.model-picker__panel');
  assert.equal(await renderer.evaluate('document.querySelector(".model-picker__panel").contains(document.activeElement)'),true);
  await shot('v125-model-menu-zh-night-compact');
  await key('Enter');await until('!document.querySelector(".model-picker__panel")');
  assert.match(await renderer.evaluate('document.querySelector(".context-settings__fallback .model-picker__trigger").textContent'),/Provider 18.*Model 28/);
  passed.push('Fallback picker with 18 providers/28 models fits compact viewport, stays open during real wheel scrolling and selects the last model with keyboard');
  await renderer.evaluate('document.querySelector(".context-settings__fallback .model-picker__trigger").click();true');await layout('.model-picker__panel');
  await renderer.evaluate('document.querySelector(".settings-content__body").scrollTop+=180;true');
  await sleep(150);await layout('.model-picker__panel');
  await key('Escape');await until('!document.querySelector(".model-picker__panel")');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))'),true);
  await renderer.evaluate('document.querySelector("button[aria-label=关闭设置]").click();true');
  passed.push('Settings scroll repositions the open picker; Escape closes the dropdown without closing settings');

  await fill('x\n'.repeat(18));
  await renderer.evaluate('document.querySelector(".extension-trigger").click();true');
  await layout('.extension-panel');
  await renderer.evaluate('document.querySelector(".extension-panel__body").scrollTop=10000;true');
  await until('document.querySelector(".extension-panel__body")?.scrollTop>0');
  assert.ok(await renderer.evaluate('(()=>{const p=document.querySelector(".extension-panel").getBoundingClientRect(),b=[...document.querySelectorAll(".extension-item")].at(-1).getBoundingClientRect();return b.top>=p.top&&b.bottom<=p.bottom})()'));
  await renderer.evaluate('[...document.querySelectorAll(".extension-item")].at(-1).click();true');
  await until('Boolean(document.querySelector(".reference-chip"))');
  await renderer.evaluate('document.querySelector(".extension-panel__header button").click();true');
  await renderer.evaluate('document.querySelector(".context-meter").click();true');
  await layout('.context-details');await key('Escape');
  await fill('/');await layout('.composer-slash-menu');
  await renderer.evaluate('document.querySelector(".composer-slash-menu").scrollTop=10000;true');
  assert.ok((await layout('.composer-slash-menu')).scroll>0);await key('Escape');
  await fill('@');await layout('.mention-menu');
  assert.ok(await renderer.evaluate('document.querySelectorAll(".mention-menu button").length>8'));
  await renderer.evaluate('document.querySelector(".mention-menu").scrollTop=10000;true');
  await renderer.evaluate('[...document.querySelectorAll(".mention-menu button")].at(-1).click();true');
  assert.match(await renderer.evaluate('document.querySelector(".composer textarea").value'),/^@/);
  passed.push('Tall composer, 24 skills, CTX, slash commands and more than eight Agent suggestions remain within screen and selectable');

  await renderer.evaluate(`[...document.querySelectorAll('.desktop-caption__actions button')].find(el=>el.getAttribute('aria-label')==='中文 / English').click();document.documentElement.dataset.theme='day';true`);
  await fill('');await renderer.evaluate('document.querySelector(".chat-model-picker .model-picker__trigger").click();true');
  await layout('.model-picker__panel');
  await renderer.send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});
  await sleep(150);await layout('.model-picker__panel');await shot('v125-model-menu-en-day');await key('Escape');
  for(const name of ['terms','privacy','disclaimer','manual','changelog'])for(const locale of ['zh-CN','en'])assert.ok((await renderer.evaluate(`window.mingshen.readPolicy(${JSON.stringify(name)},${JSON.stringify(locale)})`)).includes(version));
  passed.push('English/day menus reposition after resize and all ten embedded documents identify version 1.2.5');

  const oldConsent=await main.evaluate(`(()=>{const db=new(process.getBuiltinModule('node:sqlite').DatabaseSync)(${JSON.stringify(resolve(profile,'mingshen.db'))});const v=JSON.parse(db.prepare('select value_json from app_settings where key=?').get('legal.consent').value_json);db.close();return v})()`);
  await setting('legal.consent',{...oldConsent,disclaimer:false});
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".policy-consents"))');
  await assert.rejects(renderer.evaluate('window.mingshen.bootstrap()'),/accept.*privacy policy/i);
  await setting('legal.consent',oldConsent);await renderer.send('Page.reload');await until('Boolean(document.querySelector(".composer textarea"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-dialog"))'),false);
  passed.push('A version marker alone cannot bypass missing consent; an existing complete consent profile still opens normally without new prompts');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,screenshots,version},null,2));
} catch(error) {
  console.error(JSON.stringify({passed,errors,ui:await renderer?.evaluate('({policy:document.querySelector("#policy-title")?.textContent,error:document.querySelector(".form-error")?.textContent,body:document.body.innerText.slice(-1800)})').catch(()=>null)},null,2));throw error;
} finally {
  await stop();if(!temporary.startsWith(resolve(tmpdir())+sep))throw new Error('Invalid cleanup path');await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:250});
}
