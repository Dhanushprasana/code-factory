import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ReferenceSolutionEntity } from '../../tasks/entities/reference-solution.entity';
import { AgentSubmissionEntity } from './agent-submission.entity';

@Entity({ name: 'agent_evaluations' })
export class AgentEvaluationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'submission_id', type: 'uuid' }) submissionId: string;
  @ManyToOne(() => AgentSubmissionEntity, (submission) => submission.evaluations, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'submission_id' }) submission: AgentSubmissionEntity;
  @Column({ name: 'reference_id', type: 'uuid' }) referenceId: string;
  @ManyToOne(() => ReferenceSolutionEntity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'reference_id' }) reference: ReferenceSolutionEntity;
  @Column({ type: 'varchar', length: 24, default: 'queued' }) status: string;
  @Column({ name: 'workspace_path', type: 'text', nullable: true }) workspacePath: string | null;
  @Column({ name: 'test_results', type: 'jsonb', default: () => "'[]'" }) testResults: Record<string, unknown>[];
  @Column({ type: 'jsonb', default: () => "'{}'" }) metrics: Record<string, unknown>;
  @Column({ name: 'total_score', type: 'decimal', precision: 6, scale: 2, nullable: true }) totalScore: number | null;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
