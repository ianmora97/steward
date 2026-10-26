import { create } from 'zustand';
import type { RedisInfoSnapshot, RedisMessageEvent } from '@shared/schemas/redis';

/** The console history, the Insights samples and the Pub/Sub messages live here and nowhere else: nothing is saved. */
const HISTORY_MAX = 200;
const INFO_RING = 150; // about five minutes at one sample every two seconds
const MESSAGE_RING = 1000;

export interface RedisSubscriptionView {
  subscriptionId: string;
  connectionId: string;
  label: string;
  messages: RedisMessageEvent[];
  /** Why it stopped, once it has. */
  endedReason: string | null;
  /** Messages received since the view was last at the bottom, for the badge. */
  unseen: number;
}

interface RedisState {
  history: Record<string, string[]>;
  info: Record<string, RedisInfoSnapshot[]>;
  subscriptions: Record<string, RedisSubscriptionView>;

  pushHistory: (connectionId: string, line: string) => void;
  pushInfo: (connectionId: string, snapshot: RedisInfoSnapshot) => void;
  clearInfo: (connectionId: string) => void;
  addSubscription: (view: Omit<RedisSubscriptionView, 'messages' | 'endedReason' | 'unseen'>) => void;
  receive: (event: RedisMessageEvent) => void;
  endSubscription: (subscriptionId: string, reason: string) => void;
  markSeen: (subscriptionId: string) => void;
  removeSubscription: (subscriptionId: string) => void;
  clearMessages: (subscriptionId: string) => void;
}

export const useRedisStore = create<RedisState>((set) => ({
  history: {},
  info: {},
  subscriptions: {},

  pushHistory: (connectionId, line) =>
    set((state) => {
      const previous = state.history[connectionId] ?? [];
      if (previous[previous.length - 1] === line) return state;
      return { history: { ...state.history, [connectionId]: [...previous, line].slice(-HISTORY_MAX) } };
    }),

  pushInfo: (connectionId, snapshot) =>
    set((state) => ({
      info: { ...state.info, [connectionId]: [...(state.info[connectionId] ?? []), snapshot].slice(-INFO_RING) }
    })),

  clearInfo: (connectionId) =>
    set((state) => {
      const { [connectionId]: _removed, ...rest } = state.info;
      return { info: rest };
    }),

  addSubscription: (view) =>
    set((state) => ({
      subscriptions: { ...state.subscriptions, [view.subscriptionId]: { ...view, messages: [], endedReason: null, unseen: 0 } }
    })),

  receive: (event) =>
    set((state) => {
      const current = state.subscriptions[event.subscriptionId];
      if (current === undefined) return state;
      return {
        subscriptions: {
          ...state.subscriptions,
          [event.subscriptionId]: {
            ...current,
            messages: [...current.messages, event].slice(-MESSAGE_RING),
            unseen: current.unseen + 1
          }
        }
      };
    }),

  endSubscription: (subscriptionId, reason) =>
    set((state) => {
      const current = state.subscriptions[subscriptionId];
      if (current === undefined) return state;
      return { subscriptions: { ...state.subscriptions, [subscriptionId]: { ...current, endedReason: reason } } };
    }),

  markSeen: (subscriptionId) =>
    set((state) => {
      const current = state.subscriptions[subscriptionId];
      if (current === undefined || current.unseen === 0) return state;
      return { subscriptions: { ...state.subscriptions, [subscriptionId]: { ...current, unseen: 0 } } };
    }),

  removeSubscription: (subscriptionId) =>
    set((state) => {
      const { [subscriptionId]: _removed, ...rest } = state.subscriptions;
      return { subscriptions: rest };
    }),

  clearMessages: (subscriptionId) =>
    set((state) => {
      const current = state.subscriptions[subscriptionId];
      if (current === undefined) return state;
      return { subscriptions: { ...state.subscriptions, [subscriptionId]: { ...current, messages: [], unseen: 0 } } };
    })
}));

let listening = false;

/** Connects the main process's push events to the store, once per page load. */
export function listenToRedisEvents(): void {
  if (listening) return;
  listening = true;
  window.steward.redis.onMessage((event) => useRedisStore.getState().receive(event));
  window.steward.redis.onSubscriptionEnd((event) => useRedisStore.getState().endSubscription(event.subscriptionId, event.reason));
}
