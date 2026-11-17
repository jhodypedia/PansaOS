import { every } from '@boxd/run';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dir,'..');
async function settings(){
  const raw=await readFile(path.join(root,'.env'),'utf8');
  const values=Object.fromEntries(raw.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));
  return {url:process.env.PANSA_CORE_URL??'http://127.0.0.1:3001',token:values.DASH_TOKEN};
}
async function post(route:string){const {url,token}=await settings();if(!token)throw new Error('DASH_TOKEN tidak ditemukan');const r=await fetch(`${url}/api/${route}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`Maintenance HTTP ${r.status}`);return r.json();}
every('1 minute',async()=>{console.log(await post('scheduler/tick'));});
every('0 2 * * *',async()=>{console.log(await post('backup'));});
