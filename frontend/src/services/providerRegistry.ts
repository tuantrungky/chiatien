import { isFirebaseConfigured } from './firebase/config';
import { isGasConfigured } from './providers/gasProvider';
import type { DbProviderMode } from './providers/types';

const OVERRIDE_STORAGE_KEY = 'cln_db_provider_override_v1';
const listeners = new Set<(mode: DbProviderMode) => void>();

function normalizeMode(raw: unknown): DbProviderMode | null {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'firebase' || s === 'gas' || s === 'mock') return s;
  return null;
}

export interface ProviderCapabilities {
  firebaseReady: boolean;
  gasReady: boolean;
  envDefault: DbProviderMode;
  override: DbProviderMode | null;
  active: DbProviderMode;
}

export function isProviderAvailable(mode: DbProviderMode): boolean {
  if (mode === 'mock') return true;
  if (mode === 'firebase') return isFirebaseConfigured();
  if (mode === 'gas') return isGasConfigured();
  return false;
}

export function getEnvDefaultProviderMode(): DbProviderMode {
  const useMock = String(import.meta.env?.VITE_USE_MOCK || '').trim().toLowerCase() === 'true';
  if (useMock) return 'mock';

  const explicit = normalizeMode(import.meta.env?.VITE_DB_PROVIDER);
  if (explicit && isProviderAvailable(explicit)) {
    return explicit;
  }

  if (isFirebaseConfigured()) return 'firebase';
  if (isGasConfigured()) return 'gas';
  return 'mock';
}

export function getLocalProviderOverride(): DbProviderMode | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(OVERRIDE_STORAGE_KEY);
    const parsed = normalizeMode(raw);
    if (parsed && isProviderAvailable(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function getActiveProviderMode(): DbProviderMode {
  return getLocalProviderOverride() ?? getEnvDefaultProviderMode();
}

export function setLocalProviderOverride(mode: DbProviderMode | null): DbProviderMode {
  if (typeof localStorage !== 'undefined') {
    try {
      if (mode && isProviderAvailable(mode)) {
        localStorage.setItem(OVERRIDE_STORAGE_KEY, mode);
      } else {
        localStorage.removeItem(OVERRIDE_STORAGE_KEY);
      }
    } catch {
      // Ignore storage quota errors
    }
  }
  const active = getActiveProviderMode();
  for (const listener of listeners) {
    listener(active);
  }
  return active;
}

export function subscribeProviderMode(listener: (mode: DbProviderMode) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProviderCapabilities(): ProviderCapabilities {
  return {
    firebaseReady: isFirebaseConfigured(),
    gasReady: isGasConfigured(),
    envDefault: getEnvDefaultProviderMode(),
    override: getLocalProviderOverride(),
    active: getActiveProviderMode(),
  };
}

export function getActiveProviderDisplayName(mode: DbProviderMode = getActiveProviderMode()): string {
  if (mode === 'firebase') return 'Firebase Firestore';
  if (mode === 'gas') return 'Google Sheets (GAS)';
  return 'Mock Demo';
}
