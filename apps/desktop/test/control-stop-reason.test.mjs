import assert from 'node:assert/strict';import test from 'node:test';import {ControlProtocol} from '../runtime/control.mjs';
for(const reason of ['quit','eof','failure','malformed'])test(`control distinguishes ${reason} from a requested orderly quit`,async()=>{
  const generation='a'.repeat(32),control=new ControlProtocol(generation,{onStop(){},onCommand(){}}),send=command=>control.push(Buffer.from(JSON.stringify({version:1,generation,command})+'\n'));
  send('start');await control.started;
  if(reason==='quit')send('quit');if(reason==='eof')control.end();if(reason==='failure')control.fail();if(reason==='malformed')send('invalid');
  await control.stopped;assert.equal(control.quitRequested,reason==='quit');assert.equal(control.signal.aborted,true);
  if(reason==='quit'){control.fail();assert.equal(control.failed,true);}
});
