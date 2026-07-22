'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CircuitDoc } from './model/document'
import { attemptKey, loadLocal, markSynced, saveLocal } from './persistence'
import { loadAttempt, saveAttempt } from '@/lib/actions/simulator'

export type SaveState = 'idle' | 'local' | 'saving' | 'saved' | 'offline'

export interface RemoteTarget {
  simulationId: string
  classId: string
}

/** How long the editor stays quiet before a server write. */
const SYNC_DEBOUNCE_MS = 3000
/** Local writes are cheap, but no point storing every pixel of a drag. */
const LOCAL_DEBOUNCE_MS = 400

/**
 * Autosave for a circuit document.
 *
 * Local-first: IndexedDB is written on a short debounce and never fails the
 * editor, then the server is updated on a longer one. §7 is explicit that
 * losing work to a dropped connection is what kills adoption, so the network
 * is treated as an optimisation over the local copy rather than the source of
 * truth during a session.
 *
 * Without `remote` (the dev harness has no class or simulation) it degrades to
 * local-only, which is still enough to survive a refresh.
 */
export function useAutosave(doc: CircuitDoc, remote?: RemoteTarget) {
  const key = remote ? attemptKey(remote.simulationId, remote.classId) : 'dev:scratch'
  const [state, setState] = useState<SaveState>('idle')
  const [restored, setRestored] = useState<CircuitDoc | null>(null)
  const [restoreChecked, setRestoreChecked] = useState(false)

  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Skip persisting the very first render: that document came FROM storage or
  // from the authored starter, and writing it straight back would mark a
  // pristine load as unsynced work.
  const primed = useRef(false)

  // ── Restore on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = await loadLocal(key)
      if (cancelled) return

      if (remote) {
        const res = await loadAttempt(remote.simulationId, remote.classId)
        if (cancelled) return
        // Prefer whichever is newer in intent: unsynced local work always wins,
        // because it is by definition work the server has not seen.
        if (local && !local.synced) setRestored(local.doc)
        else if (res.graph) setRestored(res.graph as unknown as CircuitDoc)
        else if (local) setRestored(local.doc)
      } else if (local) {
        setRestored(local.doc)
      }
      setRestoreChecked(true)
    })()
    return () => {
      cancelled = true
    }
    // Only ever runs for the initial target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const syncNow = useCallback(async () => {
    if (!remote) return
    setState('saving')
    try {
      const res = await saveAttempt(remote.simulationId, remote.classId, {
        parts: doc.parts,
        wires: doc.wires,
      })
      if (res.success) {
        await markSynced(key)
        setState('saved')
      } else {
        setState('offline')
      }
    } catch {
      setState('offline')
    }
  }, [doc, key, remote])

  // ── Persist on change ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!restoreChecked) return
    if (!primed.current) {
      primed.current = true
      return
    }

    if (localTimer.current) clearTimeout(localTimer.current)
    localTimer.current = setTimeout(() => {
      void saveLocal(key, doc, false)
      setState((s) => (s === 'saving' ? s : 'local'))
    }, LOCAL_DEBOUNCE_MS)

    if (remote) {
      if (syncTimer.current) clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS)
    }

    return () => {
      if (localTimer.current) clearTimeout(localTimer.current)
      if (syncTimer.current) clearTimeout(syncTimer.current)
    }
  }, [doc, key, remote, restoreChecked, syncNow])

  // A last-chance local write on unload. Deliberately local only: a fetch fired
  // during pagehide is not reliably delivered, and IndexedDB is.
  useEffect(() => {
    const flush = () => void saveLocal(key, doc, false)
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [doc, key])

  return { state, restored, restoreChecked, syncNow }
}
