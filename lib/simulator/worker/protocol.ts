/**
 * Message protocol between the main thread and the simulation worker.
 *
 * The engine runs entirely in the worker (SIMULATOR_ARCHITECTURE.md §2.5). The
 * main thread only receives a throttled state snapshot for rendering — measured
 * in Phase 0, driving React at the simulation's own rate dropped the engine from
 * 2.7x realtime headless to 0.49x, because every frame forced a React commit.
 */

export interface EngineState {
  /** Amps through the LED. */
  current: number
  /** 0..1 for rendering. */
  brightness: number
  overCurrent: boolean
  anodeVolts: number
  pin: string
  /** Simulated seconds elapsed. */
  simSeconds: number
  /** Simulated time / wall time, measured inside the worker. */
  speedRatio: number
  solves: number
  cacheHits: number
  pinEdges: number
  serial: string
}

export type ToWorker =
  | { type: 'init'; hex: string; seriesOhms: number }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'setResistor'; ohms: number }
  | { type: 'benchmark' }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'state'; state: EngineState }
  | { type: 'error'; message: string }
  | { type: 'benchmark'; mcps: number; xRealtime: number }

/** How often the worker posts a snapshot. 20 Hz is plenty for numeric readouts. */
export const SNAPSHOT_HZ = 20
