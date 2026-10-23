import type { StewardApi } from '@shared/types/ipc';

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts. The renderer's only route to the system. */
    steward: StewardApi;
  }
}

export {};
