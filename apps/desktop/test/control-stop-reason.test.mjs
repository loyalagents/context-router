import assert from 'node:assert/strict';import test from 'node:test';import {ControlProtocol} from '../runtime/control.mjs';
for(const reason of ['quit','eof','failure','malformed'])test(`control distinguishes ${reason} from a requested orderly quit`,async()=>{
  const generation='a'.repeat(32),control=new ControlProtocol(generation,{onStop(){},onCommand(){}}),send=command=>control.push(Buffer.from(JSON.stringify({version:1,generation,command})+'\n'));
  send('start');await control.started;
  if(reason==='quit')send('quit');if(reason==='eof')control.end();if(reason==='failure')control.fail();if(reason==='malformed')send('invalid');
  await control.stopped;assert.equal(control.quitRequested,reason==='quit');assert.equal(control.signal.aborted,true);
  if(reason==='quit'){control.fail();assert.equal(control.failed,true);}
});
test('finite preparation may retain authority for orderly cleanup, but later protocol loss revokes it', async () => {
  const generation = 'a'.repeat(32), stops = [];
  const control = new ControlProtocol(generation, { onStop: reason => stops.push(reason), onCommand() {} });
  const send = command => control.push(Buffer.from(JSON.stringify({ version: 1, generation, command }) + '\n'));
  send('start'); await control.started; send('quit'); await control.stopped;
  assert.deepEqual(stops, [{ orderly: true }]);
  control.fail();
  assert.deepEqual(stops, [{ orderly: true }, { orderly: false }]);
});
test('bytes after Quit in the same transport chunk revoke orderly cleanup authority',async()=>{
 const generation='a'.repeat(32),stops=[],control=new ControlProtocol(generation,{onStop:reason=>stops.push(reason),onCommand(){}});
 const frame=command=>JSON.stringify({version:1,generation,command})+'\n';
 control.push(Buffer.from(frame('start')+frame('quit')+'malformed\n'));await control.stopped;
 assert.equal(control.failed,true);assert.equal(control.orderlyStopRequested,false);assert.deepEqual(stops,[{orderly:true},{orderly:false}]);
});
