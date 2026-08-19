# Localization

English is the source language for the PWA and repository overview. The first
maintained locales are English (`en`), Korean (`ko`), and Japanese (`ja`).

## Repository overview

- `README.md` is the source document.
- `README.ko.md` and `README.ja.md` are maintained translations.
- Every README starts with links to all maintained versions.
- Security boundaries, commands, versions, paths, status words (`PASS`, `FAIL`,
  `NOT RUN`), and verification claims must preserve their source meaning.
- A translated README may be shorter than the source, but it must not omit a
  safety warning or turn a planned or unexecuted capability into a completed
  claim.

When a source README change affects behavior, safety, setup, or verification,
the same pull request should update each maintained translation. Pure wording
changes may use a follow-up issue labelled as documentation debt.

## PWA catalog

The PWA locale catalog is the source of user-facing application strings.
Adding a locale requires:

1. Copy the complete English key set.
2. Translate values without changing interpolation placeholders.
3. Add the locale to the language selector and supported-locale list.
4. Run the catalog parity and syntax tests.
5. Inspect the connect, local job, approval, remote run, error, empty, and
   narrow mobile states in a real browser.

Unsupported or missing browser locales fall back to English. The application
stores only the selected locale in local storage; authentication tokens remain
session-scoped. Dynamic values from the server continue to use safe text
assignment and are never treated as translated markup.

## Contribution review

Machine translation can be used as a draft, not as verification. A pull
request should name the locale, the reviewed surfaces, and the reviewer or
testing method. Reviewers should reject translations that weaken a warning,
invent support, expose a secret, or change a command.

When a README adds or changes a core security, Actions, Android, AI-governance,
or verification claim, update the EN/KO/JA semantic markers in
`test/localization-docs.test.mjs` in the same patch.
