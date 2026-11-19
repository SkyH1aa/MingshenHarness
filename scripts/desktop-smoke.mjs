import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { experimentalExecutable } from './experimental-executable.mjs';
const portableSpawn=createRequire(resolve('apps/desktop/package.json'))('cross-spawn').spawn;
const workspace=process.cwd();const profile=resolve(`.tmp-v121-smoke-${Date.now()}`);const port=9336;
const taskRoot=await mkdtemp(resolve(tmpdir(),'mingshen-desktop-e2e-'));
const modelServer=createServer(async(req,res)=>{
 if(req.url==='/browser'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Harness embedded browser validation</title><h1>Embedded browser works</h1><button onclick="this.textContent=\'Clicked\'">Click</button>');return;}
 const buffers=[];for await(const c of req)buffers.push(Buffer.from(c));
 if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'mock-tool-model'}]}));return;}
 const body=JSON.parse(Buffer.concat(buffers).toString()||'{}');
 if(body.stream!==true){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({output:[{content:[{type:'output_text',text:'OK'}]}]}));return;}
 if(String(body.instructions??'').includes('[PROJECT_MEMORY_SUMMARY]')){
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end(`data: ${JSON.stringify({type:'response.output_text.delta',delta:'Verified the desktop file workflow while preserving approvals, cancellation and file boundaries.'})}\n\ndata: ${JSON.stringify({type:'response.completed'})}\n\n`);return;
 }
 const input=body.input??[];const last=input.findLastIndex(x=>x.role==='user'&&/WRITE_E2E|ERROR503/.test(JSON.stringify(x.content)));const turn=input.slice(Math.max(0,last));
 if(JSON.stringify(turn).includes('ERROR503')){res.writeHead(503,{'Content-Type':'application/json','x-request-id':'desktop-error-503'});res.end(JSON.stringify({error:{code:'upstream_unavailable',message:'temporary fixture failure',api_key:'dummy-smoke-key'}}));return;}
 res.writeHead(200,{'Content-Type':'text/event-stream'});const event=x=>res.write(`data: ${JSON.stringify(x)}\n\n`);
 if(String(body.instructions??'').trim().startsWith('# 会话标题生成'))event({type:'response.output_text.delta',delta:'Desktop file validation'});
 else if(!turn.some(x=>x.type==='function_call_output')){
  event({type:'response.output_text.delta',delta:'Preparing the file change.'});
  event({type:'response.output_item.added',output_index:0,item:{type:'function_call',call_id:'desktop-write',name:'write_file',arguments:''}});
  event({type:'response.function_call_arguments.delta',output_index:0,delta:JSON.stringify({path:'probe.txt',content:'validated through Electron\n'})});
 }else event({type:'response.output_text.delta',delta:'Created [probe.txt](probe.txt).'});
 event({type:'response.completed',response:{usage:{input_tokens:20,output_tokens:10,total_tokens:30}}});res.end();
});
await new Promise(r=>modelServer.listen(43124,'127.0.0.1',r));
const appArgument=process.argv.indexOf('--app');
const packagedExecutable=appArgument>=0?process.argv[appArgument+1]:null;
if(!packagedExecutable)execFileSync(process.execPath,[resolve('scripts/prepare-experimental-runtime.cjs')],{stdio:'pipe',windowsHide:true});
const env={...process.env,MSH_EXPERIMENTAL:'1',MSH_USER_DATA_DIR:profile,MSH_DISABLE_AUTO_DEPENDENCIES:'1',MSH_NOTIFICATION_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(packagedExecutable?resolve(packagedExecutable):experimentalExecutable(),[...(packagedExecutable?[]:['.']),`--remote-debugging-port=${port}`],{cwd:resolve('apps/desktop'),env,windowsHide:true,stdio:'ignore'});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));let socket;let id=0;const pending=new Map();
try{
 let target;for(let i=0;i<80;i++){try{target=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(t=>t.type==='page');if(target)break;}catch{}await sleep(100);}
 assert.ok(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 socket.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`CDP timeout: ${method}`));},25000);pending.set(requestId,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id:requestId,method,params}));});
 const evaluate=async(expression)=>{try{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}catch(cause){throw new Error(`Desktop smoke failed at ${expression.slice(0,260)}`,{cause});}};
 await send('Runtime.enable');await send('Page.enable');await sleep(350);
 assert.equal(await evaluate('(async()=>{try{await window.mingshen.bootstrap();return false}catch{return true}})()'),true);
 const early=await evaluate('(async()=>{try{await window.mingshen.acceptPolicies();return false}catch{return true}})()');assert.equal(early,true);
 assert.ok((await evaluate(`window.mingshen.readPolicy('terms','zh-CN')`)).includes('完整阅读、理解并接受'));
 assert.ok((await evaluate(`window.mingshen.readPolicy('terms','en')`)).includes('fully read, understood and accepted'));
 await mkdir('.impeccable/review',{recursive:true});
 const screenshot=async(name)=>{await evaluate('Promise.race([Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,1200))])');await sleep(150);const image=await send('Page.captureScreenshot',{format:'png'});await writeFile(`.impeccable/review/${name}.png`,Buffer.from(image.data,'base64'));};
 await screenshot('v121-first-run');
 assert.equal(await evaluate(`(()=>{const p=document.querySelector('.policy-dialog');return p && getComputedStyle(p).position==='relative' && Number(getComputedStyle(p).zIndex)>0})()`),true);
 assert.equal(await evaluate(`(()=>{const p=document.querySelector('.policy-dialog');const r=p.getBoundingClientRect();return p.contains(document.elementFromPoint(r.x+50,r.y+50))&&getComputedStyle(p.parentElement).opacity==='1'})()`),true);
 await sleep(5200);
 assert.equal(await evaluate(`document.querySelectorAll('.policy-dialog input[type=checkbox]').length`),3);
 await evaluate(`(()=>{document.querySelectorAll('.policy-dialog input[type=checkbox]').forEach(input=>input.click());[...document.querySelectorAll('.policy-dialog button')].find(b=>b.textContent.includes('同意并继续')).click();return true})()`);await sleep(400);
 assert.equal(await evaluate('Boolean(document.body.innerText.includes("使用手册"))'),true);
 for(let i=0;i<50;i++){if(await evaluate(`Boolean([...document.querySelectorAll('.policy-dialog__body a')].find(a=>a.textContent==='配置供应商与模型'))`))break;await sleep(100);}
 assert.equal(await evaluate(`(()=>{const root=document.querySelector('.policy-dialog__body');const a=[...root.querySelectorAll('a')].find(a=>a.textContent==='配置供应商与模型');a.click();return root.scrollTop>0})()`),true);
 await screenshot('v121-embedded-manual');
 await evaluate(`(()=>{[...document.querySelectorAll('.policy-dialog button')].find(b=>b.textContent.includes('开始使用')).click();return true})()`);
 for(let i=0;i<100;i++){if(await evaluate(`window.mingshen.getUpdateStatus().then(value=>value.checkedAt!==null&&value.state!=='checking')`))break;await sleep(150);}
 const updateState=await evaluate('window.mingshen.getUpdateStatus()');
 assert.ok(['current','available'].includes(updateState.state),JSON.stringify(updateState));
 if(updateState.release){
  const installed=updateState.currentVersion.split('.').map(Number);const latest=updateState.release.version.split('.').map(Number);
  const firstDifferent=latest.findIndex((part,index)=>part!==installed[index]);
  const newer=firstDifferent>=0&&latest[firstDifferent]>installed[firstDifferent];
  assert.equal(updateState.state,newer?'available':'current');assert.equal(new URL(updateState.release.downloadUrl).protocol,'https:');
 }
 assert.equal(await evaluate(`Boolean(document.querySelector('#update-title'))`),updateState.state==='available');
 await screenshot('v121-live-update');
 if(updateState.state==='available')await evaluate(`[...document.querySelectorAll('.close-dialog button')].find(b=>b.textContent==='稍后再说').click(); true`);
 await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='中文 / English').click();return true})()`);await sleep(200);
 assert.equal(await evaluate('document.documentElement.lang'),'en');await screenshot('v121-english-setup');
 await evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Chatgpt Pro',baseUrl:'http://127.0.0.1:43124/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'dummy-smoke-key',keyLabel:'Test',neverReveal:true});const updated=await window.mingshen.createModel({providerId:p.id,modelId:'mock-tool-model',displayName:'Smoke model',contextWindow:128000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['none','low','medium','high'],anthropicNoneBehavior:'disabled'});await window.mingshen.createSession({title:'Desktop validation',providerId:p.id,modelId:updated.models[0].id,workspacePath:${JSON.stringify(taskRoot)},reasoningLevel:null,permissionMode:'request_approval'});return true})()`);
 await send('Page.reload');await sleep(700);await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Open settings').click();return true})()`);await sleep(200);
 const sections=await evaluate(`[...document.querySelectorAll('.settings-nav__item')].map(b=>b.textContent.trim())`);assert.ok(sections.includes('Appearance and language'));
 const chinese=[];for(const label of sections){await evaluate(`(()=>{[...document.querySelectorAll('.settings-nav__item')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click();return true})()`);await sleep(160);const text=await evaluate(`document.querySelector('.settings-content').innerText`);const lines=text.split('\n').filter(x=>/[\u3400-\u9fff]/.test(x));if(lines.length)chinese.push({label,lines});}
 await screenshot('v121-english-settings');
 await evaluate(`(()=>{[...document.querySelectorAll('.settings-content button')].find(b=>b.textContent==='Privacy policy').click();return true})()`);await sleep(200);
 assert.equal(await evaluate(`document.querySelector('.policy-dialog__body').innerText.includes('Mingshen Harness Privacy Policy')`),true);
 await evaluate(`(()=>{[...document.querySelectorAll('.policy-dialog button')].find(b=>b.textContent==='Close').click();return true})()`);
 await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Close settings').click();return window.mingshen.desktopAction('close')})()`);await sleep(150);
 assert.ok(await evaluate(`document.body.innerText.includes('Minimize to tray')`));await screenshot('v121-close-dialog');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.close-dialog__heading')).display`),'block');
 assert.ok(await evaluate(`document.querySelector('.close-dialog__heading p').getBoundingClientRect().width>400`));
 await send('Emulation.setDeviceMetricsOverride',{width:1040,height:680,deviceScaleFactor:1,mobile:false});await screenshot('v121-close-dialog-compact-en');
 assert.equal(await evaluate(`(()=>{const el=document.querySelector('.close-dialog');return el.scrollWidth<=el.clientWidth})()`),true);
 await evaluate(`(()=>{[...document.querySelectorAll('.close-dialog button')].find(b=>b.textContent==='Cancel').click();return true})()`);
 await evaluate(`window.mingshen.desktopAction('locale','zh-CN')`);await evaluate(`document.querySelector('.desktop-caption__actions button[aria-label="中文 / English"]').click()`);await evaluate(`window.mingshen.desktopAction('close')`);await sleep(150);await screenshot('v121-close-dialog-compact-zh');
 assert.equal(await evaluate(`(()=>{const el=document.querySelector('.close-dialog');return el.scrollWidth<=el.clientWidth})()`),true);
 await evaluate(`(()=>{[...document.querySelectorAll('.close-dialog button')].find(b=>b.textContent==='取消').click();document.querySelector('.desktop-caption__actions button[aria-label="中文 / English"]').click();return true})()`);await send('Emulation.clearDeviceMetricsOverride');
 await evaluate(`(async()=>{window.__events=[];window.__approvalCount=0;window.mingshen.onRuntimeEvent(e=>{window.__events.push(e);if(e.type==='approval_required'&&!window.__holdApproval){window.__approvalCount++;void window.mingshen.decideApproval({approvalId:e.approval.id,decision:'allow_once'});}});const b=await window.mingshen.bootstrap();window.__session=b.sessions[0].id;return window.mingshen.sendChat({sessionId:window.__session,text:'WRITE_E2E: create probe.txt'})})()`);
 for(let i=0;i<600;i++){if(await evaluate(`window.__events.some(e=>['run_completed','run_failed'].includes(e.type))`))break;await sleep(100);}
 const events=await evaluate(`window.__events`);assert.ok(events.some(e=>e.type==='run_completed'),JSON.stringify(events.filter(e=>e.type==='run_failed')));
 assert.equal(await readFile(resolve(taskRoot,'probe.txt'),'utf8'),'validated through Electron\n');
 assert.equal(await evaluate('window.__approvalCount'),1);
 assert.ok(events.some(e=>e.type==='activity'&&e.activity.fileChange?.diff));
 assert.ok((await evaluate('window.mingshen.getSessionMessages(window.__session)')).some(m=>m.parts.some(p=>p.type==='run_summary')));
 await evaluate(`window.mingshen.setModelRetrySettings({maxRetries:0})`);
 await evaluate(`window.__events=[];window.mingshen.sendChat({sessionId:window.__session,text:'ERROR503'})`);
 for(let i=0;i<100;i++){if(await evaluate(`window.__events.some(e=>e.type==='run_failed')`))break;await sleep(100);}
 const failure=await evaluate(`window.__events.find(e=>e.type==='run_failed')?.error`);assert.ok(failure?.includes('HTTP 503'));assert.ok(failure.includes('desktop-error-503'));assert.ok(!failure.includes('dummy-smoke-key'));
 const browser=await evaluate(`window.mingshen.openBrowser(window.__session,'edge','http://127.0.0.1:43124/browser')`);assert.equal(browser.connected,true);
 const guest=await evaluate(`document.querySelector('webview').executeJavaScript('({text:document.body.innerText,node:typeof require,bridge:typeof window.mingshen})')`);assert.ok(guest.text.includes('Embedded browser works'));assert.equal(guest.node,'undefined');assert.equal(guest.bridge,'undefined');
 const browserSize=await evaluate(`(()=>{const r=document.querySelector('webview').getBoundingClientRect();return {width:r.width,height:r.height}})()`);assert.ok(browserSize.width>300&&browserSize.height>300,JSON.stringify(browserSize));
 await screenshot('v121-embedded-browser');
 await send('Emulation.setDeviceMetricsOverride',{width:1040,height:680,deviceScaleFactor:1,mobile:false});
 await evaluate(`document.documentElement.dataset.theme='day'; true`);await sleep(150);await screenshot('v121-day-compact');
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),true);
 await send('Emulation.clearDeviceMetricsOverride');
 await evaluate(`window.mingshen.closeBrowser(window.__session)`);
 await evaluate(`window.mingshen.desktopAction('tray',undefined,true)`);assert.equal((await evaluate('window.mingshen.getDesktopState()')).closeAction,'tray');
 await evaluate(`window.mingshen.desktopAction('close-preference','ask')`);
 assert.deepEqual(chinese,[], 'English settings must not contain untranslated application copy');
 await evaluate(`(async()=>{window.__holdApproval=true;window.__events=[];const b=await window.mingshen.bootstrap();const p=b.providers[0];const s=await window.mingshen.createSession({title:'Active removal regression',providerId:p.id,modelId:p.models[0].id,workspacePath:${JSON.stringify(taskRoot)},reasoningLevel:null,permissionMode:'request_approval'});window.__removingSession=s.id;return window.mingshen.sendChat({sessionId:s.id,text:'WRITE_E2E: wait for approval'})})()`);
 for(let i=0;i<100;i++){if(await evaluate(`window.__events.some(e=>e.type==='approval_required'&&e.sessionId===window.__removingSession)`))break;await sleep(100);}
 assert.equal(await evaluate(`window.__events.some(e=>e.type==='approval_required'&&e.sessionId===window.__removingSession)`),true);
 await evaluate(`window.mingshen.stopChat(window.__removingSession)`);
 for(let i=0;i<100;i++){if(await evaluate(`window.__events.some(e=>e.type==='run_interrupted'&&e.sessionId===window.__removingSession)`))break;await sleep(100);}
 assert.equal(await evaluate(`window.__events.some(e=>e.type==='run_interrupted'&&e.sessionId===window.__removingSession)`),true);
 assert.equal(await evaluate(`(async()=>(await window.mingshen.getSessionMessages(window.__removingSession)).filter(m=>m.role==='assistant'&&m.parts.some(p=>p.type==='text'&&p.text==='Preparing the file change.')).length)()`),1);
 await evaluate(`window.__events=[];window.mingshen.sendChat({sessionId:window.__removingSession,text:'WRITE_E2E: wait for approval again'})`);
 for(let i=0;i<100;i++){if(await evaluate(`window.__events.some(e=>e.type==='approval_required'&&e.sessionId===window.__removingSession)`))break;await sleep(100);}
 assert.equal(await evaluate(`window.__events.some(e=>e.type==='approval_required'&&e.sessionId===window.__removingSession)`),true);
 await evaluate(`window.mingshen.removeSession(window.__removingSession)`);
 assert.equal(await evaluate(`(async()=>!(await window.mingshen.bootstrap()).sessions.some(s=>s.id===window.__removingSession))()`),true);
 assert.equal(await evaluate(`window.__events.some(e=>e.type==='session_removed'&&e.sessionId===window.__removingSession)`),true);
 if(process.env.MSH_UI_AUDIT==='1'){
   await evaluate(`window.mingshen.desktopAction('show')`);
   await evaluate(`window.mingshen.desktopAction('close')`);await sleep(150);
   const audit=await new Promise(resolveAudit=>{const tool=portableSpawn('C:\\Users\\ASUS\\.codex\\skills\\impeccable\\scripts\\impeccable.cmd',['detect','--cdp',String(port),'--target','Mingshen','--json'],{cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';let err='';tool.stdout.on('data',c=>out+=c);tool.stderr.on('data',c=>err+=c);tool.on('error',e=>resolveAudit({error:String(e)}));tool.on('close',code=>resolveAudit({code,out,err}));});
   await writeFile('.impeccable/review/v121-final-detector.json',JSON.stringify(audit,null,2)); console.log('UI detector result:',JSON.stringify(audit));
   await evaluate(`window.mingshen.desktopAction('cancel-close')`);
 }
 console.log(JSON.stringify({passed:['consent IPC gate','five-second gate','three separate agreements','manual after acceptance','embedded manual section navigation','live Supabase latest release, numeric comparison and download URL','English setup','all settings navigation','English privacy document','close dialog in Chinese and English at 1040x680','tray preference','custom caption','model streaming through Electron','exactly one file approval','real file write through native sandbox','persisted diff summary','HTTP503 details and credential redaction','embedded browser registration','guest has no Node or IPC bridge','browser panel dimensions','delete an active session awaiting approval'],untranslated:chinese,sections,update:{currentVersion:updateState.currentVersion,state:updateState.state,releaseVersion:updateState.release?.version},profile},null,2));
 await evaluate(`void window.mingshen.desktopAction('quit'); true`).catch(()=>{});
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);
}finally{socket?.close();if(!child.killed)child.kill();modelServer.closeAllConnections();await new Promise(r=>modelServer.close(r));await rm(taskRoot,{recursive:true,force:true});}
