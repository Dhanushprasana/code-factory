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

  @OneToMany(() => AgentConfigEntity, (config) => config.agent, { cascade: true })
  configs: AgentConfigEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
