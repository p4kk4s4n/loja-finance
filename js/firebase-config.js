// Firebase modular SDK v11 initialization + runtime config override support
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

// Paste your Firebase Web App config here before deploying to GitHub Pages,
// OR paste it once in the in-app Setup prompt (stored in localStorage for local testing).
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB0v9-aGHvzevHu370VX4ggm-2oHpPHoLU",
  authDomain: "loja-finance.firebaseapp.com",
  projectId: "loja-finance",
  storageBucket: "loja-finance.firebasestorage.app",
  messagingSenderId: "37690286729",
  appId: "1:37690286729:web:07d92d7767660d52d65c58"
};

const LOCAL_CONFIG_KEY = 'loja_firebase_config';

export function getFirebaseConfig() {
  if (DEFAULT_FIREBASE_CONFIG.apiKey && DEFAULT_FIREBASE_CONFIG.projectId) {
    return DEFAULT_FIREBASE_CONFIG;
  }
  try {
    const saved = localStorage.getItem(LOCAL_CONFIG_KEY);
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return null;
}

export function isFirebaseConfigured() {
  const cfg = getFirebaseConfig();
  return Boolean(cfg && cfg.apiKey && cfg.projectId && cfg.appId);
}

export function saveLocalFirebaseConfig(cfg) {
  localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(cfg));
}

let firebaseHandles = null;

export async function initFirebase() {
  if (firebaseHandles) return firebaseHandles;

  const cfg = getFirebaseConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    throw new Error('Firebase configuration missing.');
  }

  const app = initializeApp(cfg);
  const auth = getAuth(app);

  let db;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (_) {
    db = getFirestore(app);
  }

  await ensureAnonymousAuth(auth);
  firebaseHandles = { app, auth, db };
  return firebaseHandles;
}

function ensureAnonymousAuth(auth) {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      async (user) => {
        unsub();
        if (user) {
          resolve(user);
          return;
        }
        try {
          const cred = await signInAnonymously(auth);
          resolve(cred.user);
        } catch (err) {
          reject(err);
        }
      },
      (err) => {
        unsub();
        reject(err);
      }
    );
  });
}

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
};
