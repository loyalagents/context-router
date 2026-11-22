import {randomBytes} from 'node:crypto';
const busy = new Set(['checking','choosing-project','terminal-opened','signing-in']);
/** Native capability injected only by the managed demo composition. No shell arguments cross HTTP. */
export function createDemoClaude({cap,send,readProgress,readClient,assertActive=()=>{}}) {
  if(cap?.mode!=='demo')throw new Error('Demo launcher unavailable');
  let current,phaseStartedAt=0,phase;
  const transition=state=>{if(state!==phase){phase=state;phaseStartedAt=Date.now();}current.state=state;};
  async function status() {
    assertActive();
    if(current){
      const observed=current;
      const state=await readProgress(observed.request);
      if(state&&current===observed)transition(state);
      // Missing progress is never success, and never triggers a new invocation.
      if(['checking','terminal-opened'].includes(current.state)&&Date.now()-phaseStartedAt>180000)current.state='unconfirmed';
    }
    const clientId=await readClient();assertActive();
    return {available:true,clientId,state:'idle',...current,busy:!!current&&busy.has(current.state)};
  }
  return {
    status,
    async open(chooseProject){
      assertActive();if(typeof chooseProject!=='boolean')throw new Error('Invalid request');
      if(current&&busy.has(current.state))return status();
      const requested={request:randomBytes(16).toString('hex'),startedAt:new Date().toISOString(),state:'checking'};current=requested;phase='checking';phaseStartedAt=Date.now();
      try{await send('demo-claude-open',{request:requested.request,chooseProject});}catch{if(current===requested)requested.state='failed';}
      return status();
    },
    accept({request,state}){if(current?.request===request)transition(state);},
  };
}
