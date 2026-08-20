#!/usr/bin/env node
// One-time cleanup: collapse duplicate CLUSTERS already live in the catalogue
// (from before the ingest dedupe existed). Groups active listings by dedupe_key;
// for each cluster of 2+ it KEEPS the best one and sets the rest to
// admin_status='inactive' (non-destructive, reversible). Audit #4.
//   node scripts/collapse-duplicates.mjs --dry-run
//   node scripts/collapse-duplicates.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(ROOT,'..','.env.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const i=t.indexOf('='); if(i<0)continue;
  let v=t.slice(i+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
  if(!(t.slice(0,i).trim() in process.env)) process.env[t.slice(0,i).trim()]=v;
}
const DB=process.env.AIROBASE_URL, KEY=process.env.AIROBASE_SECRET_KEY;
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const DRY=process.argv.includes('--dry-run');

// 1) all active, non-delisted listings that carry a dedupe_key
let props=[]; for(let off=0;;off+=1000){
  const r=await fetch(`${DB}/rest/v1/properties?admin_status=eq.active&is_delisted=eq.false&dedupe_key=not.is.null&select=id,dedupe_key,last_scraped_at,feature_image_url,property_type,city,price&order=id.asc&limit=1000&offset=${off}`,{headers:H});
  const b=await r.json(); if(!b.length)break; props.push(...b); if(b.length<1000)break;
}
// 2) image count per property
const imgCount={}; for(let off=0;;off+=1000){
  const r=await fetch(`${DB}/rest/v1/property_images?select=property_id&limit=1000&offset=${off}`,{headers:H});
  const b=await r.json(); if(!b.length)break; for(const x of b) imgCount[x.property_id]=(imgCount[x.property_id]||0)+1; if(b.length<1000)break;
}
// 3) group by dedupe_key
const groups={}; for(const p of props){ (groups[p.dedupe_key] ||= []).push(p); }
const clusters=Object.entries(groups).filter(([,ps])=>ps.length>1);
console.log(`active listings with a key: ${props.length}`);
console.log(`duplicate clusters (2+): ${clusters.length}`);
let toDeactivate=0, shown=0;
for(const [key,ps] of clusters){
  // rank: most images, then has feature image, then most recently scraped, then id
  ps.sort((a,b)=> (imgCount[b.id]||0)-(imgCount[a.id]||0) || (b.feature_image_url?1:0)-(a.feature_image_url?1:0) || String(b.last_scraped_at||'').localeCompare(String(a.last_scraped_at||'')) || a.id.localeCompare(b.id));
  const keep=ps[0], drop=ps.slice(1); toDeactivate+=drop.length;
  if(DRY && shown<8){ console.log(`  cluster ${key}  (${ps.length}) — keep ${keep.id.slice(0,8)} [${imgCount[keep.id]||0} imgs], drop ${drop.length}`); shown++; }
  if(!DRY){ for(const d of drop){ await fetch(`${DB}/rest/v1/properties?id=eq.${d.id}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({admin_status:'inactive'})}); } }
}
console.log(`\n${DRY?'WOULD deactivate':'DEACTIVATED'} ${toDeactivate} duplicate listings across ${clusters.length} clusters.`);
console.log(`After: ${props.length - toDeactivate} active listings remain (was ${props.length}).`);
