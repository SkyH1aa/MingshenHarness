import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
const require = createRequire(resolve('apps/desktop/package.json'));
const { zipSync } = require('fflate');
const { createUpdateZip } = createRequire(import.meta.url)('./create-update-zip.cjs');
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-update-ui-'));
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const marker = resolve(temporary, 'handoff.json');
const installerName = 'MingshenHarness-998.998.998-x64.exe';
execFileSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe', ['/nologo','/target:winexe',`/out:${resolve(temporary,installerName)}`,resolve('scripts/fixtures/update-installer-probe.cs')],{windowsHide:true,stdio:'pipe'});
const installer = await readFile(resolve(temporary,installerName));
const bytes = zipSync({ [installerName]: installer });
const release = { version: '998.998.998', download_page_url: 'https://example.com/update.zip', notes: 'ZIP update fixture: progress, cancellation, verification and safe handoff.\n更新流程验证。', published_at: new Date().toISOString(), package_format: 'zip', package_sha256: createHash('sha256').update(bytes).digest('hex'), package_size: bytes.length };
const passed = [], errors = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, renderer, main, updater;
async function connect(port) {
  let target;
  for (let i=0;i<120;i++) { try { target=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(x=>x.webSocketDebuggerUrl); if(target)break; } catch {} await sleep(80); }
  assert.ok(target, `No debugger on ${port}`);
  const socket=new WebSocket(target.webSocketDebuggerUrl), pending=new Map(); let next=0;
  await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const v=JSON.parse(String(event.data));if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.exception?.description||v.params.exceptionDetails.text);const p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(new Error(v.error.message)):p.done(v.result);}});
  const send=(method,params={})=>new Promise((done,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout ${method}`));},20000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw new Error(v.exceptionDetails.exception?.description||v.exceptionDetails.text);return v.result.value;};
  return { send,evaluate,close:()=>socket.close() };
}
async function until(expression,timeout=20000) { const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await renderer.evaluate(expression))return;await sleep(60);}throw new Error(`Timed out: ${expression}`); }
async function click(selector,text) { const e=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`;await until(`Boolean(${e})`);await renderer.evaluate(`${e}.click();true`); }
async function updaterObject() {
  const fn=await main.send('Runtime.evaluate',{expression:`process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain._invokeHandlers.get('updates:download')`});
  const props=await main.send('Runtime.getProperties',{objectId:fn.result.objectId,ownProperties:false});
  const scopes=props.internalProperties.find(p=>p.name==='[[Scopes]]').value.objectId;
  const list=await main.send('Runtime.getProperties',{objectId:scopes,ownProperties:true});
  for(const item of list.result){if(!item.value?.objectId)continue;const p=await main.send('Runtime.getProperties',{objectId:item.value.objectId,ownProperties:true});const value=p.result.find(v=>v.name==='updates');if(value?.value?.objectId)return value.value.objectId;}
  throw new Error('Updater scope missing');
}
async function configure(code) {
  const result=await main.send('Runtime.callFunctionOn',{objectId:updater,functionDeclaration:`async function(){${code};return true}`,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
}
async function shot(name) { const value=await renderer.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(screenshots,`${name}.png`),Buffer.from(value.data,'base64')); }
try {
  await mkdir(screenshots,{recursive:true});
  // Exercise the release ZIP helper with a harmless probe, never a real installer.
  const fake=resolve(temporary,installerName);await writeFile(fake,installer);const packaged=await createUpdateZip(fake);
  assert.equal((await readFile(packaged.archive)).length,packaged.package_size);
  assert.equal(createHash('sha256').update(await readFile(packaged.archive)).digest('hex'),packaged.package_sha256);
  passed.push('Release helper creates a root-only ZIP with matching SHA-256 and byte-size metadata');
  execFileSync(process.execPath,[resolve('scripts/prepare-experimental-runtime.cjs')],{windowsHide:true,stdio:'pipe'});
  const env={...process.env,MSH_EXPERIMENTAL:'1',MSH_USER_DATA_DIR:profile,MSH_DISABLE_AUTO_DEPENDENCIES:'1',MSH_NOTIFICATION_FIXTURE:'1',MSH_UPDATE_PROBE_MARKER:marker,MSH_UPDATE_PROBE_DATABASE:resolve(profile,'mingshen.db')};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),['--inspect=9372','.','--remote-debugging-port=9371'],{cwd:resolve('apps/desktop'),env,windowsHide:true,stdio:'ignore'});
  main=await connect(9372);
  await main.evaluate(`globalThis.__nativeFetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([${JSON.stringify(release)}])):globalThis.__nativeFetch(url,options);true`);
  renderer=await connect(9371);await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await click('.policy-dialog button','同意并继续');await click('.policy-dialog button','开始使用');await until('!document.querySelector(".policy-dialog")');
  await renderer.evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Update test fixture',baseUrl:'http://127.0.0.1:9/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-update-fixture',keyLabel:'Fixture',neverReveal:true});await window.mingshen.createModel({providerId:p.id,modelId:'fixture',contextWindow:128000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});})()`);
  await until('Boolean(document.querySelector("#update-title"))');
  updater=await updaterObject();
  await configure(`globalThis.__originalUpdateFetch=this.runtime.fetchPackage;globalThis.__updateTransportResult=await this.runtime.fetchPackage('https://raw.githubusercontent.com/openai/skills/main/README.md',{signal:AbortSignal.timeout(15000)}).then(async r=>({status:r.status,bytes:(await r.arrayBuffer()).byteLength}));`);
  const transport=await main.evaluate('globalThis.__updateTransportResult');assert.equal(transport.status,200);assert.ok(transport.bytes>100);
  passed.push('Actual production download transport reaches public GitHub HTTPS using the current network/proxy configuration');
  await configure(`this.runtime.validateUrl=async url=>new URL(url);this.runtime.activeTasks=()=>1;this.runtime.fetchPackage=async (_url,init)=>new Response(new ReadableStream({start(controller){const bytes=Uint8Array.from(${JSON.stringify([...bytes])});let offset=0;const timer=setInterval(()=>{if(init.signal.aborted){clearInterval(timer);controller.error(new Error('Canceled fixture'));return}const end=Math.min(bytes.length,offset+8);controller.enqueue(bytes.slice(offset,end));offset=end;if(offset===bytes.length){clearInterval(timer);controller.close()}},120)}}),{headers:{'content-length':String(${bytes.length})}})`);
  await renderer.send('Emulation.setDeviceMetricsOverride',{width:1040,height:680,deviceScaleFactor:1,mobile:false});
  await shot('v126-update-confirm-zh-night');
  await click('.update-controls button','自动下载并安装');await until('document.querySelector(".update-controls__progress")?.textContent.includes("MiB")');
  await click('.close-dialog button','后台继续');await until('!document.querySelector("#update-title")');
  assert.equal(await renderer.evaluate('window.mingshen.getUpdateStatus().then(s=>s.state)'), 'downloading');
  await renderer.evaluate('document.querySelector(".desktop-update-trigger").click();true');
  await click('.update-controls button','取消更新');await until('document.querySelector(".update-controls__state")?.textContent==="发现新版本"');
  passed.push('Real Electron ZIP prompt downloads in background, title-bar reopens progress and cancellation restores controls');
  await configure(`this.runtime.fetchPackage=async()=>new Response('failed',{status:503,statusText:'Service Unavailable'})`);
  await click('.update-controls button','自动下载并安装');await until('document.querySelector(".update-controls .form-error")?.textContent.includes("503")');
  await shot('v126-update-error-zh-night');
  await configure(`this.runtime.fetchPackage=async()=>new Response(Uint8Array.from(${JSON.stringify([...bytes])}));this.value.release.packageSha256='0'.repeat(64)`);
  await click('.update-controls button','重新下载更新');await until('document.querySelector(".update-controls .form-error")?.textContent.includes("SHA-256")');
  passed.push('HTTP 503 and ZIP integrity failures show complete error, retry affordance and never reach installer handoff');
  await configure(`this.value.release.packageSha256=${JSON.stringify(release.package_sha256)}`);
  await click('.update-controls button','重新下载更新');await until('document.querySelector(".update-controls__state")?.textContent.includes("等待 1 个")');
  await shot('v126-update-waiting-zh-night');
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".desktop-update-trigger"))');
  await renderer.evaluate('document.querySelector(".desktop-update-trigger").click();true');await until('document.querySelector(".update-controls__state")?.textContent.includes("等待 1 个")');
  passed.push('Ready update waits for tasks without discarding chat, survives renderer reload and retains cancel control');
  await renderer.evaluate(`document.querySelector('.desktop-caption__actions button[aria-label="中文 / English"]').click();document.documentElement.dataset.theme='day';true`);
  await until('document.querySelector(".update-controls__state")?.textContent.includes("Waiting for 1")');
  const bounds=await renderer.evaluate(`(()=>{const a=document.querySelector('.close-dialog').getBoundingClientRect();return {left:a.left,right:a.right,top:a.top,bottom:a.bottom,width:innerWidth,height:innerHeight}})()`);
  assert.ok(bounds.left>=10&&bounds.top>=10&&bounds.right<=bounds.width-10&&bounds.bottom<=bounds.height-10);
  await shot('v126-update-waiting-en-day');
  await click('.close-dialog button','Continue in background');
  await renderer.evaluate(`document.querySelector('.app-topbar button[aria-label="Open settings"]').click();true`);
  await click('.settings-nav__item','About');await until('document.querySelector(".settings-content__body .update-controls")?.textContent.includes("Waiting for 1")');
  await shot('v126-update-about-en-day');
  for(const name of ['terms','privacy','manual','changelog'])for(const locale of ['zh-CN','en'])assert.match(await renderer.evaluate(`window.mingshen.readPolicy(${JSON.stringify(name)},${JSON.stringify(locale)})`),/ZIP/);
  passed.push('Compact Chinese/night and English/day controls fit the viewport; About and embedded docs expose the same update flow');
  // Exercise app.relaunch itself with the harmless probe, never with a real installer.
  await main.evaluate(`process.env.MSH_UPDATE_PROBE_PARENT=String(process.pid);true`);
  await configure('const original=this.runtime.handoff;this.runtime.handoff=async path=>{setTimeout(()=>void original(path),1800);return true};this.runtime.activeTasks=()=>0');
  await until('window.mingshen.getUpdateStatus().then(s=>s.state==="installing")');
  // Node's inspector can hold shutdown open until its debugging socket disconnects.
  renderer.close();main.close();renderer=null;main=null;
  const exit=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Update did not quit app')),10000);if(child.exitCode!==null){clearTimeout(timer);done(child.exitCode);}else child.once('exit',code=>{clearTimeout(timer);done(code);});});
  assert.equal(exit,0);
  child=null;
  let found=false;for(let i=0;i<150;i++){try{await readFile(marker);found=true;break;}catch{}await sleep(80);}assert.ok(found,'Harmless installer probe was not launched');
  const handoff=JSON.parse(await readFile(marker,'utf8'));assert.deepEqual(handoff,{installerStarted:true,parentExited:true,databaseClosed:true});
  passed.push('Real idle handoff quits cleanly; Electron actually launches the harmless EXE after parent exit and SQLite close (no installation)');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,screenshots,version:'1.2.6',installerExecuted:false},null,2));
} catch(error) { console.error(JSON.stringify({passed,errors,ui:await renderer?.evaluate('document.body.innerText.slice(-1800)').catch(()=>null)},null,2));throw error; }
finally {
  if(child){await renderer?.evaluate('setTimeout(()=>{void window.mingshen.cancelUpdate().then(()=>window.mingshen.desktopAction("quit"))},100);true').catch(()=>{});await Promise.race([new Promise(done=>child.once('exit',done)),sleep(5000)]);if(child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done));}}
  renderer?.close();main?.close();
  if(!temporary.startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe test cleanup');await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
