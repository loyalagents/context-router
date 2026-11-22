import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture} from './browser-fixture.mjs';

const navigation=[
 ['Edit Profile','/dashboard/profile'],['Preferences','/dashboard/preferences'],
 ['Form Fill','/dashboard/form-fill'],['Audit History','/dashboard/history'],
 ['Preference Schema','/dashboard/schema'],['Permission Grants','/dashboard/permissions'],
];

async function openDemo(f) {
 await f.page.route('**/api/local/capabilities',async route=>{
  const response=await route.fetch(),body=await response.json();
  if(response.status()===200)body.runtime={mode:'demo',launcher:'native',generation:'c'.repeat(32),storeId:'b'.repeat(32)};
  await route.fulfill({response,json:body});
 });
 await f.page.goto(f.ready.origin+'/dashboard');
 await f.page.getByLabel('Unlock token').fill(f.bootstrap);await f.page.getByRole('button',{name:'Unlock local dashboard'}).click();
 await f.page.getByRole('heading',{name:'Your context',exact:true}).waitFor();
}

test('demo plain-text editor preserves string type, pending draft identity and persisted changes', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 const original=(await f.graphql('query { activePreferences { id slug value } }')).activePreferences;
 const selected=original.find(p=>typeof p.value==='string');
 await f.page.getByLabel('Search your context').fill(selected.slug);await f.page.getByRole('region',{name:'Saved context'}).getByRole('button').first().click();
 await f.page.getByRole('button',{name:'Edit context',exact:true}).click();
 const editor=f.page.getByLabel('Value for '+selected.slug,{exact:true});assert.equal(await editor.inputValue(),selected.value);
 const value='"Quoted text"\ntrue remains a string.';await editor.fill(value);
 assert.equal(await f.page.getByLabel('Search your context').isDisabled(),true);assert.equal(await f.page.getByLabel('Context category').isDisabled(),true);
 let release,seen;const waiting=new Promise(resolve=>seen=resolve),hold=new Promise(resolve=>release=resolve);
 await f.page.route('**/graphql',async route=>{if(route.request().postDataJSON().query.includes('mutation SetPreference')){seen();await hold;}await route.continue();});
 await f.page.getByRole('button',{name:'Save changes',exact:true}).click();await waiting;
 assert.equal(await editor.isDisabled(),true);assert.equal(await f.page.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);
 f.page.once('dialog',dialog=>dialog.accept());await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 assert.equal(new URL(f.page.url()).pathname,'/dashboard');assert.equal(await editor.inputValue(),value);
 release();await f.page.getByRole('button',{name:'Edit context',exact:true}).waitFor();
 const after=(await f.graphql('query { activePreferences { id slug value } }')).activePreferences;
 assert.equal(after.find(p=>p.id===selected.id).value,value);assert.deepEqual(after.filter(p=>p.id!==selected.id),original.filter(p=>p.id!==selected.id));
 await f.page.reload();await f.page.getByLabel('Search your context').fill(selected.slug);await f.page.getByRole('region',{name:'Saved context'}).getByRole('button').first().click();
 assert.equal(await f.page.locator('.demo-detail-value').innerText(),value);
 await f.page.getByRole('button',{name:'Edit context',exact:true}).click();await editor.fill('discarded draft');await f.page.getByRole('button',{name:'Cancel',exact:true}).click();
 await f.page.getByRole('button',{name:'Edit context',exact:true}).click();assert.equal(await editor.inputValue(),value);
});

test('demo structured editor validates JSON and a session lock clears a pending editor', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);
 const {connect,call}=await import('../../backend/scripts/demo/mcp-import.mjs');
 const peer=await connect(Number(new URL(f.ready.mcpOrigin).port),f.root+'/demo/exports/agent-a.token'),slug='home.demo001.boolean_trial';
 try{await call(peer,'mutatePreferences',{operation:'CREATE_DEFINITION',definition:{slug,description:'Synthetic boolean editor fixture',valueType:'BOOLEAN',scope:'GLOBAL',isSensitive:false}});await call(peer,'mutatePreferences',{operation:'SET_PREFERENCE',preference:{slug,value:'false'}});}finally{await peer.close();}
 await openDemo(f);await f.page.getByLabel('Search your context').fill(slug);await f.page.getByRole('region',{name:'Saved context'}).getByRole('button').first().click();
 await f.page.getByRole('button',{name:'Edit context',exact:true}).click();const editor=f.page.getByLabel('Value for '+slug,{exact:true});
 await editor.fill('invalid JSON');await f.page.getByRole('button',{name:'Save changes',exact:true}).click();await f.page.getByRole('alert').filter({hasText:'Invalid JSON format'}).waitFor();
 await editor.fill('true');await f.page.getByRole('button',{name:'Save changes',exact:true}).click();await f.page.getByRole('button',{name:'Edit context',exact:true}).waitFor();
 assert.equal((await f.graphql('query { activePreferences { slug value } }')).activePreferences.find(p=>p.slug===slug).value,true);
 await f.page.getByRole('button',{name:'Edit context',exact:true}).click();await editor.fill('false');
 let release,seen;const waiting=new Promise(resolve=>seen=resolve),hold=new Promise(resolve=>release=resolve);
 await f.page.route('**/graphql',async route=>{if(route.request().postDataJSON().query.includes('mutation SetPreference')){seen();await hold;await route.abort();return;}await route.continue();});
 await f.page.getByRole('button',{name:'Save changes',exact:true}).click();await waiting;
 await f.page.getByRole('button',{name:'Lock dashboard',exact:true}).click();await f.page.getByLabel('Unlock token').waitFor();release();
 assert.equal(await f.page.getByRole('complementary',{name:'Context details'}).count(),0);
});

for(const demo of [false,true])test(`${demo?'demo':'personal'} uses its intended dashboard and navigation`,{timeout:60000},async t=>{
 const f=await browserFixture(t,{demo});f.page.setDefaultTimeout(5000);
 // Only admitted presentation metadata is response-injected. The database,
 // historical seed, identity, grants, APIs and browser authentication are real.
 await f.page.route('**/api/local/capabilities',async route=>{
  const response=await route.fetch(),body=await response.json();
  if(response.status()===200)body.runtime={mode:demo?'demo':'personal',launcher:'native',generation:'c'.repeat(32),storeId:'b'.repeat(32)};
  await route.fulfill({response,json:body});
 });
 await f.page.goto(f.ready.origin+'/dashboard');
 assert.equal(await f.page.getByRole('complementary',{name:'Demo mode'}).count(),0);
 assert.equal(await f.page.getByText('Demo walkthrough (optional)',{exact:true}).count(),0);
 await f.page.getByLabel('Unlock token').fill(f.bootstrap);await f.page.getByRole('button',{name:'Unlock local dashboard'}).click();
 if(demo){
  await f.page.getByRole('heading',{name:'Your context',exact:true}).waitFor();
  const list=f.page.getByRole('region',{name:'Saved context'}),nav=f.page.getByRole('navigation',{name:'Main navigation'});
  assert.equal(await list.getByRole('button').count(),189);
  assert.deepEqual(await nav.getByRole('link').allTextContents(),['Context','Connections','Activity']);
  assert.equal(await f.page.getByRole('heading',{name:'Account Information'}).count(),0);
  assert.equal(await f.page.getByRole('button',{name:'Smart search',exact:true}).isVisible(),false);
  for(const width of [1280,1440,375]){await f.page.setViewportSize({width,height:900});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);}
  await f.page.setViewportSize({width:1440,height:900});assert.ok((await list.boundingBox()).y<400);
  await f.page.getByLabel('Context category').selectOption({index:1});assert.ok(await list.getByRole('button').count()<189);
  await f.page.getByLabel('Search your context').fill('no-such-memory-xyz');await list.getByText('No matching context',{exact:true}).waitFor();
  await nav.getByRole('link',{name:'Connections',exact:true}).click();await f.page.getByRole('heading',{name:'Connections',exact:true}).waitFor();
  await f.page.getByRole('heading',{name:'Your context, in Claude Code',exact:true}).waitFor();await f.page.getByText(/Open the installed Mac demo to launch/).waitFor();
  assert.equal(await f.page.getByText('Connection verified',{exact:true}).count(),0);
  await nav.getByRole('link',{name:'Activity',exact:true}).click();await f.page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
  assert.equal(await f.page.getByRole('button',{name:'Clear both history streams',exact:true}).isVisible(),false);
  await nav.getByRole('link',{name:'Context',exact:true}).click();await list.waitFor();
  await f.page.getByRole('button',{name:'Lock dashboard',exact:true}).click();await f.page.getByLabel('Unlock token').waitFor();assert.equal(await list.count(),0);
  return;
 }
 await f.page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
 for(const name of ['Account Information','Profile Memory'])await f.page.getByRole('heading',{name,exact:true}).waitFor();
 assert.deepEqual(await f.page.locator('a[href^="/dashboard/"]').evaluateAll(links=>links.map(a=>[a.textContent.trim(),a.getAttribute('href')])),navigation);
 assert.equal(await f.page.getByRole('complementary',{name:'Demo mode'}).count(),demo?1:0);
 const summary=f.page.getByText('Demo walkthrough (optional)',{exact:true});
 if(!demo){assert.equal(await summary.count(),0);return;}

});

test('seeded demo client rename preserves historical attribution and exact activity navigation', {timeout:60000}, async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);
 // Presentation metadata only: this source fixture is not native mode-switch proof.
 await f.page.route('**/api/local/capabilities',async route=>{
  const response=await route.fetch(),body=await response.json();
  if(response.status()===200)body.runtime={mode:'demo',launcher:'native',generation:'c'.repeat(32),storeId:'b'.repeat(32)};
  await route.fulfill({response,json:body});
 });
 const {connect,call}=await import('../../backend/scripts/demo/mcp-import.mjs');
 const {readFile}=await import('node:fs/promises');
 const receipt=JSON.parse(await readFile(f.root+'/demo/generation.json'));
 const id=receipt.clients.agentA,key='local:'+id,slug='home.demo001.renamed_note',label='Demo laptop 東京';
 const peer=await connect(Number(new URL(f.ready.mcpOrigin).port),f.root+'/demo/exports/agent-a.token');
 try{
  await call(peer,'mutatePreferences',{operation:'CREATE_DEFINITION',definition:{slug,description:'Owned rename integration fixture',valueType:'STRING',scope:'GLOBAL',isSensitive:false}});
  await call(peer,'mutatePreferences',{operation:'SET_PREFERENCE',preference:{slug,value:'"retained demo note"'}});
 }finally{await peer.close();}
 const history=()=>{const c=f.database.connect();try{return c.all('SELECT id,actor_client_key,before_state,after_state FROM preference_audit_events WHERE subject_slug=? ORDER BY id',[slug]);}finally{c.close();}};
 const before=history();assert.ok(before.length>=2);assert.ok(before.every(event=>event.actor_client_key===key));
 await f.page.goto(f.ready.origin+'/dashboard/permissions');await f.page.getByLabel('Unlock token').fill(f.bootstrap);await f.page.getByRole('button',{name:'Unlock local dashboard'}).click();
 await f.page.locator('.demo-client-card').filter({has:f.page.getByRole('button',{name:'Edit permissions '+id,exact:true})}).locator('summary').click();
 await f.page.getByRole('button',{name:'Rename '+id,exact:true}).click();await f.page.getByLabel('Connection name',{exact:true}).fill(label);await f.page.getByRole('button',{name:'Save name'}).click();await f.page.getByRole('status',{name:'Connection name saved',exact:true}).waitFor();
 await f.page.getByRole('link',{name:'View activity '+id,exact:true}).click();
 for(const tab of ['Assistant access','Context changes']){
  await f.page.getByRole('tab',{name:tab,exact:true}).click();const panel=f.page.getByRole('tabpanel',{name:tab,exact:true});
  if(tab==='Context changes'){await panel.getByText('Filter activity',{exact:true}).click();await panel.getByRole('button',{name:'More filters',exact:true}).click();}
  assert.equal(new URL(f.page.url()).hash,'#mcp-client='+id);assert.equal(await panel.getByLabel(tab==='Context changes'?'Actor client key':'Client key').inputValue(),key);
  await panel.getByText(label,{exact:true}).first().waitFor();
  const row=panel.getByRole('button').filter({hasText:tab==='Context changes'?'Memory set':'requested a memory change'}).first();await row.click();
  await panel.getByText('Client key: '+key,{exact:true}).waitFor();await f.page.getByRole('complementary',{name:'Demo mode'}).waitFor();
 }
 assert.deepEqual(history(),before,'rename must leave existing audit payloads and exact actor keys intact');
 await f.page.goto(f.ready.origin+'/dashboard/preferences');await f.page.getByLabel('Search your context').fill(slug);await f.page.getByRole('region',{name:'Saved context'}).getByRole('button').first().click();await f.page.getByText(label,{exact:true}).waitFor();await f.page.getByText('Technical details',{exact:true}).click();
 assert.ok((await f.page.textContent('body')).includes(key));await f.page.getByRole('complementary',{name:'Demo mode'}).waitFor();
 const after=JSON.parse(f.cli('local-mcp.js','list').stdout).result;
 assert.equal(after.find(client=>client.id===id).label,label);
 assert.equal(after.find(client=>client.id===receipt.clients.agentB).label,'Claude Code — reader');
 assert.deepEqual(JSON.parse(await readFile(f.root+'/demo/generation.json')),receipt);
});

test('demo uses the installed local model for smart search while keeping historical identity visible', {timeout:60000}, async t=>{
 const f=await browserFixture(t,{demo:true,model:true});f.page.setDefaultTimeout(10000);
 await f.page.route('**/api/local/capabilities',async route=>{
  const response=await route.fetch(),body=await response.json();
  if(response.status()===200)body.runtime={mode:'demo',launcher:'native',generation:'c'.repeat(32),storeId:'b'.repeat(32)};
  await route.fulfill({response,json:body});
 });
 await f.page.goto(f.ready.origin+'/dashboard/preferences');await f.page.getByLabel('Unlock token').fill(f.bootstrap);await f.page.getByRole('button',{name:'Unlock local dashboard'}).click();
 await f.page.getByRole('button',{name:'Lock dashboard'}).waitFor();
 const data=await f.graphql('query { activePreferences { slug value } }'),selected=data.activePreferences.find(p=>p.slug.startsWith('travel.demo001.')),slug=selected.slug;
 f.peer.state.hook=async(request,_response,body)=>{
  if(request.url==='/completion'){
   const rows=JSON.parse(JSON.parse(body).prompt.split('\n').find(line=>line.startsWith('[[')));
   const row=rows.find(row=>row[6].includes(selected.value));assert.ok(row,'authorized stored memory must be in model context');
   f.peer.state.reply=JSON.stringify({relevantReferences:[row[0],row[0],999999],queryInterpretation:'Synthetic historical travel match'});
  }return false;
 };
 const banner=f.page.getByRole('complementary',{name:'Demo mode'});await banner.waitFor();await banner.locator('summary').click();
 assert.match(await banner.innerText(),/Installed local AI is used when available/);
 assert.doesNotMatch(await banner.innerText(),/AI is disabled/);
 await f.page.getByRole('button',{name:'Add or import',exact:true}).click();await f.page.getByText('AI-assisted search',{exact:true}).click();
 await f.page.getByLabel('Search query',{exact:true}).fill('Historical travel preferences');
 f.peer.state.tokens=12001;
 await f.page.getByRole('button',{name:'Smart search',exact:true}).click();
 await f.page.getByRole('alert').filter({hasText:'This search exceeds the local model’s context limit. Literal search is still available.'}).waitFor();
 assert.equal(f.peer.state.completionBodies.length,0,'context overflow must not start inference');
 f.peer.state.tokens=10;
 await f.page.getByRole('button',{name:'Smart search',exact:true}).click();
 const results=f.page.getByLabel('Smart search results');await results.getByText('Synthetic historical travel match',{exact:true}).waitFor();
 await results.getByText(slug,{exact:true}).waitFor();assert.equal(f.peer.state.completionBodies.length,1);
 await banner.waitFor();assert.equal((await f.graphql('query { activePreferences { slug } }')).activePreferences.length,189);
});

test('demo navigation retains its shell, protects edits and makes memory selection keyboard accessible', {timeout:60000}, async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 const nav=f.page.getByRole('navigation',{name:'Main navigation'}),list=f.page.getByRole('region',{name:'Saved context'});
 await f.page.evaluate(()=>{window.demoShellNode=document.querySelector('.demo-sidebar');window.demoDocument=document;});
 for(const [name,heading] of [['Connections','Connections'],['Activity','Activity'],['Context','Your context']]){
  await nav.getByRole('link',{name,exact:true}).click();await f.page.getByRole('heading',{name:heading,exact:true}).waitFor();
  assert.equal(await f.page.evaluate(()=>window.demoShellNode===document.querySelector('.demo-sidebar')&&window.demoDocument===document),true);
  if(name==='Activity')assert.equal(await f.page.getByRole('tab',{name:'Assistant access',exact:true}).getAttribute('aria-selected'),'true');
 }
 await list.getByRole('button').first().waitFor();
 assert.equal(await list.locator('button[tabindex="0"]').count(),1);
 await list.locator('button[tabindex="0"]').focus();await f.page.keyboard.press('ArrowDown');
 assert.equal(await list.getByRole('button').nth(1).getAttribute('aria-pressed'),'true');
 await f.page.keyboard.press('End');assert.equal(await list.getByRole('button').last().getAttribute('aria-pressed'),'true');
 await f.page.keyboard.press('Home');assert.equal(await list.getByRole('button').first().getAttribute('aria-pressed'),'true');
 await f.page.keyboard.press('Tab');assert.equal(await f.page.getByRole('button',{name:'Edit context',exact:true}).evaluate(el=>el===document.activeElement),true);
 const top=(await list.boundingBox()).y;await f.page.getByRole('button',{name:'Edit context',exact:true}).click();
 const editor=f.page.locator('.demo-inspector textarea');await editor.fill('Unsaved navigation fixture');
 assert.equal((await list.boundingBox()).y,top,'edit notice must not shift the list');
 for(const link of [nav.getByRole('link',{name:'Connections',exact:true}), f.page.getByRole('link',{name:'Context Router',exact:true}), f.page.getByRole('link',{name:'Connect Claude Code',exact:true})]){
  f.page.once('dialog',dialog=>dialog.dismiss());await link.click();assert.equal(await editor.inputValue(),'Unsaved navigation fixture');
 }
 f.page.once('dialog',dialog=>dialog.accept());await nav.getByRole('link',{name:'Activity',exact:true}).click();await f.page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
 await nav.getByRole('link',{name:'Context',exact:true}).click();await list.waitFor();
 for(const [width,height] of [[1280,720],[1440,900],[1920,1080]]){await f.page.setViewportSize({width,height});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollHeight>window.innerHeight+1),false);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);}
 await f.page.getByRole('button',{name:'Add or import',exact:true}).click();const tools=f.page.getByRole('region',{name:'Context tools'});
 assert.equal(await tools.evaluate(el=>el===document.activeElement),true);assert.ok((await tools.boundingBox()).y<(await list.boundingBox()).y);
 await f.page.getByRole('button',{name:'Add or import',exact:true}).click();
 await f.page.getByText('More tools',{exact:true}).click();await f.page.getByRole('link',{name:'Memory fields',exact:true}).click();
 await f.page.getByRole('heading',{name:'Memory fields',exact:true}).waitFor();
 await f.page.locator('.demo-more[open]').waitFor();assert.equal(await f.page.getByRole('link',{name:'Memory fields',exact:true}).getAttribute('aria-current'),'page');
 assert.equal(await f.page.getByRole('link',{name:'Back to Dashboard',exact:true}).count(),0);
});

test('demo connection details, inspect focus and current labels stay attached to their exact connection', {timeout:60000}, async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 const rows=f.page.locator('.demo-client-card');await rows.first().waitFor();
 const labels=await rows.locator('.demo-client-name').allTextContents();assert.match(labels[0],/Claude Code — reader/);assert.match(labels.at(-1),/revoked/);
 const card=rows.first();assert.equal(await card.getByRole('button',{name:/Inspect /}).isVisible(),false);
 await card.locator('summary').click();await card.getByRole('button',{name:/Inspect /}).click();
 const panel=card.getByRole('region',{name:'Connection inspection'});await panel.waitFor();assert.equal(await panel.evaluate(el=>el===document.activeElement),true);
 await panel.getByRole('heading',{name:'CLI maximum policy',exact:true}).waitFor();
 assert.equal(await rows.nth(1).getByRole('region',{name:'Connection inspection'}).count(),0);
 await f.page.getByText('Demo walkthrough (optional)',{exact:true}).click();await f.page.getByRole('button',{name:'Copy step 1 prompt',exact:true}).waitFor();
 await f.page.getByRole('button',{name:'Review access',exact:true}).click();assert.equal(await f.page.getByRole('list',{name:'Connections',exact:true}).evaluate(el=>el===document.activeElement),true);
});

test('demo preserves permission drafts during passive refresh and keeps a tab stop after a filtered memory edit', {timeout:60000}, async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 const nav=f.page.getByRole('navigation',{name:'Main navigation'});
 await nav.getByRole('link',{name:'Connections',exact:true}).click();
 const card=f.page.locator('.demo-client-card').first();await card.getByRole('button',{name:/Edit permissions /}).click();
 const panel=f.page.getByRole('region',{name:'Edit permissions',exact:true});
 await panel.getByLabel('Maximum value access').selectOption('Blocked');
 await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await f.page.locator('.demo-client-card').first().waitFor();assert.equal(await panel.getByLabel('Maximum value access').inputValue(),'Blocked');
 f.page.once('dialog',dialog=>dialog.dismiss());await nav.getByRole('link',{name:'Context',exact:true}).click();assert.equal(await panel.getByLabel('Maximum value access').inputValue(),'Blocked');
 await panel.getByRole('button',{name:'Cancel',exact:true}).click();
 await nav.getByRole('link',{name:'Context',exact:true}).click();await f.page.getByLabel('Search your context').fill('project');
 const list=f.page.getByRole('region',{name:'Saved context'});assert.ok(await list.getByRole('button').count()>1);
 await list.getByRole('button').first().click();await f.page.getByRole('button',{name:'Edit context',exact:true}).click();await f.page.locator('.demo-inspector textarea').fill('Synthetic updated memory without the search term');
 await f.page.getByRole('button',{name:'Save changes',exact:true}).click();await f.page.getByRole('button',{name:'Edit context',exact:true}).waitFor();
 assert.equal(await list.locator('button[tabindex="0"]').count(),1);assert.equal(await list.locator('button[aria-pressed="true"]').count(),1);
});

test('demo access summaries preserve mixed, unavailable and definition-management distinctions', {timeout:60000}, async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 const {readFile}=await import('node:fs/promises'),receipt=JSON.parse(await readFile(f.root+'/demo/generation.json'));
 await f.page.route('**/api/local/mcp/list',async route=>{
  const response=await route.fetch(),body=await response.json();
  for(const item of body.items){
   if(item.id===receipt.clients.agentA)item.summary={level:'Mixed',total:189,counts:{blocked:69,read:100,suggest:0,write:20,define:0}};
   if(item.id===receipt.clients.agentB)item.summary=null;
   if(item.id===receipt.clients.agentC)item.summary={level:'Read',total:145,counts:{blocked:0,read:145,suggest:0,write:0,define:1}};
  }
  await route.fulfill({response,json:body});
 });
 await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 const row=id=>f.page.locator('.demo-client-card').filter({has:f.page.getByRole('button',{name:'Edit permissions '+id,exact:true})});
 await row(receipt.clients.agentA).getByText(/Mixed access across 189 fields/).waitFor();
 assert.doesNotMatch(await row(receipt.clients.agentA).innerText(),/Can read 189|Cannot change/);
 await row(receipt.clients.agentB).getByText('Current access summary unavailable.',{exact:true}).waitFor();
 assert.doesNotMatch(await row(receipt.clients.agentB).innerText(),/Can read 0|Cannot change/);
 await row(receipt.clients.agentC).getByText(/Can read 145 fields/).waitFor();
 assert.doesNotMatch(await row(receipt.clients.agentC).innerText(),/Cannot change/);
});

test('Claude launch is explicit, remembers in-flight state on reload, and reports only recent exact-client reads', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);
 const fs=await import('node:fs'),path=await import('node:path'),{createRequire}=await import('node:module');
 const require=createRequire(new URL('../../backend/package.json',import.meta.url));
 const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'demo/generation.json'),'utf8'));const peers=[];t.after(async()=>{for(const peer of peers)await peer.close();});
 async function read(role){const peer=new Client({name:'synthetic-connect-test',version:'1'},{capabilities:{}});peers.push(peer);await peer.connect(new StreamableHTTPClientTransport(new URL(f.ready.mcpOrigin),{requestInit:{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(f.root,`demo/exports/agent-${role}.token`),'utf8').trim()}}}));const result=await peer.callTool({name:'searchPreferences',arguments:{query:'work.demo001.'}});assert.ok(!result.isError,JSON.stringify(result));}
 await read('b');
 let state={available:true,clientId:receipt.clients.agentB,state:'idle',busy:false},opens=0;const requests=[];
 await f.page.route('**/api/local/demo/claude/status',route=>route.fulfill({json:state}));
 await f.page.route('**/api/local/demo/claude/open',route=>{opens++;requests.push(route.request().postDataJSON());state={...state,state:'checking',busy:true,request:'d'.repeat(32),startedAt:new Date().toISOString()};return route.fulfill({json:state});});
 await openDemo(f);await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 const button=f.page.getByRole('button',{name:'Open Claude Code',exact:true});await button.waitFor();await f.page.getByText('Choose a project once.',{exact:false}).waitFor();assert.equal(opens,0);
 await button.click();assert.equal(opens,1);assert.deepEqual(requests,[{chooseProject:false}]);assert.equal(await button.isDisabled(),true);
 state={...state,state:'terminal-opened'};await f.page.getByText('Terminal opened.',{exact:false}).waitFor();assert.equal(await f.page.getByText(/^Context read at /).count(),0);
 await f.page.reload();await f.page.getByText('Terminal opened.',{exact:false}).waitFor();assert.equal(opens,1);
 await read('a');await f.page.waitForTimeout(2200);assert.equal(await f.page.getByText(/^Context read at /).count(),0);
 await read('b');const history=(await f.graphql('query($input:McpAccessHistoryInput!){mcpAccessHistory(input:$input){items{clientKey occurredAt outcome operationName responseMetadata}}}',{input:{first:20,clientKey:`local:${receipt.clients.agentB}`}})).mcpAccessHistory.items;assert.ok(history.some(item=>item.operationName==='searchPreferences'&&item.responseMetadata?.activeCount>0),JSON.stringify(history));await f.page.getByText(/^Context read at /).waitFor();
 const activity=f.page.getByRole('region',{name:'Connect Claude Code'}).getByRole('link',{name:'View activity'});assert.ok((await activity.getAttribute('href')).endsWith('#mcp-client='+receipt.clients.agentB));
 state={...state,state:'starting',busy:false};await f.page.getByText('Your latest chat is opening', {exact:false}).waitFor();assert.equal(await button.isDisabled(),false);
 await button.click();assert.equal(opens,2);assert.deepEqual(requests[1],{chooseProject:false});assert.equal(await button.isDisabled(),true);
 state={...state,state:'exited',busy:false};await f.page.getByText('Your latest chat has closed.',{exact:false}).waitFor();await f.page.getByRole('button',{name:'Change project',exact:true}).click();assert.equal(opens,3);assert.deepEqual(requests[2],{chooseProject:true});
});

test('Codex launch is explicit, remembers in-flight state on reload, and reports only recent exact-client reads', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);
 const fs=await import('node:fs'),path=await import('node:path'),{createRequire}=await import('node:module');
 const require=createRequire(new URL('../../backend/package.json',import.meta.url));
 const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'demo/generation.json'),'utf8'));const peers=[];t.after(async()=>{for(const peer of peers)await peer.close();});
 async function read(role){const peer=new Client({name:'synthetic-connect-test',version:'1'},{capabilities:{}});peers.push(peer);await peer.connect(new StreamableHTTPClientTransport(new URL(f.ready.mcpOrigin),{requestInit:{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(f.root,`demo/exports/agent-${role}.token`),'utf8').trim()}}}));const result=await peer.callTool({name:'searchPreferences',arguments:{query:'work.demo001.'}});assert.ok(!result.isError,JSON.stringify(result));}
 await read('a');
 let state={available:true,clientId:receipt.clients.agentA,state:'idle',busy:false},opens=0;const requests=[];
 await f.page.route('**/api/local/demo/codex/status',route=>route.fulfill({json:state}));
 await f.page.route('**/api/local/demo/codex/open',route=>{opens++;requests.push(route.request().postDataJSON());state={...state,state:'checking',busy:true,request:'d'.repeat(32),startedAt:new Date().toISOString()};return route.fulfill({json:state});});
 await openDemo(f);await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 await f.page.getByRole('button',{name:'Codex CLI',exact:true}).click();
 const button=f.page.getByRole('button',{name:'Open Codex',exact:true});await button.waitFor();await f.page.getByText('Choose a project once.',{exact:false}).waitFor();assert.equal(opens,0);
 await button.click();assert.equal(opens,1);assert.deepEqual(requests,[{chooseProject:false}]);assert.equal(await button.isDisabled(),true);
 state={...state,state:'terminal-opened'};await f.page.getByText('Terminal opened.',{exact:false}).waitFor();assert.equal(await f.page.getByText(/^Context read at /).count(),0);
 await f.page.reload();await f.page.getByRole('button',{name:'Codex CLI',exact:true}).click();await f.page.getByText('Terminal opened.',{exact:false}).waitFor();assert.equal(opens,1);
 await read('b');await f.page.waitForTimeout(2200);assert.equal(await f.page.getByText(/^Context read at /).count(),0);
 await read('a');const history=(await f.graphql('query($input:McpAccessHistoryInput!){mcpAccessHistory(input:$input){items{clientKey occurredAt outcome operationName responseMetadata}}}',{input:{first:20,clientKey:`local:${receipt.clients.agentA}`}})).mcpAccessHistory.items;assert.ok(history.some(item=>item.operationName==='searchPreferences'&&item.responseMetadata?.activeCount>0),JSON.stringify(history));await f.page.getByText(/^Context read at /).waitFor();
 const activity=f.page.getByRole('region',{name:'Connect Codex'}).getByRole('link',{name:'View activity'});assert.ok((await activity.getAttribute('href')).endsWith('#mcp-client='+receipt.clients.agentA));
 state={...state,state:'starting',busy:false};await f.page.getByText('Your latest chat is opening', {exact:false}).waitFor();assert.equal(await button.isDisabled(),false);
 await button.click();assert.equal(opens,2);assert.deepEqual(requests[1],{chooseProject:false});assert.equal(await button.isDisabled(),true);
 state={...state,state:'exited',busy:false};await f.page.getByText('Your latest chat has closed.',{exact:false}).waitFor();await f.page.getByRole('button',{name:'Change project',exact:true}).click();assert.equal(opens,3);assert.deepEqual(requests[2],{chooseProject:true});
});
