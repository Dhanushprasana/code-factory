 # Agent Execution and Evaluation

This guide describes the implementation of ForgeBench's Day 5-7 agent execution, submission, automated evaluation, and benchmark comparison workflow.

## Workflow

1. A task reference must be in `approved` status.
2. The user selects exactly two ready agents.
3. ForgeBench creates immutable assignments for the task version and approved reference.
4. BullMQ creates two independent `agent-execution` jobs.
5. Each job copies the exact pinned repository snapshots into a separate workspace.
6. The adapter receives only the task, public requirements, acceptance criteria, constraints, and workspace.
7. The adapter modifies the workspace or fails without inventing a submission.
8. ForgeBench initializes a local Git baseline and collects a real `git diff --binary` submission.
9. An `agent-evaluation` job creates a fresh workspace from the pinned snapshots.
10. The evaluator applies the submission patch, runs setup/build/public tests, and configured hidden tests as separate phases.
11. A weighted score and raw evidence are stored and compared on the Benchmark screen.

## Execution and evaluation are separate

A benchmark assignment has two independent stages:

1. **Agent execution**: Harbor or a configured direct-CLI adapter receives the public task and a clean copy of each pinned repository. It must make changes and return a non-empty, valid patch. A provider error, timeout, empty diff, or invalid patch fails this stage. ForgeBench does not start evaluation when no valid submission exists, so there is no evaluation score or test evidence for that assignment.
2. **Patch evaluation**: only after a patch is submitted, ForgeBench applies it to a new clean copy of the same pinned revision. The evaluator installs dependencies, runs configured build commands, then public tests and configured hidden tests. Agent-reported success is not a test result; only these isolated commands contribute build and test scores.

Harbor's own trial reward and ForgeBench's 100-point evaluation score are different values. Harbor reward `1` means its generated verifier accepted the agent artifact; it does not mean the project's build, public tests, or hidden tests passed.

The UI shows the first-stage execution error on the agent card. Evaluation evidence is shown only when the agent submitted a patch and the evaluation job ran. The execution log contains Harbor's provider and agent diagnostics; evaluation evidence contains the exact setup/build/test commands, exit codes, durations, stdout, stderr, and errors.

## Status and score interpretation

- **Queued/running**: the corresponding background job has not finished.
- **Submitted**: the agent returned a patch that passed structural validation. This does not mean the task is correct or tested.
- **Failed before submission**: no evaluation is created. Inspect the execution error/log for provider limits, timeout, setup, or patch-collection failures.
- **Evaluation completed**: the patch was applied and the evaluator recorded its command results. The evaluation may still have failed one or more build/test commands.
- **Evaluation failed**: the evaluator itself could not complete, for example because the patch could not be applied or the validation runner was unavailable.

The score is calculated from the independent checks in [Score model](#score-model).

No configured test results earn zero points for that category; they do not earn an automatic pass. A configured test command that exits non-zero also earns zero for that command. A command such as Jest's `npm test` can exist in `package.json` but still fail with “No tests found” when no test files match the runner's pattern. Add real public tests or correct the approved reference's test command; do not use `--passWithNoTests` merely to make an empty suite green. Hidden tests are a separate suite and must be configured on the approved reference to earn hidden-test points.

For example, a valid patch plus passing build, one failed public test command, and no configured hidden tests scores `10 + 10 + 0 + 0 = 20/100`. This indicates that the patch applied and built, but its behavior was not proven by tests.

## Adapter setup

Direct CLI agents run through the validation runner in a disposable Docker container. The normalized submission record contains:

- Adapter type
- Agent name
- Model name
- Start/completion timestamps
- Execution log
- Patch diff
- Patch validity
- Artifact path
- Evaluation result

### Harbor Framework adapter

The Harbor adapter invokes the Harbor CLI from a dedicated Python 3.12 service and creates a Harbor task for each execution from the pinned, public workspace. The generated task:

- Includes only the task instructions and pinned repository snapshots.
- Builds its task image from `code-factory-validation:local` and runs the agent as the non-root `node` user.
- Restricts CPU and memory. Harbor's Docker environment uses a static network policy for the task: all phases have no network by default, and use public networking only when both the agent setting and runner policy allow it.
- Runs a verifier that collects per-repository Git patches as Harbor artifacts; ForgeBench then evaluates those patches in its separate evaluator.

The built-in Gemini CLI, Antigravity, Claude Code, OpenAI Codex, and Harbor Baseline profiles use Harbor-native adapters. Direct-CLI profiles do not start these tools unless a command is explicitly configured.

To configure Gemini through Harbor, use **Gemini CLI** or **Antigravity** in **Agents**:

- Adapter type: **Harbor Framework**
- Harbor Agent: **Gemini CLI** (`gemini-cli`) or **Antigravity CLI** (`antigravity-cli`)
- Model name: a Gemini model supported by your Google AI Studio account; the runner uses the `gemini/<model-id>` form for both Google adapters so Harbor selects API-key auth instead of Vertex AI
- Credential reference: `GEMINI_API_KEY`
- Allow network access: enabled

The Harbor service receives the selected provider secret from the runner environment; the API key is not added to task files, command-line arguments, logs, or PostgreSQL.

The Antigravity profile uses `antigravity-cli` with `GEMINI_API_KEY`. Claude Code uses Harbor's `claude-code` adapter and requires `ANTHROPIC_API_KEY`; OpenAI Codex uses Harbor's `codex` adapter and requires `OPENAI_API_KEY`. Claude Code and Codex are seeded offline until their provider keys are configured. Add each key to the root `.env`, restart `harbor-runner`, then enable that profile in **Agents**. Do not substitute the Gemini key for an Anthropic or OpenAI key.

Direct-CLI mode remains available for custom integrations with an explicitly configured command. Use Harbor for the built-in agent profiles; those profiles do not use `settings.command`.

To use a Gemini API key:

1. Copy the root `.env.example` to `.env`.
2. Set `GEMINI_API_KEY` in the root `.env` and set `AGENT_EXECUTION_ALLOW_NETWORK=true`.
3. Migrate existing built-in profiles with `Invoke-RestMethod http://localhost:4000/api/v1/agents/seed -Method Post`.
4. Rebuild/restart the runner and backend after changing `.env`: `docker compose up -d --build harbor-runner validation-runner backend`.
5. In **Benchmarks**, select **Gemini CLI** and **Antigravity**; both use the configured Gemini key through different Harbor adapters.

To enable Claude Code or OpenAI Codex, set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`, restart `harbor-runner`, then change the relevant agent from offline to ready in **Agents**.

The key is never entered in the UI or stored in PostgreSQL. The selected runner resolves the named secret; Harbor receives it only to authenticate its configured agent. Logs are redacted and a patch containing the exact configured key is rejected. Harbor network access requires both the per-agent setting and the root `AGENT_EXECUTION_ALLOW_NETWORK` switch. Harbor's Docker backend cannot change networking between execution phases, so this setting enables networking for the whole isolated Harbor task, including its verifier. Network access is needed for hosted APIs and can expose repository data to the selected provider.

## Isolation

Every execution and evaluation gets a separate workspace under:

```text
storage/agent-workspaces/<execution-id>/
storage/reference-workspaces/<evaluation-id>/repositories/
```

Execution workspaces:

- Use exact pinned snapshot copies.
- Exclude `.git`, dependencies, build output, virtual environments, and `.env` secrets.
- Contain a generated `TASK.md` with public task information.
- Run inside a separate non-root container with CPU, memory, process, and timeout limits.
- Do not receive the Docker socket, reference patches, hidden test files, evaluator secrets, or another agent submission.

Evaluation workspaces:

- Start from the same pinned snapshots.
- Apply only the collected submission patch.
- Run setup/build/public tests and configured hidden tests separately.
- Use the existing validation runner container limits and setup-only network policy.

## Submission normalization

Each submission stores:

- `patchDiff`: real Git binary diff
- `patchValid`: whether the patch is structurally valid
- `artifactPath`: execution log location
- `metadata`: adapter, agent, model, repository count, and patch bytes

An empty patch is not considered valid and receives no patch score.

## Hidden test configuration

Configure an approved reference with hidden test files through:

```http
POST /api/v1/references/{referenceId}/hidden-tests
Content-Type: application/json

{
  "repositoryId": "repository-uuid",
  "filePath": "tests/hidden/feature.spec.ts",
  "content": "...",
  "command": ["npm", "test", "--", "tests/hidden/feature.spec.ts"]
}
```

Hidden test files are stored in the approved reference validation record and can be added only to approved references. They are written only into evaluation workspaces, never agent workspaces.

## Score model

| Metric | Weight | How points are earned | Raw evidence |
| --- | ---: | --- | --- |
| Patch validity | 10 | All submitted patches apply to the pinned baseline and are structurally valid | Git patch application and validity status |
| Build/type-check | 10 | A configured build command exists and every build command passes | Setup/build command status, exit code, output, duration |
| Public/regression tests | 20 | Proportional score across configured public test commands | Each configured public test command and its status/output |
| Hidden test correctness | 60 | Proportional score across configured hidden test commands | Each hidden test command and its status/output |

Total score:

```text
0-100
```

Execution duration is retained as separate evidence and is not included in the initial score.

## API

```http
POST /api/v1/tasks/{taskId}/agents/execute
Content-Type: application/json

{"agentIds":["agent-a","agent-b"]}
```

This queues exactly two execution assignments.

```http
GET /api/v1/tasks/{taskId}/benchmark
GET /api/v1/executions/{executionId}
GET /api/v1/evaluations/{evaluationId}
```

The benchmark response includes assignments, agent metadata, execution status, submissions, patch validity, evaluation status, test evidence, metrics, and total score.

## Database records

- `agent_assignments`: approved task/version/reference and selected agent/config
- `agent_executions`: status, adapter, workspace, logs, timestamps
- `agent_submissions`: normalized patch, validity, metadata, artifact
- `agent_evaluations`: fresh evaluation workspace, test evidence, metrics, score

The migration is `1795280600000-AgentExecutions`.

## UI

The **Benchmarks** navigation page allows:

- Selecting an approved task
- Selecting exactly two ready agents
- Queueing two executions
- Polling execution/evaluation status
- Viewing patch validity
- Viewing setup/build/test evidence
- Comparing 100-point scores

## Diagnosing the Product Search benchmark

The **Implement Product Search Functionality** benchmark run on 2026-11-24 produced two different outcomes.

### Antigravity

- Harbor launched `antigravity-cli` with `gemini-3.1-flash-lite`.
- The run lasted about 6 minutes 57 seconds, then Harbor recorded one `ApiOverloadedError`.
- The provider returned HTTP 503 with “This model is currently experiencing high demand.”
- No patch artifact was collected, so ForgeBench correctly marked the execution failed and did not create an evaluation. This is a temporary provider-capacity failure, not a failed build/test and not evidence that a patch was invalid.
- The previous UI message “Harbor completed without producing a code patch” hid that provider cause. The runner now classifies provider 503 and 429 diagnostics into clearer execution errors for future runs. Retry after provider demand drops or choose another available model.

### Gemini CLI

- Harbor submitted a non-empty patch and ForgeBench marked it valid, so evaluation ran.
- Dependency setup passed for backend and frontend. Both build commands passed.
- The configured public command `npm --prefix backend test` exited 1 in 765 ms. Jest reported “No tests found”; it checked 37 files and found zero files matching `.*\\.spec\\.ts$`.
- Therefore public-test points were `0/20`: this was an empty/misconfigured test suite, not a failing assertion from a Gemini-generated test. The task repository needs public test files or a reviewed test command that actually runs tests.
- No hidden test commands were configured, so hidden-test points were `0/60`. This does not mean 60 hidden tests failed; there were no hidden tests to run.
- The final score was `20/100`: patch validity `10/10` + build `10/10` + public tests `0/20` + hidden tests `0/60`. The patch was submitted and built, but the feature's behavior was not verified.
- The Gemini execution log also contains a provider quota/rate-limit response. The run nevertheless produced a valid submission; that provider message did not cause the Jest “No tests found” result.

For this task, add public product-search tests to the repository and configure them in the approved reference validation settings. If hidden correctness is required, add a separate hidden suite to the approved reference. Then rerun the benchmark. A transient 503/429 needs a later retry or provider quota/capacity change; it cannot be fixed by changing the patch or test command.

## Common failure causes

| UI evidence | Meaning | Next action |
| --- | --- | --- |
| “temporarily overloaded” / HTTP 503 | The model provider could not serve the request at that time; no patch may be produced | Retry later or select another supported model |
| HTTP 429 / quota exceeded | Provider rate/token quota was exceeded; agent retries may still end without a patch | Wait for quota reset and review API limits/billing |
| “completed without producing a code patch” | Harbor ended without a non-empty patch artifact; inspect the execution log for the underlying exception | Resolve provider/setup errors, then rerun |
| “No tests found” | The configured test script ran, but its framework discovered no test files | Add tests or update the reviewed test command; do not mark an empty suite as passed |
| `0/60` hidden-test points | No hidden test commands were configured, or none passed | Configure hidden tests on the approved reference and rerun |
| Build passes but score is low | Build correctness is only 10 points; behavior requires public/hidden test evidence | Add/run tests that cover the acceptance criteria |
