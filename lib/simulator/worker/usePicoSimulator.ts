'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CircuitDoc } from '../model/document'
import {
  PICO_BOOTROM_URL,
  PICO_FIRMWARE_URL,
  type FromPicoWorker,
  type PicoSnapshot,
  type ToPicoWorker,
} from './pico-protocol'

const EMPTY: PicoSnapshot = {
  ledBrightness: {},
  currents: {},
  adc: {},
  faults: [],
  problems: [],
  serial: '',
  pins: {},
  onboardLed: false,
  simSeconds: 0,
  solves: 0,
  cacheHits: 0,
  pinEdges: 0,
  unknowns: 0,
  solveError: null,
  limitations: [],
  repl: 'booting',
  deviceStates: {},
}

/**
 * Drives the PICO simulation worker.
 *
 * A sibling of ./useSimulator.ts, with the same firmware-tagging discipline —
 * every piece of worker state carries the firmware identity it belongs to, and
 * readiness is derived, so state from a torn-down worker can never be mistaken
 * for the new one's.
 *
 * THREE THINGS DIFFER FROM THE AVR HOOK, all forced by the board:
 *
 *  1. TWO BINARY BLOBS, NOT A HEX STRING. The RP2040's 16 KB mask ROM is not
 *     optional (the reset vector and the flash stage-2 handoff live in it) and
 *     MicroPython is a 320 KB flat image. Both are fetched as ArrayBuffers and
 *     TRANSFERRED to the worker rather than structured-cloned; cloning 336 KB
 *     on every init would copy it for no reason. A transferred buffer is
 *     detached afterwards, which is why they are re-fetched per worker rather
 *     than cached in a ref.
 *
 *  2. THE SCRIPT IS A SEPARATE INPUT. There is no compile step on this track:
 *     one prebuilt MicroPython serves everybody and the student's .py is typed
 *     into the emulated REPL at runtime. Changing it REBOOTS the interpreter,
 *     because once a `while True:` loop owns the REPL nothing short of a reset
 *     gets it back — so the worker's own `setScript` is used rather than a
 *     worker teardown, which would also throw away the 16 MB flash allocation
 *     and re-boot MicroPython from scratch.
 *
 *  3. `speedRatio` IS WORTH SHOWING. rp2040js runs a 125 MHz part at roughly
 *     half wall-clock speed where avr8js runs a 16 MHz part at several times
 *     it. Simulated time stays exact — a time.sleep(0.5) is 500.0 ms — but a
 *     1 Hz blink visibly blinks slower than 1 Hz, and the honest thing is to
 *     surface the ratio rather than let a student think the board is faulty.
 */
export function usePicoSimulator(doc: CircuitDoc, script: string, enabled = true) {
  const workerRef = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  /**
   * The script that is RUNNING, not a boolean.
   *
   * Same tagging discipline as ./useSimulator.ts, and here it is what keeps the
   * hook free of a setState inside an effect: changing the script reboots the
   * interpreter, so the run has to stop — but deriving `running` from whether
   * the tag still matches the current script makes that fall out for free
   * instead of needing the script effect to reach over and reset a flag.
   */
  const [runFor, setRunFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<PicoSnapshot>(EMPTY)
  const [speedRatio, setSpeedRatio] = useState(0)
  const [bench, setBench] = useState<{ mips: number; xRealtime: number } | null>(null)

  // Read inside the init effect without making the worker depend on them: a
  // document edit or a script change must not tear the emulator down.
  const docRef = useRef(doc)
  const scriptRef = useRef(script)
  /** The script the running interpreter was actually given. See below. */
  const sentScript = useRef<string | null>(null)
  useEffect(() => {
    docRef.current = doc
  }, [doc])
  useEffect(() => {
    scriptRef.current = script
  }, [script])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const worker = new Worker(new URL('./pico.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (ev: MessageEvent<FromPicoWorker>) => {
      const msg = ev.data
      if (msg.type === 'ready') setReady(true)
      else if (msg.type === 'snapshot') {
        setSnapshot(msg.snapshot)
        setSpeedRatio(msg.speedRatio)
      } else if (msg.type === 'error') setError(msg.message)
      else if (msg.type === 'benchmark') setBench({ mips: msg.mips, xRealtime: msg.xRealtime })
    }
    worker.onerror = (e) => setError(e.message || 'worker failed')

    Promise.all([
      fetch(PICO_BOOTROM_URL).then((r) => {
        if (!r.ok) throw new Error(`bootrom fetch failed: ${r.status}`)
        return r.arrayBuffer()
      }),
      fetch(PICO_FIRMWARE_URL).then((r) => {
        if (!r.ok) throw new Error(`MicroPython fetch failed: ${r.status}`)
        return r.arrayBuffer()
      }),
    ])
      .then(([bootrom, firmware]) => {
        if (disposed) return
        const msg: ToPicoWorker = {
          type: 'init',
          bootrom,
          firmware,
          doc: docRef.current,
          script: scriptRef.current,
        }
        sentScript.current = scriptRef.current
        worker.postMessage(msg, [bootrom, firmware])
      })
      .catch((e) => !disposed && setError(String(e)))

    return () => {
      disposed = true
      worker.terminate()
      workerRef.current = null
      sentScript.current = null
      setReady(false)
      setRunFor(null)
      setSnapshot(EMPTY)
      setSpeedRatio(0)
    }
  }, [enabled])

  // Push document edits through. The interpreter keeps running across a rewire.
  useEffect(() => {
    if (!ready) return
    const msg: ToPicoWorker = { type: 'setDocument', doc }
    workerRef.current?.postMessage(msg)
  }, [doc, ready])

  /**
   * A new script reboots, unavoidably. The run stops as a CONSEQUENCE — the
   * `runFor` tag no longer matches the current script — rather than by this
   * effect resetting a flag.
   *
   * `sentScript` is what stops this firing spuriously the instant the worker
   * reports ready: the script already went out with `init`, so re-sending the
   * identical text would reboot a MicroPython that had just finished booting —
   * once per mount, every mount.
   */
  useEffect(() => {
    if (!ready) return
    if (sentScript.current === script) return
    sentScript.current = script
    const msg: ToPicoWorker = { type: 'setScript', script }
    workerRef.current?.postMessage(msg)
  }, [script, ready])

  const send = useCallback((msg: ToPicoWorker) => workerRef.current?.postMessage(msg), [])

  const start = useCallback(() => {
    send({ type: 'start' })
    setRunFor(script)
  }, [send, script])

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

  return {
    ready: enabled && ready,
    running: enabled && ready && runFor === script,
    error,
    snapshot: enabled ? snapshot : EMPTY,
    speedRatio: enabled ? speedRatio : 0,
    bench,
    start,
    stop,
    reset,
    benchmark,
  }
}
