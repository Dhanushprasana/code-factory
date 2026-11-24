import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'evaluations' })
export class EvaluationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @Column({ name: 'agent_config_id', type: 'uuid', nullable: true })
  agentConfigId: string | null;

  @Column({ name: 'agent_name', type: 'varchar', length: 160 })
  agentName: string;

  @Column({ name: 'model_name', type: 'varchar', length: 128 })
  modelName: string;

  @Column({ type: 'varchar', length: 64, default: 'Custom' })
  provider: string;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0.0 })
  reward: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0.0 })
  score: number;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metrics: Record<string, any>;

  @Column({ name: 'trajectory_logs', type: 'text', default: '' })
  trajectoryLogs: string;

  @Column({ name: 'test_output', type: 'text', default: '' })
  testOutput: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'harbor_job_id', type: 'varchar', length: 128, nullable: true })
  harborJobId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
