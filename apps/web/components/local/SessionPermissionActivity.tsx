'use client';

import {useEffect, useRef, useState, type RefObject} from 'react';
import {localJson} from '@/lib/authenticated-fetch';
import {ClientName} from './ClientNames';

export type PermissionChange = {kind:'maximum'|'scope'|'sensitive'|'rule'|'connection';target?:string;action?:string;before:string;after:string};
export type PermissionActivity = {id:string;sequence:number;occurredAt:string;clientKey:string;actor:'dashboard-user';action:'save'|'grant'|'revoke';changes:PermissionChange[];omittedChanges:number};
export type PermissionActivityPage = {sessionId:string;latestSequence:number;limit:number;truncated:boolean;items:PermissionActivity[]};
const value = (change:PermissionChange, text:string) => change.kind === 'maximum'
  ? text === 'None' ? 'Blocked' : text.split(', ').map(capability=>({ 'preferences:read':'Read', 'preferences:suggest':'Suggest changes', 'preferences:write':'Write', 'preferences:define':'Manage definitions' }[capability]??capability)).join(', ')
  : text;
const label = (change:PermissionChange) => change.kind === 'maximum' ? 'Maximum access' : change.kind === 'sensitive' ? 'Sensitive context' : change.kind === 'connection' ? 'Connection' : change.kind === 'scope' ? `Allowed scope · ${change.target}` : `${change.action} rule · ${change.target}`;

export type PermissionRevealState = {revealed:boolean;open:boolean};
export function PermissionActivityRow({event,highlight,active,revealState,olderThanLoaded,relativeTime,absoluteTime,onExpandedChange}:{event:PermissionActivity;highlight:boolean;active:boolean;revealState?:RefObject<PermissionRevealState>;olderThanLoaded:boolean;relativeTime:string;absoluteTime:string;onExpandedChange:(id:string,open:boolean)=>void}) {
  const element=useRef<HTMLDetailsElement>(null);
  const single=event.changes.length===1 && !event.omittedChanges ? event.changes[0] : null;
  useEffect(()=>{
    if(highlight && active && revealState && !revealState.current.revealed && element.current){
      revealState.current.revealed=true;revealState.current.open=true;element.current.open=true;onExpandedChange(event.id,true);
      element.current.scrollIntoView({block:'nearest'});element.current.focus({preventScroll:true});
    }
  },[highlight,active,revealState,event.id,onExpandedChange]);
  useEffect(()=>{onExpandedChange(event.id,!!element.current?.open);return()=>onExpandedChange(event.id,false);},[event.id,onExpandedChange]);
  return <details ref={element} tabIndex={highlight?-1:undefined} open={highlight ? revealState?.current.open : undefined} onToggle={() => { onExpandedChange(event.id,!!element.current?.open); if(highlight && revealState && element.current) revealState.current.open=element.current.open; }} data-permission-change={event.id} className={`m-3 rounded-lg border-l-4 !border-l-violet-500 bg-violet-50 p-4 ${highlight?'ring-2 ring-violet-300':''}`}>
    <summary className="cursor-pointer" onClick={click => {
      if(element.current){
        // Native toggle is queued; save the choice before a focus refresh can remount us.
        click.preventDefault();
        const open = !element.current.open;
        if(highlight && revealState)revealState.current.open = open;
        element.current.open = open;
        onExpandedChange(event.id,open);
      }
    }}><strong>{single?.kind==='maximum' ? <>You set maximum access for <ClientName clientKey={event.clientKey} showId={false}/> to {value(single,single.after)} (was {value(single,single.before)})</> : <>You {event.action==='revoke'?'revoked access for':'changed permissions for'} <ClientName clientKey={event.clientKey} showId={false}/></>}</strong>
      {single?.kind!=='maximum' && <span className="mt-1 block text-sm text-gray-600">{event.changes.slice(0,2).map(change=>`${label(change)}: ${value(change,change.before)} → ${value(change,change.after)}`).join(' · ')}{event.changes.length>2?' · More changes':''}</span>}
      <span className="mt-1 block text-xs text-gray-500">Dashboard change · <span title={absoluteTime}>{relativeTime}</span></span>
      {olderThanLoaded && <span className="mt-2 block text-sm">Older than the loaded requests; Load more to see what came between.</span>}
    </summary>
    {!single && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Setting</th><th className="p-2">Before</th><th className="p-2">After</th></tr></thead><tbody>{event.changes.map((change,index)=><tr key={index} className="border-t border-violet-200"><td className="break-all p-2">{label(change)}</td><td className="p-2">{value(change,change.before)}</td><td className="p-2">{value(change,change.after)}</td></tr>)}</tbody></table></div>}
    {!!event.omittedChanges&&<p className="mt-2 text-sm">{event.omittedChanges} additional setting changes were omitted from this bounded session record.</p>}
    <p className="mt-2 text-xs">Settings changed as shown. More specific rules may affect access.</p>
    <p className="mt-2 break-all text-xs">Assistant: {event.clientKey} · {new Date(event.occurredAt).toLocaleString()}</p>
  </details>;
}

export function ClearSessionPermissionActivity({onInvalidated}:{onInvalidated:()=>void}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const life=useRef<AbortController|null>(null);
  useEffect(()=>()=>life.current?.abort(),[]);
  async function clear() {
    if(busy)return;const controller=new AbortController();life.current=controller;setBusy(true);setMessage('');
    try{
      const snapshot=await localJson<PermissionActivityPage>('/api/local/mcp/changes',{},controller.signal);
      if(controller.signal.aborted)return;
      if(!window.confirm('Clear dashboard permission changes recorded so far in this app session? Stored history and current permissions stay unchanged.'))return;
      await localJson('/api/local/mcp/changes/clear',{sessionId:snapshot.sessionId,throughSequence:snapshot.latestSequence},controller.signal);
      if(!controller.signal.aborted){setMessage('Session permission changes cleared. New changes may appear.');onInvalidated();}
    }catch{if(!controller.signal.aborted){setMessage('Session clear was not confirmed. Review history before trying again.');onInvalidated();}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <div className="mt-3"><p className="text-sm">Temporary permission-change entries are separate from stored history.</p><button type="button" disabled={busy} className="text-red-700 underline disabled:opacity-50" onClick={()=>void clear()}>{busy?'Clearing session changes…':'Clear session permission changes'}</button>{message&&<p role="status">{message}</p>}</div>;
}
