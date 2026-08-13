import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPocketForgeServer } from '../src/http-app.mjs';
import { JobManager } from '../src/job-manager.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'device-http-test-token';
const id = 'device-action-1';

test('device routes require authentication and remain disabled by default', async () => {
  const server=createPocketForgeServer({config:{publicDir:root,token},manager:{}});
  const base=await listen(server);
  try {
    assert.equal((await fetch(`${base}/api/devices`)).status,401);
    const devices=await request(base,'/api/devices');
    assert.deepEqual(devices.body,{enabled:false,devices:[]});
    const prepare=await request(base,'/api/device-actions/prepare',{method:'POST',body:{jobId:'j',artifactId:'0',deviceId:'d'}});
    assert.equal(prepare.response.status,503);
    assert.equal(prepare.body.code,'device_actions_disabled');
  } finally { await close(server); }
});

test('device HTTP accepts identifiers only, returns approval token once, and serves trusted runtime evidence', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pf-device-http-'));
  const screenshot=path.join(directory,'screenshot.png');
  await fs.writeFile(screenshot,Buffer.from([137,80,78,71]));
  const calls=[];
  const publicAction={id,jobId:'job-1',artifactId:'0',deviceId:'opaque-device',status:'awaiting_approval'};
  const runtime={
    listDevices:async()=>[{deviceId:'opaque-device',model:'Phone'}],
    listActions:options=>{calls.push(['list',options]);return[publicAction];},
    getAction:value=>value===id?publicAction:null,
    prepare:async input=>{calls.push(['prepare',input]);return{action:publicAction,approvalToken:'returned-once-only'};},
    approve:async input=>{calls.push(['approve',input]);return{...publicAction,status:'installing'};},
    getEvidenceFile:async()=>({absolutePath:screenshot,name:'screenshot.png',contentType:'image/png',size:4}),
    deleteEvidence:async actionId=>({actionId,deleted:true}),
  };
  const manager={resolveDeviceArtifact:(jobId,artifactId)=>({jobId,jobStatus:'succeeded',artifactId,artifactPath:path.join(directory,'app.apk'),workspaceRoot:directory,repository:null,resolvedCommit:null})};
  const server=createPocketForgeServer({config:{publicDir:root,token},manager,deviceActionsRuntime:runtime});
  const base=await listen(server);
  try {
    const devices=await request(base,'/api/devices');
    assert.equal(devices.body.devices[0].deviceId,'opaque-device');
    const prepared=await request(base,'/api/device-actions/prepare',{method:'POST',body:{jobId:'job-1',artifactId:'0',deviceId:'opaque-device'}});
    assert.equal(prepared.response.status,201);
    assert.equal(prepared.body.approvalToken,'returned-once-only');
    assert.equal(calls[0][1].artifactPath,path.join(directory,'app.apk'));
    const listed=await request(base,'/api/device-actions?jobId=job-1');
    assert.equal(JSON.stringify(listed.body).includes('returned-once-only'),false);
    const approved=await request(base,`/api/device-actions/${id}/approve`,{method:'POST',body:{approvalToken:'returned-once-only'}});
    assert.equal(approved.response.status,202);
    assert.equal(JSON.stringify(approved.body).includes('approvalToken'),false);
    const evidence=await fetch(`${base}/api/device-actions/${id}/evidence/screenshot`,{headers:authHeaders()});
    assert.equal(evidence.status,200);
    assert.equal(evidence.headers.get('content-type'),'image/png');
    runtime.getEvidenceFile=async()=>{await fs.unlink(screenshot).catch(()=>{});return{absolutePath:screenshot,name:'screenshot.png',contentType:'image/png',size:4};};
    const vanished=await fetch(`${base}/api/device-actions/${id}/evidence/screenshot`,{headers:authHeaders()});
    assert.equal(vanished.status,404);
    assert.equal((await vanished.text()).includes(screenshot),false);
    assert.equal((await fetch(`${base}/api/health`)).status,200);
    const deleted=await request(base,`/api/device-actions/${id}/evidence`,{method:'DELETE',body:{decision:'delete'}});
    assert.equal(deleted.body.evidence.deleted,true);
    const injected=await request(base,'/api/device-actions/prepare',{method:'POST',body:{jobId:'job-1',artifactId:'0',deviceId:'opaque-device',artifactPath:'C:\\evil.apk'}});
    assert.equal(injected.response.status,400);
    assert.equal((await request(base,'/api/device-actions/../escape')).response.status,404);
  } finally { await close(server); await fs.rm(directory,{recursive:true,force:true}); }
});

test('JobManager resolves only its own succeeded APK artifacts', () => {
  const manager=new JobManager({token:'internal-test-token',maxConcurrentJobs:1,maxQueuedJobs:1,maxRetainedJobs:10});
  const source=path.resolve('trusted-source');
  manager.jobs.set('job-ok',{id:'job-ok',status:'succeeded',sourceDir:source,repository:'https://github.com/example/mobile',resolvedCommit:'a'.repeat(40),artifacts:[{id:'0',absolutePath:path.join(source,'app.apk'),contentType:'application/vnd.android.package-archive'}]});
  assert.equal(manager.resolveDeviceArtifact('job-ok','0').artifactPath,path.join(source,'app.apk'));
  assert.equal(manager.resolveDeviceArtifact('job-ok','0').resolvedCommit,'a'.repeat(40));
  manager.jobs.get('job-ok').status='failed';
  assert.throws(()=>manager.resolveDeviceArtifact('job-ok','0'),error=>error.statusCode===409);
  manager.jobs.get('job-ok').status='succeeded';
  manager.jobs.get('job-ok').artifacts[0]={id:'0',absolutePath:path.join(source,'app.aab'),contentType:'application/octet-stream'};
  assert.throws(()=>manager.resolveDeviceArtifact('job-ok','0'),error=>error.statusCode===400);
});

async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return`http://127.0.0.1:${server.address().port}`;}
async function close(server){server.closeEventStreams?.();if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
function authHeaders(){return{Authorization:`Bearer ${token}`};}
async function request(base,pathname,{method='GET',body}={}){const response=await fetch(`${base}${pathname}`,{method,headers:{...authHeaders(),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{response,body:await response.json()};}
