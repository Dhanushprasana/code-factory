# ForgeBench: Project Status, Improvement Areas, and Showstoppers

**Status checked:** 2026-11-24
**Scope:** Project history from the initial repository-setup prototype through the current Harbor execution and evaluation workflow.

This report distinguishes a working application feature from a result that has actually been verified. A healthy service, a generated patch, or a passing build does not by itself prove that a benchmark task is correct.

## Executive status

ForgeBench has grown from a repository-setup prototype into a runnable local benchmark prototype. Its current workflow includes pinned GitHub snapshots, bounded static analysis, AI-assisted task and reference generation, reviewer-controlled reference application, two-agent execution, submission collection, and isolated evaluation of configured commands.

The local Compose stack was running at this report's status check: PostgreSQL, Redis, backend, AI service, validation runner, Harbor runner, and frontend were healthy; Ollama was running. The backend health endpoint returned `ok`, the AI health endpoint returned `ok`, and the frontend health endpoint returned HTTP 200. The ForgeBench backend suite passed **49/49 tests** in the current check.

That does **not** mean the current benchmark proves the generated feature works:

- In the observed Product Search benchmark, Antigravity failed before submission because its provider returned HTTP 503 overload.
- Gemini CLI submitted a patch and both builds passed, but the backend test command found **zero matching test specs** and exited unsuccessfully. The reference had **zero configured hidden tests**.
- The result was **20/100**, not a correctness pass. The feature behavior remains unverified.

## How ForgeBench currently works

### 1. Project, repository, and pinned source

The React frontend calls the NestJS API to create projects and attach GitHub repositories. The backend uses GitHub metadata and branch/commit APIs, then records the selected branch and full commit SHA in PostgreSQL. Cloning is a separate action: it checks out the selected commit into the shared artifact volume and verifies the resulting `HEAD`. Repository association does not itself clone source.

### 2. Repository analysis

The backend queues analysis work through BullMQ/Redis. A worker sends the ready snapshot to the Python FastAPI analyzer. The analyzer reads the checkout from artifact storage mounted read-only and returns a deterministic report that the backend persists in PostgreSQL. It scans manifests, source structure, selected routes/entities, and (where supported) Tree-sitter symbols and relationships. It does not install dependencies, execute repository code, or run the repository's tests.

The analysis is bounded for large repositories. Current limits include up to 25,000 filesystem entries, 15,000 route/entity scan files, 5,000 Tree-sitter files, and 512 KB per file. These limits prevent unbounded work but mean a report is not necessarily exhaustive.

### 3. Task generation

The user selects completed analyses and chooses OpenRouter or Ollama. The backend verifies that the analyses match the project's pinned snapshots and forwards bounded source context to the AI service. Context selection uses keyword, structure, and static-graph retrieval; it is not vector semantic search. The AI service requests structured output, validates it, and returns candidate tasks with evidence references. A reviewer edits and saves candidates as versioned task drafts.

OpenRouter sends selected repository excerpts to a hosted model. Ollama can process them through a configured local model. Provider availability, output quality, and quota remain external dependencies.

### 4. Reference generation and review

Reference generation inherits the task's selected provider and pins the task version and source baseline. The AI service returns a plan, repository-specific patches, and proposed public tests. The backend validates response shape, repository IDs, and paths, applies narrow mechanical diff normalizations where possible, and runs `git apply --check` against the pinned source before a reference can enter review.

Review application uses a separate copy of the pinned snapshot; it does not modify the original checkout. The reviewer can download the resulting workspace. **Reference build/test validation is currently manual**: ForgeBench does not run arbitrary repository scripts during reference approval. The reviewer must inspect the workspace, run the suggested commands in a controlled environment, and record the results. Approval is gated on recorded passing build and test results.

This gate establishes that a diff applies, and that a reviewer recorded successful commands. It does not independently prove that generated tests cover the requirements or that the implementation is correct.

### 5. Agent execution and evaluation

The user selects an approved task and exactly two ready agents. The backend persists assignments and queues separate jobs. Each execution receives its own copy of the same pinned source and the public task requirements. Built-in Gemini CLI, Antigravity, Claude Code, Codex, and Harbor Baseline profiles use the dedicated Harbor runner; custom direct-CLI profiles use the validation runner. ForgeBench collects a real Git diff as the submission. An empty or invalid patch does not start evaluation.

For a submitted patch, evaluation creates a new isolated workspace from the same pinned source, applies the patch, and runs configured setup, build, public-test, and hidden-test commands through the validation runner. Execution and evaluation evidence are separate. A Harbor reward is not the ForgeBench score.

The score weights are: patch validity **10**, build/type-check **10**, public/regression tests **20**, and hidden-test correctness **60**. If tests are absent or a test command fails, that category earns zero; absence is not a pass.

## Active showstoppers and high-priority gaps

| Priority | Issue | Current evidence and impact | Required next step |
| --- | --- | --- | --- |
| **P0 — benchmark validity** | The observed Product Search task has no usable test evidence. | Jest checked 37 backend files and found no matching `*.spec.ts` files; `npm --prefix backend test` exited 1. No hidden tests were configured. The Gemini score was 20/100 (patch 10, build 10, public tests 0, hidden tests 0). The feature's behavior is unverified. | Add task-specific public tests and approved hidden tests. Run them on the unmodified baseline/reference first, then rerun both agents against the same pinned task and test-suite versions. |
| **P0 — provider availability** | Hosted-model capacity and quotas can prevent a benchmark from finishing. | The Product Search Antigravity run ended after about 6m57s with HTTP 503 `ApiOverloadedError` and no patch. Gemini logs also showed a quota/rate-limit response (HTTP 429), although Gemini returned a patch. These are provider failures, not build/test results. | Retry after capacity recovers or use an available model/provider. Record model, provider response/finish reason, and usage/quota details for each run. |
| **P0 — exposed credential follow-up** | A Gemini API key was pasted into an earlier conversation. | The key value is intentionally not repeated here. Treat it as compromised unless it has already been revoked. A key placed in an ignored local `.env` is still not safe if it was previously exposed elsewhere. | Revoke/rotate it with the provider, update the local secret store, and verify no live key is present in tracked files or history. |
| **P1 — reference patch reliability** | AI-generated diffs have repeatedly been malformed or incompatible with the pinned source. | Incidents include placeholder patches, truncated JSON, invalid paths, missing diff headers, corrupt hunk counts, overlapping hunks, and context mismatches. Several OpenRouter versions failed preflight; one retained patch duplicated existing code and assumed source context that was absent. Git preflight prevents unsafe application, but cannot make a rejected reference useful. | Keep preflight and failed-output retention enabled. Add bounded repair using exact pinned source, then require a successful preflight and independent human review. Do not equate `patch_format: passed` with a patch that applies or is correct. |
| **P1 — not yet a diverse, stable agent comparison** | The two smoke-tested profiles use the Gemini provider, so they are not independent provider comparisons; other built-in profiles are not ready without their credentials. | Gemini CLI and Antigravity both use Gemini credentials. Claude Code needs `ANTHROPIC_API_KEY`; Codex needs `OPENAI_API_KEY`. Harbor Baseline remains offline and duplicates the Gemini CLI path. | Configure and smoke-test genuinely distinct providers/models, or describe the result as an adapter/model comparison rather than a provider comparison. Remove or clearly label the duplicate offline Baseline profile. |
| **P1 — no frontend automated tests** | The frontend has no configured test command and no matching `.test`/`.spec` files. | `apps/frontend/package.json` contains build/dev/preview scripts only; a workspace search found no frontend test/spec files. The frontend production build has passed, but UI behavior has no automated regression coverage. | Add a frontend test runner and focused component/API-flow tests; add end-to-end coverage for task/reference/benchmark paths when stable. |
| **P1 — reference validation is manual** | The reference approval flow records reviewer-entered build/test results instead of executing them in ForgeBench. | This is an intentional safety boundary for arbitrary repository scripts, but it does not meet the plan's fully automated reference-validation workflow. Manual evidence can be incomplete or incorrectly recorded. | Add an isolated, resource-limited reference-validation job using the same pinned baseline and test-suite version. Keep explicit reviewer approval and preserve raw command output. |
| **P1 — prototype security posture** | The application is intended for local development, not untrusted multi-user or production use. | The stack binds services to localhost, but API-level authentication/reviewer identity is absent. Reference approvals are not tied to an authenticated reviewer. Agent/provider network access can expose repository context to hosted providers; Harbor networking is task-wide when enabled. The validation runner needs Docker access to create isolated execution containers. | Before exposing it beyond a trusted local machine: add authentication/authorization and audit identity, tighten network and secret policies, review Docker-host access, and document provider data sharing. |
| **P1 — database schema safety** | TypeORM `synchronize: true` is enabled for development. | This can mutate schema automatically and is unsuitable for production data. The implementation plan calls for schema migrations and `synchronize: false`. | Retain synchronization only for disposable local development; use reviewed migrations with synchronization disabled for any shared or production database. |
| **P2 — analysis and retrieval coverage** | Analysis is static and bounded, and task context retrieval is lexical/structural. | Large repositories can hit scan caps; the report does not imply full semantic understanding, test coverage, or successful builds. Embeddings/vector retrieval are not implemented. | Surface truncation and coverage prominently; prioritize relevant paths per repository; add semantic retrieval only with measurable relevance tests. |
| **P2 — dependency risk not triaged** | An earlier benchmark install emitted npm audit summary counts of 73 backend and 28 frontend advisories. | These are historical install-time counts, not a current verified vulnerability assessment; severity and exploitability were not triaged. | Re-run an audit against the exact pinned dependency tree, review direct/transitive advisories, and record accepted exceptions before external deployment. |
| **P2 — failure forensics** | Some older failed reference records did not retain the generated patch body or model metadata. | That prevents reconstruction of the exact defect for those versions. Later work added retention for some failures, but historical records remain incomplete. | Persist redacted provider/model/finish metadata, normalized and original patch output, preflight diagnostics, and bounded request/response evidence for every attempt. |

## Evidence snapshot

### Observed Product Search benchmark

- **Antigravity:** HTTP 503 provider overload after about 6m57s; no patch artifact; no evaluation created.
- **Gemini CLI:** valid non-empty patch submitted; backend and frontend builds passed; public Jest command exited 1 after about 765 ms because no files matched; hidden tests were empty/not configured.
- **Score:** 20/100. This is patch/build evidence only, not behavioral correctness.
- **Important distinction:** a Jest command existing in `package.json` does not mean tests exist. “No tests found” is a failed/unverified test run, not a passing empty suite.

The complete run diagnosis, score details, adapter configuration, and troubleshooting steps are in [Agent Execution and Evaluation](./agent-execution-evaluation.md).

### ForgeBench's own checks

| Check | Latest recorded result | What it proves—and does not prove |
| --- | --- | --- |
| Backend Jest suite | **49 passed** in 8 suites (rechecked 2026-11-24) | Covers the backend tests in this repository; it does not test generated features in external target repositories. |
| Validation-runner tests | **20 passed** in the latest recorded run | Covers runner behavior and regression cases; does not prove every Harbor/provider combination works. |
| AI-service tests | **21 passed** in the latest recorded run | Covers provider/schema and analyzer behavior; mocked provider tests are not live-provider reliability evidence. |
| Frontend production build | Passed in the latest recorded run | Type-checks/builds the UI; there is no frontend automated test suite. |
| Current local services | Backend and AI health `ok`; frontend HTTP 200; Compose services healthy at check | Confirms local processes are responding, not that external provider calls or benchmark tasks will succeed. |

These are ForgeBench implementation tests. They must not be presented as the Product Search target repository's test coverage.

## Project history: major failures and what changed

| Phase | Failure or limitation encountered | Change/status |
| --- | --- | --- |
| Foundation and GitHub setup | Public GitHub API quota exhaustion returned HTTP 403 and initially appeared as a generic backend 500. A large repository's branch list also took about 20 seconds to load. | Optional authenticated GitHub requests and actionable rate-limit errors were added. Large branch lists remain slower than small repositories. |
| Repository analysis | A traversal order exhausted scan limits before reaching important server/API paths, producing zero detected routes for a large repository. | Traversal prioritization and metadata scan coverage were improved; route/entity summary counts and truncation limits are now explicit. Analysis remains bounded/static. |
| Task generation | Provider selection/configuration, schema mismatches, Ollama latency, output truncation, and invalid JSON blocked early runs. | OpenRouter/Ollama dispatch, stricter structured output, validation, and clearer provider errors were added. The small local Ollama model was too slow/unreliable for some large outputs; live provider behavior still varies. |
| Reference generation | Model output included placeholder or incomplete implementations; some Ollama responses timed out or hit output limits; OpenRouter patches failed path, header, hunk, or source-context checks. | Response validation, pinned-snapshot Git preflight, isolated apply workspaces, bounded mechanical normalization/repair, and incident logging were added. These safeguards prevent unsafe application, but generated references still need successful preflight and human review. See [Reference Patch Application Failure Report](./reference-patch-application-failure-report.md). |
| Agent execution | Initial profiles were placeholders/direct-CLI setups that did not start correctly; Harbor had to be integrated as a separate runner with the correct Python runtime and Docker task setup. | Built-in Gemini CLI, Antigravity, Claude Code, and Codex profiles were moved to Harbor-native adapters; patch collection and provider error reporting were fixed. Gemini and Antigravity small smoke runs produced patches, but larger runs remain subject to provider capacity and task-specific tests. |
| Benchmark evaluation | A real run showed that builds can pass while behavioral verification is impossible because the target has no test specs or hidden suite. Provider 503/429 errors also prevent some executions. | Execution/evaluation evidence is separated, no-patch runs do not receive a test score, and the score treats absent tests as zero. The test corpus and provider readiness are still the blockers to trustworthy comparisons. |

Older detailed documentation:

- [Task Generation: Complete Flow](./task-generation.md)
- [Reference Solution Generation and Review](./reference-solutions.md)
- [Reference Solution Testing](./reference-solution-testing.md)
- [Reference Patch Application Failure Report](./reference-patch-application-failure-report.md)
- [Agent Execution and Evaluation](./agent-execution-evaluation.md)
- [Backend Guide](./README.md)

## Recommended order of work

1. **Rotate exposed credentials** and verify all current keys are held only in ignored local secrets or a proper secret manager.
2. **Make the benchmark measurable:** add public tests and hidden acceptance tests for Product Search; prove the tests pass on the approved reference and fail appropriately on the baseline.
3. **Run two available agents** against the same pinned task/test version after provider capacity recovers. Record raw logs and compare complete scores, not just patches or Harbor rewards.
4. **Stabilize reference generation:** keep exact failed outputs and model metadata, make repair source-grounded, and require Git preflight before review.
5. **Add frontend and end-to-end tests** for the main user workflows; preserve the passing backend, AI-service, and runner suites.
6. **Automate reference validation safely** in a restricted container, while retaining human approval.
7. **Harden before sharing/deployment:** disable schema synchronization, add identity/authorization, review dependency advisories, and tighten provider/network/secret controls.

## Readiness statement

ForgeBench is usable as a **local prototype** for project setup, source analysis, task/reference workflows, and Harbor-backed agent execution. It is **not yet ready to claim reliable feature correctness or production readiness**. The immediate benchmark showstopper is the absence of meaningful public and hidden tests for the observed task; provider capacity and exposed-key rotation are additional operational/security blockers. Until these are resolved, a score or generated patch must be reported with its raw evidence and limitations.
