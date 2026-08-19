import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBuildFailure } from '../src/failure-parsers.mjs';

test('classifies npm, Gradle, and CMake failures into fixed public diagnostics', () => {
  assert.deepEqual(classifyBuildFailure('npm-build', [{ message: 'npm ERR! code ERESOLVE' }]), {
    tool: 'npm', category: 'dependency', code: 'npm-dependency', summary: 'npm could not resolve or download a dependency.',
  });
  assert.equal(classifyBuildFailure('gradle-debug', [{ message: 'SDK location not found. Define ANDROID_HOME.' }]).code, 'gradle-android-sdk');
  assert.equal(classifyBuildFailure('gradle-debug', [{ message: 'Compilation failed; see the compiler error output.' }]).code, 'gradle-compile');
  assert.equal(classifyBuildFailure('cmake-release', [{ message: 'CMake Error: Could NOT find OpenSSL' }]).code, 'cmake-dependency');
  assert.equal(classifyBuildFailure('cmake-release', [{ message: 'fatal error: header.hpp: No such file' }]).code, 'cmake-compile');
});

test('returns a fixed fallback without reflecting unknown log content', () => {
  const secret = 'private-path-C:\\customer\\source';
  const result = classifyBuildFailure('npm-test', [{ message: secret }]);
  assert.equal(result.code, 'npm-unknown');
  assert.doesNotMatch(JSON.stringify(result), /customer|private-path/);
  const bounded = classifyBuildFailure('npm-test', [{ message: `npm ERR! code ERESOLVE${'x'.repeat(200_000)}` }]);
  assert.equal(bounded.code, 'npm-unknown');
});
