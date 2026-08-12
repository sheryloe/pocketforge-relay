import fs from 'node:fs';
import path from 'node:path';
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const PRESETS = Object.freeze({
  'demo-web': { id: 'demo-web', name: 'Bundled web demo', description: 'Builds the included zero-dependency sample and returns a browser-ready artifact.', sourceTypes: ['demo'], artifactMode: 'web' },
  'npm-test': { id: 'npm-test', name: 'Node.js tests', description: 'Installs locked dependencies and runs the repository test script.', sourceTypes: ['github'], artifactMode: 'summary' },
  'npm-build': { id: 'npm-build', name: 'Node.js build', description: 'Installs locked dependencies, runs npm build, and collects dist/build output.', sourceTypes: ['github'], artifactMode: 'node-build' },
  'gradle-debug': { id: 'gradle-debug', name: 'Android debug APK', description: 'Runs the repository Gradle wrapper and collects debug APK/AAB outputs.', sourceTypes: ['github'], artifactMode: 'android' },
  'cmake-release': { id: 'cmake-release', name: 'CMake release build', description: 'Configures and builds a Release tree with CMake.', sourceTypes: ['github'], artifactMode: 'cmake' },
});
export const listPresets = () => Object.values(PRESETS).map(({ id, name, description, sourceTypes }) => ({ id, name, description, sourceTypes }));
export function getPreset(id) { const p = PRESETS[id]; if (!p) throw new Error(`Unknown build preset: ${id}`); return p; }
export function assertPresetSupportsSource(p, source) { if (!p.sourceTypes.includes(source)) throw new Error(`Preset ${p.id} does not support source type ${source}.`); }
export function resolvePresetSteps(preset, cwd) {
  const lock = () => { if (!fs.existsSync(path.join(cwd, 'package-lock.json'))) throw new Error('package-lock.json is required by the safe npm MVP presets.'); return { name: 'Install locked dependencies', command: npm, args: ['ci', '--no-audit', '--no-fund'] }; };
  if (preset.id === 'demo-web') return [{ name: 'Build bundled demo', command: process.execPath, args: ['build.mjs'] }];
  if (preset.id === 'npm-test') return [lock(), { name: 'Run tests', command: npm, args: ['test'] }];
  if (preset.id === 'npm-build') return [lock(), { name: 'Build package', command: npm, args: ['run', 'build'] }];
  if (preset.id === 'gradle-debug') {
    const wrapperName = win ? 'gradlew.bat' : 'gradlew';
    const wrapperPath = path.join(cwd, wrapperName);
    if (!fs.existsSync(wrapperPath)) throw new Error('Gradle wrapper not found in the repository root.');
    if (!win) { try { fs.chmodSync(wrapperPath, 0o755); } catch {} }
    return [{ name: 'Assemble debug application', command: win ? 'gradlew.bat' : './gradlew', args: ['assembleDebug', '--no-daemon'] }];
  }
  if (preset.id === 'cmake-release') return [
    { name: 'Configure CMake', command: 'cmake', args: ['-S', '.', '-B', 'build', '-DCMAKE_BUILD_TYPE=Release'] },
    { name: 'Build CMake project', command: 'cmake', args: ['--build', 'build', '--config', 'Release', '--parallel'] },
  ];
  throw new Error(`No step resolver exists for preset ${preset.id}.`);
}
