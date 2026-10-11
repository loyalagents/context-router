import assert from 'node:assert/strict';import test from 'node:test';import {ControlProtocol} from '../runtime/control.mjs';
for(const prior of ['none','quit','eof','failure','partial','not-started'])test(`signal stop preserves prior ${prior} control evidence`,async()=>{
  const generation='a'.repeat(32),control=new ControlProtocol(generation,{onStop(){},onCommand(){}}),send=command=>control.push(Buffer.from(JSON.stringify({version:1,generation,command})+'\n'));
  try{
    if(prior!=='not-started'){send('start');await control.started;}
    if(prior==='quit')send('quit');if(prior==='eof')control.end();if(prior==='failure')control.fail();if(prior==='partial')control.push(Buffer.from('{'));
    control.requestSignalStop();await control.stopped;
    assert.equal(control.quitRequested,prior==='quit');assert.equal(control.orderlyStopRequested,['none','quit'].includes(prior));
    assert.equal(control.failed,['failure','partial','not-started'].includes(prior));
    control.fail();assert.equal(control.failed,true);assert.equal(control.orderlyStopRequested,false);
  }finally{control.fail();}
});
