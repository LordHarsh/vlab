/// <reference lib="webworker" />
/**
 * Simulation worker. Owns the AVR emulator and the analog solver, and runs them
 * as fast as the host allows without ever touching the DOM.
 *
 * Self-pacing: advance a slice of simulated time, then yield so control messages
 * (a rewire, a stop) get processed. It does not chase a framerate — the main
 * thread samples on its own schedule.
 */

import { chipForDoc } from '../avr/chip'
import { SimulationEngine, parseIntelHex, CLOCK_HZ } from '../engine'
import type { CircuitDoc } from '../model/document'
import { SNAPSHOT_HZ, type FromWorker, type ToWorker } from './protocol'

let engine: SimulationEngine | null = null
let program: Uint16Array | null = null
let lastDoc: CircuitDoc | null = null
let running = false

/** Simulated time per slice. 5 ms keeps a rewire feeling immediate. */
const SLICE_MICROS = 5_000

let lastPost = 0
let wallAccum = 0
let simAccum = 0

function post(msg: FromWorker): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)
}

/**
 * Yield without the timer clamp. setTimeout(fn, 0) is clamped to ~4 ms once
 * nested, which cost roughly a third of the duty cycle. A MessageChannel
 * round-trip is a macrotask with no clamp.
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

function loop(): void {
  if (!running || !engine) return

  const t0 = performance.now()
  let advanced = 0
  while (performance.now() - t0 < 10 && advanced < 250_000) {
    engine.run(SLICE_MICROS)
    advanced += SLICE_MICROS
  }
  const wall = (performance.now() - t0) / 1000

  wallAccum += wall
  simAccum += advanced / 1e6
  if (wallAccum > 2) {
    // Decay the window so the readout tracks recent performance.
    wallAccum *= 0.5
    simAccum *= 0.5
  }

  const now = performance.now()
  if (now - lastPost >= 1000 / SNAPSHOT_HZ) {
    lastPost = now
    postSnapshot()
  }

  scheduleLoop()
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  try {
    switch (msg.type) {
      case 'init': {
        /**
         * The DOCUMENT decides the flash size, before any engine exists.
         *
         * An ATmega328P's program memory is 32 KB and an ATmega2560's is 256 KB,
         * and the size is not merely an allocation: avr8js reads `pc22Bits` off
         * the program memory's byte length, and that flag decides whether an
         * interrupt pushes a two- or three-byte return address. Parsing a Mega
         * hex into a 32 KB buffer would both truncate the program and give the
         * CPU the wrong stack discipline.
         */
        program = parseIntelHex(msg.hex, chipForDoc(msg.doc).flashBytes)
        lastDoc = msg.doc
        engine = new SimulationEngine(program, msg.doc)
        wallAccum = 0
        simAccum = 0
        post({ type: 'ready' })
        postSnapshot()
        break
      }

      case 'setDocument': {
        // The firmware keeps running across a rewire — resetting the MCU would
        // throw away the program state the student is trying to observe.
        lastDoc = msg.doc
        engine?.setDocument(msg.doc)
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
        if (!program || !lastDoc) break
        running = false
        // Rebuilding is the honest way to reset an MCU: fresh SRAM, fresh
        // registers, fresh peripherals, firmware restarted from the vector table.
        engine = new SimulationEngine(program, lastDoc)
        wallAccum = 0
        simAccum = 0
        postSnapshot()
        break
      }

      case 'benchmark': {
        if (!engine) break
        engine.run(60_000) // warm up
        const t0 = performance.now()
        const c0 = engine.cpu.cycles
        engine.run(2_000_000) // 2 s of simulated time
        const secs = (performance.now() - t0) / 1000
        const executed = engine.cpu.cycles - c0
        post({
          type: 'benchmark',
          mcps: executed / secs / 1e6,
          xRealtime: executed / secs / CLOCK_HZ,
        })
        break
      }
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
