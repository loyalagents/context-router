import { activeDemo } from './active.mjs';
import { readCredential } from './mcp-bridge/credential.mjs';
import { createBridge } from './mcp-bridge/bridge.mjs';
try {
  if(process.versions.node!=='24.21.0'||['NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE'].some(key=>process.env[key]))throw new Error();
  const args=process.argv.slice(2),names=['--root','--store','--generation','--endpoint','--credential-file'];
  if(args.length!==names.length*2)throw new Error();const values={};
  for(let i=0;i<args.length;i+=2){if(!names.includes(args[i])||values[args[i]]||!args[i+1])throw new Error();values[args[i]]=args[i+1];}
  await activeDemo({root:values['--root'],store:values['--store'],generation:values['--generation'],endpoint:values['--endpoint']});
  const credential=readCredential(values['--credential-file']);
  const bridge=createBridge({input:process.stdin,output:process.stdout,diagnostics:process.stderr,credential,port:Number(new URL(values['--endpoint']).port)});
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>void bridge.close());
  await bridge.closed;process.exit(0);
}catch{process.stderr.write('Demo Desktop bridge unavailable. Use the current CR → Demo setup commands.\n');process.exitCode=1;}
