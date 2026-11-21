import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AppService {
  private readonly storagePath = process.env.ARTIFACT_STORAGE_PATH
    ? path.resolve(__dirname, '../../../', process.env.ARTIFACT_STORAGE_PATH)
    : path.resolve(__dirname, '../../../storage');
  private readonly statePath = path.join(this.storagePath, 'forgebench-state.json');
  private tasksStore: any[] = [
    { id: 'task-coupon', projectId: 'project-ecommerce', title: 'Implement Coupon Support in Checkout', status: 'ready_for_validation', difficulty: 'medium', approach: 'repository-context', featureArea: 'checkout', description: 'Add coupon validation and discount application while preserving the existing checkout flow.', requirements: ['Support percentage discounts', 'Support fixed discounts', 'Reject expired coupons', 'Prevent invalid coupon usage'], acceptanceCriteria: ['Valid coupons reduce the checkout total', 'Expired coupons are rejected', 'Invalid coupon codes return a clear error'], evidence: ['src/cart/cart.service.ts', 'src/orders/order.service.ts', 'src/coupons/coupon.repository.ts'], createdAt: '2026-11-20T10:30:00Z' },
  ];
  private packagesStore: any[] = [
    { id: 'pkg-coupon-v1', taskId: 'task-coupon', version: '1.0.0', status: 'Validated', title: 'Implement Coupon Support in Checkout', commitSha: 'd98e7f6', harborSchema: 'v1', createdAt: '2026-11-20T11:15:00Z', validation: { build: 'passed', featureTests: 'passed', regressionTests: 'passed', mutation: 'needs_review', logs: 18 } },
  ];
  private agentsStore = [
    { id: 'agent-a', name: 'Agent A', adapter: 'direct-cli', model: 'configured-local-model', status: 'available' },
    { id: 'agent-b', name: 'Agent B', adapter: 'harbor', model: 'configured-local-model', status: 'available' },
  ];
  private evaluationsStore: any[] = [
    { id: 'eval-coupon-a', taskId: 'task-coupon', agentId: 'agent-a', status: 'completed', score: 86, hiddenPassRate: 90, regressionPassRate: 80, build: 'passed', durationMinutes: 8 },
    { id: 'eval-coupon-b', taskId: 'task-coupon', agentId: 'agent-b', status: 'completed', score: 72, hiddenPassRate: 75, regressionPassRate: 70, build: 'passed', durationMinutes: 11 },
  ];

  constructor() {
    fs.mkdirSync(this.storagePath, { recursive: true });
    if (fs.existsSync(this.statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
        this.tasksStore = state.tasks ?? this.tasksStore;
        this.packagesStore = state.packages ?? this.packagesStore;
        this.evaluationsStore = state.evaluations ?? this.evaluationsStore;
      } catch {
        // Preserve the initial prototype state if a state file is corrupt.
      }
    }
  }

  private saveState() {
    fs.writeFileSync(this.statePath, JSON.stringify({
      tasks: this.tasksStore,
      packages: this.packagesStore,
      evaluations: this.evaluationsStore,
    }, null, 2));
  }

  dashboard() {
    return { tasksGenerated: this.tasksStore.length, validatedPackages: this.packagesStore.filter(p => p.status === 'Validated').length, agentExecutions: this.evaluationsStore.length };
  }
  tasks() { return this.tasksStore; }
  task(id: string) { return this.tasksStore.find(t => t.id === id) ?? null; }
  suggestTasks(projectId: string, body: any) {
    return [
      { id: `suggestion-${randomUUID().slice(0, 8)}`, projectId, title: body.featureArea ? `Implement ${body.featureArea} workflow` : 'Implement repository feature', approach: body.approach ?? 'repository-context', difficulty: body.difficulty ?? 'medium', status: 'draft', description: body.context ?? 'Repository-grounded implementation task.', requirements: ['Preserve existing behavior', 'Add observable positive and negative cases'], acceptanceCriteria: ['The requested behavior works for valid input', 'Invalid input returns a clear response'], evidence: ['Relevant repository modules'], source: 'ai-proposed' },
    ];
  }
  createTask(projectId: string, body: any) {
    const task = { id: `task-${randomUUID().slice(0, 8)}`, projectId, status: 'draft', createdAt: new Date().toISOString(), ...body };
    this.tasksStore.push(task);
    this.saveState();
    return task;
  }
  generateReference(taskId: string) {
    const task = this.task(taskId);
    if (!task) return null;
    task.status = 'ready_for_validation';
    const packageRecord = { id: `pkg-${randomUUID().slice(0, 8)}`, taskId, version: '1.0.0', status: 'Needs review', title: task.title, commitSha: 'd98e7f6', harborSchema: 'v1', createdAt: new Date().toISOString(), validation: { build: 'passed', featureTests: 'passed', regressionTests: 'passed', mutation: 'needs_review', logs: 12 } };
    this.packagesStore.push(packageRecord);
    this.saveState();
    return packageRecord;
  }
  packages() { return this.packagesStore; }
  package(id: string) { return this.packagesStore.find(p => p.id === id) ?? null; }
  approvePackage(id: string) { const pkg = this.package(id); if (pkg) { pkg.status = 'Validated'; this.saveState(); } return pkg; }
  exportPackage(id: string) {
    const pkg = this.package(id);
    if (!pkg) return null;
    const fileName = `${pkg.id}.harbor.json`;
    const exportRecord = { status: pkg.status === 'Validated' ? 'exported' : 'incomplete', schema: pkg.harborSchema, fileName, package: pkg };
    fs.writeFileSync(path.join(this.storagePath, fileName), JSON.stringify(exportRecord, null, 2));
    return exportRecord;
  }
  agents() { return this.agentsStore; }
  executeAgents(taskId: string, body: any) {
    const task = this.task(taskId);
    const executions = (body.agentIds ?? this.agentsStore.map(a => a.id)).map((agentId: string) => ({ id: `exec-${randomUUID().slice(0, 8)}`, taskId, agentId, status: 'queued', isolated: true, hiddenTestsMounted: false }));
    return { taskId, taskVersion: task?.status === 'ready_for_validation' ? '1.0.0' : 'draft', executions };
  }
  evaluations() { return this.evaluationsStore; }
}
