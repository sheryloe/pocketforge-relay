import { loadConfig } from './src/config.mjs';
import { createPocketForgeServer } from './src/http-app.mjs';
import { JobManager } from './src/job-manager.mjs';

const config = loadConfig();
const manager = new JobManager(config);
const server = createPocketForgeServer({ config, manager });

server.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' ? '<this-machine-ip>' : config.host;
  console.log(`PocketForge Relay listening on http://${shownHost}:${config.port}`);
  if (config.generatedToken) {
    console.log('Generated a temporary bearer token for this process:');
    console.log(config.token);
  }
});

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; stopping queued and active jobs.`);
  manager.shutdown();
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  setTimeout(() => {
    console.error('Graceful shutdown timed out.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
