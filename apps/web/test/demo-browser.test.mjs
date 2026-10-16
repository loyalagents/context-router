import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture} from './browser-fixture.mjs';

const navigation=[
 ['Edit Profile','/dashboard/profile'],['Preferences','/dashboard/preferences'],
 ['Form Fill','/dashboard/form-fill'],['Audit History','/dashboard/history'],
 ['Preference Schema','/dashboard/schema'],['Permission Grants','/dashboard/permissions'],
];

for(const demo of [false,true])test(`${demo?'demo':'personal'} uses the normal dashboard and navigation; demo help is optional`,{timeout:60000},async t=>{
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
 await f.page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
 for(const name of ['Account Information','Profile Memory'])await f.page.getByRole('heading',{name,exact:true}).waitFor();
 assert.deepEqual(await f.page.locator('a[href^="/dashboard/"]').evaluateAll(links=>links.map(a=>[a.textContent.trim(),a.getAttribute('href')])),navigation);
 assert.equal(await f.page.getByRole('complementary',{name:'Demo mode'}).count(),demo?1:0);
 const summary=f.page.getByText('Demo walkthrough (optional)',{exact:true});
 if(!demo){assert.equal(await summary.count(),0);return;}
 const guide=f.page.locator('details').filter({has:summary});
 assert.equal(await guide.getAttribute('open'),null);
 assert.equal(await f.page.getByRole('button',{name:'Copy step 1 prompt',exact:true}).isVisible(),false);
 await summary.click();assert.equal(await guide.getAttribute('open'),'');
 assert.equal(await guide.getByRole('button',{name:/Copy step [1-5] prompt/}).count(),5);
 const {loadBundledSeed}=await import('../../backend/scripts/demo/seed.mjs');
 const seed=await loadBundledSeed(new URL('../../../examples/demo-10-2026/001_user_001',import.meta.url).pathname),prefixes=new Set(seed.plan.sources.map(source=>source.file.slice(0,-6)+'.demo001.'));
 const promptText=await guide.locator('ol').innerText(),shown=[...promptText.matchAll(/[a-z]+\.demo001\.\*?/g)].map(match=>match[0]);assert.ok(shown.length>0);
 for(const prefix of shown)assert.ok(prefixes.has(prefix),'Prompt must use a real literal search prefix: '+prefix);
 await f.context.grantPermissions(['clipboard-read','clipboard-write'],{origin:f.ready.origin});
 const prompt=await guide.locator('li p').first().innerText();await guide.getByRole('button',{name:'Copy step 1 prompt',exact:true}).click();
 assert.equal(await f.page.evaluate(()=>navigator.clipboard.readText()),prompt);
 await summary.click();assert.equal(await guide.getAttribute('open'),null);
 assert.equal(await guide.getByRole('button',{name:'Copy step 1 prompt',exact:true}).isVisible(),false);
 const data=await f.graphql('query { activePreferences { slug } }');assert.equal(data.activePreferences.length,189);
 for(const [label,url,heading] of [
  ['Edit Profile','profile','Edit Profile'],['Preferences','preferences','Preferences'],
  ['Preference Schema','schema','Preference Schema'],['Permission Grants','permissions','MCP Clients'],['Audit History','history','Audit History'],
 ]){
  await f.page.goto(f.ready.origin+'/dashboard');await f.page.getByRole('link',{name:label,exact:true}).click();await f.page.waitForURL('**/dashboard/'+url);
  await f.page.getByRole('heading',{name:heading,exact:true}).waitFor();
  await f.page.getByRole('complementary',{name:'Demo mode'}).waitFor();
  if(url==='preferences')await f.page.getByText(data.activePreferences[0].slug.split('.').at(-1),{exact:true}).first().waitFor();
  if(url==='permissions')for(const role of ['A','B','C'])await f.page.getByText('Demo agent '+role,{exact:false}).first().waitFor();
 }
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
 await f.page.getByRole('button',{name:'Rename '+id,exact:true}).click();await f.page.getByLabel('Client name',{exact:true}).fill(label);await f.page.getByRole('button',{name:'Save name'}).click();await f.page.getByRole('status',{name:'Client name saved',exact:true}).waitFor();
 await f.page.getByRole('link',{name:'View activity '+id,exact:true}).click();
 for(const tab of ['MCP Access','Audit']){
  await f.page.getByRole('tab',{name:tab,exact:true}).click();const panel=f.page.getByRole('tabpanel',{name:tab,exact:true});
  if(tab==='Audit')await panel.getByRole('button',{name:'More filters',exact:true}).click();
  assert.equal(new URL(f.page.url()).hash,'#mcp-client='+id);assert.equal(await panel.getByLabel(tab==='Audit'?'Actor client key':'Client key').inputValue(),key);
  await panel.getByText(label,{exact:true}).first().waitFor();
  const row=panel.getByRole('button').filter({hasText:tab==='Audit'?slug:'mutatePreferences'}).first();await row.click();
  await panel.getByText('Client key: '+key,{exact:true}).waitFor();await f.page.getByRole('complementary',{name:'Demo mode'}).waitFor();
 }
 assert.deepEqual(history(),before,'rename must leave existing audit payloads and exact actor keys intact');
 await f.page.goto(f.ready.origin+'/dashboard/preferences');await f.page.getByText(label,{exact:true}).waitFor();
 assert.ok((await f.page.textContent('body')).includes(key));await f.page.getByRole('complementary',{name:'Demo mode'}).waitFor();
 const after=JSON.parse(f.cli('local-mcp.js','list').stdout).result;
 assert.equal(after.find(client=>client.id===id).label,label);
 assert.equal(after.find(client=>client.id===receipt.clients.agentB).label,'Demo agent B — reader');
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
 const banner=f.page.getByRole('complementary',{name:'Demo mode'});await banner.waitFor();
 assert.match(await banner.innerText(),/Installed local AI is used when available/);
 assert.doesNotMatch(await banner.innerText(),/AI is disabled/);
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
