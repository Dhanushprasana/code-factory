import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AgentConfigEntity } from '../../agents/entities/agent-config.entity';
import { AgentEntity } from '../../agents/entities/agent.entity';
import { ReferenceSolutionEntity } from '../../tasks/entities/reference-solution.entity';
import { TaskEntity } from '../../tasks/entities/task.entity';
import { AgentExecutionEntity } from './agent-execution.entity';

@Entity({ name: 'agent_assignments' })
export class AgentAssignmentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'task_id', type: 'uuid' }) taskId: string;
  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'task_id' }) task: TaskEntity;
  @Column({ name: 'task_version', type: 'integer' }) taskVersion: number;
  @Column({ name: 'reference_id', type: 'uuid' }) referenceId: string;
  @ManyToOne(() => ReferenceSolutionEntity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'reference_id' }) reference: ReferenceSolutionEntity;
  @Column({ name: 'agent_id', type: 'uuid' }) agentId: string;
  @ManyToOne(() => AgentEntity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'agent_id' }) agent: AgentEntity;
  @Column({ name: 'config_id', type: 'uuid', nullable: true }) configId: string | null;
  @ManyToOne(() => AgentConfigEntity, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'config_id' }) config: AgentConfigEntity | null;
  @Column({ type: 'varchar', length: 24, default: 'queued' }) status: string;
  @Column({ name: 'baseline_manifest', type: 'jsonb' }) baselineManifest: Record<string, unknown>[];
  @CreateDateColumn({ name: 'assigned_at' }) assignedAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @OneToMany(() => AgentExecutionEntity, (execution) => execution.assignment) executions: AgentExecutionEntity[];
}
