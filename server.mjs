import { loadConfig } from './src/config.mjs';
import { createActionsRuntime } from './src/action-run-manager.mjs';
import { createPocketForgeServer } from './src/http-app.mjs';
import { JobManager } from './src/job-manager.mjs';
import { createDeviceActionRuntime } from './src/device-action-runtime.mjs';
import { shutdownRelay } from './src/graceful-shutdown.mjs';

const config = loadConfig();
const manager = new JobManager(config);
const recoveredJobs = await manager.recoverInterruptedJobs();
const actionsManager = await createActionsRuntime(config);
const deviceActionsRuntime = await createDeviceActionRuntime(config);
const server = createPocketForgeServer({ config, manager, actionsManager, deviceActionsRuntime });

server.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' ? '<this-machine-ip>' : config.host;
  console.log(`PocketForge Relay listening on http://${shownHost}:${config.port}`);
  if (config.generatedToken) {
    console.log('Generated a temporary bearer token for this process:');
    console.log(config.token);
  }
  if (actionsManager) console.log(`GitHub Actions adapter enabled for ${actionsManager.listTargets().length} target(s).`);
  if (deviceActionsRuntime) console.log('Android device actions enabled.');
  if (recoveredJobs) console.log(`Recorded ${recoveredJobs} interrupted job(s) as failed after restart.`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; stopping queued and active jobs.`);
  try {
    await shutdownRelay({ server, managers: [manager, actionsManager, deviceActionsRuntime] });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
