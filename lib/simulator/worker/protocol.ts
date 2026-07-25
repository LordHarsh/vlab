/**
 * Message protocol between the main thread and the simulation worker.
 *
 * The engine runs entirely in the worker (SIMULATOR_ARCHITECTURE.md §2.5). The
 * main thread only receives a throttled snapshot for rendering — measured in
 * Phase 0, driving React at the simulation's own rate dropped the engine from
 * 2.7x realtime to 0.49x, because every frame forced a React commit.
 */

import type { CircuitDoc } from '../model/document'
import type { EngineSnapshot } from '../engine'

export type { EngineSnapshot }

export type ToWorker =
  | { type: 'init'; hex: string; doc: CircuitDoc }
  | { type: 'setDocument'; doc: CircuitDoc }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'benchmark' }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: EngineSnapshot; speedRatio: number }
  | { type: 'error'; message: string }
  | { type: 'benchmark'; mcps: number; xRealtime: number }

/** How often the worker posts a snapshot. 20 Hz is plenty for numeric readouts. */
export const SNAPSHOT_HZ = 20
