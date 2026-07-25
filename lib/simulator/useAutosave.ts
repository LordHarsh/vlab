'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CircuitDoc } from './model/document'
import { parseCodeBundle, type CodeBundle } from './model/code'
import { attemptKey, loadLocal, markSynced, saveLocal } from './persistence'
import { loadAttempt, saveAttempt } from '@/lib/actions/simulator'

export type SaveState = 'idle' | 'local' | 'saving' | 'saved' | 'offline'

/**
 * Where the document the editor opened with came from.
 *
 *  - `attempt` — the student's own saved work, on the server.
 *  - `starter` — the authored circuits.role='starter' row for this simulation.
 *  - `local`   — an IndexedDB copy, either unsynced work or an offline cache.
 *  - `none`    — nothing was found, so the caller's own initial document stands.
 */
export type RestoreSource = 'attempt' | 'starter' | 'local' | 'none'

export interface RemoteTarget {
  simulationId: string
  classId: string
}

/**
 * Which of two candidate bundles to restore, when the wiring and the source
 * come from different places.
 *
 * The doc's winner is preferred, but only if it actually carries a file. An
 * IndexedDB record written before the code panel shipped has NO `code` key at
 * all, and that record legitimately wins the document race (it is unsynced
 * work) — so taking its absent code as gospel would silently discard a program
 * the server is still holding. Absence is not a deletion.
 */
function bestCode(primary: CodeBundle | null, fallback: CodeBundle | null): CodeBundle | null {
  if (primary && primary.files.length > 0) return primary
  if (fallback && fallback.files.length > 0) return fallback
  return primary ?? fallback
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
 *
 * `code` — the student's SOURCE — rides the same path as the wiring, on purpose.
 * Two save paths with two debounces would eventually disagree about which of a
 * program and the circuit it ran on is the newer, and a student would reload
 * into a mismatched pair. One document, one write, one "saved" indicator.
 */
export function useAutosave(doc: CircuitDoc, remote?: RemoteTarget, code?: CodeBundle) {
  const key = remote ? attemptKey(remote.simulationId, remote.classId) : 'dev:scratch'
  const [state, setState] = useState<SaveState>('idle')
  const [restored, setRestored] = useState<CircuitDoc | null>(null)
  const [restoredCode, setRestoredCode] = useState<CodeBundle | null>(null)
  const [restoreSource, setRestoreSource] = useState<RestoreSource>('none')
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
        // The server action can reject outright — an unauthenticated harness, a
        // dropped connection, a redeploy mid-flight. It must not take the
        // restore down with it: `restoreChecked` gates BOTH the first render of
        // the editor and the arming of autosave, so a throw that escaped here
        // would leave the student looking at a spinner that never saves.
        let graph: CircuitDoc | null = null
        let remoteCode: CodeBundle | null = null
        let source: RestoreSource = 'none'
        try {
          const res = await loadAttempt(remote.simulationId, remote.classId)
          remoteCode = parseCodeBundle(res.code)
          if (res.graph) {
            graph = res.graph as unknown as CircuitDoc
            source = res.source === 'attempt' ? 'attempt' : 'starter'
          }
        } catch {
          // Falls through to whatever the local copy holds.
        }
        if (cancelled) return
        // Prefer whichever is newer in intent: unsynced local work always wins,
        // because it is by definition work the server has not seen.
        if (local && !local.synced) {
          setRestored(local.doc)
          setRestoredCode(bestCode(local.code ?? null, remoteCode))
          setRestoreSource('local')
        } else if (graph) {
          setRestored(graph)
          setRestoredCode(bestCode(remoteCode, local?.code ?? null))
          setRestoreSource(source)
        } else if (local) {
          setRestored(local.doc)
          setRestoredCode(bestCode(local.code ?? null, remoteCode))
          setRestoreSource('local')
        }
      } else if (local) {
        setRestored(local.doc)
        setRestoredCode(local.code ?? null)
        setRestoreSource('local')
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
      const res = await saveAttempt(
        remote.simulationId,
        remote.classId,
        { parts: doc.parts, wires: doc.wires },
        code,
      )
      if (res.success) {
        await markSynced(key)
        setState('saved')
      } else {
        setState('offline')
      }
    } catch {
      setState('offline')
    }
  }, [code, doc, key, remote])

  // ── Persist on change ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!restoreChecked) return
    if (!primed.current) {
      primed.current = true
      return
    }

    if (localTimer.current) clearTimeout(localTimer.current)
    localTimer.current = setTimeout(() => {
      void saveLocal(key, doc, false, code)
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
    // `code` joins `doc` as a change trigger, so typing a line of Python is
    // exactly as much of an edit as dragging a wire.
  }, [code, doc, key, remote, restoreChecked, syncNow])

  // A last-chance local write on unload. Deliberately local only: a fetch fired
  // during pagehide is not reliably delivered, and IndexedDB is.
  //
  // This is what actually catches a reload typed into within the last 400 ms —
  // the debounced write above may not have fired yet, and losing the last thing
  // a student typed is exactly the failure this whole module exists to prevent.
  useEffect(() => {
    const flush = () => void saveLocal(key, doc, false, code)
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [code, doc, key])

  return { state, restored, restoredCode, restoreSource, restoreChecked, syncNow }
}
