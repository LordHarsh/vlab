/// <reference lib="webworker" />
/**
 * Pico simulation worker. Owns the RP2040 emulator and the analog solver, and
 * runs them as fast as the host allows without ever touching the DOM.
 *
 * Structurally identical to ./engine.worker.ts — self-paced slices, a
 * MessageChannel yield to dodge the setTimeout clamp, a throttled snapshot —
 * with two deliberate departures forced by measurement:
 *
 *  1. SLICE_MICROS is 2 ms, not 5 ms. rp2040js runs at roughly 0.5x realtime
 *     against avr8js's 2.7x, so an equal slice of SIMULATED time costs about
 *     five times as much WALL time. Keeping the wall-clock cost per slice
 *     comparable is what keeps a rewire feeling immediate.
 *  2. `reset` reboots the interpreter and re-pastes the script, because there
 *     is no other way to un-run a MicroPython program: once a `while True:`
 *     loop owns the REPL, only a reset gets it back.
 */

import { PicoSimulationEngine } from '../pico/engine'
import { loadPicoFirmware, type PicoFirmware } from '../pico/firmware'
import type { CircuitDoc } from '../model/document'
import { PICO_SNAPSHOT_HZ, type FromPicoWorker, type ToPicoWorker } from './pico-protocol'

let engine: PicoSimulationEngine | null = null
let firmware: PicoFirmware | null = null
let lastDoc: CircuitDoc | null = null
let lastScript: string | undefined
let running = false

/** Simulated time per slice. See the note above about why this is not 5 ms. */
const SLICE_MICROS = 2_000

let lastPost = 0
let wallAccum = 0
let simAccum = 0

function post(msg: FromPicoWorker): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)
}

/**
 * Yield without the timer clamp. setTimeout(fn, 0) is clamped to ~4 ms once
 * nested, which on this track would cost proportionally more than on the AVR
 * one — the slices are smaller, so a fixed 4 ms tax is a larger share.
 */
const yieldChannel = new MessageChannel()
let pumpQueued = false
yieldChannel.port1.onmessage = () => {
  pumpQueued = false
  loop()
}
function scheduleLoop(): void {
  if (pumpQueued) return
  pumpQueued = true
  yieldChannel.port2.postMessage(0)
}

function postSnapshot(): void {
  if (!engine) return
  post({
    type: 'snapshot',
    snapshot: engine.snapshot(),
    speedRatio: wallAccum > 0 ? simAccum / wallAccum : 0,
  })
}

function boot(): void {
  if (!firmware || !lastDoc) return
  // Rebuilding is the honest way to reset: fresh SRAM, fresh peripherals, the
  // interpreter restarted from its reset vector, and the script re-pasted into
  // a clean REPL.
  engine = new PicoSimulationEngine(firmware, lastDoc, { script: lastScript })
  wallAccum = 0
  simAccum = 0
}

function loop(): void {
  if (!running || !engine) return

  const t0 = performance.now()
  let advanced = 0
  // Bounded by wall time first: a 10 ms budget keeps the worker responsive to
  // control messages regardless of how slow the emulation happens to be on
  // this machine, which matters more here than on the AVR track.
  while (performance.now() - t0 < 10 && advanced < 100_000) {
    engine.run(SLICE_MICROS)
    advanced += SLICE_MICROS
  }
  const wall = (performance.now() - t0) / 1000

  wallAccum += wall
  simAccum += advanced / 1e6
  if (wallAccum > 2) {
    wallAccum *= 0.5
    simAccum *= 0.5
  }

  const now = performance.now()
  if (now - lastPost >= 1000 / PICO_SNAPSHOT_HZ) {
    lastPost = now
    postSnapshot()
  }

  scheduleLoop()
}

self.onmessage = (ev: MessageEvent<ToPicoWorker>) => {
  const msg = ev.data
  try {
    switch (msg.type) {
      case 'init': {
        firmware = loadPicoFirmware(new Uint8Array(msg.bootrom), new Uint8Array(msg.firmware))
        lastDoc = msg.doc
        lastScript = msg.script
        boot()
        post({ type: 'ready' })
        postSnapshot()
        break
      }

      case 'setDocument': {
        // The interpreter keeps running across a rewire — rebooting would throw
        // away the program state the student is trying to observe.
        lastDoc = msg.doc
        engine?.setDocument(msg.doc)
        postSnapshot()
        break
      }

      case 'setScript': {
        // A reboot, unavoidably. See the file header.
        lastScript = msg.script
        running = false
        boot()
        postSnapshot()
        break
      }

      case 'start': {
        if (!engine || running) break
        running = true
        loop()
        break
      }

      case 'stop': {
        running = false
        postSnapshot()
        break
      }

      case 'reset': {
        running = false
        boot()
        postSnapshot()
        break
      }

      case 'benchmark': {
        if (!engine) break
        engine.run(100_000) // warm up
        const t0 = performance.now()
        const n0 = engine.mcu.clock.nanos
        engine.run(1_000_000) // 1 s of simulated time
        const secs = (performance.now() - t0) / 1000
        const simSecs = (engine.mcu.clock.nanos - n0) / 1e9
        post({
          type: 'benchmark',
          // Cycles, not instructions: rp2040js does not expose a retired-
          // instruction count, and cycles are what the clock actually advances.
          mips: (simSecs * 125e6) / secs / 1e6,
          xRealtime: simSecs / secs,
        })
        break
      }
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
