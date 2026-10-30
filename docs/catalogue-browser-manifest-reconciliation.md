# Catalogue browser input reconciliation — exactly five entries

The stale36-entry manifest recovered from the exact e95bdaff source checkout is preserved byte-for-byte in `tests/ui/fixtures/catalogue-browser-manifest-60bb38a.json`, SHA256 `5cb3165b593300b6f7cad6c4fd0b3d98219d46e9d03fff5f3232432df5a68007`. Its historical `public_source_head` metadata says60bb38a; the fixture filename labels that metadata, **not** the commit containing these manifest bytes. It is not a copy of the manifest as stored at commit60bb38a. The current manifest keeps the same36paths. Exactly five existing input blob/SHA256/byte-size triples change; the other31entries remain identical. No paths are added, removed or excluded.

## Reviewed behavior, not blanket current-code acceptance

- `src/components/ui/Dialog.tsx`: owner-linked return-focus traversal; restore targets must be connected, enabled and visible, including ancestor inert/hidden states. Pending dismissal and topmost modal ownership remain. Approved workspace§8 requires keyboard/focus restoration; nine existing dialog tests exercise pending, Escape, disconnected fallback, nested owner removal and containment. Native browser behavior is not newly claimed verified.
- `src/index.css`: three narrowly scoped login rules retain visible pending text in the mounted public sign-in form. Explicit Oct26 auth redesign request/verification and auth-transition tests establish this intent. They do not expose private content during authentication.
- `src/styles/ui.css`: four CO status color classes; existing text labels remain authoritative, not color alone. Approved compact workspace/status direction supports this styling-only delta.
- `package.json`: exact ExcelJS4.4.0, saxes6.0.0 and @types/node25.5.2 additions support accepted XLSX parsing, guarded streamed XML and compilation. No other dependency versions are changed here.
- `package-lock.json`:192new public-registry entries; no new hasInstallScript flags. Four existing entries change: root dependency metadata and dev flags for graceful-fs/saxes/xmlchars. Existing versions do not change. The bounded XLSX guard enforces expansion/structure limits and rejects macros/external content; source inspection and accepted sample tests are not a comprehensive parser security proof.

The user explicitly chose to skip a fresh npm audit. No alternative dependency-metadata transmission or audit retry is authorized. No claim of zero vulnerabilities is made. A prior dated audit is not current assurance, and no automatic dependency upgrade/install is part of this reconciliation.

## Provenance versus future candidate identity

`public_source_head=e95bdaff33b9fcb8cd18114f364e23198c290ba3` records the base source of these36public inputs. **It is not the current uncommitted candidate or a future release SHA.** The unchanged browser runner separately requires the real future `CATALOGUE_BROWSER_SOURCE_SHA` to equal checked-out git HEAD, binds manifest bytes to tracked HEAD, binds every source/harness input to tracked blobs, and rejects symlinks/uncommitted inputs before isolated browser execution. Those protections are not removed or redirected to old source.

This metadata change is tested locally; the required exact checkout/CI/native-browser run remains a separate later verification. No CI trigger, publication, production deployment or hosted change is performed here.

## Negative guards

The loading coverage test validates the finite manifest before reading any listed file, requires immutable historical bytes, exact36unique paths and named five updates, and verifies all current content hashes/sizes. Mutation tests reject missing/duplicate/extra paths, a traversal path, changed reviewed/unchanged hashes and incorrect source provenance. Consequently future arbitrary current-file drift cannot automatically repin itself into acceptance.
