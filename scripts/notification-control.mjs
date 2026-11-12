const targets = await fetch('http://127.0.0.1:9341/json').then(r => r.json());
const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
const expression = process.argv[2] || "window.mingshen.desktopAction('show')";
const result = await new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP timeout')), 10000);
  socket.addEventListener('message', e => { const value = JSON.parse(String(e.data)); if (value.id === 1) { clearTimeout(timer); value.error || value.result.exceptionDetails ? reject(value.error || value.result.exceptionDetails) : done(value.result.result.value); } });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
console.log(JSON.stringify(result)); socket.close();
