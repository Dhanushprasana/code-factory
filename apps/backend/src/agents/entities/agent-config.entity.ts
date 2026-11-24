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

  @Column({ name: 'encrypted_api_key', type: 'text', nullable: true, select: false })
  encryptedApiKey: string | null;

  @Column({ name: 'api_key_iv', type: 'varchar', length: 64, nullable: true, select: false })
  apiKeyIv: string | null;

  @Column({ name: 'api_key_tag', type: 'varchar', length: 64, nullable: true, select: false })
  apiKeyTag: string | null;

  @Column({ name: 'api_key_masked', type: 'varchar', length: 64, nullable: true })
  apiKeyMasked: string | null;

  @Column({ name: 'harbor_harness', type: 'varchar', length: 64, default: 'openrouter' })
  harborHarness: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
