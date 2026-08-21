#!/usr/bin/env node
// Batch: run the watermark AI checker + removal on EVERY image of every ACTIVE
// listing. Detects logos / phone / URL / heavy-text / large-title overlays via
// Google Vision, inpaints with Sharp, uploads the clean webp to B2, and repoints
// the property_images row (+ feature_image_url). Clean photos are left untouched.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(ROOT,'..','.env.local'),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const i=t.indexOf('='); if(i<0)continue;
  let v=t.slice(i+1).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
  if(!(t.slice(0,i).trim() in process.env)) process.env[t.slice(0,i).trim()]=v;
}
const DB=process.env.AIROBASE_URL, KEY=process.env.AIROBASE_SECRET_KEY, VK=process.env.GOOGLE_VISION_API_KEY;
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const s3=new S3Client({endpoint:process.env.B2_S3_ENDPOINT,region:process.env.B2_REGION,credentials:{accessKeyId:process.env.B2_KEY_ID,secretAccessKey:process.env.B2_APP_KEY},forcePathStyle:true});
const V='https://vision.googleapis.com/v1/images:annotate';
const box=(v)=>{const xs=v.map(p=>p.x||0),ys=v.map(p=>p.y||0);return{left:Math.min(...xs),top:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};};
async function detect(buf,w,h){
  const r=await fetch(`${V}?key=${VK}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests:[{image:{content:buf.toString('base64')},features:[{type:'LOGO_DETECTION',maxResults:5},{type:'TEXT_DETECTION',maxResults:1}]}]})}).catch(()=>null);
  if(!r||!r.ok)return null; const r0=(await r.json()).responses?.[0]||{}; const bx=[];
  for(const l of r0.logoAnnotations||[]) if(l.boundingPoly?.vertices) bx.push(box(l.boundingPoly.vertices));
  const full=r0.textAnnotations?.[0]?.description||'';
  const hasPhone=/(\+?595|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/.test(full), hasUrl=/(www\.|https?:\/\/|\.(com|net|org|py|co)\b)/i.test(full), heavy=full.replace(/\s+/g,'').length>40;
  let big=false; const fv=r0.textAnnotations?.[0]?.boundingPoly?.vertices;
  if(fv){const b=box(fv); if((b.right-b.left)>=0.28*w&&(b.bottom-b.top)>=0.07*h)big=true;}
  if(hasPhone||hasUrl||heavy||big) for(const t of (r0.textAnnotations||[]).slice(1)) if(t.boundingPoly?.vertices) bx.push(box(t.boundingPoly.vertices));
  if(!bx.length)return null;
  let L=Math.min(...bx.map(b=>b.left)),T=Math.min(...bx.map(b=>b.top)),R=Math.max(...bx.map(b=>b.right)),B=Math.max(...bx.map(b=>b.bottom));
  if(((R-L)*(B-T))/(w*h)>0.55)return null;
  const px=w*0.1,py=h*0.1; L=Math.max(0,L-px);T=Math.max(0,T-py);R=R>=w*0.85?w:Math.min(w,R+px);B=B>=h*0.85?h:Math.min(h,B+py);
  return {left:Math.round(L),top:Math.round(T),width:Math.round(R-L),height:Math.round(B-T)};
}
async function fill(buf,rg,W,Hh){
  const sl=Math.max(0,Math.min(rg.left,W-1)),st=Math.max(0,Math.min(rg.top,Hh-1)),sw=Math.min(rg.width,W-sl),sh=Math.min(rg.height,Hh-st);
  if(sw<=0||sh<=0)return buf; const below=Hh-(st+sh),above=st; let patch;
  if(below>=20){const ph=Math.min(sh,below);patch=await sharp(buf).extract({left:sl,top:st+sh,width:sw,height:ph}).resize(sw,sh,{fit:'fill'}).toBuffer();}
  else if(above>=20){const pt=Math.max(0,st-sh);const ph=Math.max(1,st-pt);patch=await sharp(buf).extract({left:sl,top:pt,width:sw,height:ph}).resize(sw,sh,{fit:'fill'}).toBuffer();}
  else patch=await sharp(buf).extract({left:sl,top:st,width:sw,height:sh}).blur(30).toBuffer();
  return sharp(buf).composite([{input:patch,left:sl,top:st}]).toBuffer();
}
// active property ids
const active=new Set(); const feat=new Set();
for(let off=0;;off+=1000){const r=await fetch(`${DB}/rest/v1/properties?admin_status=eq.active&is_delisted=eq.false&select=id&limit=1000&offset=${off}`,{headers:H});const b=await r.json();if(!b.length)break;b.forEach(x=>active.add(x.id));if(b.length<1000)break;}
// all images of active props
let imgs=[];
for(let off=0;;off+=1000){const r=await fetch(`${DB}/rest/v1/property_images?select=id,property_id,source_url,storage_key,is_feature&limit=1000&offset=${off}`,{headers:H});const b=await r.json();if(!b.length)break;imgs.push(...b.filter(x=>active.has(x.property_id) && !String(x.storage_key||'').includes('clean-')));if(b.length<1000)break;}
console.log(`[wm] active listings ${active.size} · images to scan ${imgs.length}`);
let scanned=0,removed=0,errs=0;
async function one(im){
  try{
    const raw=Buffer.from(await (await fetch(im.source_url,{signal:AbortSignal.timeout(20000)})).arrayBuffer());
    const work=await sharp(raw).rotate().resize(1280,1280,{fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer();
    const m=await sharp(work).metadata(); const rg=await detect(work,m.width,m.height);
    if(rg){
      const webp=await sharp(await fill(work,rg,m.width,m.height)).webp({quality:92}).toBuffer();
      const base=im.storage_key.split('/').pop().replace(/\.[^.]+$/,''); const key=im.storage_key.split('/').slice(0,-1).join('/')+`/clean-${base}.webp`;
      await s3.send(new PutObjectCommand({Bucket:process.env.B2_BUCKET,Key:key,Body:webp,ContentType:'image/webp'}));
      const url=`/api/media/${key.split('/').map(encodeURIComponent).join('/')}`;
      await fetch(`${DB}/rest/v1/property_images?id=eq.${im.id}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({storage_key:key,storage_url:url})});
      if(im.is_feature) await fetch(`${DB}/rest/v1/properties?id=eq.${im.property_id}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({feature_image_url:url})});
      removed++;
    }
  }catch{errs++;}
  scanned++; if(scanned%200===0)console.log(`[wm] scanned ${scanned}/${imgs.length} · removed ${removed} · errs ${errs}`);
}
// concurrency
const N=6; let idx=0;
await Promise.all(Array.from({length:N},async()=>{while(idx<imgs.length){await one(imgs[idx++]);}}));
console.log(`[wm] DONE — scanned ${scanned} · watermarks removed ${removed} · errors ${errs}`);
