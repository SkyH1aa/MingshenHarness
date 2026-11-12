import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { scannedPdf } = require(resolve('scripts/fixtures/document-fixtures.cjs'));
const { zipSync, strToU8 } = require('fflate');
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-document-vision-'));
const requests = [], errors = [], passed = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, main, renderer;
const server = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ url: request.url, body });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const events = request.url.endsWith('/messages') ? [{type:'content_block_delta',delta:{type:'text_delta',text:'Read'}},{type:'message_stop'}] : request.url.endsWith('/responses') ? [{type:'response.output_text.delta',delta:'Read'},{type:'response.completed',response:{usage:{input_tokens:1800,output_tokens:10}}}] : [{choices:[{delta:{content:'Read'},finish_reason:'stop'}]},'[DONE]'];
    for (const event of events) response.write(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`);
    response.end();
  } catch (error) { errors.push(String(error)); response.destroy(); }
});
async function connect(port) {
  let target; for (let index=0;index<160;index++) { try { target=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(t=>t.webSocketDebuggerUrl); if(target)break; }catch{} await sleep(70); }
  assert.ok(target, `Debugger ${port} unavailable`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let next=0;
  await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);const p=pending.get(value.id);if(!p)return;pending.delete(value.id);clearTimeout(p.timer);value.error?p.reject(new Error(value.error.message)):p.done(value.result);});
  const send=(method,params={})=>new Promise((done,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout ${method}`));},60000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;};
  return {send,evaluate,close:()=>socket.close()};
}
async function until(expression) { const end=Date.now()+60000;while(Date.now()<end){if(await renderer.evaluate(expression))return;await sleep(80);}throw new Error(`Timeout: ${expression}`); }
async function launch() {
  const env={...process.env,MSH_EXPERIMENTAL:'1',MSH_USER_DATA_DIR:resolve(temporary,'profile'),MSH_DISABLE_AUTO_DEPENDENCIES:'1',MSH_NOTIFICATION_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.argv.includes('--app') ? resolve(process.argv[process.argv.indexOf('--app')+1]) : resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe');
  const args=['--inspect=9378','--remote-debugging-port=9377']; if(!process.argv.includes('--app'))args.push('.');
  child=spawn(executable,args,{cwd:resolve('apps/desktop'),env,windowsHide:true,stdio:'ignore'});
  main=await connect(9378);await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  renderer=await connect(9377);await renderer.send('Runtime.enable');
}
async function close() {
  if(!child)return;const process=child,ended=new Promise(done=>process.once('exit',done));await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(()=>{});renderer?.close();main?.close();renderer=null;main=null;await Promise.race([ended,sleep(7000)]);if(process.exitCode===null){process.kill();await ended;}child=null;
}
const file=(name,mimeType,bytes)=>({name,mimeType,kind:'file',size:bytes.length,dataUrl:`data:${mimeType};base64,${bytes.toString('base64')}`});
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  execFileSync(process.execPath,[resolve('scripts/prepare-experimental-runtime.cjs')],{windowsHide:true,stdio:'pipe'});
  await launch();await until('Boolean(document.querySelector(".policy-consents"))');await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  for(const text of ['同意并继续','开始使用']){await until(`[...document.querySelectorAll('.policy-dialog button')].some(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`);await renderer.evaluate(`[...document.querySelectorAll('.policy-dialog button')].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)}).click();true`);}
  await until('!document.querySelector(".policy-dialog")');
  await renderer.evaluate('(async()=>{for(const s of await window.mingshen.listMcpServers())if(s.enabled)await window.mingshen.setMcpServerEnabled(s.id,false);})()');
  const scan=file('handwritten-scan.pdf','application/pdf',scannedPdf({handwriting:true,mixed:true}));
  const doc=file('legacy.doc','application/msword',await readFile(resolve('scripts/fixtures/legacy-word-test01.doc')));
  const docx=file('modern.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',Buffer.from(zipSync({'[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Modern Word evidence 127</w:t></w:r></w:p></w:body></w:document>')})));
  const sessions=[];
  for(const [protocol,modalities]of [['openai_responses',['text']],['openai_responses',['text','image']],['openai_chat_completions',['text','image','file']],['anthropic_messages',['text','image']],['openai_responses',['text','file']],['anthropic_messages',['text','file']]]) {
    const session=await renderer.evaluate(`(async()=>{const provider=await window.mingshen.createProvider({name:${JSON.stringify(protocol+modalities.join('-'))},baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:${JSON.stringify(protocol)},authMode:'bearer',apiKey:'local-document-fixture',keyLabel:'Fixture',neverReveal:true});const p=await window.mingshen.createModel({providerId:provider.id,modelId:'fixture',contextWindow:200000,maxOutputTokens:4096,inputModalities:${JSON.stringify(modalities)},toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});return window.mingshen.createSession({title:'Document fixture',providerId:provider.id,modelId:p.models[0].id,workspacePath:null,reasoningLevel:null,permissionMode:'full_access',agentProfileId:'primary'});})()`);
    sessions.push(session);
    const before=requests.length;
    await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:'Read these documents',attachments:${JSON.stringify(modalities.length===1?[scan,doc,docx]:[scan])}})`);
    await until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>s.status==='idle'||s.status==='error')`);
    const completedSession = await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(session.id)})`);
    if (completedSession.status !== 'idle') {
      const diagnostic = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(session.id)})`);
      const compact = diagnostic.map(message => ({ role: message.role, parts: message.parts.map(part => part.type === 'text' ? part.text?.slice(0, 400) : part.type === 'tool_result' ? part.output?.slice(0, 800) : part.type === 'error' ? part : { type: part.type, name: part.name, isError: part.isError }) }));
      throw new Error(`Document session failed: status=${completedSession.status} messages=${JSON.stringify(compact)}`);
    }
    const body=requests.slice(before).find(item=>item.url.endsWith(protocol==='anthropic_messages'?'/messages':protocol==='openai_responses'?'/responses':'/chat/completions'))?.body;
    assert.ok(body);
    const content=protocol==='openai_responses'?body.input[0].content:body.messages.find(message=>message.role==='user').content;
    if(modalities.length===1){const text=JSON.stringify(content);assert.ok(text.includes('Offline PDF scan evidence 127'));assert.ok(text.replace(/\s/g,'').includes('中文扫描文档测试'));assert.ok(text.includes('Unicode characters'));assert.ok(text.includes('Modern Word evidence 127'));}
    else if(modalities.includes('file')&&protocol!=='openai_chat_completions')assert.ok(content.some(part=>part.type===(protocol==='openai_responses'?'input_file':'document')));
    else {const image=content.find(part=>['input_image','image','image_url'].includes(part.type));assert.ok(image);const encoded=protocol==='anthropic_messages'?image.source.data:(protocol==='openai_responses'?image.image_url:image.image_url.url).split(',')[1];assert.equal(Buffer.from(encoded,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');}
    const messages=await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(session.id)})`);
    assert.ok(!messages.some(message=>message.parts.some(part=>part.attachment?.documentPageImages)));
    passed.push(`${protocol} ${modalities.join('+')}: actual document bytes, correct model payload, no persisted page images`);
  }
  await close();await launch();await until('Boolean(document.querySelector(".composer"))');
  const session=sessions[1],before=requests.length;
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:'Read the earlier PDF again after restart'})`);
  await until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>s.status==='idle'||s.status==='error')`);
  assert.ok(requests.slice(before).some(item=>JSON.stringify(item.body).includes('input_image')));
  passed.push('Restart reconstructs PDF page images from original saved attachment without reparsing errors');
  const cancelSession=sessions[0]; const many=file('long-scan.pdf','application/pdf',scannedPdf({pages:20}));const beforeCancel=requests.length;
  await renderer.evaluate(`globalThis.__pendingDoc=window.mingshen.sendChat({sessionId:${JSON.stringify(cancelSession.id)},text:'Cancel parsing',attachments:${JSON.stringify([many])}}).then(()=>({ok:true}),error=>({error:String(error)}));true`);
  await sleep(700);await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(cancelSession.id)})`);
  assert.ok((await renderer.evaluate('globalThis.__pendingDoc')).error);
  assert.equal(requests.length,beforeCancel);
  passed.push('Stop during real OCR cancels pending send before a model request and leaves no partial user message');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed,requests:requests.length,version:'1.2.7',packaged:process.argv.includes('--app')},null,2));
} finally {
  await close();await new Promise(done=>server.close(done));assert.ok(temporary.startsWith(resolve(tmpdir())+sep));await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
