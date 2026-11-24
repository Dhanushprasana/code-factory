import { Module } from '@nestjs/common';
import * as path from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { InitialProjectsAndRepositories1710000000000 } from './database/migrations/1710000000000-InitialProjectsAndRepositories';
import { CreateAgentsTables1710000000001 } from './database/migrations/1710000000001-CreateAgentsTables';
import { RepositoryAnalyses1795280400000 } from './database/migrations/1795280400000-RepositoryAnalyses';
import { AnalysisModule } from './analysis/analysis.module';
import { GitHubModule } from './github/github.module';
import { ProjectsModule } from './projects/projects.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { WorkflowModule } from './workflow/workflow.module';
import { AgentsModule } from './agents/agents.module';
import { TasksModule } from './tasks/tasks.module';
import { CreateTaskFactoryTables1710000000002 } from './database/migrations/1710000000002-CreateTaskFactoryTables';
import { ReferenceSolutions1795280500000 } from './database/migrations/1795280500000-ReferenceSolutions';
import { AddContextToRepositoryAnalyses1795280600000 } from './database/migrations/1795280600000-AddContextToRepositoryAnalyses';
import { AddHarborFilesToTasks1795280700000 } from './database/migrations/1795280700000-AddHarborFilesToTasks';
import { AddHarborVerificationToTasks1795280800000 } from './database/migrations/1795280800000-AddHarborVerificationToTasks';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, '../.env'), path.resolve(process.cwd(), '.env')],
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: Number(config.get('DATABASE_PORT', 5432)),
        username: config.get<string>('DATABASE_USER', 'forgebench'),
        password: config.get<string>('DATABASE_PASSWORD', 'local_dev_password'),
        database: config.get<string>('DATABASE_NAME', 'forgebench'),
        autoLoadEntities: true,
        migrations: [
          InitialProjectsAndRepositories1710000000000,
          RepositoryAnalyses1795280400000,
          CreateAgentsTables1710000000001,
          CreateTaskFactoryTables1710000000002,
          ReferenceSolutions1795280500000,
          AddContextToRepositoryAnalyses1795280600000,
          AddHarborFilesToTasks1795280700000,
          AddHarborVerificationToTasks1795280800000,
        ],
        migrationsRun: true,
        synchronize: true,
        retryAttempts: 5,
        retryDelay: 2000,
      }),
    }),
    ProjectsModule,
    RepositoriesModule,
    AnalysisModule,
    GitHubModule,
    WorkflowModule,
    AgentsModule,
    TasksModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
