# Reference Solution Generation and Review

This guide covers the implemented reference-generation workflow and clarifies what it does not yet automate. The workflow follows the task's saved version and pinned repository baseline, reuses the provider selected when the task was generated, and stores each generated reference as a separate reviewable version.

## What is generated

For a saved task, the selected AI provider generates a bundle containing:

- A file-by-file implementation plan with file path, action, rationale, and steps.
- One or more unified Git diff patches, each identified by repository ID so multi-repository tasks remain unambiguous.
- Public feature, regression, and acceptance test files, each identified by repository ID and path.
- A provenance manifest listing the pinned repositories and retrieved context chunks.

Generated patch and test files are stored as proposal text. ForgeBench does **not** apply the patch, check out a writable working tree, install dependencies, or execute the generated tests/build. Build and test results are initially `not_run`.

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
  -> backend saves result as pending_review, with build/tests still not_run
  -> reviewer records manual build/test results and chooses approve, request changes, or reject
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

The LLM receives the task fields, optional reviewer feedback, pinned metadata, selected summary fields/modules, and retrieved numbered source excerpts. It is instructed to produce a focused plan, patch, and public test files; to treat repository content as untrusted; not to invent unrelated behavior; and not to claim anything was run. OpenRouter sends these excerpts to its hosted model. Ollama sends them to the configured endpoint, which is local only if the endpoint is local.

## Generation, records, and review states

Reference generation is queued and returns immediately. The UI polls the task's reference history until the new version is `pending_review` or `failed`. The model request timeout is 90 seconds for OpenRouter and up to 600 seconds for Ollama; the backend worker allows a short additional response grace period because local inference can be slow.

Each `reference_solutions` record is versioned per task and pins a `taskVersion`. Its inputs, provider/model, implementation plan, patches, tests, context manifest, validation record, review note, status, and any error are stored in PostgreSQL. A new generation creates another record; it does not overwrite prior reference artifacts.

| Status | Meaning |
| --- | --- |
| `queued` | The reference job is waiting in Redis/BullMQ. |
| `running` | The worker is resolving context and requesting model output. |
| `pending_review` | Plan, patches, and test files passed output/schema/path checks and await human review. This does not mean build/tests passed. |
| `changes_requested` | Reviewer requested changes and recorded a note; generate a new version to address it. |
| `rejected` | Reviewer rejected this reference version. |
| `approved` | Reviewer approved after recording passing build and test results. |
| `failed` | The job or provider failed; the record includes an error message. |

Generated paths are checked to be relative and non-traversing. The AI service checks plan/test repository IDs against the supplied pinned repositories and requires each patch to have a unique, known repository ID and valid `diff --git` paths. This prevents unsafe path references in the artifact; it does not prove that the patch is correct or applies cleanly.

## Validation and approval gate

The initial validation record sets structural checks (`patch_format` and `test_files_present`) from the generated artifact and sets `build`, `tests`, and `execution_mode` to `not_run`. The app currently has no isolated reference build/test runner.

The reviewer can record build/test status (`not_run`, `passed`, or `failed`) and must add notes when recording a pass. These are explicitly labeled **manual confirmation**, not results produced by ForgeBench. Approval is rejected unless:

1. A patch bundle exists.
2. Generated test files exist.
3. Build status is recorded as passed.
4. Test status is recorded as passed.
5. The results were recorded through the manual validation endpoint.

Review actions are **Approve**, **Request changes**, and **Reject**. Request changes requires a note and leaves the existing version intact; a subsequent generation creates a new immutable reference version and includes that note as model feedback by default. Approval does not publish or execute the reference. The current prototype also has no user authentication or reviewer identity/role system, so this is a local workflow state, not an access-controlled approval system.

## Using the UI

1. Open **Task Library** and select a saved task.
2. In **Reference implementation**, choose **Generate reference**. The app automatically reuses the provider from the original task generation.
3. Wait for the queued job to finish. Review each plan item, repository-specific patch, generated test file, and pinned task/snapshot version.
4. Apply and validate the changes in an appropriately isolated environment outside ForgeBench; do not treat generated tests passing by themselves as proof the reference satisfies the task.
5. Record the build and test outcomes and reviewer notes in the workspace.
6. Approve only after both checks pass, request changes with an actionable note, or reject the version.

## API

All backend routes below are under `/api/v1`:

| Method and route | Purpose |
| --- | --- |
| `POST /tasks/:id/references/generate` | Queue a new reference for the task's current version and inherited provider. Optional JSON body: `{"reviewerFeedback":"..."}`. |
| `GET /tasks/:id/references` | List reference versions, newest first. |
| `GET /references/:id` | Read a reference plan, patches, tests, validation, and review state. |
| `POST /references/:id/validation` | Record manual build/test results and notes. |
| `PATCH /references/:id/review` | Record `approve`, `request_changes`, or `reject` with an optional note. |

The internal Python endpoint is `POST /api/v1/references/generate`; it is called by the backend worker, not by the browser.

## Configuration and implementation

The provider settings are the same ones documented in [Task Generation](./task-generation.md): `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL`. `REFERENCE_OUTPUT_TOKEN_BUDGET` controls the model output budget (default `8000`). `TASK_CONTEXT_TOKEN_BUDGET` controls bounded source retrieval.

Implementation files:

- `apps/frontend/src/App.tsx` — task reference workspace and review controls.
- `apps/backend/src/tasks/reference-solutions.service.ts` — provider inheritance, pinned-baseline resolution, queueing, records, validation, and review gates.
- `apps/backend/src/tasks/reference-solutions.processor.ts` — background job processor.
- `apps/backend/src/tasks/entities/reference-solution.entity.ts` — versioned reference persistence.
- `apps/ai-service/app/reference_factory.py` — provider request, prompt, output schema, and path validation.
- `apps/ai-service/app/context_engine.py` — bounded repository context retrieval.

Generated output is a model proposal requiring human review. The workflow does not claim that a patch is correct, applies cleanly, compiles, or passes tests until someone validates it independently and records the result.
