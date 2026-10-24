import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StewardServiceError } from '@shared/types/result';

/**
 * The slice of Electron's `safeStorage` this module needs. Injected so the
 * module stays free of Electron imports, like the IPC layer.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SecretStore {
  isAvailable(): boolean;
  save(id: string, value: string): void;
  load(id: string): string | null;
  remove(id: string): void;
}

/** Ids come from `uuidv7()`; anything else could be a path and is refused before it touches the disk. */
const ID_PATTERN = /^[0-9a-f-]{36}$/;

export function createSecretStore(deps: { directory: string; safeStorage: SafeStorageLike }): SecretStore {
  const { directory, safeStorage } = deps;

  function fileFor(id: string): string {
    if (!ID_PATTERN.test(id)) {
      throw new StewardServiceError('VALIDATION_FAILED', 'invalid secret id');
    }
    return join(directory, `${id}.bin`);
  }

  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),

    save(id, value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new StewardServiceError(
          'SECRET_STORE_UNAVAILABLE',
          'this system cannot encrypt secrets, so Steward will not store the token',
          'The OS keyring (Windows DPAPI, macOS Keychain or libsecret) is not available to Steward.'
        );
      }
      const file = fileFor(id);
      mkdirSync(directory, { recursive: true });
      writeFileSync(file, safeStorage.encryptString(value), { mode: 0o600 });
      try {
        chmodSync(file, 0o600);
      } catch {
        // Windows ignores POSIX modes; the file is still DPAPI-encrypted.
      }
    },

    load(id) {
      const file = fileFor(id);
      if (!existsSync(file)) return null;
      try {
        return safeStorage.decryptString(readFileSync(file));
      } catch {
        return null;
      }
    },

    remove(id) {
      const file = fileFor(id);
      try {
        unlinkSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  };
}
