'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CircuitDoc } from '../model/document'
import type { EngineSnapshot, FromWorker, ToWorker } from './protocol'

const EMPTY: EngineSnapshot = {
  ledBrightness: {},
  currents: {},
  adc: {},
  faults: [],
  problems: [],
  serial: '',
  pins: {},
  simSeconds: 0,
  solves: 0,
  cacheHits: 0,
  pinEdges: 0,
  unknowns: 0,
  solveError: null,
  limitations: [],
  deviceStates: {},
}

/**
 * Drives the simulation worker.
 *
 * Snapshots arrive at the worker's rate (20 Hz), not the simulation rate, so
 * React commits stay decoupled from engine throughput.
 *
 * Changing firmware replaces the worker. Rather than resetting four pieces of
 * state from an effect — which is both a lint violation and a real
 * concurrent-rendering hazard — every piece of worker state is TAGGED with the
 * firmware it belongs to and readiness is derived. State from the previous
 * worker can then never be mistaken for the new one's: without that, the Run
 * button stayed enabled during the swap and 'start' arrived before 'init', which
 * the worker silently dropped.
 */
export function useSimulator(hexUrl: string, doc: CircuitDoc) {
  const workerRef = useRef<Worker | null>(null)
  const [readyFor, setReadyFor] = useState<string | null>(null)
  const [runFor, setRunFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tagged, setTagged] = useState<{ url: string; snapshot: EngineSnapshot; speed: number }>({
    url: '',
    snapshot: EMPTY,
    speed: 0,
  })
  const [bench, setBench] = useState<{ mcps: number; xRealtime: number } | null>(null)

  const ready = readyFor === hexUrl
  const running = runFor === hexUrl
  const snapshot = tagged.url === hexUrl ? tagged.snapshot : EMPTY
  const speedRatio = tagged.url === hexUrl ? tagged.speed : 0

  const docRef = useRef(doc)
  useEffect(() => {
    docRef.current = doc
  }, [doc])

  useEffect(() => {
    let disposed = false
    const url = hexUrl
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const msg = ev.data
      if (msg.type === 'ready') setReadyFor(url)
      else if (msg.type === 'snapshot')
        setTagged({ url, snapshot: msg.snapshot, speed: msg.speedRatio })
      else if (msg.type === 'error') setError(msg.message)
      else if (msg.type === 'benchmark') setBench({ mcps: msg.mcps, xRealtime: msg.xRealtime })
    }
    worker.onerror = (e) => setError(e.message || 'worker failed')

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`firmware fetch failed: ${res.status}`)
        return res.text()
      })
      .then((hex) => {
        if (disposed) return
        const msg: ToWorker = { type: 'init', hex, doc: docRef.current }
        worker.postMessage(msg)
      })
      .catch((e) => !disposed && setError(String(e)))

    return () => {
      disposed = true
      worker.terminate()
      workerRef.current = null
    }
  }, [hexUrl])

  // Push document edits through to the engine.
  useEffect(() => {
    if (!ready) return
    const msg: ToWorker = { type: 'setDocument', doc }
    workerRef.current?.postMessage(msg)
  }, [doc, ready])

  const send = useCallback((msg: ToWorker) => workerRef.current?.postMessage(msg), [])

  const start = useCallback(() => {
    send({ type: 'start' })
    setRunFor(hexUrl)
  }, [send, hexUrl])

  const stop = useCallback(() => {
    send({ type: 'stop' })
    setRunFor(null)
  }, [send])

  const reset = useCallback(() => {
    send({ type: 'reset' })
    setRunFor(null)
  }, [send])

  const benchmark = useCallback(() => {
    setBench(null)
    send({ type: 'benchmark' })
  }, [send])

  return { ready, running, error, snapshot, speedRatio, bench, start, stop, reset, benchmark }
}
