import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const MODEL = Object.freeze({ name:'Qwen3.5-9B-Q4_K_M.gguf', bytes:5680522464,
  sha256:'03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
  url:'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf',
  redirectHosts:Object.freeze(['huggingface.co','cdn-lfs.huggingface.co','cdn-lfs-us-1.hf.co','cas-bridge.xethub.hf.co','us.aws.cdn.hf.co']) });
export async function inspectModel(root, signal) {
  const file = path.join(root,MODEL.name);
  let fd;
  try {
    const directory=await lstat(root), before=await lstat(file);
    if (!directory.isDirectory()||directory.uid!==process.getuid()||(directory.mode&0o7777)!==0o700||await realpath(root)!==root||
        !before.isFile()||before.uid!==process.getuid()||(before.mode&0o7777)!==0o600||before.nlink!==1||before.size!==MODEL.bytes) return false;
    fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const opened=await fd.stat();if(opened.dev!==before.dev||opened.ino!==before.ino)return false;
    const block=Buffer.alloc(1024*1024),hash=createHash('sha256');let position=0;
    while(position<MODEL.bytes){signal?.throwIfAborted();const {bytesRead}=await fd.read(block,0,Math.min(block.length,MODEL.bytes-position),position);if(!bytesRead)return false;hash.update(block.subarray(0,bytesRead));position+=bytesRead;}
    const after=await lstat(file),last=await fd.stat();
    return [after,last].every(s=>s.dev===before.dev&&s.ino===before.ino&&s.size===before.size&&s.mode===before.mode&&s.nlink===1&&s.mtimeMs===before.mtimeMs&&s.ctimeMs===before.ctimeMs)&&hash.digest('hex')===MODEL.sha256;
  } catch { return false; } finally { await fd?.close(); }
}
