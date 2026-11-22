'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {localGraphql, localJson} from '@/lib/authenticated-fetch';

type Setup = {available:boolean; state?:string; busy?:boolean; request?:string; startedAt?:string; clientId?:string};
const messages:Record<string,string> = {
  idle:'Choose a project once. Sign in only when needed; Claude opens with your demo context configured.',
  checking:'Checking Claude Code on this Mac…',
  'choosing-project':'Choose your demo project in the Mac folder picker.',
  'terminal-opened':'Terminal opened. Continue there; sign-in will appear if needed.',
  'signing-in':'Complete Claude sign-in in Terminal. Your project will open automatically afterward.',
  starting:'Continue in Claude Code in Terminal. Approve the project if prompted, then ask it to read your saved context.',
  exited:'Claude has closed. You can open a fresh conversation in the same project.',
  cancelled:'Project selection cancelled. Open Claude Code when you’re ready.',
  'login-failed':'Sign-in did not finish. Open Claude Code to try again.',
  failed:'Setup did not finish. Check Terminal for the reason. If Claude is already open, use /exit before reopening.',
  busy:'Another Mac setup window is open. Finish or close it, then try again.',
  'client-unavailable':'Claude could not pass setup checks. In CR → Demo setup, use Choose executable to select Claude Code 2.1.299, then try again.',
  unconfirmed:'Launch is unconfirmed. Check Terminal before trying again; exit any existing demo Claude session first.',
};
const query = `query DemoClaudeRead($input:McpAccessHistoryInput!){mcpAccessHistory(input:$input){items{clientKey occurredAt outcome operationName responseMetadata}}}`;
type ReadEvent = {clientKey:string;occurredAt:string;outcome:string;operationName:string;responseMetadata?:{activeCount?:number}};
export default function DemoClaudeConnect({reviewAccess}:{reviewAccess:()=>void}) {
  const [setup,setSetup]=useState<Setup|null>(null),[error,setError]=useState(''),[submitting,setSubmitting]=useState(false),[lastRead,setLastRead]=useState<string|null>(null);
  const epoch=useRef(0),mounted=useRef(false),pending=useRef(false);
  const refresh=useCallback(async(signal:AbortSignal)=>{
    if(pending.current)return;
    const current=epoch.current;
    try{
      const next=await localJson<Setup>('/api/local/demo/claude/status',{},signal);
      if(signal.aborted||current!==epoch.current)return;
      setSetup(next);setError('');
      if(next.clientId&&next.startedAt){
        const data=await localGraphql<{mcpAccessHistory:{items:ReadEvent[]}}>(query,{input:{first:20,clientKey:`local:${next.clientId}`,operationName:'searchPreferences',outcome:'SUCCESS',occurredFrom:next.startedAt}},signal);
        if(signal.aborted||current!==epoch.current)return;
        const event=data.mcpAccessHistory.items.find(item=>item.clientKey===`local:${next.clientId}`&&item.outcome==='SUCCESS'&&item.operationName==='searchPreferences'&&Date.parse(item.occurredAt)>=Date.parse(next.startedAt!)&&(item.responseMetadata?.activeCount??0)>0);
        setLastRead(event?.occurredAt??null);
      }else setLastRead(null);
    }catch{if(!signal.aborted&&current===epoch.current)setError('Setup status is unavailable. Refresh before opening Claude again.');}
  },[]);
  useEffect(()=>{
    mounted.current=true;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{await refresh(controller.signal);if(!controller.signal.aborted)timer=setTimeout(poll,2000);};void poll();
    return()=>{mounted.current=false;controller.abort();clearTimeout(timer);epoch.current++;};
  },[refresh]);
  async function open(chooseProject=false){
    if(pending.current)return;pending.current=true;epoch.current++;setSubmitting(true);setError('');setLastRead(null);
    try{const next=await localJson<Setup>('/api/local/demo/claude/open',{chooseProject});if(mounted.current)setSetup(next);}
    catch{if(mounted.current)setError('Launch could not be confirmed. Check Terminal before retrying.');}
    finally{pending.current=false;if(mounted.current)setSubmitting(false);}
  }
  const disabled=submitting||!!setup?.busy||!setup?.available||!!error;
  return <section className="demo-connection-intro" aria-label="Connect Claude Code">
    <h2>Your context, in Claude Code</h2>
    <p>Open a project in Terminal with your demo context already connected.</p>
    <div className="demo-setup-steps">
      <div><span className="demo-step-number">1</span><h3>Open your project</h3>
        <p>Normal coding tools, a separate demo sign-in, and your existing context permissions.</p>
        <div className="flex gap-3 flex-wrap mt-4"><button className="demo-button demo-primary" disabled={disabled} onClick={()=>void open()}>Open Claude Code</button><button className="demo-button" disabled={disabled} onClick={()=>void open(true)}>Change project</button></div>
      </div>
      <div><span className="demo-step-number">2</span><h3>Continue in Terminal</h3>
        <p role="status" aria-live="polite">{error||(!setup?'Checking setup availability…':!setup.available?'Open the installed Mac demo to launch Claude Code.':messages[setup.state??'idle']??'Check Terminal to continue.')}</p>
        <p className="mt-3">After restarting Context Router, exit the old Claude session and open a fresh one here.</p>
      </div>
      <div><span className="demo-step-number">3</span><h3>See your context in use</h3>
        <p>{lastRead?`Context read at ${new Date(lastRead).toLocaleTimeString()}.`:'Ask Claude to read your saved context. Recent access will appear here.'}</p>
        {lastRead&&<p className="mt-2">Recent activity from this demo credential; not a live connection indicator.</p>}
        <div className="flex gap-3 flex-wrap mt-4"><button className="demo-button" onClick={reviewAccess}>Review access</button><Link prefetch={false} className="demo-button" href={setup?.clientId?`/dashboard/history#mcp-client=${encodeURIComponent(setup.clientId)}`:'/dashboard/history'}>View activity</Link></div>
      </div>
    </div>
    <p className="demo-provider-notice">Opening Claude allows Anthropic sign-in and use of this synthetic demo context and your chosen project. Claude asks for file and command permissions as usual.</p>
  </section>;
}
