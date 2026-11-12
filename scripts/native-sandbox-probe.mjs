import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root=await mkdtemp(join(tmpdir(),'mingshen-native-probe-'));
const home=join(root,'home');const work=join(root,'work');await mkdir(home);await mkdir(work);
await writeFile(join(home,'config.toml'),`default_permissions = "mingshen"\n[windows]\nsandbox = "mxc"\n[permissions.mingshen.filesystem]\n":minimal" = "read"\n${JSON.stringify(work.replaceAll('\\','/'))} = "write"\n[permissions.mingshen.network]\nenabled = false\n`);
const executable=resolve('.tmp-runtime-downloads/codex-sandbox/codex-x86_64-pc-windows-msvc.exe');
const secret=join(root,'secret.txt');await writeFile(secret,'OUTSIDE_SENTINEL');
const script=`$ErrorActionPreference='Stop'; $inputText=[Console]::In.ReadToEnd(); if($inputText -ne 'PAYLOAD_TEST'){throw 'stdin not forwarded'};[IO.File]::WriteAllText('probe.txt','inside');try{[IO.File]::ReadAllText('${secret}');throw 'OUTSIDE_READ_ALLOWED'}catch{if($_.Exception.Message -eq 'OUTSIDE_READ_ALLOWED'){throw};'OUTSIDE_READ_BLOCKED'};try{[IO.File]::WriteAllText('${secret}','escaped');throw 'OUTSIDE_WRITE_ALLOWED'}catch{if($_.Exception.Message -eq 'OUTSIDE_WRITE_ALLOWED'){throw};'OUTSIDE_WRITE_BLOCKED'};'NATIVE_OK'`;
const args=['-c','windows.sandbox="mxc"','sandbox','-P','mingshen','-C',work,'--','C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
try{const child=spawn(executable,args,{windowsHide:true,env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.stdin.end('PAYLOAD_TEST');const code=await new Promise((r,j)=>{child.on('exit',r);child.on('error',j)});if(await readFile(secret,'utf8')!=='OUTSIDE_SENTINEL')throw new Error('Outside file changed');console.log('Exit:',code);process.exitCode=code??1;}finally{const checked=resolve(root);if(!checked.startsWith(resolve(tmpdir())+'\\mingshen-native-probe-'))throw new Error('Unsafe cleanup target');await rm(checked,{recursive:true,force:true});}
