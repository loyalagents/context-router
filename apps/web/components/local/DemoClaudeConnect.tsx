'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {localGraphql, localJson} from '@/lib/authenticated-fetch';

type AccessReview = {reviewAccess:(clientId:string)=>void;canReviewAccess:(clientId:string)=>boolean};
type Setup = {available:boolean; state?:string; busy?:boolean; request?:string; startedAt?:string; clientId?:string};
const messagesFor=(name:string,version:string):Record<string,string> => ({
  idle:`Choose a project once. Sign in only when needed; ${name} opens with your demo context configured.`,
  checking:`Checking ${name} on this Mac…`,
  'choosing-project':'Choose your demo project in the Mac folder picker.',
  'terminal-opened':'Terminal opened. Continue there; sign-in will appear if needed.',
  'signing-in':`Complete ${name} sign-in in Terminal. Your project will open automatically afterward.`,
  starting:'Your latest chat is opening in Terminal. You can open another chat here and keep earlier chats running.',
  interrupted:`The latest ${name} launch or chat was interrupted. Earlier chats can stay open; you can open a fresh chat here.`,
  exited:'Your latest chat has closed. You can open a fresh conversation in the same project.',
  cancelled:`Project selection cancelled. Open ${name} when you’re ready.`,
  'login-failed':`Sign-in did not finish. Open ${name} to try again.`,
  failed:'Setup did not finish. Check Terminal for the reason.',
  busy:'Another Mac setup window is open. Finish or close it, then try again.',
  'client-unavailable':`${name} could not pass setup checks. In CR → Demo setup, use Choose executable to select ${name} ${version}, then try again.`,
  unconfirmed:'Launch is unconfirmed. Check Terminal before trying again; finish any sign-in already in progress.',
});
const query = `query DemoClaudeRead($input:McpAccessHistoryInput!){mcpAccessHistory(input:$input){items{clientKey occurredAt outcome operationName responseMetadata}}}`;
type ReadEvent = {clientKey:string;occurredAt:string;outcome:string;operationName:string;responseMetadata?:{activeCount?:number}};
export default function DemoClaudeConnect({reviewAccess,canReviewAccess}:AccessReview) {
  const [client,setClient]=useState<'claude'|'codex'>('claude');
  return <><div className="flex gap-3 flex-wrap mb-4" role="group" aria-label="Choose coding assistant">
    <button className={`demo-button ${client==='claude'?'demo-primary':''}`} aria-pressed={client==='claude'} onClick={()=>setClient('claude')}>Claude Code</button>
    <button className={`demo-button ${client==='codex'?'demo-primary':''}`} aria-pressed={client==='codex'} onClick={()=>setClient('codex')}>Codex CLI</button>
  </div><DemoCliConnect key={client} client={client} reviewAccess={reviewAccess} canReviewAccess={canReviewAccess}/></>;
}
function DemoCliConnect({client,reviewAccess,canReviewAccess}:AccessReview&{client:'claude'|'codex'}) {
  const name=client==='codex'?'Codex':'Claude Code',provider=client==='codex'?'OpenAI':'Anthropic';
  const messages=messagesFor(name,client==='codex'?'0.160.0':'2.1.299');
  const [setup,setSetup]=useState<Setup|null>(null),[error,setError]=useState(''),[launchError,setLaunchError]=useState(''),[submitting,setSubmitting]=useState(false),[lastRead,setLastRead]=useState<string|null>(null);
  const epoch=useRef(0),mounted=useRef(false),pending=useRef(false);
  const refresh=useCallback(async(signal:AbortSignal)=>{
    if(pending.current)return;
    const current=epoch.current;
    try{
      const next=await localJson<Setup>(`/api/local/demo/${client}/status`,{},signal);
      if(signal.aborted||current!==epoch.current)return;
      setSetup(next);setError('');
      if(next.clientId&&next.startedAt){
        const data=await localGraphql<{mcpAccessHistory:{items:ReadEvent[]}}>(query,{input:{first:20,clientKey:`local:${next.clientId}`,operationName:'searchPreferences',outcome:'SUCCESS',occurredFrom:next.startedAt}},signal);
        if(signal.aborted||current!==epoch.current)return;
        const event=data.mcpAccessHistory.items.find(item=>item.clientKey===`local:${next.clientId}`&&item.outcome==='SUCCESS'&&item.operationName==='searchPreferences'&&Date.parse(item.occurredAt)>=Date.parse(next.startedAt!)&&(item.responseMetadata?.activeCount??0)>0);
        setLastRead(event?.occurredAt??null);
      }else setLastRead(null);
    }catch{if(!signal.aborted&&current===epoch.current)setError(`Setup status is unavailable. Refresh before opening ${name} again.`);}
  },[client,name]);
  useEffect(()=>{
    mounted.current=true;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{await refresh(controller.signal);if(!controller.signal.aborted)timer=setTimeout(poll,2000);};void poll();
    return()=>{mounted.current=false;controller.abort();clearTimeout(timer);epoch.current++;};
  },[refresh]);
  async function open(chooseProject=false){
    if(pending.current)return;pending.current=true;epoch.current++;setSubmitting(true);setLaunchError('');setError('');setLastRead(null);
    try{const next=await localJson<Setup>(`/api/local/demo/${client}/open`,{chooseProject});if(mounted.current)setSetup(next);}
    catch{if(mounted.current)setLaunchError('Launch could not be confirmed. Check Terminal before retrying.');}
    finally{pending.current=false;if(mounted.current)setSubmitting(false);}
  }
  const disabled=submitting||!!setup?.busy||!setup?.available||!!error;
  return <section className="demo-connection-intro" aria-label={`Connect ${name}`}>
    <h2>Your context, in {name}</h2>
    <p>Open a project in Terminal with your demo context already connected.</p>
    <div className="demo-setup-steps">
      <div><span className="demo-step-number">1</span><h3>Open your project</h3>
        <p>Each click starts a fresh chat. Chats share your demo sign-in and context permissions.</p>
        <div className="flex gap-3 flex-wrap mt-4"><button className="demo-button demo-primary" disabled={disabled} onClick={()=>void open()}>Open {name}</button><button className="demo-button" disabled={disabled} onClick={()=>void open(true)}>Change project</button></div>
      </div>
      <div><span className="demo-step-number">2</span><h3>Continue in Terminal</h3>
        <p role="status" aria-live="polite">{launchError||error||(!setup?'Checking setup availability…':!setup.available?`Open the installed Mac demo to launch ${name}.`:messages[setup.state??'idle']??'Check Terminal to continue.')}</p>
        <p className="mt-3">After restarting Context Router, open a fresh chat here to use the current connection.</p>
      </div>
      <div><span className="demo-step-number">3</span><h3>See your context in use</h3>
        <p>{lastRead?`Context read at ${new Date(lastRead).toLocaleTimeString()}.`:`Ask ${name} to read your saved context. Recent access will appear here.`}</p>
        {lastRead&&<p className="mt-2">Activity is shared across your demo chats; it does not identify a specific chat or show whether it is still open.</p>}
        <div className="flex gap-3 flex-wrap mt-4"><button className="demo-button" disabled={!setup?.clientId||!canReviewAccess(setup.clientId)} onClick={()=>{if(setup?.clientId)reviewAccess(setup.clientId);}}>Review access</button><Link prefetch={false} className="demo-button" href={setup?.clientId?`/dashboard/history#mcp-client=${encodeURIComponent(setup.clientId)}`:'/dashboard/history'}>View activity</Link></div>
      </div>
    </div>
    <p className="demo-provider-notice">Opening {name} allows {provider} sign-in and use of this synthetic demo context and your chosen project. {name} uses its normal file and command permissions.{client==='codex'&&' Saving context changes requires approval and your current access permissions.'}</p>
  </section>;
}
