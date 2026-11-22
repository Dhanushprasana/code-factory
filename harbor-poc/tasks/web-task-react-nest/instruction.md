# Fullstack Bug Fix: Task Management App (NestJS + React)

You have a fullstack application under `/workspace`:
- `/workspace/backend` (NestJS REST API)
- `/workspace/frontend` (React + TypeScript Vite App)

There are two critical bugs preventing the automated tests from passing.

---

## 1. Bug 1: Backend Priority Validation (`/workspace/backend/src/tasks/tasks.service.ts`)
The endpoint `POST /tasks` should allow creating tasks with priorities: `'LOW' | 'MEDIUM' | 'HIGH'`.
Currently, the service rejects `'HIGH'` tasks or maps them incorrectly, returning an `INVALID_PRIORITY` error.

**Requirement:**
Fix `/workspace/backend/src/tasks/tasks.service.ts` so that:
- Creating a task with priority `HIGH` works properly.
- All valid priorities (`LOW`, `MEDIUM`, `HIGH`) are accepted.
- Invalid priorities return HTTP 400 with `{ "statusCode": 400, "message": "Invalid priority" }`.

---

## 2. Bug 2: Frontend Filter Button (`/workspace/frontend/src/App.tsx`)
In the React UI, clicking the "High Priority" filter button fails to filter the tasks list because of an incorrect state filter condition.

**Requirement:**
Fix `/workspace/frontend/src/App.tsx` so that clicking the "High" filter displays only tasks with `priority === 'HIGH'`.

---

## 3. Automation Testing & Verification
The verifier runs automated test suites for both tiers:
1. **Backend Integration Tests:** `npm --prefix /workspace/backend test` (Supertest + Jest against the NestJS app).
2. **Frontend Component & Automation Tests:** `npm --prefix /workspace/frontend test` (React Testing Library + Vitest simulating user interactions and filtering).

Both test suites must pass 100%.
