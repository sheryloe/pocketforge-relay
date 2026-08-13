import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { GitHubActionsError } from './github-actions-client.mjs';
import { ActionApprovalError } from './github-actions-runner.mjs';
import { mapDeviceActionError } from './device-action-runtime.mjs';
import { listPresets } from './presets.mjs';
import { applySecurityHeaders, safeStaticPath, tokenMatches } from './security.mjs';
const MIME = new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png']]);
const FINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
export function createPocketForgeServer({ config, manager, actionsManager = null, deviceActionsRuntime = null }) {
  const eventStreamClosers = new Set();
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res,200,{ok:true,name:'PocketForge Relay',version:'0.1.0',time:new Date().toISOString()});
      if (url.pathname.startsWith('/api/')) { applySecurityHeaders(res,{api:true}); if (!tokenMatches(config.token, req.headers.authorization)) return json(res,401,{error:'Missing or invalid bearer token.'}); return await api(req,res,url,manager,actionsManager,deviceActionsRuntime,eventStreamClosers); }
      return await staticFile(res,config.publicDir,url.pathname);
    } catch (e) { if (!res.headersSent) { applySecurityHeaders(res,{api:url.pathname.startsWith('/api/')}); return json(res,e.statusCode||500,{error:e.statusCode?e.message:'Internal server error.'}); } res.end(); }
  });
  server.closeEventStreams = () => {
    for (const closeStream of [...eventStreamClosers]) closeStream();
  };
  return server;
}
async function api(req,res,url,manager,actionsManager,deviceActionsRuntime,eventStreamClosers) {
  if (url.pathname === '/api/actions/targets' || url.pathname.startsWith('/api/actions/')) return actionsApi(req,res,url,actionsManager);
  if (url.pathname === '/api/devices' || url.pathname === '/api/device-actions' || url.pathname.startsWith('/api/device-actions/')) {
    return deviceActionsApi(req,res,url,manager,deviceActionsRuntime);
  }
  if (url.pathname === '/api/presets' && req.method === 'GET') return json(res,200,{presets:listPresets()});
  if (url.pathname === '/api/jobs' && req.method === 'GET') return json(res,200,{jobs:manager.listJobs()});
  if (url.pathname === '/api/jobs' && req.method === 'POST') { const body = await readJson(req,64*1024); try { return json(res,202,{job:manager.createJob(body)}); } catch(e) { return json(res,e.statusCode||400,{error:e.message}); } }
  let m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)$/i); if (m && req.method === 'GET') { const j=manager.getJob(m[1]); return j?json(res,200,{job:j}):json(res,404,{error:'Job not found.'}); }
  m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/cancel$/i); if (m && req.method === 'POST') { const j=manager.cancelJob(m[1]); return j?json(res,200,{job:j}):json(res,404,{error:'Job not found.'}); }
  m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/events$/i); if (m && req.method === 'GET') return streamJobEvents(req,res,manager,m[1],eventStreamClosers);
  m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/artifacts\/([0-9]+)$/i); if (m && req.method === 'GET') { const a=manager.getArtifact(m[1],m[2]); if(!a) return json(res,404,{error:'Artifact not found.'}); return sendFile(res,a.absolutePath,{'Content-Type':a.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); }
  return json(res,404,{error:'API route not found.'});
}

async function deviceActionsApi(req,res,url,jobManager,runtime) {
  if (url.pathname === '/api/devices' && req.method === 'GET') {
    return json(res,200,{enabled:Boolean(runtime),devices:runtime ? await runtime.listDevices() : []});
  }
  if (!runtime) return json(res,503,{error:'Android device actions are disabled.',code:'device_actions_disabled'});
  try {
    if (url.pathname === '/api/device-actions' && req.method === 'GET') {
      const jobId=url.searchParams.get('jobId');
      if (jobId != null && (!jobId || jobId.length>128 || /[\u0000-\u001f\u007f]/.test(jobId))) throw requestError('jobId is malformed.','device_action_input');
      return json(res,200,{actions:runtime.listActions(jobId == null ? {} : {jobId})});
    }
    if (url.pathname === '/api/device-actions/prepare' && req.method === 'POST') {
      const body=await strictBody(req,['jobId','artifactId','deviceId']);
      const trusted=jobManager.resolveDeviceArtifact(body.jobId,body.artifactId);
      const prepared=await runtime.prepare({...trusted,deviceId:body.deviceId});
      return json(res,201,prepared);
    }
    let match=url.pathname.match(/^\/api\/device-actions\/([A-Za-z0-9_-]{1,128})\/approve$/);
    if(match&&req.method==='POST') {
      const body=await strictBody(req,['approvalToken']);
      const action=await runtime.approve({actionId:match[1],approvalToken:body.approvalToken});
      return json(res,202,{action});
    }
    match=url.pathname.match(/^\/api\/device-actions\/([A-Za-z0-9_-]{1,128})$/);
    if(match&&req.method==='GET') {
      const action=runtime.getAction(match[1]);
      return action?json(res,200,{action}):json(res,404,{error:'Device action was not found.',code:'action_not_found'});
    }
    if(match&&req.method==='DELETE') {
      const body=await strictBody(req,['decision']);
      if(body.decision!=='discard') throw requestError("decision must be 'discard'.",'device_action_input');
      return json(res,200,{action:await runtime.discard(match[1])});
    }
    match=url.pathname.match(/^\/api\/device-actions\/([A-Za-z0-9_-]{1,128})\/evidence\/(json|logcat|crash|screenshot)$/);
    if(match&&req.method==='GET') {
      const file=await runtime.getEvidenceFile(match[1],match[2]);
      return sendFile(res,file.absolutePath,{'Content-Type':file.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    }
    match=url.pathname.match(/^\/api\/device-actions\/([A-Za-z0-9_-]{1,128})\/evidence$/);
    if(match&&req.method==='DELETE') {
      const body=await strictBody(req,['decision']);
      if(body.decision!=='delete') throw requestError("decision must be 'delete'.",'device_action_input');
      return json(res,200,{evidence:await runtime.deleteEvidence(match[1])});
    }
    return json(res,404,{error:'Device actions API route not found.',code:'device_actions_route_not_found'});
  } catch(error) {
    const mapped=mapDeviceActionError(error);
    if(!mapped) throw error;
    return json(res,mapped.status,{error:mapped.message,code:mapped.code});
  }
}

async function actionsApi(req,res,url,actionsManager) {
  if (url.pathname === '/api/actions/targets' && req.method === 'GET') {
    return json(res,200,{enabled:Boolean(actionsManager),targets:actionsManager?.listTargets() ?? []});
  }
  if (!actionsManager) return json(res,503,{error:'GitHub Actions integration is disabled.',code:'actions_disabled'});
  try {
    if (url.pathname === '/api/actions/approvals' && req.method === 'POST') {
      const body = await actionBody(req, ['targetId','ref','label']);
      return json(res,201,{approval:actionsManager.createApproval(body)});
    }
    if (url.pathname === '/api/actions/runs' && req.method === 'GET') return json(res,200,{runs:actionsManager.listRuns()});
    if (url.pathname === '/api/actions/runs' && req.method === 'POST') {
      const body = await actionBody(req, ['approvalId','decision']);
      return json(res,202,{run:actionsManager.createRun(body)});
    }
    let match = url.pathname.match(/^\/api\/actions\/runs\/([0-9a-f-]+)$/i);
    if (match && req.method === 'GET') {
      const run=actionsManager.getRun(match[1]);
      return run?json(res,200,{run}):json(res,404,{error:'GitHub Actions run not found.',code:'run_not_found'});
    }
    match = url.pathname.match(/^\/api\/actions\/runs\/([0-9a-f-]+)\/cancel$/i);
    if (match && req.method === 'POST') {
      await actionBody(req, []);
      const run=await actionsManager.cancelRun(match[1]);
      return run?json(res,200,{run}):json(res,404,{error:'GitHub Actions run not found.',code:'run_not_found'});
    }
    match = url.pathname.match(/^\/api\/actions\/runs\/([0-9a-f-]+)\/artifacts\/([0-9]+)$/i);
    if (match && req.method === 'GET') {
      const artifact=actionsManager.getArtifact(match[1],match[2]);
      if(!artifact) return json(res,404,{error:'GitHub Actions artifact not found.',code:'artifact_not_found'});
      return sendFile(res,artifact.absolutePath,{'Content-Type':artifact.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    }
    return json(res,404,{error:'Actions API route not found.',code:'actions_route_not_found'});
  } catch (error) {
    const mapped=mapActionsError(error);
    if(!mapped) throw error;
    return json(res,mapped.status,{error:mapped.message,code:mapped.code});
  }
}

async function actionBody(req, allowedKeys) {
  const body=await readJson(req,16*1024);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype) throw requestError('Request body must be a JSON object.','actions_input');
  const unexpected=Object.keys(body).find(key=>!allowedKeys.includes(key));
  if(unexpected) throw requestError(`Unexpected request field: ${unexpected}`,'actions_input');
  return body;
}

async function strictBody(req,allowedKeys) {
  const body=await readJson(req,16*1024);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype) throw requestError('Request body must be a JSON object.','device_action_input');
  const unexpected=Object.keys(body).find(key=>!allowedKeys.includes(key));
  if(unexpected) throw requestError(`Unexpected request field: ${unexpected}`,'device_action_input');
  const missing=allowedKeys.find(key=>!Object.hasOwn(body,key));
  if(missing) throw requestError(`Missing request field: ${missing}`,'device_action_input');
  return body;
}

function mapActionsError(error) {
  if(error?.statusCode) return {status:error.statusCode,code:error.code||'actions_request',message:error.message};
  if(error instanceof ActionApprovalError) {
    const statuses={approval_limit:429,approval_not_found:404,approval_expired:410,run_not_owned:409};
    return {status:statuses[error.code]||400,code:error.code,message:error.message};
  }
  if(error instanceof GitHubActionsError) return {status:502,code:error.code,message:error.message};
  return null;
}

function requestError(message,code) { const error=new Error(message);error.statusCode=400;error.code=code;return error; }
function streamJobEvents(req,res,manager,jobId,eventStreamClosers) {
  const snapshot=manager.getJob(jobId); if(!snapshot) return json(res,404,{error:'Job not found.'});
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','Connection':'close','X-Accel-Buffering':'no'}); event(res,'snapshot',snapshot);
  if (FINAL_JOB_STATUSES.has(snapshot.status)) { res.end(); return; }
  let closed=false; let heartbeat; let unsubscribe;
  const closeStream=()=>{
    if(closed)return; closed=true; clearInterval(heartbeat); unsubscribe?.(); eventStreamClosers.delete(closeStream); req.off('close',closeStream);
    if(!res.destroyed&&!res.writableEnded)res.end();
  };
  unsubscribe=manager.subscribe(jobId,payload=>{event(res,payload.type,payload);if(payload.type==='complete')closeStream();});
  if(!unsubscribe){closeStream();return;}
  heartbeat=setInterval(()=>{if(!res.destroyed&&!res.writableEnded)res.write(': heartbeat\n\n');},15000);
  eventStreamClosers.add(closeStream); req.once('close',closeStream);
}
async function staticFile(res,dir,requestPath) { const p=safeStaticPath(dir,requestPath); if(!p){applySecurityHeaders(res);return text(res,400,'Bad request.');} applySecurityHeaders(res); const ext=path.extname(p).toLowerCase();try{return await sendFile(res,p,{'Content-Type':MIME.get(ext)||'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=300'});}catch(error){if(!res.headersSent&&error?.statusCode===404)return text(res,404,'Not found.');throw error;} }
async function sendFile(res,filePath,headers) {
  let before;
  try { before=await fsp.lstat(filePath); }
  catch(error) { if(error?.code==='ENOENT')throw fileResponseError(404,'File not found.'); throw error; }
  if(!before.isFile()||before.isSymbolicLink()){const error=new Error('File not found.');error.statusCode=404;throw error;}
  let handle;
  try { handle=await fsp.open(filePath,'r'); }
  catch(error) { if(error?.code==='ENOENT')throw fileResponseError(404,'File not found.'); throw error; }
  let handedOff=false;
  try {
    const opened=await handle.stat();
    if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino){const error=new Error('File changed before download.');error.statusCode=409;throw error;}
    res.writeHead(200,{...headers,'Content-Length':opened.size});
    const stream=handle.createReadStream({autoClose:true});
    handedOff=true;
    await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=callback=>{if(settled)return;settled=true;res.off('close',onClose);callback();};
      const onClose=()=>{stream.destroy();finish(resolve);};
      res.once('close',onClose);
      stream.once('error',error=>finish(()=>reject(error)));
      stream.once('end',()=>finish(resolve));
      stream.pipe(res);
    });
  } finally { if(!handedOff)await handle.close().catch(()=>{}); }
}
function fileResponseError(statusCode,message){const error=new Error(message);error.statusCode=statusCode;return error;}
async function readJson(req,max){const chunks=[];let total=0;for await(const c of req){total+=c.length;if(total>max){const e=new Error('Request body is too large.');e.statusCode=413;throw e;}chunks.push(c);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Request body must be valid JSON.');e.statusCode=400;throw e;}}
function event(res,name,payload){if(res.destroyed||res.writableEnded)return;res.write(`event: ${name}\n`);res.write(`data: ${JSON.stringify(payload)}\n\n`);}
function json(res,status,payload){const body=`${JSON.stringify(payload)}\n`;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(body);}
function text(res,status,body){res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(body);}
