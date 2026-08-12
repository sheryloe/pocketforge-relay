# Architecture

PocketForge Relay separates the **control surface** from the **execution surface**. The phone expresses intent, approvals, and review decisions. The relay authenticates, validates, queues, and emits state. Runners execute allowlisted work. Artifact and device adapters return evidence.

```mermaid
flowchart LR
  PWA[Mobile PWA] -->|Bearer + JSON| API[Relay API]
  API --> JM[Job Manager]
  JM --> WS[Per-job Workspace]
  WS --> PR[Preset Runner]
  PR --> EV[SSE Logs + State]
  WS --> ART[Artifact Collector]
  EV --> PWA
  ART --> PWA
```

Target architecture:

```mermaid
flowchart TB
  PHONE[Mobile Client] --> GATE[Relay Gateway]
  GATE --> POLICY[Policy and Approval]
  POLICY --> AGENT[Agent Adapter]
  POLICY --> RUNNER[Runner Adapter]
  AGENT --> WT[Ephemeral Worktree]
  RUNNER --> ISO[Container or Micro-VM]
  ISO --> BUILD[Build and Test]
  BUILD --> STORE[Artifact and Provenance Store]
  STORE --> DEVICE[Device Adapter]
  DEVICE --> EVIDENCE[Logs, Crash, Screenshot, Test Evidence]
  EVIDENCE --> GATE
```

The MVP keeps jobs in memory and artifacts on disk. The next persistence slice should use an append-only event log with a current-state projection. External protocol messages should eventually include schema version, stable event type, correlation identifiers, authoritative timestamp, and adapter capability version.
