'use client'

/**
 * Local-first persistence for circuit documents.
 *
 * SIMULATOR_ARCHITECTURE.md §7 asks for IndexedDB write-through with a
 * debounced sync to Supabase, and is blunt about why: campus wifi drops, and
 * "losing 40 minutes of wiring kills adoption harder than any missing feature".
 *
 * So the local write is synchronous-ish and unconditional; the network is
 * best-effort and never blocks the editor. IndexedDB rather than localStorage
 * because a circuit with a breadboard is tens of kilobytes of JSON and
 * localStorage is a synchronous main-thread API with a hard quota.
 */

import type { CircuitDoc } from './model/document'
import type { CodeBundle } from './model/code'

const DB_NAME = 'vlab-simulator'
const DB_VERSION = 1
const STORE = 'attempts'

export interface StoredAttempt {
  key: string
  doc: CircuitDoc
  /**
   * The student's source, when the document has a board that runs one.
   *
   * OPTIONAL, and it must stay optional: every record written before the code
   * panel existed has no `code` key, and a restore that treated its absence as
   * "the student deleted their program" would wipe work on the first load after
   * a deploy. Absent means "nothing was stored", never "stored as empty".
   */
  code?: CodeBundle
  updatedAt: number
  /** False until the server has acknowledged this version. */
  synced: boolean
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
  return dbPromise
}

// IDBRequest is invariant in its type parameter, so a callback returning
// IDBRequest<IDBValidKey> will not widen to IDBRequest<unknown>. Typing the
// callback's return as the base interface sidesteps that without any casts at
// the call sites.
function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
      }),
  )
}

export async function saveLocal(
  key: string,
  doc: CircuitDoc,
  synced = false,
  code?: CodeBundle,
): Promise<void> {
  const record: StoredAttempt = { key, doc, updatedAt: Date.now(), synced }
  // Written only when there IS one, so a document with no board never plants an
  // empty bundle over source the student typed on a previous visit.
  if (code) record.code = code
  try {
    await tx('readwrite', (s) => s.put(record))
  } catch {
    // A private-browsing profile or a blocked origin can refuse IndexedDB.
    // Losing autosave is bad; taking the editor down with it is worse.
  }
}

export async function loadLocal(key: string): Promise<StoredAttempt | null> {
  try {
    const rec = await tx<StoredAttempt | undefined>('readonly', (s) => s.get(key))
    return rec ?? null
  } catch {
    return null
  }
}

export async function markSynced(key: string): Promise<void> {
  const rec = await loadLocal(key)
  // rec.code is carried through: marking a record synced must not be the thing
  // that drops the student's source out of it.
  if (rec) await saveLocal(key, rec.doc, true, rec.code)
}

/** Every locally-stored attempt that has not reached the server yet. */
export async function pendingKeys(): Promise<string[]> {
  try {
    const all = await tx<StoredAttempt[]>('readonly', (s) => s.getAll())
    return all.filter((r) => !r.synced).map((r) => r.key)
  } catch {
    return []
  }
}

export function attemptKey(simulationId: string, classId: string): string {
  return `${simulationId}:${classId}`
}
