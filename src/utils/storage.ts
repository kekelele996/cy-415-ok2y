import { del, get, set } from 'idb-keyval';

import type { PersistedEnvelope } from '@/types';

const STORAGE_VERSION = 1;
const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 365;

const prefixed = (key: string) => `reswap:${key}`;

export const STORAGE_KEYS = {
  currentUserId: prefixed('current-user-id'),
  users: prefixed('users'),
  items: prefixed('items'),
  exchanges: prefixed('exchanges'),
  accounts: prefixed('accounts'),
  ledger: prefixed('ledger'),
  settlements: prefixed('settlements'),
  journal: prefixed('settlement-journal'),
  theme: prefixed('theme'),
  lastClean: prefixed('last-clean'),
};

export interface TransactionOperation<T = unknown> {
  key: string;
  value: T;
}

interface TransactionJournal {
  id: string;
  created_at: string;
  snapshots: Record<string, string | null>;
}

const now = () => Date.now();

const envelope = <T>(payload: T, ttl = DEFAULT_TTL): PersistedEnvelope<T> => ({
  version: STORAGE_VERSION,
  expiresAt: now() + ttl,
  payload,
});

const toPlain = <T>(payload: T): T => JSON.parse(JSON.stringify(payload)) as T;

const isExpired = <T>(data: PersistedEnvelope<T> | null) => {
  if (!data) return false;
  return Boolean(data.expiresAt && data.expiresAt < now());
};

const parseLocal = <T>(key: string): PersistedEnvelope<T> | null => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedEnvelope<T>;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
};

const writeLocal = <T>(key: string, payload: T, ttl?: number) => {
  localStorage.setItem(key, JSON.stringify(envelope(payload, ttl)));
};

const restoreSnapshot = async (key: string, raw: string | null) => {
  if (raw === null) {
    localStorage.removeItem(key);
    await del(key);
    return;
  }
  localStorage.setItem(key, raw);
  await set(key, JSON.parse(raw));
};

export const storage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const localEnvelope = parseLocal<T>(key);
    if (isExpired(localEnvelope)) {
      await this.remove(key);
      return fallback;
    }
    if (localEnvelope?.version === STORAGE_VERSION) {
      return localEnvelope.payload;
    }

    const indexedEnvelope = await get<PersistedEnvelope<T>>(key);
    if (isExpired(indexedEnvelope ?? null)) {
      await this.remove(key);
      return fallback;
    }
    if (indexedEnvelope?.version === STORAGE_VERSION) {
      writeLocal(key, indexedEnvelope.payload);
      return indexedEnvelope.payload;
    }
    return fallback;
  },

  async set<T>(key: string, payload: T, ttl?: number): Promise<T> {
    const plainPayload = toPlain(payload);
    const packed = envelope(plainPayload, ttl);
    localStorage.setItem(key, JSON.stringify(packed));
    await set(key, packed);
    return plainPayload;
  },

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
    await del(key);
  },

  async runTransaction(operations: TransactionOperation[]): Promise<void> {
    if (!operations.length) return;
    const snapshots: Record<string, string | null> = {};
    for (const operation of operations) {
      snapshots[operation.key] = localStorage.getItem(operation.key);
    }
    const journal: TransactionJournal = {
      id: this.createId('tx'),
      created_at: new Date().toISOString(),
      snapshots,
    };
    localStorage.setItem(STORAGE_KEYS.journal, JSON.stringify(envelope(journal)));
    try {
      for (const operation of operations) {
        await this.set(operation.key, operation.value);
      }
    } catch (error) {
      for (const [key, raw] of Object.entries(snapshots)) {
        await restoreSnapshot(key, raw);
      }
      localStorage.removeItem(STORAGE_KEYS.journal);
      await del(STORAGE_KEYS.journal);
      throw error;
    }
    localStorage.removeItem(STORAGE_KEYS.journal);
    await del(STORAGE_KEYS.journal);
  },

  async recoverTransaction(): Promise<boolean> {
    const packed = parseLocal<TransactionJournal>(STORAGE_KEYS.journal);
    if (!packed) return false;
    for (const [key, raw] of Object.entries(packed.payload.snapshots)) {
      await restoreSnapshot(key, raw);
    }
    localStorage.removeItem(STORAGE_KEYS.journal);
    await del(STORAGE_KEYS.journal);
    return true;
  },

  async cleanExpired(): Promise<void> {
    const keys = Object.values(STORAGE_KEYS);
    await Promise.all(
      keys.map(async (key) => {
        const localEnvelope = parseLocal<unknown>(key);
        if (isExpired(localEnvelope)) {
          await this.remove(key);
        }
      }),
    );
    localStorage.setItem(STORAGE_KEYS.lastClean, JSON.stringify(envelope(new Date().toISOString())));
  },

  createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  },
};
