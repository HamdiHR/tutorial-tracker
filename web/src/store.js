// Tiny IndexedDB key-value store for the device copy of the person's data (v0.40). Every call resolves, never throws:
// when storage is blocked (private window, quota) the app simply works without the device copy.
const DB = 'tt-device', STORE = 'kv';
let opening = null;
const open = () => (opening ||= new Promise((resolve) => {
  try {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = r.onblocked = () => resolve(null);
  } catch { resolve(null); }
}));
const run = async (mode, fn) => {
  const db = await open(); if (!db) return undefined;
  return new Promise((resolve) => {
    try { const tx = db.transaction(STORE, mode); const req = fn(tx.objectStore(STORE)); tx.oncomplete = () => resolve(req?.result); tx.onerror = tx.onabort = () => resolve(undefined); }
    catch { resolve(undefined); }
  });
};
export const kv = {
  get: (k) => run('readonly', (s) => s.get(k)),
  set: (k, v) => run('readwrite', (s) => s.put(v, k)),
  del: (k) => run('readwrite', (s) => s.delete(k)),
  clear: () => run('readwrite', (s) => s.clear()),
};
