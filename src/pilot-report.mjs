const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function validatePilotReport(report) {
  if (!report || report.schemaVersion !== 1) throw new Error('Pilot report schemaVersion must be 1.');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(report.repository || '')) throw new Error('Pilot repository must be an HTTPS GitHub URL.');
  if (!SHA1.test(report.resolvedCommit || '')) throw new Error('Pilot resolvedCommit must be a full Git commit.');
  if (report.cleanCheckout !== true) throw new Error('Pilot checkout must be recorded as clean.');
  if (!Array.isArray(report.commands) || report.commands.length === 0) throw new Error('Pilot commands are required.');
  for (const entry of report.commands) {
    if (typeof entry.command !== 'string' || !entry.command || !Number.isSafeInteger(entry.exitCode)) throw new Error('Pilot command evidence is malformed.');
  }
  if (!Array.isArray(report.artifacts)) throw new Error('Pilot artifacts must be an array.');
  for (const artifact of report.artifacts) {
    if (typeof artifact.path !== 'string' || !artifact.path || !SHA256.test(artifact.sha256 || '')) throw new Error('Pilot artifact evidence is malformed.');
  }
  return report;
}
