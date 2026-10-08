import { Socket } from 'node:net';
import { ControlProtocol } from '../../runtime/control.mjs';
const commands=[];
try {
  const c=new ControlProtocol('a'.repeat(32),{onStop:()=>{},onCommand:command=>commands.push(command)});
  // Node's fixture stdio uses Unix socketpairs. Native cohort tests separately
  // exercise ManagedControl's required anonymous FIFO descriptors.
  const input=new Socket({fd:5,readable:true,writable:false});
  input.on('data',bytes=>c.push(bytes));input.on('end',()=>c.end());input.on('error',()=>c.fail());
  await c.started;await c.stopped;
  input.destroy();if(c.failed)throw new Error();
  process.stdout.write(JSON.stringify({started:true,commands,stopped:c.signal.aborted}));
}catch{process.stderr.write('control-rejected\n');process.exitCode=1;}
