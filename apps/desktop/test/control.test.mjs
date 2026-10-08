import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
const generation = 'a'.repeat(32);
async function fixture(t) {
  const child = spawn(process.execPath, [join(import.meta.dirname,'fixtures/control-child.mjs')], { env:{},stdio:['ignore','pipe','pipe','ignore','ignore','pipe','pipe'] });
  const ended = once(child,'close'); let out='',err=''; child.stdout.on('data', b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});
  child.stdio[5].on('error',()=>{});child.stdio[6].resume();
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await ended;});
  return {child,ended,send:value=>child.stdio[5].write(JSON.stringify(value)+'\n'),output:()=>({out,err})};
}
test('private start/commands are generation-bound and EOF permanently stops admission',async t=>{
  const f=await fixture(t);
  f.send({version:1,generation,command:'start'});f.send({version:1,generation,command:'unlock'});f.child.stdio[5].end();
  assert.equal((await f.ended)[0],0);
  assert.deepEqual(JSON.parse(f.output().out),{started:true,commands:['unlock'],stopped:true});
});
for(const variant of ['wrong-generation','extra-field','unknown-command','partial','oversize','no-start']) test(`private channel rejects ${variant}`,async t=>{
  const f=await fixture(t), frame={version:1,generation,command:'start'};
  if(variant==='wrong-generation')frame.generation='b'.repeat(32);
  if(variant==='extra-field')frame.secret='canary';
  if(variant==='unknown-command')frame.command='exec';
  if(variant==='partial')f.child.stdio[5].write('{');
  else if(variant==='oversize')f.child.stdio[5].write('x'.repeat(16385));
  else if(variant!=='no-start')f.send(frame);
  f.child.stdio[5].end();assert.equal((await f.ended)[0],1);assert.equal(f.output().out,'');assert.equal(f.output().err,'control-rejected\n');
});
