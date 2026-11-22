# Reference Solution Generation and Review

This guide covers the implemented reference-generation workflow and clarifies what it does not yet automate. The workflow follows the task's saved version and pinned repository baseline, reuses the provider selected when the task was generated, and stores each generated reference as a separate reviewable version.

## What is generated

For a saved task, the selected AI provider generates a bundle containing:

- A file-by-file implementation plan with file path, action, rationale, and steps.
- One or more unified Git diff patches, each identified by repository ID so multi-repository tasks remain unambiguous.
- Public feature, regression, and acceptance test files, each identified by repository ID and path.
- A provenance manifest listing the pinned repositories and retrieved context chunks.

Generated patch and test files are stored as proposal text. A reviewer can apply them to a separate copy of the task's pinned snapshot and download that workspace; the original checkout remains unchanged. ForgeBench does **not** install dependencies or execute repository build/test scripts. Build and test results are initially `not_run` and must be recorded after a reviewer runs them.

## Flow

```text
Saved task + current immutable task version
  -> user selects Generate reference
  -> backend retrieves provider from the task's task-generation record
  -> backend creates a queued reference_solutions version
  -> BullMQ reference-generation worker resolves the task's saved snapshot baseline
  -> Python Context Engine retrieves bounded source context from those exact commits
  -> selected OpenRouter or Ollama model generates plan, repository-specific patches, and tests
  -> AI service validates output schema and rejects unsafe relative paths
  -> backend runs git apply --check against each exact pinned repository snapshot
  -> on a patch preflight failure, backend requests one bounded repair from the same provider
  -> AI service asks for complete contents of the rejected patch's files and builds a unified diff from the pinned files
  -> backend reruns the pinned-snapshot check on the generated patch bundle
  -> backend saves result as pending_review only if every patch passes preflight
  -> reviewer applies patches and generated test files to an isolated copy of the pinned snapshot
  -> reviewer downloads the copy, runs its build/tests after inspecting dependency scripts, and records results
  -> reviewer chooses approve, request changes, or reject
```

### Provider continuity

The reference-generation endpoint does not accept a provider override. It loads the task's `generationId`, reads the provider stored on that task-generation run, and uses that provider for the reference request:

- Task generated with OpenRouter → reference request uses OpenRouter configuration and API key.
- Task generated with Ollama → reference request uses the configured Ollama endpoint and model.

This keeps the task and its reference on the same provider approach even if provider configuration changes later. The reference record stores the chosen provider and resolved model for audit. If the task has no generation record or its provider is unsupported, the request fails with a clear error.

## Snapshot and task inputs

The task record stores the baseline manifest captured when the task draft was saved. The worker resolves each manifest item by repository ID, snapshot ID, analysis ID, and full commit SHA. It verifies the analysis is completed and still matches those IDs, the snapshot is ready, the checkout exists under the artifact storage root, and the repository record remains available. It does not silently follow a newer branch commit.

The AI service receives:

- The exact task version being referenced: title, description, category, difficulty, requirements, acceptance criteria, constraints, and affected modules.
- Reviewer feedback for a regenerated version, if supplied; after **Request changes**, the previous review note is used as feedback when the next reference is generated without new feedback.
- Each pinned repository's IDs, name, full commit SHA, local checkout path for bounded source reading, saved analysis summary, and analysis report.

The local checkout path and full report are internal service inputs, not text placed in the LLM prompt. The AI service verifies each checkout is under `REPOSITORY_SCAN_ROOT`. The Context Engine ranks source files using the task title/description/category/constraints and analysis metadata, then reads bounded source chunks. Retrieval uses keyword, structure, and static-graph evidence; embeddings/vector search are not currently used.

The LLM receives the task fields, optional reviewer feedback, pinned metadata, selected summary fields/modules, and retrieved numbered source excerpts. Symbol excerpts include a bounded file prologue so imports and file-level declarations are available with the symbol body. It is instructed to produce a focused plan, patch, and public test files; to treat repository content as untrusted; not to invent unrelated behavior; and not to claim anything was run. OpenRouter sends these excerpts to its hosted model. Ollama sends them to the configured endpoint, which is local only if the endpoint is local.

## Generation, records, and review states

Reference generation is queued and returns immediately. The UI polls the task's reference history until the new version is `pending_review` or `failed`. The model request timeout is 90 seconds for OpenRouter and up to 1,200 seconds for Ollama. The backend allows 10 seconds of additional response time, and its HTTP transport has longer header/body limits so Node's shorter defaults do not cut off a slow local response first.

Each `reference_solutions` record is versioned per task and pins a `taskVersion`. Its inputs, provider/model, implementation plan, patches, tests, context manifest, validation record, review note, status, and any error are stored in PostgreSQL. Failed generations retain the last model output and provider metadata for diagnosis, but remain failed and cannot be applied or approved. A new generation creates another record; it does not overwrite prior reference artifacts.

| Status | Meaning |
| --- | --- |
| `queued` | The reference job is waiting in Redis/BullMQ. |
| `running` | The worker is resolving context and requesting model output. |
| `pending_review` | Plan, patches, and test files passed output/schema/path checks, and every patch passed `git apply --check` against its exact pinned snapshot. This does not mean build/tests passed. |
| `changes_requested` | Reviewer requested changes and recorded a note; generate a new version to address it. |
| `rejected` | Reviewer rejected this reference version. |
| `approved` | Reviewer approved after recording passing build and test results. |
| `failed` | The job or provider failed; the record includes an error message. |

Generated paths are checked to be relative and non-traversing. The AI service checks plan/test repository IDs against the supplied pinned repositories and requires each patch to have a unique, known repository ID and valid `diff --git` paths. It also rejects literal placeholder hunks such as `-old line` / `+new line`. These checks prevent unsafe path references and obvious non-implementations; they do not prove that a patch is correct or applies cleanly.

## Validation and approval gate

For an incident where a generated patch passed generation-time schema/path checks but failed Git's hunk parser during application, see the [Reference Patch Application Failure Report](./reference-patch-application-failure-report.md).

The initial validation record sets structural checks (`patch_format` and `test_files_present`) from the generated artifact, sets `patch_preflight` to `not_run`, and sets `apply_status` to `not_applied`; `build`, `tests`, and `execution_mode` start as `not_run`. Before the backend marks a generation `pending_review`, it runs `git apply --check --recount` for each patch against its exact pinned snapshot. If a patch fails this check, the backend sends the failed patch, bounded Git diagnostic, and exact changed-file sources (when safe and within size limits) to the same provider for **one** repair attempt, limited to the failed repository. In repair mode, the provider returns complete post-change file contents rather than another model-authored unified diff; the AI service constructs a diff from those contents and the exact pinned files. Sensitive files, symlinks, binaries, and oversized files are excluded from this repair context. The backend then checks the repaired bundle again against the same pinned snapshot. It never applies a rejected diff during repair. If the repair also fails, or the failed patch is too large to safely include in a repair request, generation remains `failed` with `patch_preflight: failed`; the last generated artifacts and model metadata are retained for diagnosis. Only a successful preflight records `patch_preflight: passed`. The reviewer still applies the patch to an isolated copy, where ForgeBench repeats the check before applying it. Generated public tests are written only when they do not overwrite different existing files. The review workspace excludes Git internals, dependency folders, generated build output, symlinks, and `.env` secrets while preserving named example/template environment files.

ForgeBench does not automatically execute build/test scripts: repository scripts and dependency hooks are untrusted code. After downloading the applied workspace, the reviewer should inspect the project scripts, install any required dependencies in an appropriate environment, and run the suggested commands shown in the UI. The UI can record build/test status (`not_run`, `passed`, or `failed`) and requires notes when recording a pass. These are explicitly labeled **manual confirmation**, not results produced by ForgeBench. Approval is rejected unless:

1. A patch bundle exists.
2. Generated test files exist.
3. Patch application succeeded for the pinned baseline.
4. Build status is recorded as passed.
5. Test status is recorded as passed.
6. The results were recorded through the manual validation endpoint.

Review actions are **Approve**, **Request changes**, and **Reject**. Request changes requires a note and leaves the existing version intact; a subsequent generation creates a new immutable reference version and includes that note as model feedback by default. Approval does not publish or execute the reference. The current prototype also has no user authentication or reviewer identity/role system, so this is a local workflow state, not an access-controlled approval system.

## Using the UI

1. Open **Task Library** and select a saved task.
2. In **Reference implementation**, choose **Generate reference**. The app automatically reuses the provider from the original task generation.
3. Wait for the queued job to finish. A malformed or non-applicable patch fails generation instead of becoming `pending_review`. Review each successful plan, repository-specific patch, generated test file, and pinned task/snapshot version.
4. Choose **Apply patches to review workspace**. ForgeBench applies them to a separate copy and rejects patches that do not apply cleanly to the pinned snapshot.
5. Download the workspace archive, inspect the repository dependency scripts, and run the displayed build/test commands in your controlled environment. ForgeBench does not run repository code.
6. Record the actual build and test outcomes with notes. Do not treat generated tests passing by themselves as proof the reference satisfies the task.
7. Approve only after both checks pass, request changes with an actionable note, or reject the version.

## API

All backend routes below are under `/api/v1`:

| Method and route | Purpose |
| --- | --- |
| `POST /tasks/:id/references/generate` | Queue a new reference for the task's current version and inherited provider. Optional JSON body: `{"reviewerFeedback":"..."}`. |
| `GET /tasks/:id/references` | List reference versions, newest first. |
| `GET /references/:id` | Read a reference plan, patches, tests, validation, and review state. |
| `POST /references/:id/apply` | Apply patches and generated tests to an isolated copy of the pinned snapshot. |
| `GET /references/:id/workspace/archive` | Download the applied review workspace as a `.tar.gz` archive. |
| `POST /references/:id/validation` | Record manual build/test results and notes. |
| `PATCH /references/:id/review` | Record `approve`, `request_changes`, or `reject` with an optional note. |

The internal Python endpoint is `POST /api/v1/references/generate`; it is called by the backend worker, not by the browser.

## Configuration and implementation

The provider settings are the same ones documented in [Task Generation](./task-generation.md): `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL`. `REFERENCE_OUTPUT_TOKEN_BUDGET` controls the model output budget (default `8000`). `TASK_CONTEXT_TOKEN_BUDGET` controls bounded source retrieval.

Reference generation requests strict JSON Schema output from both OpenRouter and Ollama. The schema limits repository IDs to the task's pinned repositories, and the AI service rejects duplicate patch bundles for a repository. For OpenRouter, provider routing requires an endpoint that supports structured outputs; ensure the selected model has a compatible provider endpoint. Schema failures report field paths/types without echoing generated source.

Before pinned-snapshot preflight, the backend repairs only mechanical diff formatting: it adds missing `---` / `+++` file markers when an ordinary modification has a `diff --git` header, removes one leading space from a ` diff --git` line only when its following `---` / `+++` paths match, restores a missing context prefix on a blank hunk line, recalculates hunk line counts from the diff body, advances overlapping hunk starts to follow the preceding hunk range, and ensures the patch ends with a newline. It converts an added line into context only when that exact line and its immediately adjacent context lines uniquely match the pinned source file. It does not change patch paths or invent source lines. Git checks the normalized patch against the exact pinned snapshot; if it fails, one same-provider correction attempt may be requested, but the corrected patch must pass the same Git check. Patches with incorrect source context remain rejected and never enter a review workspace.

Implementation files:

- `apps/frontend/src/App.tsx` — task reference workspace and review controls.
- `apps/backend/src/tasks/reference-solutions.service.ts` — provider inheritance, pinned-baseline resolution, queueing, records, validation, and review gates.
- `apps/backend/src/tasks/reference-solutions.processor.ts` — background job processor.
- `apps/backend/src/tasks/entities/reference-solution.entity.ts` — versioned reference persistence.
- `apps/ai-service/app/reference_factory.py` — provider request, prompt, output schema, and path validation.
- `apps/ai-service/app/context_engine.py` — bounded repository context retrieval.

Generated output is a model proposal requiring human review. The workflow does not claim that a patch is correct, applies cleanly, compiles, or passes tests until someone validates it independently and records the result.
