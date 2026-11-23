# Reference Solution Testing

This guide describes how ForgeBench automatically tests an applied reference solution. It is separate from reference generation and patch review.

## Start-to-finish flow

1. Generate a reference for a saved task.
2. Confirm that pinned-snapshot patch preflight passed.
3. Choose **Apply patches to review workspace**.
4. Review the detected setup/build/test commands.
5. Choose **Run build and tests**.
6. Inspect setup, build, and test evidence.
7. Approve only when build and test statuses are both `passed`.

Approval is not a manual checkbox. It requires a successful automatic container run with passing build and test evidence.

## Environment discovery

After a workspace is applied, ForgeBench recursively searches the repository to a depth of four for project manifests. It excludes `.git`, dependency folders, generated directories, virtual environments, and build output.

Detected project types:

| Project type | Setup | Build command | Test command |
| --- | --- | --- | --- |
| npm package | `npm ci` when a lockfile exists, otherwise `npm install` | `npm run build` | `npm test` |
| pnpm package | `pnpm install --frozen-lockfile` or `pnpm install` | `pnpm run build` | `pnpm test` |
| Yarn package | `yarn install --immutable` or `yarn install --frozen-lockfile` | `yarn run build` | `yarn test` |
| Python `pyproject.toml` | virtual environment, then `pip install -e .` | `python -m compileall -q <project>` | `python -m pytest <project>` when a tests directory exists |
| Python `requirements.txt` | virtual environment, then `pip install -r requirements.txt` | `python -m compileall -q <project>` | `python -m pytest <project>` when a tests directory exists |
| Maven | none | `mvn -f pom.xml package` | `mvn -f pom.xml test` |
| Gradle | none | `gradle build` | `gradle test` |
| Go | none | `go build <project>` | `go test <project>/...` |
| Rust | none | `cargo build --manifest-path Cargo.toml` | `cargo test --manifest-path Cargo.toml` |
| Make | none | `make build` | `make test` |

Nested `backend/package.json` and `frontend/package.json` manifests are detected independently. npm commands use `--prefix` for the nested package directory, while pnpm and Yarn use `--dir` or `--cwd`.

Existing applied workspaces are refreshed with newly detected commands before a new validation run. No patch reapplication is needed after upgrading ForgeBench.

## Isolated execution environment

The backend queues the run on BullMQ. A dedicated `validation-runner` service receives the applied workspace and starts one disposable Docker container per repository.

The container uses `code-factory-validation:local` and includes:

- Node.js 22
- npm, pnpm, Yarn
- Python 3 and pytest
- Go
- Rust and Cargo
- Maven
- Gradle
- Make

The container runs as an unprivileged `node` user. Its `/workspace` repository is stored on a temporary 4 GiB tmpfs volume that is removed after the run. `/tmp` is size-limited and no host repository, credential file, Docker socket, or application secret is mounted into the container.

The container has:

- 2 GiB memory limit
- 2 CPU limit
- 256 process limit
- Configurable command timeout, 600 seconds by default
- A 512 MiB workspace archive limit by default
- A 50,000-file workspace limit

## Network policy

Network access is disabled during build and test execution. Dependency setup can optionally use a dedicated network:

```env
REFERENCE_VALIDATION_ALLOW_NETWORK=true
VALIDATION_RUNNER_TOKEN=replace_with_a_strong_secret
REFERENCE_VALIDATION_COMMAND_TIMEOUT_SECONDS=600
REFERENCE_VALIDATION_MAX_WORKSPACE_BYTES=536870912
```

The default is `REFERENCE_VALIDATION_ALLOW_NETWORK=true` in the Compose deployment. Dependency setup requires network access when dependencies are not already cached and setup fails with evidence if packages cannot be downloaded. Set it explicitly to `false` to keep setup fully offline.

The setup network is attached only during setup commands. The container is disconnected before build and test phases.

## Evidence retained per run

Each run retains up to the latest five runs in `validation.execution_runs`. A run records:

- Run ID
- Requested, started, and completed timestamps
- Execution mode
- Network policy
- Container image
- Repository ID
- Setup/build/test status
- Full command argument array
- Phase
- Exit code
- Duration
- Timeout flag
- Timestamp
- stdout
- stderr
- Bounded-output truncation flags
- Container/node/Python version evidence

For command output, ForgeBench keeps the last 16 KiB per stdout and stderr stream. When output is truncated, the evidence response includes `stdout_truncated` or `stderr_truncated: true`.

## Status meanings

| Status | Meaning |
| --- | --- |
| `passed` | Every configured command in the phase exited successfully. |
| `failed` | A command returned a nonzero exit code or the container returned an execution error. |
| `blocked` | A setup failure prevented build/test commands from running. |
| `not_configured` | No supported build or test command was detected for the repository. |
| `not_run` | The command phase has not started. |

A missing command is evidence of configuration, not success. `not_configured` never satisfies approval.

## API

```http
POST /api/v1/references/{referenceId}/validation/execute
```

This queues one validation run. The response contains a queued validation record. Poll:

```http
GET /api/v1/references/{referenceId}
```

until the latest `execution_runs[0].status` is no longer `queued` or `running`.

Human approval is submitted through:

```http
PATCH /api/v1/references/{referenceId}/review
Content-Type: application/json

{"action":"approve","note":"optional"}
```

Approval requires:

- A patch bundle
- Generated test files
- Applied workspace
- `execution_mode: automatic_container`
- `build: passed`
- `tests: passed`

## Troubleshooting

### A reference has passed setup but build/test fails

Do not change the test runner to ignore the failure. Inspect the evidence by phase:

1. Confirm setup status is `passed`.
2. Inspect build stderr and exit code.
3. Inspect test stderr and exit code.
4. Check whether the failure comes from the reference implementation, generated tests, dependency versions, or project configuration.
5. Fix the reference patch and test artifact, apply the corrected reference from the pinned snapshot, and run validation again.

The stock-management live incident demonstrated the complete diagnostic path:

- Nested package manifests were initially missed.
- Mixed Yarn/npm metadata caused dependency resolution to use incompatible package versions.
- TypeORM `^0.2.38` resolved 0.2-era types while `@nestjs/typeorm` declarations used 0.3 `DataSource` APIs.
- The ORM config still contained the removed `cli` property.
- Jest could not resolve `@app/...` module aliases.
- Generated Jest mocks lacked required `StockEntity.product`.

The fix aligned the project on TypeORM `^0.3.20`, removed `cli`, added the Jest `moduleNameMapper`, and corrected stock test objects. A canonical diff was generated from the exact pinned snapshot and verified with `git apply --check --recount` before it was persisted. The clean reapplication run `dd565874-99a0-4704-8258-64a7ce2b48b6` completed with setup/build/tests all `passed` and is auditable in `execution_runs`.

The product-search reference had a separate implementation gap: the controller called `ProductService.search(term)`, but the service method and repository-backed test setup were missing. The fix added the search implementation, TypeORM configuration, Jest alias/repository providers, and a valid test fixture. Clean reapplication run `2979f487-f82e-4cfe-bca9-3540c7859c66` also completed with setup/build/tests all `passed`.

### No build or test scripts detected

- Check whether the project manifest is inside a nested directory.
- Confirm the manifest contains a real `scripts.build` or `scripts.test` entry.
- Python tests require a `tests/` or `test/` directory.
- Make-based projects require a `build` or `test` target.
- Save and reapply only if the workspace predates the nested-manifest fix.

### Setup failed

Enable dependency network setup only for trusted projects:

```env
REFERENCE_VALIDATION_ALLOW_NETWORK=true
```

Inspect the setup command's stderr and exit code in the validation run.

### Command timed out

Increase `REFERENCE_VALIDATION_COMMAND_TIMEOUT_SECONDS`, retry, or simplify the project build. The timeout is enforced per command.

### Approval is rejected

Approval is blocked until both build and test statuses become `passed`. A build failure, test failure, setup block, missing command, or runner error must be resolved and rerun.

### Runner unavailable

Check:

```powershell
docker compose ps validation-runner
docker compose logs --tail 100 validation-runner
docker compose up -d --build backend validation-runner
```

Set the same `VALIDATION_RUNNER_TOKEN` in the backend and runner environment. Do not expose port 8010 publicly.
