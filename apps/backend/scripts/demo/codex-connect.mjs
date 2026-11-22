import path from 'node:path';
import {exists} from './trusted-files.mjs';
import {spawnSync} from 'node:child_process';
import {loginSpec} from './clients.mjs';
import {safeError} from './files.mjs';

export function codexCodingLaunchSpec(launch,project){
 const args=launch.args.map(value=>value==='read-only'?'workspace-write':/^features\.(shell_tool|unified_exec|view_image)=false$/.test(value)?value.replace('=false','=true'):value==='project_doc_max_bytes=0'?'project_doc_max_bytes=32768':value);
 args.splice(args.length-1,0,'-c','project_root_markers=[]');
 return {...launch,args,cwd:project};
}
export function codexLoginSpec(launch){
 const spec=loginSpec(launch);
 return {...spec,cwd:launch.env.HOME,args:[...spec.args.slice(0,-1),'-c','project_root_markers=[]','login']};
}
export async function validateCodexProject(project){
 if(await exists(path.join(project,'.codex/config.toml')))throw safeError('Choose a demo project without its own Codex config (.codex/config.toml). Existing settings are left unchanged.');
}
export function parseCodexAuthStatus(result,config){
 let output=result.stderr??'';
 // The qualified CLI cannot create PATH aliases in disposable probe roots.
 // Permit only its known diagnostic, bound to this exact isolated config.
 const lines=output.trim().split('\n');
 if(lines.length===2&&config&&lines[0].startsWith('WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "')&&lines[0].endsWith(`(codex_home: AbsolutePathBuf(${JSON.stringify(config)}))`))output=lines[1];
 if(result.stdout===''&&result.status===0&&output.trim()==='Logged in using ChatGPT')return true;
 if(result.stdout===''&&result.status===1&&output.trim()==='Not logged in')return false;
 throw safeError('Could not verify the separate Codex demo sign-in. No conversation was started.');
}
export function codexAuthStatus(launch,guard){
 guard.mutating();
 const spec=codexLoginSpec(launch);
 const result=spawnSync(spec.executable,[...spec.args,'status'],{cwd:spec.cwd,env:spec.env,input:'',encoding:'utf8',timeout:15000,maxBuffer:65536});
 if(result.error||result.signal!==null)throw safeError('Codex sign-in check was interrupted. Invocation evidence is retained.');
 const signedIn=parseCodexAuthStatus(result,launch.env.CODEX_HOME);guard.settled();return signedIn;
}
