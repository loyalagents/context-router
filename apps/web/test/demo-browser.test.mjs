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
 for(const link of [nav.getByRole('link',{name:'Connections',exact:true}), f.page.getByRole('link',{name:'Context Router',exact:true}), f.page.getByRole('link',{name:'Connect to AI',exact:true})]){
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
 assert.equal(await f.page.getByRole('button',{name:'Review access',exact:true}).isDisabled(),true); // Source-only demo has no bound native client.
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
 f.page.once('dialog',dialog=>dialog.dismiss());await f.page.keyboard.press('Escape');assert.equal(await panel.getByLabel('Maximum value access').inputValue(),'Blocked');
 f.page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Cancel',exact:true}).click();
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
 await f.page.getByRole('tab',{name:'Codex',exact:true}).click();
 const button=f.page.getByRole('button',{name:'Open Codex',exact:true});await button.waitFor();await f.page.getByText('Choose a project once.',{exact:false}).waitFor();assert.equal(opens,0);
 await button.click();assert.equal(opens,1);assert.deepEqual(requests,[{chooseProject:false}]);assert.equal(await button.isDisabled(),true);
 state={...state,state:'terminal-opened'};await f.page.getByText('Terminal opened.',{exact:false}).waitFor();assert.equal(await f.page.getByText(/^Context read at /).count(),0);
 await f.page.reload();await f.page.getByRole('tab',{name:'Codex',exact:true}).click();await f.page.getByText('Terminal opened.',{exact:false}).waitFor();assert.equal(opens,1);
 await read('b');await f.page.waitForTimeout(2200);assert.equal(await f.page.getByText(/^Context read at /).count(),0);
 await read('a');const history=(await f.graphql('query($input:McpAccessHistoryInput!){mcpAccessHistory(input:$input){items{clientKey occurredAt outcome operationName responseMetadata}}}',{input:{first:20,clientKey:`local:${receipt.clients.agentA}`}})).mcpAccessHistory.items;assert.ok(history.some(item=>item.operationName==='searchPreferences'&&item.responseMetadata?.activeCount>0),JSON.stringify(history));await f.page.getByText(/^Context read at /).waitFor();
 const activity=f.page.getByRole('region',{name:'Connect Codex'}).getByRole('link',{name:'View activity'});assert.ok((await activity.getAttribute('href')).endsWith('#mcp-client='+receipt.clients.agentA));
 state={...state,state:'starting',busy:false};await f.page.getByText('Your latest chat is opening', {exact:false}).waitFor();assert.equal(await button.isDisabled(),false);
 await button.click();assert.equal(opens,2);assert.deepEqual(requests[1],{chooseProject:false});assert.equal(await button.isDisabled(),true);
 state={...state,state:'exited',busy:false};await f.page.getByText('Your latest chat has closed.',{exact:false}).waitFor();await f.page.getByRole('button',{name:'Change project',exact:true}).click();assert.equal(opens,3);assert.deepEqual(requests[2],{chooseProject:true});
});

test('demo context refreshes external changes on focus without replacing active or newly opened drafts', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 const selected=(await f.graphql('query { activePreferences { id slug value } }')).activePreferences.find(p=>p.slug.startsWith('work.demo001.')&&typeof p.value==='string');
 const {connect,call}=await import('../../backend/scripts/demo/mcp-import.mjs');const path=await import('node:path');
 const peer=await connect(Number(new URL(f.ready.mcpOrigin).port),path.join(f.root,'demo/exports/agent-a.token'));t.after(()=>peer.close());
 const write=value=>call(peer,'mutatePreferences',{operation:'SET_PREFERENCE',preference:{slug:selected.slug,value:JSON.stringify(value)}});
 await f.page.getByLabel('Search your context').fill(selected.slug);await f.page.getByRole('region',{name:'Saved context'}).getByRole('button').first().click();
 await write('External update one');await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.locator('.demo-detail-value').getByText('External update one',{exact:true}).waitFor();
 await f.page.getByRole('button',{name:'Edit context',exact:true}).click();const editor=f.page.getByLabel('Value for '+selected.slug,{exact:true});await editor.fill('Unsaved draft');
 await write('External update two');await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.waitForTimeout(300);assert.equal(await editor.inputValue(),'Unsaved draft');
 await f.page.getByRole('button',{name:'Cancel',exact:true}).click();await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.locator('.demo-detail-value').getByText('External update two',{exact:true}).waitFor();
 let release,seen;const hold=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>seen=resolve);t.after(()=>release());
 await f.page.route('**/graphql',async route=>{if(!route.request().postDataJSON().query.includes('LocalSavedPreferences'))return route.continue();const response=await route.fetch();seen();await hold;await route.fulfill({response}).catch(()=>{});});
 await write('External delayed update');await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await waiting;
 await f.page.getByRole('button',{name:'Edit context',exact:true}).click();await editor.fill('Draft wins over passive response');release();await f.page.waitForTimeout(300);assert.equal(await editor.inputValue(),'Draft wins over passive response');
});

for(const client of ['claude','codex'])test(`${client} demo launch errors remain visible across polls without automatic replay and permit explicit retry`, {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);let opens=0,polls=0;
 await f.page.route(`**/api/local/demo/${client}/status`,route=>{polls++;return route.fulfill({json:{available:true,state:'idle',busy:false}});});
 await f.page.route(`**/api/local/demo/${client}/open`,route=>{opens++;return opens===1?route.fulfill({status:503,json:{}}):route.fulfill({json:{available:true,state:'checking',busy:true}});});
 await openDemo(f);await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 if(client==='codex')await f.page.getByRole('tab',{name:'Codex',exact:true}).click();
 const button=f.page.getByRole('button',{name:client==='codex'?'Open Codex':'Open Claude Code',exact:true});await button.click();const error=f.page.getByText('Launch could not be confirmed. Check Terminal before retrying.',{exact:true});await error.waitFor();
 const before=polls;await f.page.waitForTimeout(4500);assert.ok(polls>=before+2);assert.equal(await error.isVisible(),true);assert.equal(opens,1);assert.equal(await button.isDisabled(),false);
 await button.click();await f.page.getByText(client==='codex'?'Checking Codex on this Mac…':'Checking Claude Code on this Mac…',{exact:true}).waitFor();assert.equal(opens,2);
});

test('demo sidebar clears the Activity client filter and Back restores it', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 const clients=JSON.parse(f.cli('local-mcp.js','list').stdout).result,id=clients[0].id;
 await f.page.goto(f.ready.origin+'/dashboard/history#mcp-client='+id);const panel=f.page.getByRole('tabpanel',{name:'Assistant access',exact:true});
 await panel.getByRole('button',{name:'Remove client filter',exact:true}).waitFor();
 await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Activity',exact:true}).click();
 await f.page.waitForFunction(()=>location.hash==='');await panel.getByRole('button',{name:'Remove client filter',exact:true}).waitFor({state:'hidden'});
 await f.page.goBack();await panel.getByRole('button',{name:'Remove client filter',exact:true}).waitFor();assert.equal(new URL(f.page.url()).hash,'#mcp-client='+id);
});

test('demo profile drafts warn on navigation and a completed save clears the warning', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 await f.page.locator('.demo-more summary').click();await f.page.getByRole('link',{name:'Profile',exact:true}).click();
 await f.page.getByLabel('Full Name',{exact:false}).fill('Synthetic review profile');
 await f.page.getByLabel('Contact Email',{exact:false}).fill('review@example.test');
 const connections=f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true});let dialogs=0;
 const dismiss=async dialog=>{dialogs++;await dialog.dismiss();};f.page.on('dialog',dismiss);
 await connections.click();assert.equal(dialogs,1);assert.equal(new URL(f.page.url()).pathname,'/dashboard/profile');
 await f.page.getByRole('button',{name:'Save Changes',exact:true}).click();await f.page.getByText('Profile updated successfully.',{exact:true}).waitFor();
 await connections.click();await f.page.getByRole('heading',{name:'Connections',exact:true}).waitFor();assert.equal(dialogs,1);
});


test('Review access opens the selected assistant exact permissions and preserves existing drafts', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);
 const {readFile}=await import('node:fs/promises'),receipt=JSON.parse(await readFile(f.root+'/demo/generation.json'));
 const a=receipt.clients.agentA,b=receipt.clients.agentB;
 f.cli('local-mcp.js','rename','--id',a,'--label','Z renamed assistant');
 f.cli('local-mcp.js','rename','--id',b,'--label','A renamed assistant');
 let codexId=a;
 await f.page.route('**/api/local/demo/claude/status',route=>route.fulfill({json:{available:true,clientId:b,state:'idle',busy:false}}));
 await f.page.route('**/api/local/demo/codex/status',route=>route.fulfill({json:{available:true,clientId:codexId,state:'idle',busy:false}}));
 await openDemo(f);await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 const review=f.page.getByRole('button',{name:'Review access',exact:true}),panel=f.page.getByRole('region',{name:'Edit permissions',exact:true});
 const open=async(id,label)=>{await review.click();await panel.getByText('Instance '+id+'.',{exact:false}).waitFor();assert.match(await panel.getByRole('heading',{level:2}).innerText(),new RegExp(label));assert.equal(await panel.getByRole('heading',{level:2}).evaluate(el=>el===document.activeElement),true);assert.ok(await panel.getByRole('heading',{level:2}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));};
 await open(b,'A renamed assistant');
 const drawer=f.page.getByRole('dialog',{name:'Assistant access controls'}),close=f.page.getByRole('button',{name:'Close access controls'});
 assert.equal(await drawer.evaluate(el=>el.matches(':modal')),true);
 await drawer.evaluate(el=>new Promise(resolve=>{el.addEventListener('close',()=>setTimeout(resolve,0),{once:true});el.close();el.showModal();}));assert.equal(await drawer.evaluate(el=>el.matches(':modal')),true);
 assert.ok(await drawer.evaluate(el=>{const r=el.getBoundingClientRect();return Math.abs(r.right-innerWidth)<1&&r.top===0&&r.bottom===innerHeight;}));
 await f.page.keyboard.press('Tab');assert.equal(await drawer.evaluate(el=>el.contains(document.activeElement)),true);
 await f.page.getByRole('tab',{name:'Claude Code',exact:true}).evaluate(el=>el.focus());assert.equal(await drawer.evaluate(el=>el.contains(document.activeElement)),true);
 await f.page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});assert.equal(await review.evaluate(el=>el===document.activeElement),true);
 await f.page.getByRole('tab',{name:'Codex',exact:true}).click();await open(a,'Z renamed assistant');
 await panel.getByLabel('Maximum value access').selectOption('Blocked');
 for(let i=0;i<5;i++){f.page.once('dialog',dialog=>dialog.dismiss());await f.page.keyboard.press('Escape');assert.equal(await drawer.evaluate(el=>el.matches(':modal')),true);assert.equal(await panel.getByLabel('Maximum value access').inputValue(),'Blocked');}await panel.getByText('Instance '+a+'.',{exact:false}).waitFor();
 f.page.once('dialog',dialog=>dialog.dismiss());await drawer.evaluate(el=>el.close());await f.page.waitForFunction(()=>document.querySelector('dialog')?.matches(':modal'));
 f.page.once('dialog',dialog=>dialog.dismiss());await f.page.mouse.click(10,100);assert.equal(await drawer.isVisible(),true);
 f.page.once('dialog',dialog=>dialog.accept());await close.click();await drawer.waitFor({state:'hidden'});assert.equal(await review.evaluate(el=>el===document.activeElement),true);
 await open(a,'Z renamed assistant');await f.page.mouse.click(10,100);await drawer.waitFor({state:'hidden'});
 await open(a,'Z renamed assistant');await drawer.evaluate(el=>el.close());await panel.waitFor({state:'detached'});await f.page.waitForFunction(()=>document.activeElement?.textContent==='Review access');
 // A pending save cannot be dismissed, and a confirmed save leaves no dirty warning.
 await open(a,'Z renamed assistant');await panel.getByLabel('Maximum value access').selectOption('Blocked');
 await panel.getByRole('button',{name:'Preview resulting access',exact:true}).click();await panel.getByRole('region',{name:'Resulting access preview'}).waitFor();
 let release,seen;const pending=new Promise(resolve=>seen=resolve),hold=new Promise(resolve=>release=resolve);t.after(()=>release?.());
 await f.page.route('**/api/local/mcp/save',async route=>{seen();await hold;await route.continue();});
 await panel.getByRole('button',{name:'Save permissions',exact:true}).click();await pending;
 assert.equal(await close.isDisabled(),true);assert.equal(await panel.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);
 for(let i=0;i<5;i++){await f.page.keyboard.press('Escape');assert.equal(await drawer.evaluate(el=>el.matches(':modal')),true);}await drawer.evaluate(el=>el.close());await f.page.waitForFunction(()=>document.querySelector('dialog')?.matches(':modal'));await f.page.mouse.click(10,100);assert.equal(await drawer.isVisible(),true);
 release();await panel.getByText('Permissions saved',{exact:true}).waitFor();await close.click();await drawer.waitFor({state:'hidden'});
 await f.page.setViewportSize({width:390,height:844});await open(a,'Z renamed assistant');assert.ok(await drawer.evaluate(el=>el.getBoundingClientRect().width<=innerWidth));await close.click();await f.page.setViewportSize({width:1280,height:900});
 await f.page.getByRole('tab',{name:'Claude Code',exact:true}).click();
 const card=f.page.locator('.demo-client-card').filter({has:f.page.getByRole('button',{name:'Edit permissions '+a,exact:true})});await card.locator('summary').click();await card.getByRole('button',{name:'Rename '+a,exact:true}).click();assert.equal(await review.isDisabled(),true);await f.page.getByRole('button',{name:'Cancel rename',exact:true}).click();
 const revoked=JSON.parse(f.cli('local-mcp.js','list').stdout).result.find(client=>client.revoked).id;
 for(const id of [undefined,'missing-client',revoked]){codexId=id;await f.page.getByRole('tab',{name:'Codex',exact:true}).click();await f.page.getByText('Choose a project once.',{exact:false}).waitFor();assert.equal(await review.isDisabled(),true);assert.equal(await panel.count(),0);await f.page.getByRole('tab',{name:'Claude Code',exact:true}).click();}
});

test('passive context refresh keeps automatic selection and layout stable through reorder and removal', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 const list=f.page.getByRole('region',{name:'Saved context'}),selected=()=>list.locator('[aria-pressed="true"]');
 const firstId=await f.page.locator('.demo-inspector details code').nth(1).textContent();
 const first=await selected().innerText(),before=(await list.boundingBox()).y;let release,seen,remove=false;
 let waiting=new Promise(resolve=>seen=resolve),hold=new Promise(resolve=>release=resolve);t.after(()=>release());
 await f.page.route('**/graphql',async route=>{if(!route.request().postDataJSON().query.includes('LocalSavedPreferences'))return route.continue();const response=await route.fetch(),body=await response.json();body.data.activePreferences.reverse();if(remove)body.data.activePreferences=body.data.activePreferences.filter(p=>p.id!==firstId);seen();await hold;await route.fulfill({response,json:body});});
 await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await waiting;
 assert.equal(await f.page.getByText('Refreshing saved preferences…',{exact:true}).count(),0);assert.equal((await list.boundingBox()).y,before);
 release();await f.page.waitForTimeout(300);assert.equal(await selected().innerText(),first);
 // A removed selected item gets a new pinned fallback; later reorder cannot move it.
 remove=true;await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.waitForFunction(value=>document.querySelector('.demo-context-row[aria-pressed="true"]')?.textContent!==value,first);
 const fallback=await selected().innerText();assert.notEqual(fallback,first);assert.equal(await list.locator('[tabindex="0"]').count(),1);
 await f.page.unroute('**/graphql');await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.waitForTimeout(300);assert.equal(await selected().innerText(),fallback);
 await f.page.getByLabel('Search your context').fill('work.demo001.');const filtered=await selected().innerText();await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.waitForTimeout(300);assert.equal(await selected().innerText(),filtered);
});

test('passive context refresh updates sensitivity and preserves manual field interpretation until Clear', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);
 const {connect,call}=await import('../../backend/scripts/demo/mcp-import.mjs'),path=await import('node:path');
 const peer=await connect(Number(new URL(f.ready.mcpOrigin).port),path.join(f.root,'demo/exports/agent-a.token'));t.after(()=>peer.close());
 const slug='work.demo001.polish_sensitive';
 await f.page.getByRole('button',{name:'Add or import',exact:true}).click();const tools=f.page.getByRole('region',{name:'Context tools'});
 await tools.getByLabel('Memory field',{exact:true}).fill(slug);await tools.getByLabel('Value',{exact:true}).fill('Unfinished string draft');
 await call(peer,'mutatePreferences',{operation:'CREATE_DEFINITION',definition:{slug,description:'Synthetic sensitive field',valueType:'BOOLEAN',scope:'GLOBAL',isSensitive:true}});
 await call(peer,'mutatePreferences',{operation:'SET_PREFERENCE',preference:{slug,value:'true'}});
 await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.getByLabel('Search your context').fill(slug);await f.page.locator('.demo-detail-meta').getByText('Sensitive',{exact:true}).waitFor();
 assert.equal(await tools.getByLabel('Value',{exact:true}).evaluate(e=>e.tagName),'INPUT');assert.equal(await tools.getByLabel('Value',{exact:true}).inputValue(),'Unfinished string draft');
 await tools.getByRole('button',{name:'Clear',exact:true}).click();await tools.getByLabel('Memory field',{exact:true}).fill(slug);assert.equal(await tools.getByLabel('Value',{exact:true}).evaluate(e=>e.tagName),'SELECT');
});

test('failed passive refresh is a quiet stale-data notice with an explicit read retry', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);await openDemo(f);let fail=true;
 await f.page.route('**/graphql',route=>route.request().postDataJSON().query.includes('LocalSavedPreferences')&&fail?route.fulfill({status:503,json:{}}):route.continue());
 await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.getByText('Context may be out of date. Could not refresh in the background.',{exact:true}).waitFor();assert.equal(await f.page.getByText('Context may be out of date. Could not refresh in the background.',{exact:true}).locator('..').getAttribute('role'),'status');
 fail=false;await f.page.getByRole('button',{name:'Retry saved preferences refresh',exact:true}).click();await f.page.getByText('Context may be out of date.',{exact:false}).waitFor({state:'hidden'});
});

for(const client of ['claude','codex'])test(`${client} lost launch reply clears only when a new request is observed without replay`, {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);let opens=0,state={available:true,state:'exited',busy:false,request:'a'.repeat(32)};
 await f.page.route(`**/api/local/demo/${client}/status`,route=>route.fulfill({json:state}));
 await f.page.route(`**/api/local/demo/${client}/open`,route=>{opens++;return route.abort();});
 await openDemo(f);await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();if(client==='codex')await f.page.getByRole('tab',{name:'Codex',exact:true}).click();await f.page.getByText('Your latest chat has closed.',{exact:false}).waitFor();
 await f.page.getByRole('button',{name:client==='codex'?'Open Codex':'Open Claude Code',exact:true}).click();const error=f.page.getByText('Launch could not be confirmed.',{exact:false});await error.waitFor();
 await f.page.waitForTimeout(2300);assert.equal(await error.isVisible(),true);assert.equal(opens,1);
 state={...state,state:'starting',request:'b'.repeat(32)};await f.page.getByText('Your latest chat is opening', {exact:false}).waitFor();assert.equal(await error.count(),0);assert.equal(opens,1);
 state={...state,state:'login-interrupted'};await f.page.getByText('Sign-in was interrupted.',{exact:false}).waitFor();assert.equal(await f.page.getByText('Setup did not finish.',{exact:false}).count(),0);
});

test('drawer save result is visible and closing during list refresh restores its trigger afterward', {timeout:60000},async t=>{
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);
 const {readFile}=await import('node:fs/promises'),receipt=JSON.parse(await readFile(f.root+'/demo/generation.json'));
 await f.page.route('**/api/local/demo/claude/status',route=>route.fulfill({json:{available:true,clientId:receipt.clients.agentB,state:'idle',busy:false}}));
 await openDemo(f);await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 const review=f.page.getByRole('button',{name:'Review access',exact:true});await review.click();
 const panel=f.page.getByRole('region',{name:'Edit permissions',exact:true});await panel.getByLabel('Maximum value access').selectOption('Blocked');
 await panel.getByRole('button',{name:'Preview resulting access',exact:true}).click();await panel.getByRole('region',{name:'Resulting access preview'}).waitFor();
 let release,seen;const held=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>seen=resolve);t.after(()=>release?.());
 await f.page.route('**/api/local/mcp/list',async route=>{seen();await held;await route.continue();});
 await panel.getByRole('button',{name:'Save permissions',exact:true}).click();await waiting;
 const outcome=panel.getByText('Permissions saved',{exact:true});await outcome.waitFor();
 await f.page.waitForFunction(()=>{const result=document.querySelector('dialog [tabindex="-1"][role]');return result===document.activeElement;});
 assert.ok(await outcome.evaluate(el=>{const r=el.getBoundingClientRect(),toolbar=document.querySelector('.demo-access-drawer-toolbar').getBoundingClientRect();return r.top>=toolbar.bottom&&r.bottom<=innerHeight;}));
 await f.page.getByRole('button',{name:'Close access controls',exact:true}).click();await f.page.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(await review.isDisabled(),true);release();await f.page.waitForFunction(()=>document.activeElement?.textContent==='Review access');
 assert.equal(await f.page.evaluate(()=>document.body.style.overflow),'');
});

async function accessPolishFixture(t) {
 const f=await browserFixture(t,{demo:true});f.page.setDefaultTimeout(10000);
 const {readFile}=await import('node:fs/promises'),receipt=JSON.parse(await readFile(f.root+'/demo/generation.json'));
 for(const [name,id] of [['claude',receipt.clients.agentB],['codex',receipt.clients.agentA]])await f.page.route(`**/api/local/demo/${name}/status`,route=>route.fulfill({json:{available:true,clientId:id,state:'starting',busy:false,startedAt:'2026-01-01T00:00:00Z'}}));
 await openDemo(f);await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();
 return {...f,a:receipt.clients.agentA,b:receipt.clients.agentB};
}

test('assistant selection survives Activity Back and reload, and legacy naming stays exact-client bound', {timeout:60000},async t=>{
 const f=await accessPolishFixture(t);
 f.cli('local-mcp.js','rename','--id',f.a,'--label','Demo agent A — writer');f.cli('local-mcp.js','rename','--id',f.b,'--label','Demo agent A — writer');
 await f.page.getByRole('button',{name:'Refresh connections',exact:true}).click();
 await f.page.getByRole('tab',{name:'Codex',exact:true}).click();assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('context-router.demo-assistant.v1')),'codex');
 const card=id=>f.page.locator('.demo-client-card').filter({has:f.page.getByRole('button',{name:'Edit permissions '+id,exact:true})});
 await card(f.a).getByText('Codex — writer',{exact:true}).waitFor();await card(f.b).getByText('Demo agent A — writer',{exact:true}).waitFor();
 await f.page.getByRole('region',{name:'Connect Codex'}).getByRole('link',{name:'View activity',exact:true}).click();await f.page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
 await f.page.goBack();await f.page.getByRole('heading',{name:'Your context, in Codex',exact:true}).waitFor();await f.page.reload();await f.page.getByRole('heading',{name:'Your context, in Codex',exact:true}).waitFor();
 assert.equal(await f.page.getByRole('tab',{name:'Codex',exact:true}).getAttribute('aria-selected'),'true');
 await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Context',exact:true}).click();await f.page.getByRole('heading',{name:'Your context',exact:true}).waitFor();await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Connections',exact:true}).click();await f.page.getByRole('heading',{name:'Your context, in Codex',exact:true}).waitFor();
 await f.page.getByRole('button',{name:'Review access',exact:true}).click();await f.page.getByRole('heading',{name:/Codex access —/}).waitFor();
 await f.page.getByRole('region',{name:'Edit permissions',exact:true}).getByText('Instance '+f.a+'.',{exact:false}).waitFor();
});

test('drawer refresh coalesces changes during a read, preserves drafts and keeps actions visible', {timeout:60000},async t=>{
 const f=await accessPolishFixture(t);await f.page.getByRole('tab',{name:'Codex',exact:true}).click();await f.page.getByRole('button',{name:'Review access',exact:true}).click();
 const panel=f.page.getByRole('region',{name:'Edit permissions',exact:true}),preview=panel.getByRole('button',{name:'Preview resulting access',exact:true});
 await panel.getByLabel('Maximum value access').selectOption('Blocked');await panel.getByText('Reading and changing values is blocked.',{exact:false}).waitFor();
 assert.equal(await panel.getByLabel('Manage context fields',{exact:true}).isChecked(),true);
 let release,seen,reads=0;const hold=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>seen=resolve);t.after(()=>release?.());
 await f.page.route('**/api/local/mcp/inspect',async route=>{reads++;const response=await route.fetch();if(reads===1){seen();await hold;}await route.fulfill({response});});
 await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await waiting;
 f.cli('local-mcp.js','permissions','--id',f.a,'--capabilities','preferences:write,preferences:define','--targets','work.*');
 await f.page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'));});release();
 await panel.getByText('Advanced: categories, fields and rules',{exact:true}).click();await panel.getByRole('button',{name:'Remove maximum target work.*',exact:true}).waitFor();assert.equal(reads,2);
 assert.equal(await panel.getByLabel('Maximum value access').inputValue(),'Blocked');
 for(const [width,height] of [[1280,720],[390,600]]){await f.page.setViewportSize({width,height});await panel.getByLabel('Search categories or fields').scrollIntoViewIfNeeded();assert.ok(await preview.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));}
 await preview.click();await panel.getByRole('region',{name:'Resulting access preview'}).waitFor();
 const save=panel.getByRole('button',{name:'Save permissions',exact:true});assert.ok(await save.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
 await save.click();await panel.getByText('Permissions saved',{exact:true}).waitFor();await f.page.getByRole('button',{name:'Close access controls'}).click();
 const card=f.page.locator('.demo-client-card').filter({has:f.page.getByRole('button',{name:'Edit permissions '+f.a,exact:true})});await card.getByText('Field management is enabled separately, within its scope and rules.',{exact:false}).waitFor();
});

test('failed list refresh cannot steal focus on a later explicit retry', {timeout:60000},async t=>{
 const f=await accessPolishFixture(t);const review=f.page.getByRole('button',{name:'Review access',exact:true});await review.click();
 const panel=f.page.getByRole('region',{name:'Edit permissions',exact:true});await panel.getByLabel('Maximum value access').waitFor();
 let fail=true,release,seen,retryRelease;const hold=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>seen=resolve),retryHold=new Promise(resolve=>retryRelease=resolve);t.after(()=>{release?.();retryRelease?.();});
 await f.page.route('**/api/local/mcp/list',async route=>{if(!fail){await retryHold;return route.continue();}seen();await hold;await route.fulfill({status:503,json:{}});});
 await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await waiting;await f.page.getByRole('button',{name:'Close access controls'}).click();release();
 await f.page.getByText('Unable to load connections. Refresh to continue.',{exact:true}).waitFor();fail=false;
 const refresh=f.page.getByRole('button',{name:'Refresh connections',exact:true});await refresh.click();const tab=f.page.getByRole('tab',{name:'Claude Code',exact:true});await tab.focus();retryRelease();await f.page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Review access')?.disabled);
 assert.equal(await review.evaluate(el=>el===document.activeElement),false);assert.equal(await tab.evaluate(el=>el===document.activeElement),true);
});

test('demo Activity updates live and pauses while filter drafts or details are open', {timeout:60000},async t=>{
 const f=await accessPolishFixture(t),{connect,call}=await import('../../backend/scripts/demo/mcp-import.mjs');
 const peer=await connect(Number(new URL(f.ready.mcpOrigin).port),f.root+'/demo/exports/agent-a.token');t.after(()=>peer.close());
 await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Activity',exact:true}).click();await f.page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
 await call(peer,'searchPreferences',{query:'work.demo001.'});const row=f.page.getByRole('button').filter({hasText:'searched context'}).first();await row.waitFor();
 await row.click();let polls=0;f.page.on('request',req=>{if(req.url().endsWith('/graphql')&&req.postDataJSON()?.query.includes('McpAccessHistoryForTab'))polls++;});
 await f.page.waitForTimeout(3400);assert.equal(polls,0);assert.equal(await row.getAttribute('aria-expanded'),'true');await row.click();
 const activity=f.page.getByRole('tabpanel',{name:'Assistant access'});await activity.getByText('Filter activity',{exact:true}).click();await activity.getByLabel('Operation',{exact:true}).fill('unfinished');await f.page.waitForTimeout(3400);assert.equal(polls,0);assert.equal(await activity.getByLabel('Operation',{exact:true}).inputValue(),'unfinished');
});

test('latest exact-assistant denial is visible without masking a later successful read', {timeout:60000},async t=>{
 const f=await accessPolishFixture(t);let denied=false,recovered=false;
 const event=(id,outcome,seconds)=>({clientKey:`local:${id}`,operationName:'searchPreferences',outcome,occurredAt:`2026-11-22T18:00:${seconds}Z`,responseMetadata:{activeCount:outcome==='SUCCESS'?1:0}});
 await f.page.route('**/graphql',route=>route.request().postDataJSON().query.includes('DemoClaudeRead')?route.fulfill({json:{data:{mcpAccessHistory:{items:[...(recovered?[{...event(f.a,'SUCCESS','30'),responseMetadata:{activeCount:0}}]:[]),...(denied?[event(f.a,'DENY','20')]:[]),event(f.b,'DENY','10'),event(f.a,'SUCCESS','00')]}}}}):route.continue());
 await f.page.getByRole('tab',{name:'Codex',exact:true}).click();await f.page.getByText(/^Context read at /).waitFor();assert.equal(await f.page.getByText('Your latest context read was denied.',{exact:false}).count(),0);
 denied=true;await f.page.getByText('Your latest context read was denied.',{exact:false}).waitFor();recovered=true;await f.page.getByText(/^Context read at /).waitFor();assert.equal(await f.page.getByText('Your latest context read was denied.',{exact:false}).count(),0);
 await f.page.route('**/api/local/demo/codex/status',route=>route.fulfill({json:{available:true,clientId:f.a,state:'failed',busy:false}}));await f.page.getByRole('alert').filter({hasText:'Setup did not finish.'}).waitFor();
});

test('Activity polling preserves paginated browsing even with short pages', {timeout:60000},async t=>{
 const f=await accessPolishFixture(t);let requests=0;
 const event=(n,operationName)=>({id:`poll-test-${n}`,clientKey:`local:${f.a}`,occurredAt:'2026-11-22T18:00:00Z',surface:'TOOLS_CALL',operationName,outcome:'SUCCESS',correlationId:null,latencyMs:1,requestMetadata:{},responseMetadata:{activeCount:1},errorMetadata:null});
 await f.page.route('**/graphql',route=>{const body=route.request().postDataJSON();if(!body.query.includes('McpAccessHistoryForTab'))return route.continue();requests++;return route.fulfill({json:{data:{mcpAccessHistory:body.variables.input.after?{items:[event(3,'listPreferenceSlugs')],hasNextPage:false,nextCursor:null}:{items:[event(1,'searchPreferences'),event(2,'searchPreferences')],hasNextPage:true,nextCursor:'next'}}}});});
 await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Activity',exact:true}).click();await f.page.getByRole('button',{name:'Load more',exact:true}).click();await f.page.getByRole('button').filter({hasText:'listPreferenceSlugs'}).waitFor();
 const before=requests;await f.page.waitForTimeout(3400);assert.equal(requests,before);assert.equal(await f.page.locator('.demo-history-row').count(),3);
});

test('an in-flight Activity poll cannot replace details opened while it was waiting', {timeout:60000},async t=>{
 const f=await accessPolishFixture(t);let holdPoll=false,release,seen,done;
 const hold=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>seen=resolve),settled=new Promise(resolve=>done=resolve);t.after(()=>release?.());
 const event=id=>({id,clientKey:`local:${f.a}`,occurredAt:'2026-11-22T18:00:00Z',surface:'TOOLS_CALL',operationName:id==='original'?'searchPreferences':'listPreferenceSlugs',outcome:'SUCCESS',correlationId:null,latencyMs:1,requestMetadata:{},responseMetadata:{activeCount:1},errorMetadata:null});
 await f.page.route('**/graphql',async route=>{if(!route.request().postDataJSON().query.includes('McpAccessHistoryForTab'))return route.continue();const held=holdPoll;if(held){seen();await hold;}try{await route.fulfill({json:{data:{mcpAccessHistory:{items:[event(held?'replacement':'original')],hasNextPage:false,nextCursor:null}}}});}catch{}finally{if(held)done();}});
 await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Activity',exact:true}).click();const row=f.page.getByRole('button').filter({hasText:'searched context'});await row.waitFor();holdPoll=true;await waiting;
 await row.click();assert.equal(await row.getAttribute('aria-expanded'),'true');release();await settled;await f.page.waitForTimeout(300);
 assert.equal(await row.getAttribute('aria-expanded'),'true');assert.equal(await f.page.getByRole('button').filter({hasText:'listPreferenceSlugs'}).count(),0);
});
