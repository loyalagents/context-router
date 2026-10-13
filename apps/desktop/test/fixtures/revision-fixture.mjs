import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './supervisor-fixture.mjs';
import {writeSignedFixture} from './signed-package.mjs';

export async function editedFixture(t,variant,edit){
  const f=await fixture(t,variant);
  const bundle=path.dirname(path.dirname(path.dirname(f.executable))),resources=path.join(bundle,'Contents/Resources');
  const runtime=path.join(resources,'desktop/runtime');
  await edit(runtime,f);
  await writeSignedFixture(bundle);
  return {...f,runtime};
}
export async function replace(file,before,after){
  const source=await readFile(file,'utf8');if(!source.includes(before))throw new Error('Missing fixture insertion point');
  await writeFile(file,source.replace(before,after));
}
export async function journal(f){const j=JSON.parse(await readFile(path.join(f.envelope,'owner.json')));f.acceptQuiescent(j);return j;}
