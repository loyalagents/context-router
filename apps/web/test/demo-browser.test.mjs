import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture} from './browser-fixture.mjs';

test('historical demo guide and persistent banner reuse real memory, authority and history views', {timeout:60000}, async t=>{
 const f=await browserFixture(t,{demo:true});
 // Linux UI fixture: only admitted presentation metadata is response-injected.
 // Seed, identity, MCP grants, memory/history APIs and browser auth are real.
 // Native admission and mode changes are qualified by the macOS artifact harness.
 await f.page.route('**/api/local/capabilities',async route=>{
  const response=await route.fetch();const body=await response.json();
  if(response.status()===200)body.runtime={mode:'demo',launcher:'native',generation:'c'.repeat(32),storeId:'b'.repeat(32)};
  await route.fulfill({response,json:body});
 });
 await f.page.goto(f.ready.origin+'/dashboard');
 assert.equal(await f.page.getByRole('complementary',{name:'Demo mode'}).count(),0);
 await f.page.getByLabel('Unlock token').fill(f.bootstrap);await f.page.getByRole('button',{name:'Unlock local dashboard'}).click();
 await f.page.getByRole('heading',{name:'Explore the demo'}).waitFor();
 assert.equal(await f.page.getByRole('button',{name:/Copy step [1-5] prompt/}).count(),5);
 const {loadBundledSeed}=await import('../../backend/scripts/demo/seed.mjs');
 const seed=await loadBundledSeed(new URL('../../../examples/demo-10-2026/001_user_001',import.meta.url).pathname),prefixes=new Set(seed.plan.sources.map(source=>source.file.slice(0,-6)+'.demo001.'));
 const promptText=await f.page.locator('main ol').innerText(),shown=[...promptText.matchAll(/[a-z]+\.demo001\.\*?/g)].map(match=>match[0]);assert.ok(shown.length>0);
 for(const prefix of shown)assert.ok(prefixes.has(prefix),'Prompt must use a real literal search prefix: '+prefix);
 for(const [link,url] of [['Memories','preferences'],['Agent permissions','permissions'],['Changes and access','history']]){
  await f.page.goto(f.ready.origin+'/dashboard');await f.page.getByRole('link',{name:link,exact:true}).click();await f.page.waitForURL('**/dashboard/'+url);
  await f.page.getByRole('complementary',{name:'Demo mode'}).waitFor();assert.match(await f.page.getByRole('complementary',{name:'Demo mode'}).innerText(),/historical 2024–2025/);
  if(url==='permissions'){await f.page.getByText('Demo agent A', {exact:false}).first().waitFor();await f.page.getByText('Demo agent B',{exact:false}).first().waitFor();await f.page.getByText('Demo agent C',{exact:false}).first().waitFor();}
 }
 const data=await f.graphql('query { activePreferences { slug } }');assert.equal(data.activePreferences.length,189);
});
