import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const {version}=JSON.parse(await readFile('package.json','utf8'));
const temporary=await mkdtemp(resolve(tmpdir(),'mingshen-task-preview-'));
const profile=resolve(temporary,'profile'),project=resolve(temporary,'project'),screenshots=resolve('.impeccable/review');
const requests=[],passed=[],errors=[];
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const workerFirstMarker=worker=>`FIRST_WORKER_${worker}_SOURCE`;
const workerLastMarker=worker=>`FINAL_WORKER_${worker}`;
const workerParagraph=(worker,index)=>`Worker ${worker} verified output ${index}. ${'Complete local evidence remains saved for full-session inspection. '.repeat(8)}\n\n`;
const workerOutput=worker=>`${workerFirstMarker(worker)}\n\n${Array.from({length:36},(_,index)=>workerParagraph(worker,index)).join('')}${workerLastMarker(worker)}`;
const previewErrorTail='CHILD_PREVIEW_FAILURE_COMPLETE_TAIL_7f26';
const previewError=['CHILD_PREVIEW_FAILURE_START',...Array.from({length:75},(_,index)=>`Preview failure diagnostic ${index+1}: preserve the complete injected local failure detail.`),'',previewErrorTail].join('\n');
let child,main,renderer,hold=true;
const server=createServer(async(request,response)=>{
  try {
    const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
    response.writeHead(200,{'Content-Type':'text/event-stream'});
    const event=value=>response.write(`data: ${JSON.stringify(value)}\n\n`);
    const input=body.input??[],all=JSON.stringify(input);
    const worker=/子任务：WORKER_(\d)/.exec(JSON.stringify(input.find(item=>item.role==='user')?.content))?.[1];
    const tool=(name,args,index=0)=>{event({type:'response.output_item.added',output_index:index,item:{type:'function_call',call_id:`${name}-${requests.length}-${index}`,name,arguments:''}});event({type:'response.function_call_arguments.delta',output_index:index,delta:JSON.stringify(args)});};
    const done=()=>{event({type:'response.completed',response:{usage:{input_tokens:1400,output_tokens:80,total_tokens:1480}}});response.end();};
    if(worker){
      if(!input.some(item=>item.type==='function_call'&&item.name==='read_file')){tool('read_file',{path:'evidence.txt'});done();return;}
      event({type:'response.reasoning_summary_text.delta',delta:`Reasoning summary for worker ${worker}.`});
      event({type:'response.output_text.delta',delta:`${workerFirstMarker(worker)}\n\n`});
      for(let i=0;i<36&&!response.destroyed;i++){event({type:'response.output_text.delta',delta:workerParagraph(worker,i)});await sleep(90);}
      if(!response.destroyed){event({type:'response.output_text.delta',delta:workerLastMarker(worker)});done();}return;
    }
    if(all.includes('最近已保存的安全工具边界')){event({type:'response.output_text.delta',delta:'Resumed from latest saved plan without resetting completed work.'});done();return;}
    const calls=input.filter(item=>item.type==='function_call');
    if(!calls.some(item=>item.name==='update_todos')){
      tool('update_todos',{todos:[
        {id:'done',content:'Completed evidence',status:'completed',priority:'high'},
        {id:'current',content:'Review parallel evidence',status:'in_progress',priority:'medium',dependsOn:['done']},
        {id:'next',content:'Final verification',status:'pending',priority:'medium',dependsOn:['current']}
      ]});done();return;
    }
    if(!calls.some(item=>item.name==='spawn_subagent')){
      for(let i=1;i<=2;i++)tool('spawn_subagent',{agent:'review-subagent',label:`Preview worker ${i}`,task:`WORKER_${i} inspect evidence and report.`,context:'Read-only verification.'},i-1);
      done();return;
    }
    while(hold&&!response.destroyed){response.write(': waiting\n\n');await sleep(150);}
    if(!response.destroyed){event({type:'response.output_text.delta',delta:'Parent finished.'});done();}
  }catch(cause){if(!response.destroyed)response.destroy();errors.push(String(cause));}
});
async function connect(port){
  let target;for(let i=0;i<140;i++){try{target=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(t=>t.webSocketDebuggerUrl);if(target)break;}catch{}await sleep(70);}assert.ok(target,`No debugger ${port}`);
  const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let next=0;
  await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const v=JSON.parse(String(event.data));if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.exception?.description||v.params.exceptionDetails.text);const p=pending.get(v.id);if(!p)return;pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(new Error(v.error.message)):p.done(v.result);});
  const send=(method,params={})=>new Promise((done,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout ${method}`));},20000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw new Error(v.exceptionDetails.exception?.description||v.exceptionDetails.text);return v.result.value;};return{send,evaluate,close:()=>socket.close()};
}
async function launch(){const env={...process.env,MSH_EXPERIMENTAL:'1',MSH_USER_DATA_DIR:profile,MSH_DISABLE_AUTO_DEPENDENCIES:'1',MSH_NOTIFICATION_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;child=spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),['--inspect=9374','.','--remote-debugging-port=9373'],{cwd:resolve('apps/desktop'),env,windowsHide:true,stdio:'ignore'});main=await connect(9374);await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');renderer=await connect(9373);await renderer.send('Runtime.enable');}
async function until(expression,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await renderer.evaluate(expression))return;await sleep(60);}throw new Error(`Timed out: ${expression}`);}
async function click(selector,text){const find=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`;await until(`Boolean(${find})`);await renderer.evaluate(`${find}.click();true`);}
async function shot(name){const result=await renderer.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(screenshots,`${name}.png`),Buffer.from(result.data,'base64'));}
async function select(id){await renderer.evaluate('document.querySelector(".session-group__show-all[aria-expanded=false]")?.click();true');await until(`Boolean(document.querySelector('[data-session-id="${id}"] .session-row'))`);await renderer.evaluate(`document.querySelector('[data-session-id="${id}"] .session-row').click();true`);await until(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(id)}`);}
async function close(){if(!child)return;const process=child,ended=new Promise(done=>process.once('exit',done));await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(()=>{});renderer?.close();main?.close();renderer=null;main=null;await Promise.race([ended,sleep(7000)]);if(process.exitCode===null){process.kill();await ended;}child=null;}
try{
  assert.ok(workerOutput('1').length>12000&&workerOutput('1').length<40000,'The real child source must exceed the preview limit while remaining below the delegated-result limit');
  assert.ok(previewError.indexOf(previewErrorTail)>4000,'The injected preview failure must exercise a complete long diagnostic');
  await mkdir(project,{recursive:true});await mkdir(screenshots,{recursive:true});await writeFile(resolve(project,'evidence.txt'),'Actual read-only worker evidence.\n');
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  execFileSync(process.execPath,[resolve('scripts/prepare-experimental-runtime.cjs')],{windowsHide:true,stdio:'pipe'});
  await launch();await until('Boolean(document.querySelector(".policy-consents"))');await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');await click('.policy-dialog button','同意并继续');await click('.policy-dialog button','开始使用');await until('!document.querySelector(".policy-dialog")');
  const parent=await renderer.evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Task output fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-task-fixture',keyLabel:'Fixture',neverReveal:true});const configured=await window.mingshen.createModel({providerId:p.id,modelId:'fixture',contextWindow:200000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});for(const s of await window.mingshen.listMcpServers())if(s.enabled)await window.mingshen.setMcpServerEnabled(s.id,false);return window.mingshen.createSession({title:'Resume and preview',providerId:p.id,modelId:configured.models[0].id,workspacePath:${JSON.stringify(project)},reasoningLevel:null,permissionMode:'full_access',agentProfileId:'code-review'});})()`);
  await renderer.evaluate(`(async()=>window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),defaultLayout:'agents'}))()`);
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".task-workbench"))');await select(parent.id);
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(parent.id)},text:'Inspect with two workers and keep a structured plan.'})`);
  await until('document.querySelectorAll(".plan-step").length===3');await until('Boolean(document.querySelector(".plan-step--in_progress .spin"))');
  await until(`window.mingshen.listSessionPage({parentId:${JSON.stringify(parent.id)}}).then(page=>page.total===2)`);
  const workers=(await renderer.evaluate(`window.mingshen.listSessionPage({parentId:${JSON.stringify(parent.id)}})`)).sessions;
  await click('.task-workbench__toolbar button','Agent 任务树');await until('document.querySelectorAll(".agent-task-tree__child").length===2');
  const first=workers[0].id;
  assert.equal(await renderer.evaluate('document.querySelectorAll(".subagent-output").length'),0);
  await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand').click();true`);
  await until('document.querySelector(".subagent-output__live")?.textContent.includes("verified output")');
  await until('(()=>{const output=document.querySelector(".subagent-output__body").getBoundingClientRect(),panel=document.querySelector(".task-workbench__body").getBoundingClientRect();return output.top>=panel.top&&output.top+32<=panel.bottom})()');
  assert.equal(await renderer.evaluate('document.querySelector(".session-row--selected").closest("[data-session-id]").dataset.sessionId'),parent.id);
  const before=await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop');
  await sleep(300);assert.equal(await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop'),before);
  await shot('v126-child-live-output-zh-night');
  passed.push('Two real delegated workers stream inside the disclosure pane; parent stays selected and its timeline does not move');
  await renderer.send('Page.bringToFront');
  await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand').focus({preventScroll:true});true`);
  assert.equal(await renderer.evaluate('document.activeElement.classList.contains("agent-task-tree__expand")'),true);
  await renderer.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await renderer.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await until('!document.querySelector(".subagent-output")');
  await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand').click();true`);
  await until(`window.mingshen.listSessionPage({parentId:${JSON.stringify(parent.id)}}).then(page=>page.sessions.every(s=>s.status==='idle'))`);
  await until('document.querySelector(".subagent-output")?.textContent.includes("FINAL_WORKER_")');
  assert.ok(await renderer.evaluate('document.querySelectorAll(".subagent-output__tool").length>=2'));
  await renderer.evaluate('document.querySelector(".subagent-output__tool summary").click();true');
  await renderer.evaluate('document.querySelector(".subagent-output__body").scrollTop=0;true');await sleep(100);
  await renderer.evaluate('document.querySelector(".subagent-output__header button").click();true');await sleep(350);
  assert.equal(await renderer.evaluate('document.querySelector(".subagent-output__body").scrollTop'),0);
  await shot('v126-child-finished-output-zh-night');
  const childMessages=await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(first)})`);
  const childPrompt=childMessages.find(message=>message.role==='user');
  assert.ok(childPrompt,'The completed child must have its own unique source prompt');
  const sourceParts=childMessages.flatMap(message=>message.parts);
  const source=sourceParts.find(part=>part.type==='text'&&part.text.includes('FIRST_WORKER_'));
  assert.ok(source,'The completed child must retain its original long source text');
  const workerNumber=/FIRST_WORKER_(\d)_SOURCE/.exec(source.text)?.[1];
  assert.ok(workerNumber);
  assert.equal(source.text,workerOutput(workerNumber),'The complete original SSE output must remain persisted without preview truncation');
  const firstMarker=workerFirstMarker(workerNumber),lastMarker=workerLastMarker(workerNumber);
  const preview=await renderer.evaluate(`window.mingshen.getSubagentOutput(${JSON.stringify(parent.id)},${JSON.stringify(first)})`);
  assert.equal(preview.sessionId,first);assert.equal(preview.truncated,true);
  assert.ok(preview.parts.some(part=>part.text.includes(lastMarker))&&!preview.parts.some(part=>part.text.includes(firstMarker)),'The bounded preview must expose its truncation while retaining the source tail');
  assert.equal(await renderer.evaluate(`document.querySelector('.subagent-output__body').textContent.includes(${JSON.stringify(firstMarker)})`),false);
  await until('Boolean(document.querySelector(".subagent-output__empty > button.icon-button"))');

  await main.evaluate(`(()=>{
    const {ipcMain}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    globalThis.__taskPreviewHandlers=ipcMain._invokeHandlers;
    globalThis.__taskPreviewOriginal=globalThis.__taskPreviewHandlers.get('workbench:subagent-output');
    if(typeof globalThis.__taskPreviewOriginal!=='function')throw new Error('Missing owned preview handler');
    globalThis.__taskPreviewFailures=0;
    globalThis.__taskPreviewHandlers.set('workbench:subagent-output',(event,parentId,sessionId)=>{
      if(parentId===${JSON.stringify(parent.id)}&&sessionId===${JSON.stringify(first)}){
        globalThis.__taskPreviewFailures++;
        throw new Error(${JSON.stringify(previewError)});
      }
      return globalThis.__taskPreviewOriginal(event,parentId,sessionId);
    });
    return true;
  })()`);
  try{
    await renderer.evaluate('document.querySelector(".subagent-output__header button").click();true');
    const errorSelector='.subagent-output__body [role=alert] .expandable-text';
    await until(`Boolean(document.querySelector(${JSON.stringify(errorSelector)}))`);
    const compact=await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(errorSelector)});return{open:el.open,body:Boolean(el.querySelector('pre')),text:el.querySelector('summary').textContent}})()`);
    assert.equal(compact.open,false);assert.equal(compact.body,false);assert.ok(compact.text.includes('CHILD_PREVIEW_FAILURE_START'));
    await renderer.evaluate(`document.querySelector(${JSON.stringify(errorSelector)}).querySelector('summary').click();true`);
    await until(`document.querySelector(${JSON.stringify(errorSelector)})?.querySelector('pre')?.textContent.includes(${JSON.stringify(previewErrorTail)})`);
    const expanded=await renderer.evaluate(`document.querySelector(${JSON.stringify(errorSelector)}).querySelector('pre').textContent`);
    assert.ok(expanded.includes(previewError)&&expanded.includes(`\n\n${previewErrorTail}`),'The child loading error must retain its entire diagnostic and blank line');
    await renderer.evaluate("window.__taskPreviewCopy=null;Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.__taskPreviewCopy=text}});true");
    await renderer.evaluate(`document.querySelector(${JSON.stringify(errorSelector)}).querySelector('.copy-control button').click();true`);
    await until('window.__taskPreviewCopy!==null');
    assert.equal(await renderer.evaluate('window.__taskPreviewCopy'),expanded,'Copy must retain the exact complete child preview loading error');
    assert.ok(await main.evaluate('globalThis.__taskPreviewFailures>0'));
    await renderer.evaluate(`(()=>{
      const body=document.querySelector('.subagent-output__body');
      const summary=document.querySelector(${JSON.stringify(errorSelector)}).querySelector('summary');
      body.scrollTop+=summary.getBoundingClientRect().top-body.getBoundingClientRect().top;
      return true;
    })()`);
    await shot('v130-child-preview-error-expanded-zh-night');
  }finally{
    assert.equal(await main.evaluate(`(()=>{
      globalThis.__taskPreviewHandlers.set('workbench:subagent-output',globalThis.__taskPreviewOriginal);
      const restored=globalThis.__taskPreviewHandlers.get('workbench:subagent-output')===globalThis.__taskPreviewOriginal;
      delete globalThis.__taskPreviewHandlers;delete globalThis.__taskPreviewOriginal;delete globalThis.__taskPreviewFailures;
      return restored;
    })()`),true,'The temporary owned IPC failure handler must be restored');
  }
  await renderer.evaluate('document.querySelector(".subagent-output__header button").click();true');
  await until(`!document.querySelector('.subagent-output__body [role=alert]')&&document.querySelector('.subagent-output__body')?.textContent.includes(${JSON.stringify(lastMarker)})`);
  passed.push('An injected failure in only the owned child-preview IPC expands and copies its complete diagnostic; restoring the original handler and refreshing recovers the real saved SSE preview');
  await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .subagent-output__empty > button.icon-button').click();true`);
  await until(`Boolean(document.getElementById(${JSON.stringify(`message-${childPrompt.id}`)}))&&Boolean(document.querySelector('.parent-session-link'))&&!document.querySelector('.subagent-output')&&document.querySelector('.conversation')?.textContent.includes(${JSON.stringify(firstMarker)})&&document.querySelector('.conversation')?.textContent.includes(${JSON.stringify(lastMarker)})`);
  await shot('v130-child-preview-full-session-zh-night');
  passed.push('A real child source above 12k is explicitly truncated only in its preview; the preview arrow opens the correct child session with both original source markers available');
  await select(parent.id);await click('.task-workbench__toolbar button','Agent 任务树');
  await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand').click();true`);
  await until(`document.querySelector('.subagent-output')?.textContent.includes(${JSON.stringify(lastMarker)})`);
  await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .agent-task-tree__name').click();true`);
  await until('Boolean(document.querySelector(".parent-session-link"))&&!document.querySelector(".subagent-output")&&document.querySelector(".conversation")?.textContent.includes("FINAL_WORKER_")');
  await select(parent.id);await click('.task-workbench__toolbar button','Agent 任务树');
  await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand').click();true`);await until('document.querySelector(".subagent-output")?.textContent.includes("FINAL_WORKER_")');
  await renderer.send('Page.reload');await until('Boolean(document.querySelector(".task-workbench"))');await click('.task-workbench__toolbar button','Agent 任务树');await until(`Boolean(document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand'))`);await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand').click();true`);await until('document.querySelector(".subagent-output")?.textContent.includes("FINAL_WORKER_")');
  passed.push('Keyboard collapse, completed tool/text output, name-only navigation and local output after renderer reload work');
  await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(parent.id)})`);await until(`window.mingshen.getSession(${JSON.stringify(parent.id)}).then(s=>s.status==='interrupted')`);
  await click('.task-workbench__toolbar button','计划与待办');await until('document.querySelector(".plan-step--in_progress")?.dataset.stepState==="已中断"');assert.equal(await renderer.evaluate('document.querySelectorAll(".plan-step .spin").length'),0);
  const state=await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(parent.id)})`);
  const updated=await renderer.evaluate(`window.mingshen.updatePlan(${JSON.stringify({sessionId:parent.id,revision:state.plan.revision,paused:true,breakpoints:['next'],steps:state.plan.steps.map(s=>s.id==='current'?{...s,content:'User saved current plan after stop'}:s)})})`);
  await until('document.querySelector(".plan-step--in_progress")?.dataset.stepState==="已暂停"');
  await shot('v126-plan-paused-zh-night');
  await close();await launch();await until('Boolean(document.querySelector(".task-workbench"))');await select(parent.id);
  assert.deepEqual((await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(parent.id)})`)).plan,updated);
  await click('.task-workbench button','从恢复点继续');await until(`window.mingshen.getSession(${JSON.stringify(parent.id)}).then(s=>s.status==='idle')`);
  const resumed=(await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(parent.id)})`)).plan;
  const fields=plan=>plan.steps.map(({id,content,status,dependsOn})=>({id,content,status,dependsOn}));assert.deepEqual(fields(resumed),fields(updated));assert.deepEqual(resumed.breakpoints,['next']);assert.equal(resumed.paused,false);
  const inputText=item=>typeof item.content==='string'?item.content:(item.content??[]).map(part=>part.text??'').join('\n');
  const request=requests.findLast(r=>r.input?.some(item=>inputText(item).includes('User saved current plan after stop')));
  assert.ok(request,'The resumed request must carry the user-edited plan');
  const planContext=request.input.filter(item=>item.role==='user').map(inputText).findLast(value=>value.startsWith('[HOST_CONTEXT plan]'));
  assert.ok(planContext,'The latest plan must travel as chronological host context');
  const sentPlan=JSON.parse(planContext.split('\n').at(-1));
  assert.deepEqual(fields(sentPlan),fields(updated));assert.deepEqual(sentPlan.breakpoints,['next']);assert.equal(sentPlan.paused,false);
  assert.ok(request.input.some(item=>item.role==='user'&&!inputText(item).startsWith('[HOST_CONTEXT')&&inputText(item).includes('User saved current plan after stop')),'The explicit resume message must also include the current plan');
  await until('document.querySelector(".plan-step--in_progress")?.dataset.stepState==="待继续"');assert.equal(await renderer.evaluate('document.querySelectorAll(".plan-step .spin").length'),0);await shot('v126-plan-resumed-zh-night');
  passed.push('Stop/restart preserves plan/todos; resume sends latest user-edited IDs/status/dependencies/breakpoints in chronological host context and explicit message, without resetting progress');
  await renderer.send('Emulation.setDeviceMetricsOverride',{width:1040,height:680,deviceScaleFactor:1,mobile:false});
  await renderer.evaluate('window.mingshen.desktopAction("locale","en").then(()=>{localStorage.setItem("mingshen.locale","en");localStorage.setItem("mingshen.theme","day")})');await renderer.send('Page.reload');await until('document.documentElement.lang==="en"&&Boolean(document.querySelector(".task-workbench"))');await click('.task-workbench__toolbar button','Agent task tree');await until(`Boolean(document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand'))`);await renderer.evaluate(`document.querySelector('[data-agent-session="${first}"] .agent-task-tree__expand').click();true`);await until('document.querySelector(".subagent-output")?.textContent.includes("FINAL_WORKER_")');
  const layout=await renderer.evaluate('(()=>{const p=document.querySelector(".subagent-output").getBoundingClientRect(),b=document.querySelector(".subagent-output__body"),v=b.getBoundingClientRect(),panel=document.querySelector(".task-workbench__body").getBoundingClientRect(),workbench=document.querySelector(".task-workbench").getBoundingClientRect(),c=document.querySelector(".composer textarea").getBoundingClientRect();return {left:p.left,right:p.right,w:innerWidth,bottom:c.bottom,h:innerHeight,outputTop:v.top,panelTop:panel.top,panelBottom:panel.bottom,workbenchBottom:workbench.bottom,drawer:document.querySelector(".app-body").dataset.inspectorDrawer,overflow:getComputedStyle(b).overflowY}})()');assert.ok(layout.left>=0&&layout.right<=layout.w&&layout.bottom<=layout.h);assert.ok(layout.outputTop>=layout.panelTop&&layout.outputTop+32<=layout.panelBottom);assert.ok(layout.panelBottom<=layout.workbenchBottom+1&&layout.workbenchBottom<=layout.h+1,JSON.stringify(layout));assert.equal(layout.drawer,'true');assert.equal(layout.overflow,'auto');await shot('v126-child-output-en-day-compact');
  await click('.task-workbench__toolbar button','Plan and todos');assert.equal(await renderer.evaluate('document.querySelector(".plan-step--in_progress > small").textContent'),'Awaiting continuation');assert.equal(await renderer.evaluate('document.querySelectorAll(".plan-step .spin").length'),0);
  passed.push('English/day compact layout keeps output independently scrollable and composer visible, with static unfinished-step labels');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,requests:requests.length,screenshots,version,boundaries:['Child read_file results and long source text come from real owned local Responses SSE runs.','The child-preview loading error is injected only into the temporary Electron IPC handler and restored before the remaining scenarios.','Copy capture stays inside the isolated renderer and does not access the system clipboard.']},null,2));
}catch(cause){console.error(JSON.stringify({passed,errors,body:await renderer?.evaluate('document.body.innerText').catch(()=>null)},null,2));if(renderer)await shot('v126-task-preview-failure').catch(()=>{});throw cause;}
finally{hold=false;await close();await new Promise(done=>server.close(done));if(!temporary.startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe cleanup');await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
