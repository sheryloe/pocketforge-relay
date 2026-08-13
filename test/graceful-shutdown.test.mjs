import test from 'node:test';
import assert from 'node:assert/strict';
import { shutdownRelay } from '../src/graceful-shutdown.mjs';

test('shutdown waits for active device work instead of forcing an early exit', async () => {
  let finish;
  const active=new Promise(resolve=>{finish=resolve;});
  let serverClosed=false;
  const server={
    listening:true,
    closeEventStreams(){},
    close(callback){serverClosed=true;callback();},
  };
  let completed=false;
  const shutdown=shutdownRelay({server,managers:[{shutdown:()=>active}]}).then(()=>{completed=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(serverClosed,true);
  assert.equal(completed,false);
  finish();
  await shutdown;
  assert.equal(completed,true);
});
