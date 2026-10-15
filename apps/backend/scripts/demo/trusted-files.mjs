import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { privatePath, safeError } from './files.mjs';
export const exists = async file => { try { await fs.lstat(file); return true; } catch(e) { if(e.code==='ENOENT')return false; throw e; } };
export function administratorCaskroom(directory,s,{command,executable,platform=process.platform}={}){
  return platform==='darwin'&&command==='codex'&&executable==='/opt/homebrew/Caskroom/codex/0.160.0/bin/codex'&&directory==='/opt/homebrew/Caskroom'&&s.uid===process.getuid()&&s.gid===80&&(s.mode&0o7777)===0o775;
}
export async function trustedDirectory(directory, privateLeaf=true,executableContext={}){
  if(!path.isAbsolute(directory)||path.resolve(directory)!==directory||/[\x00-\x1f\x7f]/.test(directory)||await fs.realpath(directory)!==directory)throw safeError('Path must be canonical.');
  for(let current=directory;;current=path.dirname(current)){
    const s=await fs.lstat(current);
    if(!s.isDirectory()||![0,process.getuid()].includes(s.uid)||((s.mode&0o022)&&!(s.uid===0&&(s.mode&0o1000))&&!administratorCaskroom(current,s,executableContext)))throw safeError('Untrusted directory ancestry.');
    if(path.dirname(current)===current)break;
  }
  if(privateLeaf)await privatePath(directory,true);
}
export async function trustedBytes(file,maxBytes=512*1024*1024,options={}){
  await trustedDirectory(path.dirname(file),false,options);
  if(await fs.realpath(file)!==file)throw safeError('Source must be canonical.');
  const before=await fs.lstat(file);
  if(!before.isFile()||before.nlink!==1||![0,process.getuid()].includes(before.uid)||(before.mode&0o022)||before.size>maxBytes)throw safeError('Untrusted source file.');
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const opened=await h.stat(),bytes=await h.readFile(),after=await h.stat(),named=await fs.lstat(file);
    if([opened,after,named].some(s=>s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size||s.mode!==before.mode||s.uid!==before.uid||s.nlink!==1||s.ctimeMs!==before.ctimeMs||s.mtimeMs!==before.mtimeMs)||bytes.length!==before.size)throw safeError('Source changed during inspection.');return bytes;
  }finally{await h.close();}
}
export async function durable(file){
  const temporary=['/tmp','/private/tmp','/var/tmp','/private/var/tmp','/var/folders','/private/var/folders',await fs.realpath(os.tmpdir())];
  if(temporary.some(root=>file===root||file.startsWith(root+path.sep)))throw safeError('Desktop references must be durable, outside temporary directories.');
}
export async function syncDirectory(dir){const h=await fs.open(dir,'r');try{await h.sync();}finally{await h.close();}}
export async function writeSynced(file,bytes,mode=0o600){const h=await fs.open(file,'wx',mode);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}await syncDirectory(path.dirname(file));}
export const writeSyncedJson=(file,value)=>writeSynced(file,JSON.stringify(value,null,2)+'\n');
export async function ensurePrivateDirectory(dir){try{await fs.mkdir(dir,{mode:0o700});await syncDirectory(path.dirname(dir));}catch(e){if(e.code!=='EEXIST')throw e;}await trustedDirectory(dir);}
