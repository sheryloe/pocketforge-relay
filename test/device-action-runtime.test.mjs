import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHmac, createHash } from 'node:crypto';
import { createDeviceActionRuntime, DeviceActionRuntime } from '../src/device-action-runtime.mjs';

const key = Buffer.alloc(32, 7);

test('runtime blocks new work during shutdown and awaits an active approval', async () => {
  let finish;
  const task = new Promise(resolve => { finish = resolve; });
  const manager = { approve: () => task, getAction: () => ({ id: 'action-1', status: 'installing' }), listActions: () => [] };
  const adapter = { listDevices: async () => [] };
  const runtime = new DeviceActionRuntime({ manager, adapter, actionStoreRoot: path.resolve('actions'), evidenceIntegrityKey: key });
  const started = await runtime.approve({ actionId: 'action-1', approvalToken: 'x' });
  assert.equal(started.status, 'installing');
  let stopped = false;
  const shutdown = runtime.shutdown().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  await assert.rejects(runtime.prepare({}), /shutting down/);
  finish({ id: 'action-1', status: 'succeeded' });
  await shutdown;
});

test('runtime verifies evidence before serving and deletes only terminal fixed files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-device-runtime-'));
  const id = 'action-2';
  const evidenceDir = path.join(root, id, 'evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, 'logcat.txt'), 'bounded log');
  await writeManifest(evidenceDir, { logcat: fileEntry('logcat.txt', Buffer.from('bounded log')) });
  let forgotten=false;
  const manager = { getAction: value => !forgotten&&value === id ? { id, status: 'succeeded' } : null, listActions: () => [], forgetTerminalAction:()=>{forgotten=true;return true;} };
  const runtime = new DeviceActionRuntime({ manager, adapter: { listDevices: async () => [] }, actionStoreRoot: root, evidenceIntegrityKey: key });
  const file = await runtime.getEvidenceFile(id, 'logcat');
  assert.equal(file.name, 'logcat.txt');
  await fs.writeFile(file.absolutePath, 'tampered');
  await assert.rejects(runtime.getEvidenceFile(id, 'logcat'), /failed verification/i);
  await fs.writeFile(file.absolutePath, 'bounded log');
  assert.deepEqual(await runtime.deleteEvidence(id), { actionId: id, deleted: true });
  assert.deepEqual(await runtime.deleteEvidence(id), { actionId: id, deleted: true });
  assert.equal(runtime.getAction(id),null);
  await assert.rejects(runtime.getEvidenceFile(id, 'json'), error => error.statusCode === 410);
  await fs.rm(root, { recursive: true, force: true });
});

test('runtime bounds concurrent approvals', async () => {
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const manager={approve:()=>pending,getAction:value=>({id:value,status:'installing'}),listActions:()=>[]};
  const runtime=new DeviceActionRuntime({manager,adapter:{listDevices:async()=>[]},actionStoreRoot:path.resolve('actions'),evidenceIntegrityKey:key,maxConcurrentActions:1});
  await runtime.approve({actionId:'one',approvalToken:'x'});
  await assert.rejects(runtime.approve({actionId:'two',approvalToken:'y'}),error=>error.statusCode===429);
  finish({id:'one',status:'succeeded'});
  await runtime.shutdown();
});

test('runtime serializes heavyweight preparation admission', async () => {
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const manager={prepare:()=>pending,listActions:()=>[],getAction:()=>null,shutdown:async()=>{}};
  const runtime=new DeviceActionRuntime({manager,adapter:{listDevices:async()=>[]},actionStoreRoot:path.resolve('actions'),evidenceIntegrityKey:key,maxConcurrentActions:1});
  const first=runtime.prepare({});
  await assert.rejects(runtime.prepare({}),error=>error.statusCode===429);
  finish({action:{id:'one'},approvalToken:'token'});
  await first;
  await runtime.shutdown();
});

test('runtime rejects a symlinked evidence directory before deletion', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pf-device-link-root-'));
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'pf-device-link-target-'));
  const id='linked-action';
  await fs.mkdir(path.join(root,id));
  await fs.writeFile(path.join(outside,'logcat.txt'),'keep me');
  try { await fs.symlink(outside,path.join(root,id,'evidence'),process.platform==='win32'?'junction':'dir'); }
  catch(error) { if(error.code==='EPERM'||error.code==='EACCES') return t.skip('Directory links are unavailable.'); throw error; }
  const runtime=new DeviceActionRuntime({manager:{getAction:()=>({id,status:'succeeded'}),listActions:()=>[]},adapter:{listDevices:async()=>[]},actionStoreRoot:root,evidenceIntegrityKey:key});
  await assert.rejects(runtime.deleteEvidence(id),error=>error.statusCode===409);
  assert.equal(await fs.readFile(path.join(outside,'logcat.txt'),'utf8'),'keep me');
  await fs.rm(root,{recursive:true,force:true});
  await fs.rm(outside,{recursive:true,force:true});
});

test('runtime recovers signed evidence after restart and removes abandoned snapshots', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pf-device-recover-'));
  const id='recovered-action';
  const evidenceDir=path.join(root,id,'evidence');
  await fs.mkdir(evidenceDir,{recursive:true});
  await fs.writeFile(path.join(evidenceDir,'logcat.txt'),'bounded log');
  await fs.writeFile(path.join(root,id,'approved.apk'),'leftover');
  const files={logcat:fileEntry('logcat.txt',Buffer.from('bounded log'))};
  await writeManifest(evidenceDir,files,{actionId:id,jobId:'job-recovered',status:'succeeded'});
  const abandoned=path.join(root,'abandoned-action');
  await fs.mkdir(abandoned);
  await fs.writeFile(path.join(abandoned,'approved.apk'),'abandoned');
  const manager={listActions:()=>[],getAction:()=>null,maxRetainedActions:100,shutdown:async()=>{}};
  const runtime=new DeviceActionRuntime({manager,adapter:{listDevices:async()=>[]},actionStoreRoot:root,evidenceIntegrityKey:key});
  await runtime.initialize();
  const recovered=runtime.getAction(id);
  assert.equal(recovered.jobId,'job-recovered');
  assert.equal(recovered.recovered,true);
  assert.equal(JSON.stringify(recovered).includes(root),false);
  await assert.rejects(fs.access(path.join(root,id,'approved.apk')));
  await assert.rejects(fs.access(abandoned));
  assert.equal((await runtime.getEvidenceFile(id,'logcat')).name,'logcat.txt');
  assert.deepEqual(await runtime.deleteEvidence(id),{actionId:id,deleted:true});
  await fs.rm(root,{recursive:true,force:true});
});

test('runtime recovery fails closed on tampered or unexpected evidence', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pf-device-recover-bad-'));
  const id='tampered-action';
  const evidenceDir=path.join(root,id,'evidence');
  await fs.mkdir(evidenceDir,{recursive:true});
  await writeManifest(evidenceDir,{}, {actionId:id,jobId:'job-bad',status:'failed'});
  await fs.writeFile(path.join(evidenceDir,'unexpected.txt'),'private');
  const runtime=new DeviceActionRuntime({manager:{listActions:()=>[],getAction:()=>null,maxRetainedActions:100},adapter:{listDevices:async()=>[]},actionStoreRoot:root,evidenceIntegrityKey:key});
  await assert.rejects(runtime.initialize(),/unexpected/i);
  await fs.rm(root,{recursive:true,force:true});
});

test('runtime refuses an action store exposed by the public static tree', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pf-device-public-overlap-'));
  const publicDir=path.join(root,'public');
  await fs.mkdir(publicDir);
  const config={
    publicDir,
    dataDir:path.join(root,'data'),
    deviceActions:{
      enabled:true,
      adbPath:path.join(root,'adb.exe'),
      apkanalyzerPath:path.join(root,'apkanalyzer.bat'),
      apksignerPath:path.join(root,'apksigner.bat'),
      actionStoreRoot:path.join(publicDir,'device-actions'),
      deviceIdSecret:Buffer.alloc(32,1),
      evidenceIntegrityKey:key,
      maxConcurrentActions:1,
    },
  };
  await assert.rejects(createDeviceActionRuntime(config),/must not overlap the public static directory/);
  await fs.rm(root,{recursive:true,force:true});
});

test('terminal actions without evidence can be explicitly dismissed', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pf-device-no-evidence-'));
  const id='failed-without-evidence';
  await fs.mkdir(path.join(root,id));
  let forgotten=false;
  const manager={
    listActions:()=>[],
    getAction:value=>!forgotten&&value===id?{id,status:'failed'}:null,
    forgetTerminalAction:()=>{forgotten=true;return true;},
  };
  const runtime=new DeviceActionRuntime({manager,adapter:{listDevices:async()=>[]},actionStoreRoot:root,evidenceIntegrityKey:key});
  assert.deepEqual(await runtime.deleteEvidence(id),{actionId:id,deleted:true});
  assert.equal(runtime.getAction(id),null);
  await assert.rejects(fs.access(path.join(root,id)));
  await fs.rm(root,{recursive:true,force:true});
});

test('startup removes only known regular partial evidence left before manifest commit', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pf-device-partial-'));
  const id='partial-action';
  const evidenceDir=path.join(root,id,'evidence');
  await fs.mkdir(evidenceDir,{recursive:true});
  await fs.writeFile(path.join(evidenceDir,'logcat.txt'),'partial');
  await fs.writeFile(path.join(evidenceDir,'screenshot.png'),Buffer.from([137,80,78,71]));
  await fs.writeFile(path.join(root,id,'approved.apk'),'snapshot');
  const runtime=new DeviceActionRuntime({manager:{listActions:()=>[],getAction:()=>null,maxRetainedActions:100},adapter:{listDevices:async()=>[]},actionStoreRoot:root,evidenceIntegrityKey:key});
  await runtime.initialize();
  await assert.rejects(fs.access(path.join(root,id)));
  await fs.rm(root,{recursive:true,force:true});
});

function fileEntry(name, bytes) { return { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }
async function writeManifest(directory, files, fields = {}) {
  const unsigned = { schemaVersion: 2, ...fields, files };
  const payload = stable(unsigned);
  const manifest = { ...unsigned, integrity: { algorithm: 'HMAC-SHA256', manifestSha256: createHash('sha256').update(payload).digest('hex'), manifestHmac: createHmac('sha256', key).update(payload).digest('hex') } };
  await fs.writeFile(path.join(directory, 'device-evidence.json'), `${JSON.stringify(manifest)}\n`);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
