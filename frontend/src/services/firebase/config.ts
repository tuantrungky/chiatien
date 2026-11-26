import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function getFirebaseEnvConfig(): FirebaseEnvConfig {
  const env = import.meta.env;
  return {
    apiKey: String(env?.VITE_FIREBASE_API_KEY || '').trim(),
    authDomain: String(env?.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: String(env?.VITE_FIREBASE_PROJECT_ID || '').trim(),
    storageBucket: String(env?.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
    messagingSenderId: String(env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId: String(env?.VITE_FIREBASE_APP_ID || '').trim(),
  };
}

export function isFirebaseConfigured(): boolean {
  const cfg = getFirebaseEnvConfig();
  return Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);
}

let cachedDb: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Chưa cấu hình đầy đủ biến môi trường Firebase (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID).'
    );
  }
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp(getFirebaseEnvConfig());
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getFirebaseDb(): Firestore {
  if (cachedDb) return cachedDb;
  const app = getFirebaseApp();
  try {
    cachedDb = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // Fallback khi môi trường (VD SSR/Private mode/test) không hỗ trợ IndexedDB persistence
    cachedDb = getFirestore(app);
  }
  return cachedDb;
}

export async function signInWithFirebaseGoogle(): Promise<{ user: User; idToken: string }> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  const idToken = await cred.user.getIdToken(true);
  return { user: cred.user, idToken };
}

export async function signOutFirebase(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  await signOut(getFirebaseAuth());
}

export async function getFreshFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
