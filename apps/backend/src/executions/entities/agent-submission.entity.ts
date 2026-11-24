import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AgentExecutionEntity } from './agent-execution.entity';
import { AgentEvaluationEntity } from './agent-evaluation.entity';

@Entity({ name: 'agent_submissions' })
export class AgentSubmissionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'execution_id', type: 'uuid' }) executionId: string;
  @ManyToOne(() => AgentExecutionEntity, (execution) => execution.submissions, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'execution_id' }) execution: AgentExecutionEntity;
  @Column({ type: 'varchar', length: 24, default: 'collected' }) status: string;
  @Column({ name: 'patch_diff', type: 'text', nullable: true }) patchDiff: string | null;
  @Column({ name: 'patch_valid', type: 'boolean', default: false }) patchValid: boolean;
  @Column({ type: 'jsonb', default: () => "'{}'" }) metadata: Record<string, unknown>;
  @Column({ name: 'artifact_path', type: 'text', nullable: true }) artifactPath: string | null;
  @CreateDateColumn({ name: 'submitted_at' }) submittedAt: Date;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @OneToMany(() => AgentEvaluationEntity, (evaluation) => evaluation.submission) evaluations: AgentEvaluationEntity[];
}
