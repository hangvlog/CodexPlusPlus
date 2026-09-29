// Upload bytes to an existing release without PATCHing its metadata.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const [directory] = process.argv.slice(2);
const repo=process.env.GH_REPO, tag=process.env.CLAWKIT_RELEASE_TAG;
if (!directory || !repo || !/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('Missing release identity');
function gh(args, capture=false) {
  const result=spawnSync('gh',args,{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit'});
  if(result.status!==0) throw new Error(`GitHub operation failed: ${args[0]}`);
  return result.stdout;
}
const release=JSON.parse(gh(['api',`repos/${repo}/releases/tags/${tag}`],true));
for(const name of readdirSync(directory).filter(n=>/\.(dmg|zip|exe|gz|sig)$/.test(n)).sort()) {
  const path=join(directory,name), bytes=statSync(path).size;
  const hash='sha256:'+createHash('sha256').update(readFileSync(path)).digest('hex');
  const old=release.assets.find(a=>a.name===name);
  if(old){
    if(old.size!==bytes || old.digest!==hash) throw new Error(`Existing release asset differs: ${name}`);
    console.log(`Verified existing ${name}`); continue;
  }
  gh(['release','upload',tag,path,'--repo',repo]);
}
