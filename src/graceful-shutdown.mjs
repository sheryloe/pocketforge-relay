export async function shutdownRelay({ server, managers = [] }) {
  const serverClosed = new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close(error => error ? reject(error) : resolve());
  });
  server.closeEventStreams?.();
  await Promise.all([
    ...managers.filter(Boolean).map(manager => manager.shutdown()),
    serverClosed,
  ]);
}
