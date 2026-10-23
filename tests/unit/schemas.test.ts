import { describe, expect, it } from 'vitest';
import { absolutePathSchema, slugify } from '@shared/schemas/common';
import { createProjectInputSchema } from '@shared/schemas/project';
import { addRepositoryInputSchema } from '@shared/schemas/repository';
import { reorderTabsInputSchema } from '@shared/schemas/tabs';

const VALID_ID = '0192f0c0-1111-7000-8000-000000000001';

describe('payload schemas', () => {
  it('requires a project name', () => {
    expect(createProjectInputSchema.safeParse({}).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ name: 'Billing' }).success).toBe(true);
  });

  it('strips unknown keys rather than trusting them', () => {
    const parsed = createProjectInputSchema.parse({ name: 'Billing', isAdmin: true });
    expect(parsed).toEqual({ name: 'Billing' });
    expect('isAdmin' in parsed).toBe(false);
  });

  it('accepts absolute paths only', () => {
    expect(absolutePathSchema.safeParse('C:\\Users\\ianmo\\dev\\steward').success).toBe(true);
    expect(absolutePathSchema.safeParse('/home/ianmo/dev/steward').success).toBe(true);
    expect(absolutePathSchema.safeParse('\\\\server\\share\\repo').success).toBe(true);
    expect(absolutePathSchema.safeParse('relative/path').success).toBe(false);
    expect(absolutePathSchema.safeParse('../../etc/passwd').success).toBe(false);
    expect(absolutePathSchema.safeParse('').success).toBe(false);
  });

  it('rejects repository payloads with a malformed project id', () => {
    const result = addRepositoryInputSchema.safeParse({
      projectId: 'not-a-uuid',
      localPath: '/tmp/repo'
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tab order containing duplicates or unknown tabs', () => {
    expect(
      reorderTabsInputSchema.safeParse({ projectId: VALID_ID, orderedTabKeys: ['git', 'terminal'] }).success
    ).toBe(true);
    expect(
      reorderTabsInputSchema.safeParse({ projectId: VALID_ID, orderedTabKeys: ['git', 'nope'] }).success
    ).toBe(false);
    expect(reorderTabsInputSchema.safeParse({ projectId: VALID_ID, orderedTabKeys: [] }).success).toBe(false);
  });
});

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('Billing Platform')).toBe('billing-platform');
    expect(slugify('  Spaced   Out  ')).toBe('spaced-out');
    expect(slugify('Ünïcôdé Núñez')).toBe('unicode-nunez');
    expect(slugify('API/v2 — gateway!')).toBe('api-v2-gateway');
  });

  it('never returns an empty slug', () => {
    expect(slugify('***')).toBe('project');
    expect(slugify('')).toBe('project');
  });
});
