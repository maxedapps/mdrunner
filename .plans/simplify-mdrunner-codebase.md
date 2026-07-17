# Simplify mdrunner without reducing product capability

> **Status:** Implemented
> **Implementation tracker:** `.progress/simplify-mdrunner-codebase.md`
> **Planning memory:** Included in this plan

## Problems

- The visible CLI is small, but the implementation carries test-oriented abstractions that are not part of the product: `src/main.ts` dependency orchestration, injected source/output filesystem interfaces, exported render metadata, and internal error codes. Repository evidence shows these surfaces are consumed mainly or exclusively by tests.
- `scripts/build.ts` is 392 lines and `tests/unit/build.test.ts` is 253 lines. Multi-platform support is required, but the current build adds a public dependency-injection framework, redundant target metadata, strict package-metadata modeling, and mocked lifecycle tests beyond what the standalone build needs.
- Tests total 3,237 TypeScript lines. Several suites assert implementation shape or duplicate full-document behavior instead of protecting distinct product contracts.
- Frontmatter must remain accepted and invisible. The current renderer correctly enables frontmatter parsing, but it also returns copied frontmatter and parser data that no runtime caller uses.
- GitHub Actions are explicitly prohibited. No `.github/**` file is committed on `main`; the cleanup must keep it that way and must not add CI configuration, CI scripts, or CI-based support claims.

## Implementation summary

- Preserve the current user-visible product and rich static rendering: `.md` file or piped stdin, strict UTF-8, ignored YAML/TOML frontmatter, GFM, headings, contained embedded images, static highlighting, six supported Mermaid families, self-contained safe HTML, default-browser opening, and immediate exit without a server.
- First consolidate tests around observable behavior. Then remove test-only seams and duplicate validation while retaining security, filesystem, SVG, document, and OS process boundaries.
- Keep all eight standalone target mappings for macOS, Linux, and Windows across arm64/x64, including Linux glibc/musl. Simplify the build to a compact target table and direct lifecycle rather than removing platform capability.
- Retain deterministic cache paths and complete-before-open atomic replacement. Simplify their implementation, but do not change that output contract during this cleanup.

## Conducted research and relevant sources

| Source or artifact | Material finding | Plan impact |
|---|---|---|
| `src/cli.ts`, `src/main.ts`, `tests/unit/main.test.ts`, `tests/cli/cli.test.ts` | Runtime orchestration is a linear 51-line function behind a dependency interface; the real subprocess suite already protects file/stdin/help/error/opener behavior. | Inline orchestration into the CLI and retain black-box sequencing/failure tests instead of exhaustive injected-operation tests. |
| `src/render.ts`, `src/plugins/headings.ts`, `tests/integration/markdown.test.ts` | Runtime callers use only final HTML. `RenderedMarkdown.frontmatter` and copied `data` exist for tests. Sätteri must still parse frontmatter so it is omitted. | Delete exported metadata; keep `features.frontmatter: true`; assert YAML and TOML frontmatter are absent from output and do not fail. |
| `src/plugins/safety.ts`, `src/plugins/images.ts`, image/security tests | Image URL normalization and source-location logic are duplicated before the image plugin performs final validation and embedding. | Give image URL policy one final-pipeline owner and move adversarial cases to behavioral image tests. |
| `src/output.ts`, `tests/unit/output.test.ts` | The implementation includes injected filesystem APIs and an in-process destination queue. The real CLI performs one write, but deterministic atomic replacement and Windows fallback remain useful cross-platform contracts. | Remove injection and queue machinery; keep deterministic path calculation, completed sibling file, rename, and bounded Windows restore fallback. |
| `src/errors.ts` and callers/tests | Runtime never branches on 20 internal error codes or `ExpectedError.exitCode`; users see formatted messages and process status only. | Replace the code catalogue with one concise expected CLI error carrying message and optional source location. |
| `src/assets.ts`, `src/document.ts`, `src/plugins/mermaid.ts` | Authored SVG, generated Mermaid SVG, local path containment, and final HTML validation are separate trust boundaries. | Retain these boundaries; do not collapse them into a generic validator or regex-only sanitizer. |
| `scripts/build.ts`, `tests/unit/build.test.ts`, `bun.lock`, Sätteri 0.9.5 package/loader | Sätteri dynamically loads a platform N-API addon. A literal `{ type: "file" }` import and env assignment before dynamic CLI import are irreducible. Eight package/addon variants exist. Build exports and dependency injection are only test consumers. | Keep exact mappings/bootstrap order and native smoke requirements; collapse build data and lifecycle to direct code and smaller pure helpers. |
| `package.json`, `bunfig.toml` | Many test aliases and coverage thresholds encourage implementation-detail coverage; focused Bun paths can be run directly. | Keep a small script set and behavior-first tests; remove coverage as a mandatory project gate. |
| `git ls-files '.github/**'` | No GitHub Actions setup is committed at `7e8ed52`. | Preserve an empty `.github` surface; do not integrate the stopped draft. |

- **Exploration/research lanes:**
  - Build lane `run-mroucyqm-801a15606b` inspected `scripts/build.ts`, its tests, lock/package metadata, Sätteri 0.9.5 loader behavior, target mappings, bootstrap ordering, and cleanup semantics.
  - Runtime/test lane `run-mroud19z-19817f5d1f` inspected all `src/**`, all test suites, package/config, duplicated policies, test-only consumers, and security/OS boundaries.
- **Parent verification:** The parent confirmed current totals (2,092 runtime TypeScript lines, 392 build lines, 3,237 test TypeScript lines), verified no tracked `.github/**`, searched runtime/test consumers of orchestration/render/error/output APIs, and inspected the source/output/document/build boundaries directly. Child claims requiring unavailable worktree dependencies were treated as static evidence only; the parent checkout previously passed 248 tests and native Darwin arm64 standalone smoke at `7e8ed52`.

## Scope and non-goals

- **In scope:** Runtime simplification, test consolidation, package-script/config cleanup, compact multi-platform build rewrite, frontmatter-ignore regression coverage, source and native standalone validation, and removal of any GitHub Actions-related draft from the intended implementation.
- **Non-goals:** Removing GFM, Mermaid, syntax highlighting, local image embedding, SVG safety, CSP, atomic complete-before-open output, deterministic cache paths, support for any currently mapped OS/architecture/libc, adding literal Markdown as a positional argument, adding a server/watch mode, changing CSS/design, publishing releases, signing/notarization, or adding any CI service/configuration.

## Decisions and constraints

| Approach or constraint | Result | Reason and consequence |
|---|---|---|
| Preserve eight explicit build mappings | Chosen | Bun target names and Sätteri package/addon names are asymmetric, especially Windows and Linux GNU/musl. A compact explicit table is clearer than inferred string rewriting. |
| Keep generated native-addon bootstrap | Confirmed | Sätteri evaluates its dynamic loader before normal CLI code; the addon path must be embedded literally and configured before dynamic CLI import. |
| Remove build dependency injection, not platform capability | Chosen | Only tests consume the generalized build API. Direct build lifecycle plus small pure selectors preserves all targets with less surface. |
| Keep deterministic cache paths and atomic replacement | Chosen | Existing users may have open generated files, and Windows replacement behavior is a real OS boundary. This cleanup should not silently change output identity or recovery behavior. |
| Keep frontmatter parsing but discard metadata | Chosen | The requirement is acceptance and invisibility, not exposing frontmatter through an internal API. |
| Preserve rich renderer and trust boundaries | Chosen | User requested cleanup, not feature removal. Authored content, assets, SVG, Mermaid output, and final documents cross materially different trust boundaries. |
| Inline orchestration and use real subprocess/filesystem tests | Chosen | The product is a single linear command. Existing CLI tests can protect ordering and errors without a reusable service abstraction. |
| Remove internal error codes | Chosen | No production caller branches on them; message/location/exit behavior is the actual contract. |
| Remove mandatory coverage tooling | Chosen | Test quality should be based on protected behavior. Typecheck, lint, source tests, CLI tests, build, and native smoke remain required. |
| Add GitHub Actions or equivalent CI | Rejected | Explicitly prohibited by the user. Multi-platform qualification is performed by running the same native commands on each target environment, not by committing CI configuration. |
| Remove Mermaid malformed-input gates | Rejected for this cleanup | `beautiful-mermaid` silently tolerates some malformed statements. Removing gates changes failure behavior and is not necessary to eliminate test-only abstractions. |
| Merge authored and generated SVG validators into a generic framework | Rejected | Their policies differ; abstraction would reduce lines at the cost of a less obvious security boundary. |

## Plan review

- **Reviewer:** Fresh read-only run `run-mrouot5c-c56247b3e4` reviewed the full draft, current implementation, tests, package/build configuration, and both exploration handoffs.

| Finding | Parent evaluation | Disposition | Plan change or user decision |
|---|---|---|---|
| Completion wording could treat configured targets as fully supported without native evidence. | The user requires build capability for all targets, while access to every native environment is an operational constraint outside this refactor. Code cleanup must implement all mappings; release qualification must remain evidence-based. | Accept clarification; reject blocking code cleanup on unavailable hardware. | T2.3 and DoD now distinguish implemented build capability from native-qualified release support. Every claimed release needs native smoke; unrun targets remain implemented but explicitly unqualified. |
| Standalone validation lacked one exact reusable command and a Windows opener interception contract. | Confirmed: current source CLI shims do not validate compiled Windows `powershell.exe` argv, and an optional unnamed smoke is not actionable. | Accept. | T2.3 now requires `tests/standalone/standalone.test.ts`, `bun run test:standalone`, bounded cleanup, and exact macOS/Linux/Windows opener shims. |
| T1.5/T2.2 removed all fault seams while requiring deterministic write/compile/publish failure proof. | Confirmed: real filesystems cannot reliably induce partial writes or rename failures on every OS. Broad dependency bags are unnecessary, but one-purpose helpers remain justified. | Accept. | T1.5 retains a narrow replacement-filesystem helper; T2.2 retains a one-callback owned-build-lifecycle helper plus narrow publish helper. Operation-trace matrices remain removed. |

- **Focused follow-up:** Not needed. Accepted changes are narrow clarifications that preserve the chosen architecture and do not reopen scope.

## Phase 1 — Simplified runtime with unchanged behavior

### Problems addressed

- Test-only orchestration, filesystem, renderer metadata, and error APIs obscure the linear CLI.
- Image policy and source-location extraction are duplicated.
- Tests overprotect internal call traces while duplicating full-document behavior.

### Implementation summary

- Establish a compact behavior-first regression set, then simplify the CLI and internal APIs behind it.
- Keep security and OS boundaries explicit and separate.
- Finish with the same file/stdin/frontmatter/render/write/open behavior and fewer exported/internal abstractions.

### Tasks

#### T1.1 — Consolidate the behavior-first regression contract

**Description**

- Reduce overlapping tests before refactoring, while retaining one clear owner for each visible behavior and trust boundary.
- Keep real CLI subprocess coverage for file, stdin, help, input/render failure, opener failure with retained output, Unicode/spaces, and interactive no-input exit.
- Keep one representative complete-document suite covering YAML and TOML frontmatter invisibility, GFM, headings, highlighting, six Mermaid families, embedded PNG/SVG, safe remote URLs, raw HTML escaping, CSP, responsive CSS, and absence of runtime scripts/external product assets.
- Keep focused authored-content, image containment/authored SVG, generated Mermaid SVG, final-document, source UTF-8/path, and browser argv safety suites.
- Delete implementation-shape checks and exact operation traces that no longer protect a retained contract.
- Inspect and update all coupled fixtures, helpers, scripts, and test imports discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `tests/cli/cli.test.ts` — retain black-box command behavior and side-effect ordering.
- `tests/integration/document.test.ts`, `tests/integration/complete-document.test.ts` — merge overlapping shell/complete-output assertions.
- `tests/integration/render-pipeline.test.ts` — delete after equivalent representative coverage is explicit.
- `tests/security/output-contract.test.ts` — remove source-text plugin-order/network scans; preserve only non-duplicated behavioral assertions.
- `tests/unit/main.test.ts`, `tests/unit/output.test.ts`, `tests/unit/source.test.ts` — replace internal trace matrices with retained public/failure boundaries.
- `tests/fixtures/documents/complete.md` — add or pair TOML frontmatter evidence without making the fixture unstable.

**Dependencies**

- None.

**Acceptance and verification**

- Behavior inventory remains covered — run focused retained suites; expect file/stdin/help/error/opener/frontmatter/GFM/static-output/security cases to pass before runtime refactoring.
- No implementation-shape tests remain — search tests for source-file reads of `src/render.ts`, plugin symbol ordering, injected operation trace arrays, or exact internal hashes unless they protect a public contract.
- Test code is materially smaller and each retained suite has a distinct stated boundary; no numeric coverage target is used as a reason to preserve duplicate tests.

**Task-local risks**

- Removing tests before refactoring can hide behavior. Safeguard by mapping each deleted assertion to a retained black-box or focused boundary test in the same change; recover by restoring the deleted test when no equivalent exists.

#### T1.2 — Inline CLI orchestration and simplify source acquisition

**Description**

- Move select → render → write → print → `pathToFileURL` → open into one `main` function in `src/cli.ts` with one executable error boundary.
- Delete `src/main.ts`, `MdrunnerDependencies`, `MdrunnerResult`, and injected operation sequencing.
- Preserve print-before-open so opener failure still leaves and reports the completed file.
- Replace `SourceFileSystem`, `StdinBoundary`, and broad `ReadMarkdownSourceOptions` with direct Bun/Node boundaries. Keep only a narrow input seam if PTY/stdin testing cannot use real subprocess behavior reliably.
- Preserve case-insensitive `.md`, file precedence over redirected stdin, strict fatal UTF-8, canonical source path, regular-file checks, stdin current-working-directory asset base, help behavior, and concise errors.
- Inspect and update all callers, tests, exports, and comments discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/cli.ts` — executable flow and final error formatting.
- `src/main.ts` — delete after moving its retained behavior.
- `src/source.ts` — remove test-only filesystem/stdin interfaces while preserving source contracts.
- `tests/cli/cli.test.ts`, `tests/unit/source.test.ts` — move confidence to real temp files/stdin/PTY and concise focused units.

**Dependencies**

- T1.1.

**Contract or shape**

```ts
async function main(args: readonly string[]): Promise<void> {
  const selection = await readMarkdownSource(args);
  if (selection.kind === "help") return printUsage();
  const html = await renderDocument(selection.source);
  const outputPath = await writeOutput(selection.source, html);
  console.log(outputPath);
  await openBrowser(pathToFileURL(outputPath).href);
}

try {
  await main(Bun.argv.slice(2));
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}
```

**Acceptance and verification**

- Real CLI behavior is unchanged — run `bun test tests/cli/cli.test.ts`; expect all file/stdin/help/error/opener/PTY cases to pass without a real browser.
- Opener failure prints exactly one completed path before one concise stderr diagnostic and exits 1; input/render/write failures print no output path and invoke no opener.
- Search confirms no remaining `runMdrunner`, `MdrunnerDependencies`, `MdrunnerResult`, `SourceFileSystem`, or obsolete injected stdin interfaces.

**Task-local risks**

- A broad top-level catch can accidentally print a stack or lose the completed path. Keep path printing before open and assert exact stdout/stderr through subprocess tests.

#### T1.3 — Make rendering return only final product data while preserving ignored frontmatter

**Description**

- Remove exported `RenderedMarkdown.frontmatter`, copied/frozen `data`, and `copyFrontmatter`.
- Keep a local Sätteri `data` bag solely for first-H1 title capture and continue enabling `features.frontmatter: true` so supported frontmatter is recognized and omitted.
- Return the final HTML directly from the public render function. Retain a small internal fragment helper only if focused plugin tests need it; do not expose parser metadata.
- Add explicit YAML and TOML regression cases: both compile successfully, are absent from fragment/final HTML, and do not affect fallback title except where an authored H1 exists.
- Preserve fixed plugin order and all current GFM/title/heading behavior.
- Inspect and update all render imports, tests, and type augmentations discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/render.ts` — remove metadata result API and keep local title state.
- `src/plugins/headings.ts` — retain per-document title/slug state and generated-ID reservations.
- `tests/integration/markdown.test.ts`, `tests/integration/complete-document.test.ts` — behavioral frontmatter/title assertions.

**Dependencies**

- T1.1.

**Acceptance and verification**

- Run focused Markdown/document tests; expect YAML and TOML frontmatter input to succeed, remain absent from output, and preserve GFM/title/heading behavior.
- Search confirms no runtime/test consumer of `RenderedMarkdown`, `result.frontmatter`, copied parser `data`, or metadata freezing.
- Representative file and stdin rendering remain byte-deterministic for identical source/context.

**Task-local risks**

- Disabling frontmatter rather than discarding metadata would render delimiters/content or change parsing. Keep the feature enabled and test absence explicitly.

#### T1.4 — Give image policy and source locations one owner

**Description**

- Keep raw HTML and anchor policy in the authored-content safety plugin.
- Remove its intermediate image visitor. Make the image embedding plugin the sole owner of remote HTTP(S), encoded/ambiguous scheme rejection, relative-path validation, and local embedding.
- Move every existing adversarial image URL case to final-pipeline image/security tests before deleting duplicate checks.
- Add one small shared positioned-source helper used by safety, images, Mermaid, and Expressive Code. Do not create a general plugin framework.
- Retain canonical containment, symlink defense, file signatures, authored SVG validation, and remote-image no-fetch behavior.
- Inspect and update plugin assembly, error construction, and tests discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/plugins/safety.ts` — retain raw HTML/anchor policy; remove image branch.
- `src/plugins/images.ts` — own complete image URL policy and embedding.
- `src/assets.ts` — retain filesystem and authored SVG trust boundary.
- `src/plugins/mermaid.ts`, `src/plugins/expressive-code.ts` — consume shared source positioning only.
- `tests/security/authored-content.test.ts`, `tests/integration/images.test.ts`, `tests/security/image-paths.test.ts` — preserve final behavioral cases, not transient plugin state.

**Dependencies**

- T1.1.

**Acceptance and verification**

- Run image/authored-content/authored-SVG suites; expect all safe remote/contained local cases and all encoded scheme/traversal/symlink/signature/SVG rejection cases to remain protected.
- Search confirms one image URL classifier and one source-position helper; no duplicate repeated-decoding/control-stripping image policy remains.
- Generated documents contain data URIs for local images and unchanged HTTP(S) URLs for authored remote images; generation performs no network fetch.

**Task-local risks**

- Deleting the first image check can drop encoded-protocol rejection. Port all adversarial cases to the final image owner before removing code and verify source-aware diagnostics.

#### T1.5 — Simplify output persistence without changing deterministic atomic behavior

**Description**

- Remove `OutputFileSystem`, `OutputFileHandle`, broad `WriteOutputOptions`, injected UUID/platform/filesystem callbacks, and `destinationQueues`.
- Keep deterministic `outputPathForSource`, portable filename sanitization, full source identity hash, restrictive temporary-file permissions, file sync/close, and complete temporary sibling before publish.
- Keep a direct POSIX rename-over-existing path and a compact Windows backup/install/restore fallback. Make platform selection internal.
- Ensure owned temporary/backup files are cleaned on all ordinary failures without replacing the primary diagnostic.
- Replace mocked operation-trace tests with real temporary-directory persistence tests. Retain one narrow `replaceCompletedFile` helper that accepts only the rename/unlink operations required to deterministically test Windows install/restore failures; do not retain a general `OutputFileSystem` abstraction.
- Inspect and update callers, imports, and cleanup tests discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/output.ts` — direct filesystem lifecycle and deterministic path helpers.
- `tests/unit/output.test.ts` — retain path contract, complete replacement, failed-write cleanup, and Windows rollback; remove queue and exact operation-trace internals.
- `tests/cli/cli.test.ts` — retain completed-output and opener-failure behavior.

**Dependencies**

- T1.1, T1.2.

**Acceptance and verification**

- Real temporary-directory tests prove first write, repeated replacement, failed-write cleanup, and no sibling residue; deterministic path remains unchanged for equivalent source identity.
- Narrow helper tests deterministically prove prior complete output is restored when Windows installation fails and owned temporary/backup paths are handled; native Windows validation remains required before claiming release support.
- CLI tests prove open occurs only after a complete file exists and opener failure retains that file.

**Task-local risks**

- Simplifying replacement can lose the previous valid file on Windows. Preserve staged completion and backup restoration; recover by reverting the output refactor if native replacement semantics cannot be proven.

#### T1.6 — Simplify expected errors and package scripts

**Description**

- Replace internal error-code catalogue and unused error `exitCode` with one expected error carrying message and optional copied source location.
- Update tests to assert user-visible message/location/process behavior rather than private codes.
- Reduce package scripts to useful entry points: `dev`, `build`, `test`, `test:standalone`, `typecheck`, `lint`, `format`, `format:check`, and `check`. Focused source suites remain directly runnable with `bun test <path>`; `test:standalone` is the one bounded native packaging gate defined in T2.3.
- Remove `test:coverage`, coverage thresholds/reporting, and `bunfig.toml` if it has no remaining non-coverage purpose. Keep `coverage/` ignored for ad hoc local runs.
- Do not add `ci`, GitHub-specific orchestration, or any `.github/**` content in this phase. The local `test:standalone` command is platform-neutral and must not invoke a hosted service.
- Inspect and update all error constructors, tests, package consumers, and configuration discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `src/errors.ts` and every `ExpectedError` caller.
- `package.json`, `bunfig.toml`, `.gitignore`, `tsconfig.json`.
- Tests that assert `errorCodes` or internal error identity.

**Dependencies**

- T1.2, T1.4, T1.5.

**Acceptance and verification**

- Search confirms no `errorCodes`, `ErrorCode`, or `ExpectedError.exitCode` remains; all expected failures still produce concise source-aware text without stack traces.
- `bun test`, typecheck, lint, and format checks pass using the reduced script/config surface.
- `git ls-files '.github/**'` returns no files, and package scripts/config contain no GitHub Actions or CI setup.

**Task-local risks**

- Internal codes could be an undocumented consumer contract. Repository search currently finds no production consumer; if external library use is discovered during implementation, retain codes only at that actual boundary.

### Risks, safeguards, and recovery

- **Risk:** Deleting injected seams can make rare failure paths harder to simulate. **Safeguard:** retain narrow pure helpers only for platform-specific logic and emphasize real subprocess/temp-filesystem tests. **Recovery:** restore a single focused seam when a material failure cannot otherwise be validated; do not recreate generalized dependency bags.
- **Risk:** Security behavior can drift while consolidating plugins. **Safeguard:** move adversarial cases before deleting duplicate code and keep authored/generated SVG and final-document validators separate. **Recovery:** revert the affected consolidation and retain the regression fixture.
- **Risk:** Frontmatter may become visible or rejected. **Safeguard:** keep Sätteri frontmatter enabled and add YAML/TOML file and stdin assertions. **Recovery:** restore the prior feature options immediately if either delimiter form appears or fails.

### Phase validation and review

- **Checks:** Run `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun test`, focused CLI/security/document suites, and a source CLI file/stdin opener-shim smoke. Expect all exits 0, ignored frontmatter, no real browser/server/network, and no generated residue.
- **Review focus:** T1.1–T1.6 user-visible equivalence, trust boundaries, frontmatter behavior, output/open ordering, Windows fallback, and whether removed tests were implementation-only rather than unique protection.
- **Exit and rerun:** Apply material findings, rerun affected focused suites, then rerun the complete phase checks. Do not proceed to build simplification with runtime regressions or unresolved frontmatter/output behavior.

## Phase 2 — Compact multi-platform standalone build

### Problems addressed

- Current build capability is correct but wrapped in a large exported dependency/model surface and mock-heavy lifecycle tests.
- Multi-platform support must remain while GitHub Actions remains absent.

### Implementation summary

- Replace the build implementation with one compact exact target table, small target selection helpers, direct addon resolution, one literal bootstrap, direct Bun compile, staged publish, and cleanup. Retain only narrow fault seams for owned-build cleanup and artifact publication; remove the general dependency bag.
- Validate every target mapping statically and every claimed release natively outside `node_modules` using the same local commands on the matching platform.

### Tasks

#### T2.1 — Collapse target data and build APIs

**Description**

- Preserve exact mappings for Darwin arm64/x64, Windows arm64/x64, Linux arm64/x64 GNU, and Linux arm64/x64 musl.
- Replace verbose target objects with compact target → `[packageName, addonFile]` tuples. Derive Bun target from the key and executable extension from the Windows prefix.
- Keep zero/one developer target argument, exact own-key membership, native default, `aarch64` normalization, and fail-closed unsupported OS/arch/Linux-libc behavior.
- Keep a small pure Linux libc classifier using `process.report` and bounded `ldd --version` fallback; do not assume glibc.
- Remove exported build model interfaces, custom dependency bag, callback injection, redundant metadata fields, and exports used only by tests.
- Inspect and update package scripts, build tests, and any downstream build consumers discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `scripts/build.ts` — `BUILD_TARGETS`, host/libc detection, argument parsing, build dependency interfaces.
- `tests/unit/build.test.ts` — mapping, target, libc, and argument tests.
- `bun.lock`, installed `satteri@0.9.5` loader/package metadata — exact mapping evidence.

**Dependencies**

- Phase 1 complete and green.

**Contract or shape**

```ts
const TARGETS = {
  "bun-darwin-arm64": ["@bruits/satteri-darwin-arm64", "satteri_napi.darwin-arm64.node"],
  // Seven other exact rows; no inferred package-name magic.
} as const;
```

**Acceptance and verification**

- Focused build tests assert exactly eight mappings, exact package/addon pairs, output extension derivation, native host selection, Linux libc ambiguity failure, and malformed/inherited/extra target rejection.
- Search confirms no `BuildDependencies`, redundant `BuildTargetConfig` metadata, injected log/UUID callbacks, or production-unused build exports. Only the one-purpose compile-lifecycle and replacement helpers remain testable.
- Cross-target mapping is documented as build configuration only; native execution remains the support qualification.

**Task-local risks**

- Clever package-name derivation can map Windows or GNU incorrectly. Keep explicit tuples and compare against Sätteri 0.9.5 loader/lock entries.

#### T2.2 — Simplify addon resolution, bootstrap, compilation, and publish lifecycle

**Description**

- Resolve the exact selected addon under project `node_modules`; require a regular file before creating build material. Rely on pinned `bun.lock`/frozen installs for version integrity instead of modeling all package metadata fields.
- Preserve the fixed exclusive bootstrap filename for reproducibility/concurrent ownership.
- Generate exactly one literal `{ type: "file" }` addon import, assign `NAPI_RS_NATIVE_LIBRARY_PATH`, then await a literal dynamic import of `src/cli.ts`.
- Call Bun 1.3.14 `Bun.build` through one small owned-build-lifecycle helper that accepts only a compile callback. Production supplies the direct Bun compile; tests can write partial staging and throw to prove cleanup. Use minification, compile target, no sourcemap/bytecode, and a unique staging output.
- Verify staging exists, publish through one narrow POSIX/Windows-safe replacement helper with prior-artifact restoration, remove opposite extension after success, and attempt all owned cleanup in `finally` without deleting another build's bootstrap.
- Keep stable `build:` diagnostics and selected target/addon logging. Do not add package installation, network behavior, CI configuration, or artifact uploads.
- Inspect and update all generated paths, ignores, tests, and package scripts discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `scripts/build.ts` — addon resolution, bootstrap generation, compile, replacement, cleanup, executable guard.
- `.gitignore` — generated bootstrap/dist patterns only.
- `package.json` — `build` entry.
- `tests/unit/build.test.ts` — bootstrap ordering/escaping, missing addon, publish/rollback, cleanup.

**Dependencies**

- T2.1.

**Contract or shape**

```ts
import addonPath from "<absolute selected addon>.node" with { type: "file" };
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = addonPath;
await import("<absolute src/cli.ts>");
```

**Acceptance and verification**

- Two consecutive native builds from identical sources produce one identically hashed `dist/mdrunner` or `dist/mdrunner.exe`, with no bootstrap/staging/backup/opposite-extension residue.
- Invalid target, unsupported host/libc, missing addon, compiler failure, and publish failure produce one stable error and retain/restore any previous complete artifact.
- `scripts/build.ts` and its tests are materially smaller, with no replacement by a different generalized framework.

**Task-local risks**

- Cleanup can mask the primary compile error or delete another build's bootstrap. Track ownership explicitly, attempt all cleanup, and preserve the original failure context.

#### T2.3 — Replace mocked build lifecycle coverage with native standalone evidence

**Description**

- Keep compact unit tests for pure target/libc/bootstrap helpers, one owned-build cleanup callback test, and one focused publish rollback helper.
- Remove mocked full-build dependency bags and operation-trace tests.
- Create `tests/standalone/standalone.test.ts` and `bun run test:standalone` (`bun test --timeout 300000 tests/standalone/standalone.test.ts`). The test builds once unless the exact native artifact already exists, copies the executable plus representative fixture/assets outside the repository, runs with isolated HOME/TMP/PATH and no adjacent/project `node_modules`, intercepts the platform opener, and exercises file plus stdin.
- On macOS and Linux, create a temporary executable `open` or `xdg-open` shim that records one argv JSON array. On Windows, compile a tiny temporary Bun helper to `powershell.exe`, place it first on PATH, record the actual PowerShell argv, and assert the encoded command resolves to the exact `file://` URL. All shims/captures/helpers are owned by the test and removed in `finally`.
- The native smoke must assert complete HTML, ignored frontmatter, GFM, static highlighting, six Mermaid SVGs, embedded local PNG/SVG, no scripts/runtime imports/server, exact opener URL, empty stderr, exit, and cleanup.
- Run the same commands manually or in platform-native development/release environments for every claimed macOS/Linux/Windows architecture/libc. Do not add GitHub Actions or infer native support from cross-compilation.
- Inspect and update package scripts, fixtures, cleanup, and release-support statements discovered during implementation.

**Relevant files — non-exhaustive starting points**

- `tests/unit/build.test.ts` — reduced pure/helper tests.
- `tests/fixtures/documents/complete.md` and assets — native representative input.
- `package.json` — required local `test:standalone` command; it is a native developer/release gate and does not imply CI.
- `PROJECT.md` or eventual user documentation — distinguish configured targets from natively verified targets without CI claims.

**Dependencies**

- T2.2.

**Acceptance and verification**

- `bun run test:standalone` passes on the current host within five minutes, reuses a prebuilt exact native artifact when present, exercises file/stdin and the platform opener, and removes dist/bootstrap/cache/shim/capture/helper residue.
- All eight target mappings and build selection paths are implemented. Each release target is claimed as native-qualified only after the same command passes on matching native OS/architecture/libc; unavailable targets do not block this code cleanup but remain explicitly unqualified.
- `git ls-files '.github/**'` remains empty; no workflow, badge, action, runner matrix, upload, or CI-only script exists.

**Task-local risks**

- Cross-compilation can succeed while the addon ABI fails. Treat native smoke as the only qualification; remove unsupported release claims rather than weakening tests.

### Risks, safeguards, and recovery

- **Risk:** Simplification breaks one target mapping or bootstrap order. **Safeguard:** exact tuple tests, source-order assertion, and native smoke. **Recovery:** restore the previous build script for the affected target while retaining a failing regression.
- **Risk:** Optional native package is absent during explicit cross-build. **Safeguard:** fail before creating build material with the exact target/package/addon diagnostic. **Recovery:** perform the build in a native/frozen-install environment containing the matching optional package; do not add runtime downloads.
- **Risk:** No automated hosted matrix exists by explicit choice. **Safeguard:** use one documented native command sequence and record qualified targets from actual runs. **Recovery:** mark unrun/failing targets unqualified; do not claim support from configuration alone.

### Phase validation and review

- **Checks:** Run build unit tests, source checks, two identical native builds, `bun run test:standalone`, residue search, and `git ls-files '.github/**'`. Expect exact mapping/bootstrap behavior, one artifact, platform-specific opener capture, no GitHub Actions, no node_modules runtime dependency, and clean generated state.
- **Review focus:** T2.1–T2.3 target-map correctness, addon-before-Sätteri ordering, Linux libc, Windows replacement, bootstrap ownership, native evidence versus configuration, and absence of CI setup.
- **Exit and rerun:** Fix material findings and rerun focused build plus current-host standalone smoke. For target-specific findings, rerun on that native platform before qualification.

## Final validation and review

- **Checks:** Run `bun install --frozen-lockfile`, `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`, and `bun run test:standalone`. Generate from a `.md` file and equivalent stdin containing YAML and TOML frontmatter cases; expect frontmatter omitted, complete static HTML, exact opener interception, exit, and no server/process/temp residue.
- **Review focus:** Complete diff against the simplified contract; deleted exports/callers; frontmatter parsing; image/URL/SVG trust boundaries; output/open ordering; multi-platform target mappings; native addon bootstrap; test uniqueness; and strict absence of GitHub Actions.
- **Evidence:** Before/after file and line inventory, deleted/merged test mapping, full command outputs, current-host artifact hash/size, isolated output assertions, native target qualification records, `git ls-files '.github/**'`, generated-residue search, and explicit unavailable-platform skips.
- **Exit and rerun:** Apply material findings, rerun affected focused tests, then the full final gate. Use a fresh read-only final reviewer when available; if unavailable, record the concrete limitation rather than adding more infrastructure.

## Definition of Done

- The CLI still accepts exactly one `.md` file or piped Markdown, writes one complete self-contained HTML document, prints its path, opens its `file://` URL, and exits without a server.
- YAML and TOML frontmatter are accepted, ignored, and absent from generated HTML for file and stdin input.
- GFM, heading IDs/title, static highlighting, six supported Mermaid families, contained embedded images, safe authored links/HTML, responsive CSS, and final CSP/static-output invariants remain intact.
- Test-only orchestration/filesystem/build dependency bags, unused render metadata, internal error-code coupling, duplicated image policy, and implementation-shape tests are removed.
- Deterministic output identity, complete-before-open writes, POSIX replacement, and Windows rollback remain verified with simpler code.
- All eight macOS/Linux/Windows arm64/x64 GNU/musl target mappings and build paths are implemented exactly; the standalone bootstrap embeds one matching Sätteri addon before importing the CLI. Native-qualified release claims exist only for targets with recorded `bun run test:standalone` evidence.
- No GitHub Actions or equivalent hosted CI configuration, scripts, badges, or support claims exist.
- Source checks and current-host native standalone file/stdin smoke pass; every claimed release target has matching native smoke evidence, while unrun targets remain explicitly unqualified.
- The resulting runtime, build, and tests are materially smaller, with no replacement by speculative abstractions or loss of security boundaries.
