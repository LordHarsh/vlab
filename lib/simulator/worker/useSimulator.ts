'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineState, FromWorker, ToWorker } from './protocol'

const EMPTY: EngineState = {
  current: 0,
  brightness: 0,
  overCurrent: false,
  anodeVolts: 0,
  pin: 'output_low',
  simSeconds: 0,
  speedRatio: 0,
  solves: 0,
  cacheHits: 0,
  pinEdges: 0,
  serial: '',
}

/**
 * Drives the simulation worker and exposes its latest state.
 *
 * State updates arrive at the worker's snapshot rate (20 Hz), not the
 * simulation rate, so React commits are decoupled from engine throughput.
 */
export function useSimulator(hexUrl: string, initialOhms = 220) {
  const workerRef = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<EngineState>(EMPTY)
  const [bench, setBench] = useState<{ mcps: number; xRealtime: number } | null>(null)

  useEffect(() => {
    let disposed = false

    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const msg = ev.data
      if (msg.type === 'ready') setReady(true)
      else if (msg.type === 'state') setState(msg.state)
      else if (msg.type === 'error') setError(msg.message)
      else if (msg.type === 'benchmark') setBench({ mcps: msg.mcps, xRealtime: msg.xRealtime })
    }
    worker.onerror = (e) => setError(e.message || 'worker failed')

    fetch(hexUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`firmware fetch failed: ${res.status}`)
        return res.text()
      })
      .then((hex) => {
        if (disposed) return
        const msg: ToWorker = { type: 'init', hex, seriesOhms: initialOhms }
        worker.postMessage(msg)
      })
      .catch((e) => !disposed && setError(String(e)))

    return () => {
      disposed = true
      worker.terminate()
      workerRef.current = null
    }
    // initialOhms is only the seed value; changing it later goes through setResistor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexUrl])

  const send = useCallback((msg: ToWorker) => {
    workerRef.current?.postMessage(msg)
  }, [])

  const start = useCallback(() => {
    send({ type: 'start' })
    setRunning(true)
  }, [send])

  const stop = useCallback(() => {
    send({ type: 'stop' })
    setRunning(false)
  }, [send])

  const setResistor = useCallback(
    (ohms: number) => {
      send({ type: 'setResistor', ohms })
    },
    [send],
  )

  const benchmark = useCallback(() => {
    setBench(null)
    send({ type: 'benchmark' })
  }, [send])

  return { ready, running, error, state, start, stop, setResistor, benchmark, bench }
}
