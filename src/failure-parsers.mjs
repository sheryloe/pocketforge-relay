const RULES = Object.freeze({
  npm: [
    [/\b(?:ERESOLVE|EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT)\b/i, 'dependency', 'npm-dependency', 'npm could not resolve or download a dependency.'],
    [/\b(?:not ok|test failed|tests? failed)\b/i, 'test', 'npm-test', 'The npm test command reported a failure.'],
    [/\bnpm (?:ERR!|error)\b/i, 'execution', 'npm-execution', 'npm reported an execution failure.'],
  ],
  gradle: [
    [/(?:SDK location not found|ANDROID_HOME|ANDROID_SDK_ROOT)/i, 'environment', 'gradle-android-sdk', 'The Android SDK environment is unavailable or invalid.'],
    [/(?:Could not resolve all|Could not find .*:)/i, 'dependency', 'gradle-dependency', 'Gradle could not resolve a dependency.'],
    [/(?:Compilation failed|\berror: )/i, 'compile', 'gradle-compile', 'Gradle reported a compilation failure.'],
    [/FAILURE: Build failed/i, 'execution', 'gradle-execution', 'Gradle reported a build failure.'],
  ],
  cmake: [
    [/(?:Could NOT find|Could not find a package configuration file)/i, 'dependency', 'cmake-dependency', 'CMake could not locate a required dependency.'],
    [/(?:fatal error:|undefined reference|unresolved external)/i, 'compile', 'cmake-compile', 'The CMake build reported a compile or link failure.'],
    [/CMake Error/i, 'configuration', 'cmake-configuration', 'CMake reported a configuration failure.'],
  ],
});

export function classifyBuildFailure(presetId, logs = []) {
  const tool = String(presetId || '').startsWith('npm-') ? 'npm'
    : presetId === 'gradle-debug' ? 'gradle'
      : presetId === 'cmake-release' ? 'cmake' : 'runner';
  const text = logs.slice(-200).map(entry => String(entry?.message || '').slice(-4096)).join('\n').slice(-128 * 1024);
  for (const [pattern, category, code, summary] of RULES[tool] || []) {
    if (pattern.test(text)) return Object.freeze({ tool, category, code, summary });
  }
  return Object.freeze({ tool, category: 'execution', code: `${tool}-unknown`, summary: 'The build step failed without a recognized diagnostic.' });
}
