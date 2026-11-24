import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AgentConfigEntity } from './agent-config.entity';

@Entity({ name: 'agents' })
export class AgentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ name: 'adapter_type', type: 'varchar', length: 64, default: 'direct-cli' })
  adapterType: string;

  @Column({ type: 'varchar', length: 64, default: 'custom' })
  provider: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 24, default: 'ready' })
  status: string;

  @Column({ name: 'model_name', type: 'varchar', length: 128, default: '' })
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

  hasApiKey?: boolean;

  @OneToMany(() => AgentConfigEntity, (config) => config.agent, { cascade: true })
  configs: AgentConfigEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
