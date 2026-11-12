import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dockerExecutable } from '../apps/desktop/src/main/workspace/docker-path.ts';
import { safeFilePath } from '../apps/desktop/src/main/workspace/safe-file-path.ts';
const root=await mkdtemp(join(tmpdir(),'mingshen-link-check-'));
const outside=await mkdtemp(join(tmpdir(),'mingshen-private-check-'));
try {
  const workspace=join(root,'work');await mkdir(workspace);await writeFile(join(outside,'secret'),'sentinel');
  await symlink(outside,join(workspace,'escape'),'junction');
  await assert.rejects(safeFilePath(workspace,'escape/secret'));
  await assert.rejects(safeFilePath(workspace,'../secret'));
  await assert.rejects(safeFilePath(workspace,'.git/config'));
  assert.equal(await readFile(join(outside,'secret'),'utf8'),'sentinel');
  console.log('PASS: Windows directory-junction, traversal and Git metadata paths rejected; sentinel unchanged.');
  if(process.argv.includes('--docker')) {
    const command="if (Test-Path '/workspace/escape/secret') { throw 'HOST_SENTINEL_VISIBLE' }; 'host-link-inaccessible'";
    const output=await promisify(execFile)(dockerExecutable(),['run','--rm','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--network=none','--pids-limit=256','--memory=2g','--cpus=2','--tmpfs=/tmp:rw,nosuid,size=134217728','--mount',`type=bind,source=${workspace},target=/workspace`,'--entrypoint','pwsh','mcr.microsoft.com/powershell:lts-alpine','-NoProfile','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,timeout:60000});
    assert.ok(output.stdout.includes('host-link-inaccessible'),output.stdout);
    assert.equal(await readFile(join(outside,'secret'),'utf8'),'sentinel');
    console.log('PASS: Real Docker command cannot read the host sentinel through a Windows junction.');
  }
} finally {await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
