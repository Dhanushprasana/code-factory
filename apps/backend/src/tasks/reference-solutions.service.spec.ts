import { BadRequestException } from '@nestjs/common';
jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => () => undefined }));
import { ReferenceSolutionsService } from './reference-solutions.service';

describe('ReferenceSolutionsService review gates', () => {
  const createService = (reference: Record<string, any>) => {
    const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
    const references = {
      findOneBy: jest.fn().mockResolvedValue(reference),
      save: jest.fn(async (value) => value),
    };
    Object.assign(service, { references });
    return { service, references };
  };

  it.each(['openrouter', 'ollama'])('reuses the task-generation provider: %s', async (provider) => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const referenceRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'reference-1', ...value })),
    };
    const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
    Object.assign(service, {
      tasks: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 'task-1',
          projectId: 'project-1',
          generationId: 'generation-1',
          currentVersion: 1,
          baselineManifest: [],
        }),
      },
      generations: {
        findOneBy: jest.fn().mockResolvedValue({ provider }),
      },
      taskVersions: {
        findOneBy: jest.fn().mockResolvedValue({ content: { title: 'Saved task' } }),
      },
      references: referenceRepository,
      referenceQueue: queue,
    });

    const result = await service.generate('task-1');

    expect(result.provider).toBe(provider);
    expect(queue.add).toHaveBeenCalledWith(
      'generate',
      { referenceId: 'reference-1' },
      expect.objectContaining({ jobId: 'reference-1' }),
    );
  });

  it('does not allow approval until a reviewer records passing build and test validation', async () => {
    const reference = {
      id: 'reference-1',
      status: 'pending_review',
      patches: [{ repository_id: 'repo-1', patch_diff: 'diff --git a/src/file.ts b/src/file.ts' }],
      tests: [{ file_path: 'test/file.spec.ts' }],
      validation: { build: 'not_run', tests: 'not_run', execution_mode: 'not_run' },
    };
    const { service } = createService(reference);

    await expect(service.review('reference-1', { action: 'approve' }))
      .rejects.toThrow(BadRequestException);
  });

  it('does not allow validation after a reference leaves pending review', async () => {
    const { service, references } = createService({
      id: 'reference-1',
      status: 'changes_requested',
      validation: { build: 'not_run', tests: 'not_run', execution_mode: 'not_run' },
    });

    await expect(service.recordValidation('reference-1', {
      buildStatus: 'passed',
      testStatus: 'passed',
      notes: 'Checked locally.',
    })).rejects.toThrow(BadRequestException);

    expect(references.save).not.toHaveBeenCalled();
  });

  it('requires notes for passing manual checks and approves only after both pass', async () => {
    const reference = {
      id: 'reference-1',
      status: 'pending_review',
      patches: [{ repository_id: 'repo-1', patch_diff: 'diff --git a/src/file.ts b/src/file.ts' }],
      tests: [{ file_path: 'test/file.spec.ts' }],
      validation: { build: 'not_run', tests: 'not_run', execution_mode: 'not_run' },
    };
    const { service, references } = createService(reference);

    await expect(service.recordValidation('reference-1', {
      buildStatus: 'passed',
      testStatus: 'passed',
    })).rejects.toThrow(BadRequestException);

    await service.recordValidation('reference-1', {
      buildStatus: 'passed',
      testStatus: 'passed',
      notes: 'Reviewer ran the build and public tests in the pinned checkout.',
    });
    const approved = await service.review('reference-1', { action: 'approve' });

    expect(approved.status).toBe('approved');
    expect(reference.validation.execution_mode).toBe('manual_confirmation');
    expect(references.save).toHaveBeenCalledTimes(2);
  });
});
