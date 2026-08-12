import fs from 'node:fs/promises';
import path from 'node:path';
const MIME = new Map([['.apk','application/vnd.android.package-archive'],['.aab','application/octet-stream'],['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.txt','text/plain; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.wasm','application/wasm'],['.zip','application/zip']]);
export async function writeBuildSummary(job, sourceDir, finalStatus = job.status) {
  const dir = path.join(sourceDir, '.pocketforge-result'); await fs.mkdir(dir, { recursive: true });
  const summary = { schemaVersion: 1, jobId: job.id, label: job.label, sourceType: job.sourceType, repository: job.repository, ref: job.ref, preset: job.presetId, status: finalStatus, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, exitCode: job.exitCode, error: job.error };
  await fs.writeFile(path.join(dir, 'build-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}
export async function collectArtifacts({ sourceDir, preset, maxFiles, maxBytes }) {
  const results = []; const seen = new Set(); const realSource = await fs.realpath(sourceDir);
  const add = async file => {
    if (results.length >= maxFiles) return;
    const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return;
    const real = await fs.realpath(file); if (real !== realSource && !real.startsWith(`${realSource}${path.sep}`)) return; if (seen.has(real)) return; seen.add(real);
    const relativePath = path.relative(realSource, real).split(path.sep).join('/');
    results.push({ id: String(results.length), name: path.basename(real), relativePath, absolutePath: real, size: stat.size, contentType: MIME.get(path.extname(real).toLowerCase()) || 'application/octet-stream' });
  };
  await walk(path.join(sourceDir, '.pocketforge-result'), add, results, maxFiles);
  if (preset.artifactMode === 'web') await walk(path.join(sourceDir, 'dist'), add, results, maxFiles);
  if (preset.artifactMode === 'node-build') { await walk(path.join(sourceDir, 'dist'), add, results, maxFiles); await walk(path.join(sourceDir, 'build'), add, results, maxFiles); }
  if (preset.artifactMode === 'cmake') await walk(path.join(sourceDir, 'build'), add, results, maxFiles, true);
  if (preset.artifactMode === 'android') await walk(sourceDir, async file => { const rel = path.relative(sourceDir, file).split(path.sep).join('/'); const ext = path.extname(file).toLowerCase(); if ((ext === '.apk' || ext === '.aab') && rel.includes('/build/outputs/')) await add(file); }, results, maxFiles, true);
  return results;
}
async function walk(root, onFile, results, maxFiles, skipLarge = false) {
  try { const s = await fs.lstat(root); if (!s.isDirectory() || s.isSymbolicLink()) return; } catch { return; }
  const stack = [root];
  while (stack.length && results.length < maxFiles) {
    const current = stack.pop(); let entries; try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (results.length >= maxFiles) break; if (e.isSymbolicLink()) continue;
      if (skipLarge && e.isDirectory() && ['.git','node_modules','.gradle','.idea'].includes(e.name)) continue;
      const full = path.join(current, e.name); if (e.isDirectory()) stack.push(full); else if (e.isFile()) await onFile(full);
    }
  }
}
export const publicArtifacts = artifacts => artifacts.map(({ id, name, relativePath, size, contentType }) => ({ id, name, relativePath, size, contentType }));
