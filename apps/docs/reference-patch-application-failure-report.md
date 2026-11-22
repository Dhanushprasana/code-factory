# Incident Report: Corrupt Reference Patch

**Incident date:** 2026-11-22  
**Affected workflow:** Reference solution generation and patch application  
**Outcome:** Patch rejected during pre-application validation; no review workspace was produced.

## Executive summary

ForgeBench generated and saved a reference solution for the task **“Implement Product Listing with Pagination and Filtering.”** The saved patch was marked `pending_review` and its structural validation reported `patch_format: passed`. When a reviewer applied it, Git rejected the patch before applying any changes:

```text
git apply --whitespace=nowarn --check ...
error: corrupt patch at line 16
```

The direct cause is an incomplete unified-diff hunk. Its header declares more old and new lines than the patch contains. Git therefore cannot finish parsing the diff. This is a patch-format failure, not a build or test failure, and it is not evidence that the pinned source file itself conflicted with the proposed change.

The error was caught by `git apply --check` while operating on a temporary copy of the pinned snapshot. The application flow removed the failed staging workspace and persisted `apply_status: failed` with `workspace: null`. The pinned checkout was not the patch target.

## Incident identifiers and evidence

| Field | Value |
| --- | --- |
| Task | `f55453ff-ff9a-4bb3-aa77-90117d34bd83` |
| Task title | Implement Product Listing with Pagination and Filtering |
| Reference version | 6 |
| Reference | `4faf075b-17b8-45df-a44a-a5e7f0e336a9` |
| Provider / model | Ollama / `qwen2.5:3b` |
| Repository | `c5d33b76-93c0-492b-a44c-659dbe822a7f` |
| Pinned snapshot | `cbd99f56-6417-4f3c-bb37-06622243f013` |
| Pinned commit | `82f690bec447e55d91ac7be0b92c601c5fa6b0a3` |
| Patch path in proposal | `frontend/src/pages/Product.tsx` |

The saved record contained the patch, model/provider metadata, and the earlier validation result. A live apply attempt then reproduced the failure. After the attempt, the reference still had `status: pending_review`, but its application fields were `apply_status: failed` and `workspace: null`.

## What caused the Git error

The patch’s first hunk is syntactically counted as one removed line and two added lines. The second hunk header is `@@ -10,6 +11,10 @@` and promises 6 original lines and 10 resulting lines. The text following the second `@@` is a hunk label/context hint; it is not counted as a hunk line. Counting the actual lines after the header:

| Hunk count | Declared by header | Present in patch | Difference |
| --- | ---: | ---: | ---: |
| Old-file lines | 6 | 3 context lines | 3 missing |
| New-file lines | 10 | 3 context lines + 4 additions = 7 | 3 missing |

The four additions were two import lines, an added blank line, and the start of a `ProductPage` declaration. The patch ended there. It did not supply the remaining lines promised by the hunk header, so Git reached the end of the patch while still expecting hunk content. That is why Git reported the patch as corrupt at line 16.

This distinction matters:

- **Corrupt patch** means Git cannot parse the unified-diff structure. That is what happened here.
- **Patch does not apply / hunk failed** means Git parsed the diff but could not find matching context in the target file. That was not the reported failure.
- **Build or test failure** would happen only after a patch had been applied and the reviewer ran validation. Neither stage was reached.

Even if the hunk counts were corrected, the saved patch is only a fragment: it adds imports and begins a component declaration without providing the implementation body. It therefore does not implement the requested pagination and filtering behavior.

## How an invalid patch reached `pending_review`

The generation pipeline has multiple validation layers, but the model-output checks at generation time are structural and path-oriented:

1. The AI service requires the response to match a JSON schema, including fields for a plan, patches, and tests.
2. It checks that repository IDs and paths are allowed and that each patch has a `diff --git` path header.
3. It rejects a small set of literal placeholder lines such as `-old line` and `+new line`.
4. It does **not** parse every unified-diff hunk count or run `git apply --check` before returning the generated result.
5. The backend accepts a complete-looking response and stores it as `pending_review`. The `patch_format: passed` result reflects those generation-time structural checks; it does not certify that Git can parse or apply the patch.
6. Git’s authoritative syntax/context check runs later, when the reviewer selects **Apply patches to review workspace**.

The generation prompt asked the model to return a complete unified Git diff with real paths and hunk content. A prompt is an instruction, not a guarantee that the model will produce a complete diff. In this case, the response did not satisfy the requested hunk structure, and the current generation validator did not detect the mismatch.

## Contributing factors and what is not known

### Confirmed facts

- The selected model was `qwen2.5:3b`, and its saved output did not follow the complete-diff requirement.
- The generation validator checked schema, IDs, paths, and known placeholder strings, but did not check unified-diff hunk counts. This allowed the malformed patch to be labeled `patch_format: passed`.
- The patch was incomplete as an implementation as well as malformed as a diff.

### Possible contributors not established by the available evidence

The model's smaller size may be a reliability risk for exact patch generation, but size alone does not prove why this response was malformed. The stored reference also does not include the provider’s finish reason or enough request-level telemetry to determine whether the output was cut off by a token limit, stopped by the model, or simply emitted with incorrect hunk counts. The response ending mid-hunk is consistent with incomplete generation, but **token-budget truncation is not proven**. Likewise, the evidence does not establish that repository-context retrieval caused this specific error.

## Why the original snapshot was protected

During the original **apply** attempt, the backend resolved the exact pinned baseline, copied it into a temporary review workspace, wrote the proposed patch into that workspace, and ran `git apply --check` there first. The non-check application command was reached only if the check succeeded.

For this incident, the error path named a patch under:

```text
/workspace/storage/reference-workspaces/<reference-id>.tmp-<attempt-id>/.patches/<repository-id>.patch
```

Git ran with the copied repository as its working directory. The check command failed before the non-check `git apply` command could run. The exception path removed the staging directory and saved the failure state with no workspace. Consequently:

- No patch was applied to the pinned checkout.
- No downloaded review archive was created.
- Build/test commands were not run.
- Build/test validation and approval remain blocked.

This isolation and validation sequence is implemented in [reference-solutions.service.ts](../backend/src/tasks/reference-solutions.service.ts). The model-output checks are in [reference_factory.py](../ai-service/app/reference_factory.py).

## Corrective measures now in place

Before this incident, `git apply --check` ran only after the reviewer chose **Apply patches**. The backend now runs the same check earlier, during reference generation:

1. The backend resolves and verifies the task’s exact pinned repository baseline.
2. It writes each generated patch to a unique temporary file under artifact storage and runs `git apply --check` with the pinned checkout as the working directory. This check is read-only; it does not apply the patch to the baseline.
3. If any patch is malformed or cannot apply to that baseline, generation is marked `failed`, `patch_preflight` is recorded as `failed`, the error is surfaced, and temporary files are removed. The response is not marked `pending_review`.
4. Only when every patch passes does the backend save the reference as `pending_review` with `patch_preflight: passed`.
5. The reviewer’s later apply action still repeats `git apply --check` in the isolated review copy before applying. This protects against changes or storage problems between generation and review.

The UI now displays the pinned-snapshot preflight result and distinguishes it from later workspace application and manual build/test results. Existing reference versions created before this change have no `patch_preflight` value; they remain marked as not recorded and are not retroactively certified.

The new generation preflight is covered by a focused test: the same class of corrupt diff must fail generation, leave the pinned source unchanged, and clean up its temporary patch files. The existing apply tests continue to cover successful application, failed application, archive creation, and the manual validation gate; see [reference-solutions.service.spec.ts](../backend/src/tasks/reference-solutions.service.spec.ts).

The `patch_format` field still describes AI response schema/path checks; it is not the Git check. `patch_preflight` is now the explicit result for whether a patch parsed and applied cleanly to the pinned snapshot. Build/test execution remains manual and is not implied by either field.

## Follow-up generation attempts

The request to generate and test a fresh reference exposed two additional timeout/output-limit issues before the new patch preflight could run:

| Reference version | Runtime | Observed result | Interpretation |
| --- | --- | --- | --- |
| 7 | Ollama `qwen2.5:7b`, 8,000-token output setting | `fetch failed` after about 301 seconds | This matched Node's default HTTP response-header timeout, which was shorter than the intended backend timeout. Switching the backend call to Undici with explicit longer header/body limits removed this five-minute transport cutoff. |
| 8 | Ollama `qwen2.5:7b` | `Ollama task generation timed out.` | The request reached the AI service, but the model did not finish within its 600-second limit. |
| 9 | Ollama `qwen2.5:3b`, 4,000-token output setting | AI response was not valid JSON; Ollama logs show 3,996 generated tokens | The response reached the configured output cap without producing parseable JSON. This is strong evidence of output-budget exhaustion for this attempt; the provider finish reason itself was not stored. |
| 10 | Ollama `qwen2.5:3b`, 6,000-token output setting | `The AI provider returned a patch with missing or unsafe file paths.` | The AI response passed JSON/schema parsing but failed the patch-path validator, before Git preflight. The response body was not retained, so it is not possible to determine whether the diff omitted `diff --git` headers or contained an unsafe path. |
| 11 | Ollama `qwen2.5:7b` | `Ollama is temporarily unavailable.` | Ollama logs show the 7B model server was killed while loading. This points to a local resource constraint; no patch was generated. |
| 12 | Ollama `qwen2.5:3b`, 6,000-token output setting | AI response was not valid JSON; Ollama logs show 5,994 generated tokens | The response again reached the configured cap without parseable JSON, confirming the 6,000-token budget is insufficient for this task's generated plan, diff, and tests. |
| 13 | Ollama `qwen2.5:3b`, 8,000-token output setting | AI response was not valid JSON; Ollama logs show 7,996 generated tokens | The response again reached its configured cap. |
| 14 | Ollama `qwen2.5:3b`, 10,000-token output setting | AI response was not valid JSON; Ollama logs show 9,992 generated tokens | The response again reached its configured cap. |

The reference-only Ollama timeout is now 1,200 seconds, with a 1,210-second backend abort and 1,220-second Undici limits. The live retry used the already-installed 3B model with a 10,000-token output budget, but still did not produce parseable JSON. Versions 7–14 all failed before `patch_preflight`; no generated patch from these attempts was applied, and the safeguard prevented malformed output from reaching a review workspace. Further attempts should constrain the response size/schema or use a configured provider capable of returning the required structured output rather than indefinitely raising the token cap. OpenRouter remains capped at 90 seconds. A successful `patch_preflight` is only the first gate; human review and manual build/test validation are still required afterward.

### Later OpenRouter patch-format failures

For task `d5787ff8-f3c5-46e0-9c80-9d2b7f5aca1d`, OpenRouter reference versions 3 and 4 also failed the pinned-snapshot preflight:

| Version | Git error | Recorded outcome |
| --- | --- | --- |
| 3 | `patch fragment without header at line 14: @@ -46,6 +47,7 @@` | `patch_preflight: failed`; not applied |
| 4 | `corrupt patch at line 30` | `patch_preflight: failed`; not applied |

The failed V3/V4 records did not retain their generated diff bodies, so their exact malformed lines cannot be reconstructed. Version 3 is consistent with a hunk lacking its file headers; version 4 may reflect incorrect hunk counts or other malformed hunk framing. The backend repairs only narrow, mechanical cases: adds missing `---` / `+++` markers for ordinary modifications with a valid `diff --git` header, removes one leading space from a ` diff --git` line only when the immediately following file-marker paths match, and recomputes hunk counts from the patch body. It then runs `git apply --check --recount` against the pinned snapshot. It does not change patch paths or source hunk content, and any patch that still fails preflight remains failed and unapplied.

#### Live verification after adding normalization

After rebuilding the backend with the normalization change, a new OpenRouter reference was generated for the same task:

| Version | Reference | Provider | Git result | Recorded outcome |
| --- | --- | --- | --- | --- |
| 5 | `8936d0ef-3c16-4ced-9e8c-03f90896a291` | OpenRouter | `patch failed: backend/src/product/product.service.ts:0` | `status: failed`, `patch_preflight: failed`, `apply_status: not_applied` |
| 6 | `98870d4b-0c82-457b-a474-4bc0203ffa70` | OpenRouter | `corrupt patch at line 49` | `status: failed`, `patch_preflight: failed`, `apply_status: not_applied` |
| 7 | `4bee114d-9247-4dbe-b7b1-f47dbde52da4` | OpenRouter (`openai/gpt-4o-mini`) | `corrupt patch at line 74` after one repair attempt | `status: failed`, `patch_preflight: failed`, `patch_repair_attempts: 1`, `apply_status: not_applied` |
| 8 | `fec26280-fd9b-464d-90c2-cd117c8f0b10` | OpenRouter (`openai/gpt-4o-mini`) | `corrupt patch at line 50` after one repair attempt | `status: failed`, `patch_preflight: failed`, `patch_repair_attempts: 1`, `apply_status: not_applied` |
| 9 | `284f7e29-8b20-479e-8cfe-d9b085e8011d` | OpenRouter (`openai/gpt-4o-mini`) | Context mismatches in three product files after one repair attempt | `status: failed`, `patch_preflight: failed`, `patch_repair_attempts: 1`, `apply_status: not_applied` |
| 10 | `44c82b03-151a-4bf9-bb49-e1fb41693541` | OpenRouter (`openai/gpt-4o-mini`) | `corrupt patch at line 106` after one repair attempt | `status: failed`, `patch_preflight: failed`, `patch_repair_attempts: 1`, `apply_status: not_applied` |

V5 was a context/application mismatch rather than a parser error. The V5 record did not retain the patch body, so the exact mismatch cannot be confirmed. V6 was also a parser error, but its original patch body was not retained at that time. V7 was generated after failed-output retention and exercised the new repair path; its final patch and provider metadata were available for inspection.

The normalization is intentionally mechanical and does not invent or rewrite source context. It can repair missing file markers, a specific indented file-header pattern, and inaccurate hunk counts, but cannot make a semantically mismatched patch apply safely. `git apply --check` remains the final generation-time gate; failed output stays unapplied.

V6 is another parser-level failure, distinct from V5's context/application mismatch. The API record and backend log both contain `error: corrupt patch at line 49`; the failed record has `patches: null`, `model: null`, and `promptVersion: null`. The backend only persists the generated artifacts and model metadata after pinned-snapshot preflight succeeds, and the temporary preflight patch file is deleted whether the check passes or fails. Therefore, the contents of line 49 and the precise formatting defect cannot be recovered from V6. `apps/ai-service/.env.example` contains placeholder settings and does not account for this error: the record confirms the request used OpenRouter and reached Git preflight.

The V6 safeguard outcome is verified: the record stayed `failed`, `patch_preflight` is `failed`, and `apply_status` is `not_applied`. No patch reached review or application. The error indicates Git could not parse the generated diff after the then-current normalization; without the diff body, V6's exact syntax defect cannot be identified.

#### V7 diagnosis and follow-up

V7's automatic repair was attempted once by `openai/gpt-4o-mini`, but its returned patch still failed. The retained patch showed the later file headers at lines 36 and 67 began with a space (` diff --git ...`) rather than at column 1. Git consequently treated those intended file boundaries as hunk context, then reported `corrupt patch at line 74`. This is the first incident in this sequence where the actual malformed output was retained and the precise parser defect could be confirmed.

The backend now removes exactly one leading space from this marker only when the next two lines are `--- a/<same path>` and `+++ b/<same path>`. It then recounts each hunk and reruns the pinned-snapshot preflight. The AI prompt also explicitly requires `diff --git` headers to begin in column 1. A regression test reproduces V7's two-file malformed diff and confirms that the normalized patch passes Git against the test snapshot. A separate test confirms that one provider repair is attempted and that a second failed preflight remains unapplied. V7 itself remains failed; this change does not alter historical records.

V8's retained patch had no indented file headers, but its hunk ranges overlapped. Its first hunk declared old lines 11-18 and new lines 11-19; the next started at old line 14 and new line 15, which overlaps both ranges. `git apply --recount` can correct line counts but does not correct overlapping hunk start positions, so Git reported corruption at the end of the patch. The backend now moves an overlapping hunk start to the first line after the preceding range, recounts the body, and still requires the patch to match the pinned snapshot. A two-hunk regression test verifies this adjustment while preserving unchanged context. V8 remains failed; its stored patch was produced before this final adjustment.

V9 passed the parser after the mechanical normalizations but failed context application in three product files, even after its one provider repair. Comparing the retained output with the pinned checkout confirmed concrete mismatches: the service patch tried to add an `@InjectRepository(StockEntity)` decorator that already exists, and the DTO hunk expected validation-decorated quantity fields that are absent from the pinned DTO. This is not a diff-format defect, and the model's previous bounded context excerpts did not prevent it. The patch remains `failed` and `not_applied`.

The repair request now also includes exact text for the files named by the rejected patch when they are safe to read, UTF-8 text files, and within 12,000 characters per file / 30,000 total. `.env` secrets, symlinks, binaries, paths outside the repository, and oversized files are excluded. The repair prompt tells the model to compare every hunk against this exact source and avoid duplicating existing imports or decorators. This improves the evidence available to a retry but cannot guarantee that the model will produce a correct implementation; Git preflight remains authoritative.

V10's retained diff contained blank source lines with no leading context-space. Because those lines were not valid unified-diff body lines, hunk recounting stopped and preserved the model's short `@@ -1,6 +1,7 @@` counts despite a much longer hunk; Git reached EOF and reported `corrupt patch at line 106`. The same output also used `./entities/...` imports where the pinned service uses the existing `./enities/...` path, so correcting the parser defect alone would not have made the patch apply. The normalizer now restores a context prefix for blank lines inside hunks and recounts them. The prompt requires that prefix, and tests cover the blank-context case. V10 remains failed and unapplied; the source-path mismatch demonstrates why Git preflight must remain the final gate.

### V11 and V12: duplicate context and missing final newline

V11 (`26cc3ad4-2734-470c-a436-9fb938d8f61e`) failed after its one repair attempt because the model proposed adding an `@InjectRepository(StockEntity)` decorator that already exists in the pinned `ProductService`. A narrowly guarded source-aware normalization now treats an added line as context only when that exact line, its preceding context line, and its following context line form a unique sequence in the pinned file. It does not rewrite a merely similar line or resolve arbitrary context conflicts. Positive and negative regression tests verify both behaviors.

V12 (`4797d839-4be6-4ac3-979d-33ea0ba22d71`, OpenRouter `openai/gpt-4o-mini`, prompt `reference-factory-v6`) failed with `corrupt patch at line 40` after one repair attempt. Inspection of the retained 40-line patch confirmed its final character was `}`, with no terminating newline. The backend now always terminates normalized patch text with a newline, and a Git-backed regression test covers a generated patch with no final newline.

Replaying the retained V12 patch through the updated normalizer against the exact pinned checkout gets past the parser failure, but Git then correctly rejects its source context at `backend/src/product/product.service.ts:13`. The patch assumes the `@Injectable()` declaration follows the `typeorm` import, while the pinned source has `ProductEntity`, `StockEntity`, and DTO imports between them; it also uses `./entities/product-stock.entity` while the pinned file uses `./enities/product-stock.entity`. Therefore fixing the missing terminal newline does not make this model proposal correct. V12 remains `failed`, `patch_preflight: failed`, and `apply_status: not_applied`. The normalizer does not rewrite such mismatched context; a new generation must produce a patch based on the exact snapshot.

### V13: repair from complete pinned files

The V13 context manifest showed that the original request retrieved `ProductService` starting at line 13 and omitted its import prologue. A bounded prologue excerpt is now added before symbol excerpts, and the prompt explicitly requires copying existing import paths exactly. V13 then failed with a context mismatch at `product.service.ts:23`: the generated hunk skipped existing `findManyByIds` and `findOne` methods. This proved that a better context prompt alone did not make model-authored hunk placement reliable.

The repair contract now asks the same provider for complete post-change contents of every file in the rejected patch, not another unified diff. The AI service validates that paths are limited to the rejected bundle, reads the exact pinned files, and constructs the unified diff itself. The backend still runs `git apply --check --recount` against the pinned checkout and still rejects failures.

Live verification succeeded with reference `06cf4edd-19b6-432e-bed6-8d2447312bfb` (OpenRouter `openai/gpt-4o-mini`, `reference-factory-v8`): `patch_preflight: passed`, `patch_repair_attempts: 1`, and applying it to the isolated review workspace recorded `apply_status: applied`. The pinned checkout was not modified. This verifies patch parsing/application only. The generated plan named additional files that were not present in the final patch, and build/test validation was not run; this reference is not proof that the complete stock-management requirements are implemented or pass tests.

### Remaining diagnostic improvement

Failed records created before V7 do not include the generated patch body, resolved model, or prompt version. New failed records retain the last output and model/prompt metadata, but provider finish reason and token usage are still unavailable. These diagnostics help distinguish malformed output from a patch based on mismatched context; snapshot protection continues to come from Git preflight.

## Recovery for this reference

Reference `4faf075b-17b8-45df-a44a-a5e7f0e336a9` contains the same malformed proposal. Retrying **Apply patches** will recheck that same patch and fail again; it does not regenerate the model output. Generate a new reference version for the task, then review the complete diff before applying it.

References inherit the provider recorded by the task-generation run. This task’s reference used Ollama. A different Ollama model can be configured for a subsequent generation; using OpenRouter requires a task associated with an OpenRouter task-generation run. In either case, a newly generated patch must still pass the apply check and human review.

## Related documentation

- [Reference Solution Generation and Review](./reference-solutions.md) — end-to-end generation, apply, download, and manual validation flow.
- [AI-service API tests](../ai-service/tests/test_api.py) — prompt and output-validation coverage.
