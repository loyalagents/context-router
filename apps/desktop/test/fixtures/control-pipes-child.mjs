import * as implementation from '../../runtime/control.mjs';
const generation='a'.repeat(32);let stopped=false,control,ticks=0;
const timer=setInterval(()=>ticks++,10);
const open=implementation.openManagedControl??(async(g,handlers)=>{const c=new implementation.ManagedControl(g,handlers);await c.started;c.assertActive();return c;});
try {
  control=await open(generation,{onStop:()=>{stopped=true;},onCommand:()=>{}});
  if(process.argv[2]==='backpressure') {
    for(let n=0;n<1000;n++) await control.send('status',{message:'x'.repeat(8000)});
    throw new Error('output unexpectedly accepted');
  }
  throw new Error('admission unexpectedly accepted');
}catch{
  if(control)await control.close();clearInterval(timer);
  console.log(JSON.stringify({stopped,responsive:process.argv[2]!=='backpressure'||ticks>0}));
}
