import { spawn } from 'node:child_process';

const names = process.argv.slice(2);
const scripts = names.length ? names : [
  'settings-focus', 'desktop', 'chat-scroll', 'question-nav',
  'approval-recovery', 'agent-questions', 'agent-selection',
  'conversation-actions', 'compaction', 'context-restore',
  'v125', 'v126-workbench', 'task-workbench-ui',
  'v127-plan-attachments', 'document-vision', 'approval-notification',
];
const results = [];
for (const name of scripts) {
  const started = Date.now();
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [`scripts/${name}-smoke.mjs`], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', done);
  });
  results.push({ name, code, seconds: Math.round((Date.now() - started) / 1000) });
  console.log(JSON.stringify({ regression: results.at(-1) }));
}
console.log(JSON.stringify({ results }, null, 2));
if (results.some(item => item.code !== 0)) process.exitCode = 1;
