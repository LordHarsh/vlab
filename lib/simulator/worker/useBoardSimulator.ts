'use client'

import { useMemo } from 'react'
import { detectBoard, type BoardProfile } from '../model/boards'
import type { CircuitDoc } from '../model/document'
import type { EngineSnapshot } from './protocol'
import type { PicoSnapshot } from './pico-protocol'
import { useSimulator } from './useSimulator'
import { usePicoSimulator } from './usePicoSimulator'

/** Everything both tracks expose, so a Run button does not have to narrow. */
interface CommonControls {
  ready: boolean
  running: boolean
  error: string | null
  speedRatio: number
  start: () => void
  stop: () => void
  reset: () => void
  benchmark: () => void
}

/**
 * The two tracks, kept as a DISCRIMINATED UNION rather than flattened.
 *
 * Their snapshots genuinely differ — an Uno reports 10-bit ADC counts on
 * A0…A5, a Pico reports 12-bit counts on GP26…GP28 plus the REPL phase and the
 * on-board LED — so a merged shape would have to make half its fields optional
 * and every reader would then be guessing. `track` narrows it in one `if`.
 */
export type BoardSimulator =
  | (CommonControls & {
      track: 'avr'
      board: BoardProfile
      snapshot: EngineSnapshot
      /** Null when this board is not running. */
      problem: null
    })
  | (CommonControls & {
      track: 'rp2040'
      board: BoardProfile
      snapshot: PicoSnapshot
      problem: null
    })
  | (CommonControls & {
      track: 'none'
      board: null
      snapshot: null
      /** Why nothing is running: no board, or two of them. */
      problem: string
    })

export interface BoardSimulatorOptions {
  /** Compiled .hex for the AVR track. Ignored by a Pico document. */
  hexUrl: string
  /** MicroPython source for the Pico track. Ignored by an Uno document. */
  script: string
}

/**
 * Run whichever board this document contains.
 *
 * BOTH hooks are called on every render — rules of hooks leaves no choice —
 * but only the selected one is `enabled`, and a disabled hook creates no
 * worker, fetches no firmware, and returns an empty snapshot. So exactly one
 * emulator is ever resident, which matters here more than it would elsewhere:
 * `new RP2040()` unconditionally allocates a 16 MB flash window.
 *
 * Deliberately NOT a registry. Two boards, two emulators, two toolchains, one
 * `if`. A third board is a new worker and a new firmware pipeline, not a row in
 * a table, and building the table first would be pretending otherwise.
 */
export function useBoardSimulator(
  doc: CircuitDoc,
  { hexUrl, script }: BoardSimulatorOptions,
): BoardSimulator {
  const detected = useMemo(() => detectBoard(doc), [doc])
  const track = detected.board?.track ?? 'none'

  const avr = useSimulator(hexUrl, doc, track === 'avr')
  const pico = usePicoSimulator(doc, script, track === 'rp2040')

  if (track === 'avr' && detected.board) {
    return { track: 'avr', board: detected.board, problem: null, ...avr }
  }
  if (track === 'rp2040' && detected.board) {
    return { track: 'rp2040', board: detected.board, problem: null, ...pico }
  }
  return {
    track: 'none',
    board: null,
    snapshot: null,
    problem: detected.problem ?? 'No board in the circuit.',
    ready: false,
    running: false,
    error: null,
    speedRatio: 0,
    start: () => {},
    stop: () => {},
    reset: () => {},
    benchmark: () => {},
  }
}
