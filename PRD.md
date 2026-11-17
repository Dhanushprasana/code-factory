# ForgeBench — Product Requirements Document

**Status:** Draft  
**Version:** 1.5  
**Last updated:** 2026-11-16  
**Product type:** Web application for creating and validating software-engineering benchmark tasks

## 1. Product summary

ForgeBench helps benchmark designers turn real software repositories into realistic, reproducible coding tasks for AI coding agents. A complete task package should include clear instructions, measurable acceptance criteria, a pinned starting repository version, a working reference implementation, feature and regression tests, an execution environment, and validation evidence.

The product is intended to make task creation repeatable and quality-controlled—not merely generate task descriptions. The current HTML prototype demonstrates the primary screens and browser-only interactions. Repository cloning, AI generation, test execution, mutation testing, Harbor export, and agent evaluation are illustrative and are not implemented by the prototype.

## 2. Problem and opportunity

Benchmark authors often create coding tasks manually. This makes it difficult to ensure that tasks are repository-grounded, consistently scoped, solvable in the target environment, and objectively testable. Weak tests may accept incorrect implementations, while poorly recorded starting versions make results hard to reproduce.

ForgeBench will guide task authors through a workflow that builds a complete package from a real codebase and verifies that the package is suitable for evaluation.

## 3. Vision

Enable a benchmark author to produce a trustworthy, version-pinned coding-task package from a supported repository, then inspect the evidence that the reference solution and tests behave as intended.

## 4. Goals and non-goals

### Goals

- Guide users from repository selection to a validated, exportable task package.
- Pin every package to an immutable repository commit and record relevant environment metadata.
- Generate specific, achievable requirements that match the repository's architecture and conventions.
- Include a reference implementation, feature tests, regression tests, and reproducible execution instructions.
- Demonstrate that tests detect meaningful incorrect behavior, using independent checks and mutation testing where supported.
- Make package status, validation evidence, and known limitations easy to understand.
- Provide a consistent adapter boundary for the supplied Harbor task interface.

### Non-goals for the initial release

- Building a general-purpose Git hosting service or source-code editor.
- Guaranteeing that AI-generated requirements or code are correct without human review and automated checks.
- Supporting every language, framework, test runner, mutation tool, or Harbor schema at launch.
- Running arbitrary repository code on the application server without isolation.
- Ranking commercial coding agents as a product objective. A later evaluation feature may execute configured agents under comparable conditions.
- Treating a generated draft or a static demo status as proof that a package passed real tests.

## 5. Users and primary needs

### Benchmark author / task designer

Needs to select a suitable repository, shape a feature request, review generated criteria, and package a task without manually assembling every artifact.

### Reviewer / quality engineer

Needs to inspect the task's scope, starting commit, reference changes, test coverage, execution logs, mutation findings, and unresolved warnings before approving it.

### Benchmark operator

Needs to distribute approved packages and, in a later phase, run the same task and hidden tests against different coding agents using a consistent environment and scoring policy.

## 6. Product principles

1. **Repository-grounded:** task content and implementation must fit the selected codebase.
2. **Reproducible:** record the exact starting commit and execution environment.
3. **Testable:** requirements must map to observable outcomes and checks.
4. **Independent evidence:** tests should not simply mirror the reference implementation's assumptions.
5. **Honest status:** clearly distinguish simulated, draft, running, passed, failed, and reviewed states.
6. **Meaningful challenge:** vary business rules, edge cases, and interactions—not just names or labels.
7. **Human control:** users can inspect and edit generated artifacts before approval.

## 7. Core user journey

1. The user adds a supported Git repository or selects a previously analyzed repository.
2. ForgeBench analyzes the selected commit and reports detected language, framework, dependencies, test commands, and relevant modules.
3. The user chooses a generation approach, feature area, difficulty, and optional product context or issue text.
4. ForgeBench proposes a task description and acceptance criteria grounded in the repository.
5. The user reviews and edits the proposed task. The system flags unclear, conflicting, unsupported, or untestable criteria.
6. ForgeBench prepares a reference implementation and independent feature/regression tests in an isolated worktree or environment.
7. ForgeBench runs required checks and presents evidence, logs, and warnings.
8. The user reviews and approves the task package.
9. The user exports the package in the configured Harbor-compatible format and can later find it in the package library.

## 8. Functional requirements

Priority key: **P0** = required for initial usable release; **P1** = important follow-up; **P2** = future enhancement.

### 8.1 Workspace and navigation

- **FR-001 (P0):** Provide clear navigation for Overview, Projects, Task Generator, Solution & tests, Task Packages, and Agent Evaluation. Projects is a portfolio view; manage repository connections, components, branches, pinned commits, and project-level scope inside each project. Shared task workflows must work across the project portfolio, while each individual task remains pinned to one project's selected component baselines. Present validation as a contextual quality-review step in the task/package workflow rather than a separate top-level destination.
- **FR-002 (P0):** Show task and repository status using explicit labels; do not imply real execution for demo or simulated data.
- **FR-003 (P1):** Provide global search and keyboard access to relevant workspace records.
- **FR-004 (P1):** Preserve usable layouts on desktop, tablet, and mobile viewports and support keyboard navigation.
- **FR-005 (P1):** Provide an all-projects workspace scope by default and let users filter shared task, package, and evaluation views to a selected project without changing the project's ownership of repository components.

### 8.2 Repository management

- **FR-010 (P0):** Accept a supported remote repository URL and validate its format before attempting access.
- **FR-011 (P0):** Record repository identity, provider, default branch, selected immutable commit SHA, detected language/framework, dependency metadata, and test commands.
- **FR-012 (P0):** Analyze a specific commit, not a moving branch head, and show the selected commit to the user before task creation.
- **FR-013 (P0):** Report analysis progress, detected capabilities, and actionable errors such as unsupported stack, missing tests, or inaccessible repository.
- **FR-014 (P1):** Allow users to choose a branch or commit and re-analyze it without silently changing existing package versions.
- **FR-015 (P1):** Support private repositories through a secure provider connection; credentials must never be embedded in exported packages or logs.
- **FR-016 (P1):** For GitHub, use a GitHub App installation/authorization flow rather than asking users to paste Personal Access Tokens. Let an authorized user select the organization/account and the specific repositories ForgeBench may access.
- **FR-017 (P1):** Request only repository metadata and contents read access for analysis and task creation. Request pull-request write access only as a separate, explicit capability when the user asks ForgeBench to open a PR; never grant merge/admin permissions by default.
- **FR-018 (P1):** Store provider credentials server-side in an approved secrets service; use short-lived installation tokens, encrypt at rest and in transit, redact from logs, rotate/expire where supported, and support disconnect/revocation with an auditable event.
- **FR-019 (P1):** Enforce the authorized repository allowlist on every clone, API request, branch lookup, code-view request, and PR operation. Do not treat a repository URL supplied by the browser as authorization.

### 8.3 Task generation and editing

- **FR-020 (P0):** Let the user select one project, one or more component baselines within it, a generation approach, feature area, difficulty, and optional context.
- **FR-021 (P0):** Generate a task title, background, scope, requirements, constraints, acceptance criteria, and expected verification approach.
- **FR-022 (P0):** Ground the proposal in relevant repository files and stack details. Keep references/evidence available to the reviewer.
- **FR-023 (P0):** Express acceptance criteria as observable behaviors, including relevant boundary cases and preservation of existing behavior.
- **FR-024 (P0):** Flag ambiguous, conflicting, excessively broad, unsupported, or untestable requirements and allow user edits before implementation generation.
- **FR-025 (P0):** Distinguish the three approaches: generate from repository context, generate from a supplied requirement, and convert issue text into a task.
- **FR-026 (P1):** Let users save a task as a draft and resume editing it later.
- **FR-027 (P1):** Show a task preview that accurately reflects the selected repository, language/framework, commit, criteria, and current status.

### 8.4 Reference implementation and tests

- **FR-030 (P0):** Produce a reference implementation against the pinned repository version using its supported language, dependencies, conventions, and test environment.
- **FR-031 (P0):** Produce feature tests that map to acceptance criteria and cover key positive, negative, and boundary cases.
- **FR-032 (P0):** Run the repository's existing regression suite and report whether existing behavior remains intact.
- **FR-033 (P0):** Keep evaluation tests separate from files or instructions given to an evaluated agent when hidden tests are required.
- **FR-034 (P0):** Reject or mark incomplete a package if its reference solution does not build or the required tests do not pass.
- **FR-035 (P1):** Track criterion-to-test mapping so reviewers can identify criteria with missing or weak coverage.

### 8.5 Validation and evidence

- **FR-040 (P0):** Run checks in an isolated, resource-limited environment with recorded setup and execution commands.
- **FR-041 (P0):** Validate requirement consistency and verify reference implementation build/test results.
- **FR-042 (P0):** Compare expected outputs against independent examples or specification-derived checks where applicable.
- **FR-043 (P1):** Run mutation testing or an equivalent test-strength check when supported; show killed, survived, and excluded mutants, not just a score.
- **FR-044 (P0):** Record logs, tool versions, durations, exit codes, test counts, and environment metadata in a validation report.
- **FR-045 (P0):** Present each check as not run, running, passed, failed, or needs review. A failed or unrun required check cannot be represented as validated.
- **FR-046 (P1):** Allow reviewers to rerun checks after changes and preserve earlier run history.

### 8.6 Package library and export

- **FR-050 (P0):** List task packages across projects with searchable title/ID, project and component scope, difficulty, baseline commit, and validation state.
- **FR-051 (P0):** Support package lifecycle states: Draft, Ready for validation, Validation failed, Validated, Needs review, and Archived.
- **FR-052 (P0):** Export the task instructions, Harbor task metadata, execution environment/setup, reference implementation, tests, repository/version metadata, and validation report required by the configured interface.
- **FR-053 (P0):** Validate exported package structure against the supplied Harbor interface/schema and display actionable schema errors.
- **FR-054 (P0):** Label a metadata-only draft export as incomplete; never present it as a complete evaluation-ready package.
- **FR-055 (P1):** Keep immutable package versions or audit history when an approved task is edited or regenerated.

### 8.7 Agent evaluation (later phase)

- **FR-060 (P2):** Allow configured coding agents to receive identical task instructions, starting commits, dependencies, resource limits, timeouts, and hidden tests.
- **FR-061 (P2):** Record reproducible run logs and scores with a documented weighting and partial-credit policy.
- **FR-062 (P2):** Make illustrative or sample evaluation data visually distinct from real executed results.

### 8.8 Agent connections, parallel runs, and submissions

- **FR-070 (P1):** Provide an agent registry for supported local CLIs, editor adapters, and configured local/model endpoints. Store secrets only through OS keychains or a managed secret store, never in task prompts or browser-local settings.
- **FR-071 (P1):** Launch selected agents concurrently against the same immutable task version, base commit, environment image, dependency set, resource limits, and test-suite version.
- **FR-072 (P1):** Give every agent an isolated disposable worktree/container. Prevent agents from reading or modifying other agents' workspaces, patches, or private test artifacts.
- **FR-073 (P1):** Record agent/model/adapter version, configuration, task version, base SHA, environment digest, start/end time, resource use, logs, and patch checksum for every attempt.
- **FR-074 (P1):** Treat each completed agent patch as a submission. Run the same frozen tests against each submission only after it is submitted; report build, feature, regression, security, and UI test outcomes separately.
- **FR-075 (P1):** Require a reviewer to inspect the patch and evidence before approval. Approval may create a pull request; it must not directly merge to the source repository by default.
- **FR-076 (P1):** Attach machine-generated evidence from the isolated runner, including test reports and logs. UI tasks should capture screenshots and, where useful, a browser video/replay from the test runner rather than relying on agent-provided recordings.
- **FR-077 (P1):** If task behavior or tests change, issue a new immutable benchmark/test-suite version and rerun all compared agents on that version. Do not tailor one test script to one model's implementation.

### 8.9 Specification provenance and test fixtures

- **FR-080 (P0):** Mark AI-generated specifications, reference patches, and tests as proposals until independently reviewed; generated artifacts must not certify themselves.
- **FR-081 (P0):** Record the human-approved requirements, independent expected examples, repository contracts, and reviewer decisions used as the specification oracle.
- **FR-082 (P1):** Provide test-fixture adapters for authentication flows. MFA verification must use a provider sandbox/test tenant, a disposable TOTP test secret with controlled time, or a fake SMS/email inbox; it must not depend on production credentials or real users' codes.
- **FR-083 (P1):** Redact fixture secrets, OTP values, and credentials from task prompts, screenshots, logs, traces, and exported artifacts.

### 8.10 Task publishing and versioning

- **FR-090 (P1):** Publish only after required specification, reference, test, environment, Harbor-schema, and evidence gates pass and authorized reviewers approve.
- **FR-091 (P1):** Treat published task versions and their test-suite hashes as immutable. Keep old versions available so prior evaluation results remain reproducible.
- **FR-092 (P1):** Use semantic versioning as a human-readable convention (major for incompatible spec change, minor for new expected behavior, patch for non-behavioral fixes), while also recording content hashes for the actual specification, tests, base commit, and environment image.
- **FR-093 (P1):** Store solution attempts independently from task-package versions; never overwrite another agent's submission or the canonical reference patch.

### 8.11 Repository feature and module explorer

- **FR-100 (P1):** After a repository snapshot is analyzed, present a detailed overview tied to its exact commit, including detected stack, entry points, dependency/test tooling, and analysis timestamp.
- **FR-101 (P1):** Extract an inventory of existing user-facing features and map each feature to relevant routes, domain modules, data-access modules, and existing tests. Mark inferred or low-confidence mappings for review.
- **FR-102 (P1):** Provide a navigable, indented file structure and a read-only code viewer that serves files from the selected pinned repository commit and respects repository permissions.
- **FR-103 (P1):** Visualize feature/module dependency and call relationships as an interactive graph. Allow users to filter by feature/layer, select nodes, and inspect linked files/tests and likely regression impact.
- **FR-104 (P1):** Allow a selected feature/module to be carried into task generation as context, while clearly distinguishing repository facts from AI-generated interpretation.
- **FR-105 (P1):** Display analysis limitations, unsupported file types, truncated scans, and provenance/confidence for extracted feature mappings. Do not present an incomplete scan as a complete architecture or security audit.

### 8.12 Projects and multi-repository components

- **FR-110 (P1):** Introduce a Project entity that groups repositories by product/workspace without requiring them to be in the same Git repository.
- **FR-111 (P1):** Allow a project to contain independently configured components such as frontend, backend, data engineering, and supporting services. Each component records provider/repository URL, role, branch, pinned commit SHA, stack, environment, and analysis status.
- **FR-112 (P1):** Let a task author explicitly select which project components are in scope. Persist an immutable baseline manifest of each included repository, branch, commit SHA, and environment; excluded components must be explicit where relevant.
- **FR-113 (P1):** Provision one isolated multi-repository workspace per agent attempt, materializing the same included component manifest for every selected agent.
- **FR-114 (P1):** Present submission changes grouped first by agent and then by repository/component, preserving file status, line diff, base commit, and patch checksum. Support changed-file navigation and unified/split views.
- **FR-115 (P1):** Provide project-level comparison across all component patches while retaining each repository's independent branch and commit history. Approval must create reviewable changes per repository (for example, pull requests) and must not silently merge unrelated repositories.
- **FR-116 (P1):** Run integration checks against the assembled multi-repository workspace as well as repository-specific tests, and attach results to the project baseline manifest and task version.

## 9. Package contents

An evaluation-ready package should include, subject to the exact supplied Harbor schema:

- Task instructions and acceptance criteria.
- Harbor task metadata/configuration.
- Pinned source repository URL/identity, commit SHA, and relevant license/attribution metadata.
- Environment definition and setup/test commands.
- Reference implementation patch or equivalent answer key.
- Feature tests and regression test instructions; hidden tests stored separately when required.
- Validation report with evidence and warnings.
- Package version and generation metadata.

The exact file names and required fields must be confirmed against the Harbor version used by the project. Illustrative prototype filenames are not a substitute for schema validation.

## 10. User experience requirements

- Keep the primary workflow discoverable from the Overview and Task Generator.
- Use progressive disclosure: configure a task first, then review requirements, solution/tests, and validation details.
- Keep primary actions visible and label actions by their real effect (for example, “Save draft” versus “Export package”).
- Show a progress indicator for long-running repository analysis and validation jobs, with cancellation where feasible.
- Use clear empty states, inline validation, helpful error recovery, and confirmation before destructive actions.
- Ensure text contrast, focus visibility, semantic headings, labeled inputs, and status announcements for assistive technology.
- Avoid using color alone to convey status.

## 11. Data entities (initial conceptual model)

- **Project:** product/workspace name, description, owner, and linked repository components.
- **Project component:** project ID, role (frontend/backend/data/service), repository identity, branch, pinned commit SHA, stack/environment, and inclusion status for each task.
- **Repository:** provider, URL, display name, branch, commit SHA, detected stack, analysis status, analysis report.
- **Task draft:** ID, title, description, approach, feature area, difficulty, context, criteria, evidence references, owner, timestamps.
- **Task package version:** task ID/version, pinned repository commit, artifacts, schema version, lifecycle status.
- **Validation run:** package version, environment/tool versions, checks, logs, outcomes, timestamps, mutation details.
- **Evaluation run (later):** package version, agent/version, environment, execution logs, test outcomes, score policy/results.
- **Agent submission:** agent adapter/model version, project baseline manifest, per-repository patch(es), patch hashes, test/evidence bundle, and review/approval state.

## 12. Non-functional requirements

- **Security:** Execute untrusted repository code only in isolated, disposable environments. Apply CPU, memory, disk, network, and time limits. Do not expose host secrets or unrestricted network access.
- **Repository access security:** Keep GitHub App private keys and installation tokens out of the browser and agent prompt/workspace. Scope credentials to selected repositories; use read-only access for analysis, separate PR permission, organization policy checks, auditable access, and revocation. Test containers must not inherit repository credentials and should have network access disabled or tightly allowlisted by default.
- **Privacy:** Secure repository credentials and provider tokens; redact secrets from logs; define retention and deletion policies.
- **Reliability:** Persist task drafts and job outcomes; make long-running jobs recoverable or clearly failed rather than silently stuck.
- **Reproducibility:** Store immutable commit IDs, dependency lock/configuration data, environment image/tool versions, commands, and relevant random seeds.
- **Performance:** Target under 2 seconds for normal page navigation and feedback; show asynchronous progress for repository analysis, builds, and tests rather than blocking the UI.
- **Accessibility:** Target WCAG 2.2 AA for core workflows, including keyboard-only use and screen-reader status updates.
- **Compatibility:** Support current major desktop browsers and responsive mobile layouts. Supported repository languages/frameworks must be explicitly listed.
- **Auditability:** Maintain timestamps and actor/action history for material changes to approved packages and validation evidence.

## 13. Success metrics

### Product adoption and workflow

- Task-generation completion rate: percentage of started drafts that reach package validation.
- Median time from repository selection to validated package.
- Draft abandonment rate and the workflow step where users stop.
- Percentage of generated criteria accepted with minimal edits, interpreted alongside reviewer quality ratings.

### Package quality

- Percentage of packages pinned to immutable commits.
- Reference implementation build and test pass rate.
- Percentage of criteria with mapped feature tests.
- Regression-suite pass rate.
- Mutation score and surviving-mutant review rate where mutation testing is supported.
- Package schema validation pass rate.
- Reviewer rejection rate and top rejection reasons.

Metrics must be based on real runs. Prototype/sample values must not be reported as production outcomes.

## 14. MVP acceptance criteria

The MVP is acceptable when a user can:

1. Add or select a supported repository and pin a commit SHA.
2. See detected stack and available test commands or a clear analysis failure.
3. Generate and edit a repository-aware task proposal with measurable criteria.
4. Produce a reference implementation and feature/regression tests in the repository's supported environment.
5. Run required checks in isolation and inspect actual logs and outcomes.
6. See incomplete/failed checks clearly and prevent failed packages from being marked validated.
7. Export a package that passes validation against the configured Harbor schema.
8. Reopen a package and inspect its source version, artifacts, and validation report.

A static UI with simulated outputs does not satisfy this MVP; it is a clickable prototype only.

## 15. Release outline

### Phase 0 — Interactive prototype

Current HTML experience: navigation, task template previews, browser-local draft storage, filters, and JSON metadata export. Repository analysis, AI generation, tests, mutation checks, Harbor packaging, and agent scoring are simulated/not implemented.

### Phase 1 — Task authoring MVP

Support one or two defined language/framework combinations, real repository checkout at a pinned commit, task draft review/editing, reference/test generation, isolated execution, validation evidence, and schema-checked Harbor export.

### Phase 2 — Quality and scale

Add more stacks, stronger requirement/test mapping, mutation testing, review/approval workflow, access control, run history, private repository integration, and improved package versioning.

### Phase 3 — Parallel agent evaluation and publishing

Add GitHub/agent adapters, isolated parallel runs, submission review, evidence capture, immutable task/test releases, human-approved PR creation, hidden-test evaluation, reproducible scoring, and comparative result reporting.

## 16. Risks and mitigations

- **Vague or hallucinated requirements:** require human review, repository evidence, ambiguity checks, and criterion-level test mapping.
- **Tests that validate the same mistaken assumption as the answer key:** use independent expected outputs, boundary examples, regression tests, and mutation analysis.
- **Unsupported or unbuildable reference patch:** establish supported stacks, verify a clean baseline first, and fail clearly when the environment cannot reproduce.
- **Untrusted code execution:** use disposable sandboxing, strict resource/network policy, and secret isolation.
- **Harbor schema mismatch:** version the adapter and validate every export against the actual supplied interface/schema.
- **False confidence from demo data:** visibly mark simulated data and ensure only recorded execution results can become Passed/Validated.
- **Scope expansion across languages and agent providers:** launch with a deliberately limited compatibility matrix and expand based on usage.

## 17. Assumptions and open questions

1. Which Harbor version and exact task/package schema must the exporter support?
2. Which repository providers are required at launch, and are private repositories in scope?
3. Which language/framework/test-runner combinations are the initial supported matrix?
4. Which model providers or local models may be used for task, solution, and test generation?
5. What sandbox technology and network policy are available in the target deployment?
6. Should the reference implementation and tests be included in exported packages, stored separately, or split between visible and hidden artifacts?
7. What review/approval roles, access controls, retention limits, and audit requirements apply?
8. Which mutation-testing tools are acceptable for each supported stack, and is mutation testing mandatory or conditional?
9. What scoring policy, timeout, retry, and flaky-test rules should agent evaluation use?
10. What repository license and source redistribution constraints apply to generated benchmark packages?

## 18. Current prototype reference

The current single-page prototype is [index.html](index.html). Projects own their repository components and pinned baselines; quality checks are reached from the task workflow rather than the primary navigation. It demonstrates selected front-end interactions, including task drafting, search/filter, local draft storage, and metadata export. Treat all repository details, quality results, activity, and agent scores shown as sample content unless backed by real execution records.
