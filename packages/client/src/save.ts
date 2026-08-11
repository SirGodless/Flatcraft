import type { SimSave } from "@flatcraft/sim";

/**
 * World persistence in the browser: one save slot in IndexedDB (which
 * handles multi-megabyte snapshots and structured data natively).
 */
const DB_NAME = "flatcraft";
const STORE = "saves";
const SLOT = "world";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveWorld(data: SimSave): Promise<void> {
  await withStore("readwrite", (store) => store.put(data, SLOT));
}

export async function loadWorld(): Promise<SimSave | null> {
  try {
    const result = await withStore<SimSave | undefined>("readonly", (store) => store.get(SLOT));
    return result ?? null;
  } catch {
    return null;
  }
}

export async function deleteWorld(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(SLOT));
}
