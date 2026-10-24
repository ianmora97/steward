import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { StewardServiceError } from '@shared/types/result';

/**
 * Path validation for anything that arrives from the renderer.
 *
 * The renderer is never the authority on what is reachable on disk: it sends a
 * candidate string, and this module decides whether it is an absolute,
 * existing directory. Normalizing with `resolve` collapses `..` segments so a
 * traversal attempt cannot survive as a usable path.
 */
export interface ValidatedDirectory {
  path: string;
}

export function normalizeAbsolutePath(input: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new StewardServiceError('PATH_INVALID', 'a path is required');
  }
  if (input.includes('\0')) {
    throw new StewardServiceError('PATH_INVALID', 'path must not contain null bytes');
  }
  if (!isAbsolute(input)) {
    throw new StewardServiceError('PATH_INVALID', 'path must be absolute');
  }
  return resolve(input);
}

export function validateExistingDirectory(input: string): ValidatedDirectory {
  const path = normalizeAbsolutePath(input);

  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new StewardServiceError('PATH_NOT_FOUND', 'that folder does not exist or is not readable');
  }

  if (!stats.isDirectory()) {
    throw new StewardServiceError('PATH_INVALID', 'that path is a file, not a folder');
  }

  return { path };
}

/** An existing regular file. Only its path is kept: Steward never opens or reads it (used for SSH key files). */
export function validateExistingFile(input: string): ValidatedDirectory {
  const path = normalizeAbsolutePath(input);

  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new StewardServiceError('PATH_NOT_FOUND', 'that file does not exist or is not readable');
  }

  if (!stats.isFile()) {
    throw new StewardServiceError('PATH_INVALID', 'that path is not a file');
  }

  return { path };
}
