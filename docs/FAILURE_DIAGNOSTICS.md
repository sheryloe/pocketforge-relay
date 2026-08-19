# Failure Diagnostics

Failed npm, Android Gradle, and CMake preset jobs include a fixed diagnostic:

```json
{
  "tool": "npm",
  "category": "dependency",
  "code": "npm-dependency",
  "summary": "npm could not resolve or download a dependency."
}
```

The classifier reads only the relay's already-redacted, bounded job log and
returns fixed strings. It does not copy a matched line, path, token, package
name, or repository content into the diagnostic. Unknown output becomes a
tool-specific `*-unknown` execution failure.

Current categories cover common dependency, environment, test, configuration,
compile/link, and generic execution signatures. A classification is navigation
evidence, not a root-cause proof: maintainers must review the underlying
sanitized log. The relay does not automatically retry, edit source, or invoke an
AI provider from a diagnostic.
