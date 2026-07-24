/**
 * Message protocol between the main thread and the PICO simulation worker.
 *
 * A sibling of ./protocol.ts rather than an extension of it, because the two
 * boards do not carry the same payload and pretending they do would force a
 * union type on every consumer. The differences are load-bearing:
 *
 *   - `init` carries FIRMWARE BINARIES, not a hex string. There is no compile
 *     step on this track: one prebuilt MicroPython image serves everybody and
 *     the student's source is a separate `script` field, typed into the
 *     emulated REPL at runtime.
 *   - the two blobs are ArrayBuffers so they can be TRANSFERRED rather than
 *     structured-cloned. The MicroPython image is 320 KB; cloning it on every
 *     init would copy it for no reason.
 */

import type { CircuitDoc } from '../model/document'
import type { PicoSnapshot } from '../pico/engine'

export type { PicoSnapshot }

export type ToPicoWorker =
  | {
      type: 'init'
      /** 16 KB RP2040 mask ROM. */
      bootrom: ArrayBuffer
      /** Flat MicroPython flash image, or a raw .uf2 — either is sniffed. */
      firmware: ArrayBuffer
      doc: CircuitDoc
      /** The student's MicroPython source. Omit for a bare REPL. */
      script?: string
    }
  | { type: 'setDocument'; doc: CircuitDoc }
  /** Re-paste a new script. Reboots, because MicroPython has no way to unrun one. */
  | { type: 'setScript'; script: string }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'benchmark' }

export type FromPicoWorker =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: PicoSnapshot; speedRatio: number }
  | { type: 'error'; message: string }
  | { type: 'benchmark'; mips: number; xRealtime: number }

/** How often the worker posts a snapshot. Same 20 Hz as the AVR track. */
export const PICO_SNAPSHOT_HZ = 20

/** Where fetch-firmware.mts puts the blobs, and therefore where to fetch them. */
export const PICO_BOOTROM_URL = '/pico/bootrom.bin'
export const PICO_FIRMWARE_URL = '/pico/micropython.bin'
