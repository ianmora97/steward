import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

/** The most toasts on screen at once; a burst of actions never buries the window. */
export const MAX_TOASTS = 4;

interface ToastState {
  toasts: ToastItem[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) =>
    set((state) => {
      const next = [...state.toasts, { id: nextId++, tone, message }];
      // Over the cap, the oldest success or info goes first: an error stays until the user closes it.
      while (next.length > MAX_TOASTS) {
        const evict = next.findIndex((item) => item.tone !== 'error');
        next.splice(evict === -1 ? 0 : evict, 1);
      }
      return { toasts: next };
    }),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
}));

/** Tell the user what just happened: "Connection saved", "Key deleted". Call it from anywhere. */
export const toast = {
  success: (message: string): void => useToastStore.getState().push('success', message),
  error: (message: string): void => useToastStore.getState().push('error', message),
  info: (message: string): void => useToastStore.getState().push('info', message)
};
