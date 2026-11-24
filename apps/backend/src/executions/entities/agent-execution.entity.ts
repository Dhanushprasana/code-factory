import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AgentAssignmentEntity } from './agent-assignment.entity';
import { AgentSubmissionEntity } from './agent-submission.entity';

@Entity({ name: 'agent_executions' })
export class AgentExecutionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'assignment_id', type: 'uuid' }) assignmentId: string;
  @ManyToOne(() => AgentAssignmentEntity, (assignment) => assignment.executions, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'assignment_id' }) assignment: AgentAssignmentEntity;
  @Column({ type: 'varchar', length: 24, default: 'queued' }) status: string;
  @Column({ name: 'adapter_type', type: 'varchar', length: 64 }) adapterType: string;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ name: 'workspace_path', type: 'text', nullable: true }) workspacePath: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'" }) metadata: Record<string, unknown>;
  @Column({ name: 'log_artifact', type: 'text', nullable: true }) logArtifact: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @OneToMany(() => AgentSubmissionEntity, (submission) => submission.execution) submissions: AgentSubmissionEntity[];
}
