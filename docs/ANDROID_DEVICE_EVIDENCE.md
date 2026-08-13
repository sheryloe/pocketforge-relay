# Android Device Evidence Core

This document describes the Android device-action core and its disabled-by-default
authenticated HTTP and PWA integration.

## Scope

The core provides:

- absolute-path injection for `adb`, `apkanalyzer`, and `apksigner`;
- bounded subprocess output with no arbitrary shell input;
- parsing and safe projection of devices already enumerated by ADB;
- a relay-managed, action-owned APK snapshot outside the build workspace;
- canonical containment, symlink rejection, size limits, source-stability checks,
  SHA-256, strict metadata, and signer-certificate verification on that snapshot;
- five-minute, one-shot approval tokens stored only as bound hashes;
- an exact fresh device binding plus an alias-collapsing physical-device mutex;
- fixed install, launch-epoch, PID/package/UID, foreground, logcat, crash, and
  screenshot commands; and
- file SHA-256/size metadata plus an HMAC-authenticated evidence manifest.

The core deliberately does not:

- install Android tooling;
- connect or pair a device from user input;
- accept arbitrary Gradle tasks, ADB arguments, package names, activities, or
  filesystem paths from a client;
- replace an already-installed package;
- support AAB or split-APK installation;
- expose an enumerated ADB serial through its public device projection; or
- add PWA controls.

## Exported adapter contract

`src/android-device-adapter.mjs` exports:

- `AndroidDeviceAdapter`
- `AndroidDeviceError`
- `runBoundedProcess(options)`
- `parseAdbDevices(output)`
- `inspectContainedApkFile(options)`
- `validateApkMetadata(metadata)`

Construct the adapter with operator-controlled absolute tool paths. These paths
must be resolved at server startup, not supplied by an HTTP request.

```js
const adapter = new AndroidDeviceAdapter({
  adbPath: 'C:\\Android\\Sdk\\platform-tools\\adb.exe',
  apkanalyzerPath: 'C:\\Android\\Sdk\\cmdline-tools\\latest\\bin\\apkanalyzer.bat',
  apksignerPath: 'C:\\Android\\Sdk\\build-tools\\35.0.0\\apksigner.bat',
  deviceIdSecret,
  evidenceIntegrityKey,
});
```

For tests, `runner` may be injected. Its input is a process request containing
`file`, `args`, timeout and byte limits, `binaryStdout`, and `environment`. It
returns `{ stdout, stderr }`. Production should use the default bounded runner.
Native tools are spawned with `shell: false`. On Windows, the SDK's fixed
`.bat` wrappers are invoked through an absolute `cmd.exe` with delayed expansion
disabled, and any argument containing command-shell metacharacters is rejected
before the process starts.

`deviceIdSecret` and `evidenceIntegrityKey` are distinct, persistent,
operator-managed secrets. Restart-random evidence keys make old evidence
unverifiable and are not an acceptable production configuration.

### Device discovery and binding

```js
const devices = await adapter.listDevices();
const preparedDevice = await adapter.captureDeviceBinding(deviceId);
await adapter.assertDeviceBinding(preparedDevice.binding);
```

The public projection contains only opaque `deviceId` and a bounded display
`model`. It never contains the ADB serial, transport ID, hardware serial, build
fingerprint, or mutex key. Internally, an exact approval fingerprint binds ADB
serial, transport ID, product/model/device, manufacturer, Android SDK, hardware
serial, and build fingerprint. A separate mutex fingerprint based on stable
physical identity collapses USB and TCP ADB aliases. Each approval and the
adapter immediately before mutation resolve and compare fresh identity data;
any change requires a new preparation and approval.
The core does not execute `adb connect`, `adb pair`, or select a serial supplied
by a client.

### Action-owned APK snapshot and inspection

```js
const artifact = await adapter.createApprovedSnapshot({
  artifactPath,
  workspaceRoot,
  actionStoreRoot,
  actionId,
});
```

The source must be a regular, non-linked APK canonically contained in the build
workspace. `actionStoreRoot` is an injected absolute relay-owned directory in a
separate tree. The adapter creates `<actionStoreRoot>/<actionId>/approved.apk`
with exclusive creation, copies through an open source handle, and rejects
source identity, timestamp, size, or hash drift. Metadata and signer-certificate
SHA-256 are derived from the snapshot, never the live build output. A pre-existing
action directory is a collision and is never overwritten.

Approval tokens bind the snapshot SHA-256 and exact device fingerprint. Approval
re-inspects the snapshot and installation receives only its action-owned path.
The snapshot is deleted after terminal execution; the separate evidence bundle
is retained. Internal action-store paths must never be serialized to a client.

### Approved execution

`installAndCollectEvidence` accepts only an approved snapshot and its private
device binding. It freshly compares the exact binding again, rejects an existing
package, and uses fixed argument arrays equivalent to:

```text
adb -s <enumerated-serial> install <canonical-apk>
adb -s <enumerated-serial> shell dumpsys package <analyzed-package>
adb -s <enumerated-serial> shell pm path <analyzed-package>
adb -s <enumerated-serial> shell sha256sum <validated-installed-base-apk>
adb -s <enumerated-serial> shell date +%s.%N
adb -s <enumerated-serial> shell monkey -p <analyzed-package> -c android.intent.category.LAUNCHER 1
adb -s <enumerated-serial> shell pidof <analyzed-package>
adb -s <enumerated-serial> shell cat /proc/<validated-pid>/cmdline
adb -s <enumerated-serial> shell stat -c %u /proc/<validated-pid>
adb -s <enumerated-serial> shell cmd package list packages -U <analyzed-package>
adb -s <enumerated-serial> logcat -T <validated-launch-epoch> -d -v epoch --pid=<validated-pid>
adb -s <enumerated-serial> logcat -b crash -T <validated-launch-epoch> -d -v epoch --pid=<validated-pid>
adb -s <enumerated-serial> shell dumpsys activity activities
adb -s <enumerated-serial> exec-out screencap -p
adb -s <enumerated-serial> shell dumpsys activity activities
```

The installed package ID/version and base-APK SHA-256 must match the approved
snapshot, which also binds its verified signer certificate. The process ID must be
one positive decimal value, its `/proc` name and UID must match the package, and
both log buffers are bounded to the validated launch epoch and PID. The approved
package must be the resumed foreground package immediately before and after a
PNG screenshot. Text and binary output are independently bounded. The core does
not use `logcat -c`, because clearing a user's existing device logs is destructive.

Evidence is written under the relay-managed action directory:

```text
<actionStoreRoot>/<actionId>/evidence/device-evidence.json
<actionStoreRoot>/<actionId>/evidence/logcat.txt
<actionStoreRoot>/<actionId>/evidence/crash.txt
<actionStoreRoot>/<actionId>/evidence/screenshot.png
```

The evidence directory must be new, contained by the action directory, and free
of symbolic-link components. Schema version 2 records every retained file's
exact byte size and SHA-256. The manifest records its canonical SHA-256 and an
HMAC-SHA256 made with the separate injected integrity key. Exported
`verifyEvidenceBundle` verifies both the manifest and retained files. Writes are
exclusive and sequential; a pre-commit failure removes known partial payloads
and writes a signed failure manifest with `files: {}`. A detected target-process
crash makes the action fail while preserving a complete signed bundle.

## Exported approval contract

`src/device-actions.mjs` exports:

- `DeviceActionManager`
- `DeviceActionError`

Construct it with an `AndroidDeviceAdapter` and an operator-controlled action
store outside every job workspace:

```js
const actions = new DeviceActionManager({
  adapter,
  actionStoreRoot: 'D:\\PocketForge\\device-actions',
});
```

Prepare an action only after the existing job manager has established a
succeeded job and selected one APK artifact:

```js
const prepared = await actions.prepare({
  jobId,
  jobStatus: 'succeeded',
  repository,
  resolvedCommit,
  artifactId,
  artifactPath,
  workspaceRoot,
  deviceId,
});
```

`prepare` first allocates a strict path-safe action ID, captures exact device
identity, snapshots and inspects the APK in the action store, and returns:

```js
{
  action: publicAction,
  approvalToken: 'returned-once-only'
}
```

The token is 32 random bytes encoded as base64url. The manager stores only a
SHA-256 hash bound to action ID, job ID, snapshot digest, and exact device
fingerprint. The default
expiry is exactly five minutes. Public actions never expose the token, token
hash, canonical artifact path, or workspace path.

Approve and execute with:

```js
const action = await actions.approve({ actionId, approvalToken });
```

The manager verifies expiry and token in constant time, refuses a busy physical
device across ADB aliases, consumes the approval before mutation, freshly checks
the exact device binding, and re-inspects the snapshot. The adapter repeats the
binding check at the mutation boundary. The same token cannot be reused. If a
device is busy, the approval is not consumed, so the user may retry before
expiry. Snapshot cleanup occurs after terminal execution and is independent from
evidence retention.

Action states are:

```text
awaiting_approval
expired
validating_artifact
installing
launching
collecting_evidence
succeeded
failed
```

Use `getAction(actionId)` and `listActions({ jobId })` for read-only state.

Unapproved actions may be explicitly discarded; their approval token is consumed
and the action-owned APK snapshot is deleted. A tracked five-minute timer performs
the same snapshot cleanup for abandoned approvals, and graceful shutdown waits for
that cleanup. At startup, the runtime removes only strict action directories that
contain an abandoned `approved.apk`; unknown entries fail startup instead of being
deleted.

## HTTP integration

The runtime and HTTP routes preserve these boundaries:

1. All routes require the existing bearer authentication.
2. Tool paths and the device-ID secret are process configuration, never request
   fields.
3. The API accepts server-issued job, artifact, device, and action identifiers
   only. It does not accept command text or paths.
4. The approval token is held only in PWA memory, never URL, log, local storage,
   or session storage.
5. The approval screen shows repository, resolved commit, artifact SHA-256,
   package/version, and device model before the user confirms.
6. Device actions remain disabled unless the operator explicitly enables them.
7. Plain HTTP on an untrusted LAN is not adequate for device installation.
   Use loopback, a trusted VPN, or a TLS reverse proxy until signed pairing is
   implemented.
8. Evidence files are exposed only through fixed authenticated action routes;
   each download re-verifies manifest HMAC and file SHA-256/size without exposing
   action-store absolute paths.
9. `actionStoreRoot`, device-ID secret, and evidence-integrity key are injected
   operator configuration, live outside workspaces, and never enter requests.
10. Approval UI discloses that logcat, crash output, and the full device screen
    may contain personal or confidential data, shows the retention policy, and
    offers an authenticated deletion operation before evidence is exposed.

## Remaining security limits

The action store substantially narrows the live-workspace race, but it is not a
hard immutability boundary while untrusted repository code and the relay share
one operating-system account. Such code may still attempt to modify the action
store between the final check and `adb install` or alter retained evidence after
creation. A production deployment needs a separate execution identity and ACL,
container or micro-VM isolation, and an immutable/append-only evidence sink. The
HMAC detects modification; it does not prevent deletion, prove physical-device
authenticity, or replace signed pairing.

On Windows, timeout currently terminates the direct `cmd.exe` child used for SDK
batch wrappers. Java grandchildren may outlive it because a Job Object/process-
tree terminator is not implemented. This remains a documented P2 risk.

Foreground parsing depends on current Android `dumpsys activity` formats. The
core fails closed when it cannot identify one resumed package, but version- and
OEM-specific real-device fixtures remain required. Evidence retention and
authenticated deletion is available for terminal actions, but the runtime does
not run an automatic retention sweeper. Signed evidence is re-verified and
recovered on restart so it remains downloadable or explicitly deletable. Unknown,
linked, over-limit, or tampered action-store entries fail startup.
If shutdown happened before the signed manifest commit, startup removes only the
fixed regular partial evidence filenames; any unknown or linked entry still fails
closed. Download routes open and verify one stable regular-file handle so a
concurrent authenticated deletion cannot crash the relay.

Android tool subprocesses receive the same fixed OS/toolchain environment
allowlist as build subprocesses. Relay, GitHub, device-ID, evidence-integrity,
cloud, and registry secrets are excluded. Public errors never include raw tool
stderr or filesystem paths.

## Verification status

The core unit tests use only injected fake Android-tool responses. They verify
argument arrays, private/public device boundaries, exact fingerprint drift,
ADB-alias locking, action-store snapshot and collision behavior, containment,
metadata checks, approval expiry and one-shot behavior, artifact rebinding,
launch-time log bounds, process/foreground checks, PNG checks, file digests,
manifest HMAC verification, tamper detection, and partial-failure cleanup.

Real Android SDK/JDK build: **NOT RUN**.

Physical-device ADB install, launch, logcat, crash, and screenshot: **NOT RUN**.

Those checks require JDK 17, Android SDK Platform 35, Build Tools, Command-line
Tools, Platform Tools, and a physically attached and USB-authorized Android
device. They must be recorded separately from unit-test results.
