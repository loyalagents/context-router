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
