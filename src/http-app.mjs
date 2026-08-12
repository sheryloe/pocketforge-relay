import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { listPresets } from './presets.mjs';
import { applySecurityHeaders, safeStaticPath, tokenMatches } from './security.mjs';
const MIME = new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png']]);
export function createPocketForgeServer({ config, manager }) {
  return http.createServer(async (req,res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res,200,{ok:true,name:'PocketForge Relay',version:'0.1.0',time:new Date().toISOString()});
      if (url.pathname.startsWith('/api/')) { applySecurityHeaders(res,{api:true}); if (!tokenMatches(config.token, req.headers.authorization)) return json(res,401,{error:'Missing or invalid bearer token.'}); return await api(req,res,url,manager); }
      return await staticFile(res,config.publicDir,url.pathname);
    } catch (e) { if (!res.headersSent) { applySecurityHeaders(res,{api:url.pathname.startsWith('/api/')}); return json(res,e.statusCode||500,{error:e.statusCode?e.message:'Internal server error.'}); } res.end(); }
  });
}
async function api(req,res,url,manager) {
  if (url.pathname === '/api/presets' && req.method === 'GET') return json(res,200,{presets:listPresets()});
  if (url.pathname === '/api/jobs' && req.method === 'GET') return json(res,200,{jobs:manager.listJobs()});
  if (url.pathname === '/api/jobs' && req.method === 'POST') { const body = await readJson(req,64*1024); try { return json(res,202,{job:manager.createJob(body)}); } catch(e) { return json(res,400,{error:e.message}); } }
  let m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)$/i); if (m && req.method === 'GET') { const j=manager.getJob(m[1]); return j?json(res,200,{job:j}):json(res,404,{error:'Job not found.'}); }
  m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/cancel$/i); if (m && req.method === 'POST') { const j=manager.cancelJob(m[1]); return j?json(res,200,{job:j}):json(res,404,{error:'Job not found.'}); }
  m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/events$/i); if (m && req.method === 'GET') {
    const snapshot=manager.getJob(m[1]); if(!snapshot) return json(res,404,{error:'Job not found.'});
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'}); event(res,'snapshot',snapshot);
    const unsubscribe=manager.subscribe(m[1],e=>event(res,e.type,e)); const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000); req.on('close',()=>{clearInterval(heartbeat);unsubscribe?.();}); return;
  }
  m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/artifacts\/([0-9]+)$/i); if (m && req.method === 'GET') { const a=manager.getArtifact(m[1],m[2]); if(!a) return json(res,404,{error:'Artifact not found.'}); const s=await fsp.stat(a.absolutePath); res.writeHead(200,{'Content-Type':a.contentType,'Content-Length':s.size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); fs.createReadStream(a.absolutePath).pipe(res); return; }
  return json(res,404,{error:'API route not found.'});
}
async function staticFile(res,dir,requestPath) { const p=safeStaticPath(dir,requestPath); if(!p){applySecurityHeaders(res);return text(res,400,'Bad request.');} let s;try{s=await fsp.stat(p);}catch{applySecurityHeaders(res);return text(res,404,'Not found.');} if(!s.isFile()){applySecurityHeaders(res);return text(res,404,'Not found.');} applySecurityHeaders(res); const ext=path.extname(p).toLowerCase();res.writeHead(200,{'Content-Type':MIME.get(ext)||'application/octet-stream','Content-Length':s.size,'Cache-Control':ext==='.html'?'no-cache':'public, max-age=300'});fs.createReadStream(p).pipe(res); }
async function readJson(req,max){const chunks=[];let total=0;for await(const c of req){total+=c.length;if(total>max){const e=new Error('Request body is too large.');e.statusCode=413;throw e;}chunks.push(c);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Request body must be valid JSON.');e.statusCode=400;throw e;}}
function event(res,name,payload){if(res.destroyed||res.writableEnded)return;res.write(`event: ${name}\n`);res.write(`data: ${JSON.stringify(payload)}\n\n`);}
function json(res,status,payload){const body=`${JSON.stringify(payload)}\n`;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(body);}
function text(res,status,body){res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(body);}
