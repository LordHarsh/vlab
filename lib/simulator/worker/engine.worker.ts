/// <reference lib="webworker" />
/**
 * Simulation worker. Owns the AVR emulator and the analog solver, and runs them
 * as fast as the host allows without ever touching the DOM.
 *
 * The loop is self-pacing: it advances a fixed slice of simulated time, then
 * yields so the worker's event loop can process control messages. It does not
 * try to hit a framerate — the main thread samples state on its own schedule.
 */

import { ArduinoSimulation, parseIntelHex } from '../arduino'
import { SNAPSHOT_HZ, type EngineState, type FromWorker, type ToWorker } from './protocol'

let sim: ArduinoSimulation | null = null
let running = false

/**
 * Yield without the timer clamp.
 *
 * setTimeout(fn, 0) is clamped to ~4 ms once nested, so an 8 ms work slice ran
 * at roughly a 2/3 duty cycle — measured in-browser as 0.75x realtime against
 * 2.7x headless. A MessageChannel round-trip is a macrotask with no clamp, so
 * the loop stays responsive to control messages while giving up almost no time.
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

/** Simulated time advanced per slice. 5 ms keeps control latency imperceptible. */
const SLICE_MICROS = 5_000

let lastPost = 0
let wallAccum = 0
let simAccum = 0

function post(msg: FromWorker): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)
}

function snapshot(): EngineState {
  const s = sim!
  const led = s.led1
  const stats = s.stats
  return {
    current: led.current,
    brightness: led.brightness,
    overCurrent: led.overCurrent,
    anodeVolts: s.anodeVoltage,
    pin: s.d13,
    simSeconds: stats.simMicros / 1e6,
    speedRatio: wallAccum > 0 ? simAccum / wallAccum : 0,
    solves: stats.solves,
    cacheHits: stats.cacheHits,
    pinEdges: stats.pinEdges,
    serial: s.serial.slice(-1200),
  }
}

function loop(): void {
  if (!running || !sim) return

  // Run several slices per macrotask; yielding on every 5 ms slice would spend
  // more time in the scheduler than in the emulator.
  const t0 = performance.now()
  let advanced = 0
  while (performance.now() - t0 < 8 && advanced < 200_000) {
    sim.run(SLICE_MICROS)
    advanced += SLICE_MICROS
  }
  const wall = (performance.now() - t0) / 1000

  wallAccum += wall
  simAccum += advanced / 1e6
  // Decay the ratio window so the readout tracks recent performance.
  if (wallAccum > 2) {
    wallAccum *= 0.5
    simAccum *= 0.5
  }

  const now = performance.now()
  if (now - lastPost >= 1000 / SNAPSHOT_HZ) {
    lastPost = now
    post({ type: 'state', state: snapshot() })
  }

  scheduleLoop()
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  try {
    switch (msg.type) {
      case 'init': {
        sim = new ArduinoSimulation(parseIntelHex(msg.hex), msg.seriesOhms)
        wallAccum = 0
        simAccum = 0
        post({ type: 'ready' })
        post({ type: 'state', state: snapshot() })
        break
      }
      case 'start': {
        if (!sim || running) break
        running = true
        loop()
        break
      }
      case 'stop': {
        running = false
        break
      }
      case 'benchmark': {
        // Raw emulator throughput, isolated from loop pacing and snapshot
        // posting: one tight run of a fixed cycle count. This is the number
        // the Phase 0 kill criterion is measured against, and it must be taken
        // in-browser because Node's JIT is not representative.
        if (!sim) break
        const CYCLES = 32_000_000 // 2 s of simulated time
        sim.run(1_000_000 / 16) // warm up
        const t0 = performance.now()
        const c0 = sim.cpu.cycles
        sim.run((CYCLES / 16_000_000) * 1e6)
        const secs = (performance.now() - t0) / 1000
        const executed = sim.cpu.cycles - c0
        post({
          type: 'benchmark',
          mcps: executed / secs / 1e6,
          xRealtime: executed / secs / 16_000_000,
        })
        break
      }
      case 'setResistor': {
        if (!sim) break
        sim.setSeriesResistance(msg.ohms)
        post({ type: 'state', state: snapshot() })
        break
      }
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
