import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AgentEntity } from './agent.entity';

@Entity({ name: 'agent_configs' })
@Unique('uq_agent_configs_version', ['agentId', 'configVersion'])
export class AgentConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ManyToOne(() => AgentEntity, (agent) => agent.configs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: AgentEntity;

  @Column({ name: 'config_version', type: 'int', default: 1 })
  configVersion: number;

  @Column({ name: 'model_name', type: 'varchar', length: 128 })
  modelName: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  settings: Record<string, any>;

  @Column({ name: 'credential_reference', type: 'varchar', length: 255, nullable: true })
  credentialReference: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
