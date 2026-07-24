/**
 * Getting MicroPython into the emulated Pico's flash.
 *
 * There is no compile step on this track. The Uno path ships a .hex produced by
 * avr-gcc from the student's C++; the Pico path ships ONE prebuilt MicroPython
 * firmware image for everybody and feeds the student's .py to it at runtime
 * (see repl.ts). So this file is only ever concerned with two static blobs:
 *
 *   bootrom.bin   16,384 B   the RP2040's mask ROM, revision B1. Not optional:
 *                            the reset vector, the flash second-stage handoff
 *                            and several ROM library routines that MicroPython
 *                            calls all live in it, and rp2040js ships an empty
 *                            16 KB array until you fill it.
 *   micropython   319,232 B  the firmware itself, as a flat image starting at
 *                            FLASH_START. That is the .uf2 with its 2x block
 *                            framing removed — see uf2ToFlashImage().
 *
 * Both are content-addressed, immutable and cacheable forever; together they
 * gzip to about 245 KB, which is the honest download cost of this track.
 */

/** RP2040 XIP flash window base. */
export const FLASH_START_ADDRESS = 0x10000000

const UF2_MAGIC_START0 = 0x0a324655 // "UF2\n"
const UF2_MAGIC_START1 = 0x9e5d5157
const UF2_MAGIC_END = 0x0ab16f30
const UF2_BLOCK_SIZE = 512
const UF2_FLAG_NOT_MAIN_FLASH = 0x00000001

export interface Uf2Image {
  /** Flat flash contents, index 0 == FLASH_START_ADDRESS. */
  data: Uint8Array
  /** Lowest flash address any block targeted. */
  baseAddress: number
  /** One past the highest. */
  endAddress: number
  blocks: number
}

/**
 * UF2 → flat flash image.
 *
 * A UF2 is a stream of 512-byte blocks each carrying only 256 bytes of payload,
 * so the format is exactly 2x larger than the firmware it contains. Converting
 * at build time rather than in the browser halves the bytes on the wire for
 * free, which is why loadPicoFirmware() takes an already-flat image; this
 * function exists for the build script and for tests that start from the file
 * micropython.org actually publishes.
 */
export function uf2ToFlashImage(uf2: ArrayBuffer | Uint8Array): Uf2Image {
  const bytes = uf2 instanceof Uint8Array ? uf2 : new Uint8Array(uf2)
  if (bytes.length % UF2_BLOCK_SIZE !== 0) {
    throw new Error(`Not a UF2: length ${bytes.length} is not a multiple of ${UF2_BLOCK_SIZE}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Two passes: find the address span first, so the output is exactly the size
  // of the firmware and never a 16 MB sparse array.
  let base = Number.POSITIVE_INFINITY
  let end = 0
  let blocks = 0
  for (let off = 0; off < bytes.length; off += UF2_BLOCK_SIZE) {
    if (view.getUint32(off, true) !== UF2_MAGIC_START0) {
      throw new Error(`Not a UF2: bad magic at block ${off / UF2_BLOCK_SIZE}`)
    }
    if (view.getUint32(off + 4, true) !== UF2_MAGIC_START1) {
      throw new Error(`Not a UF2: bad magic1 at block ${off / UF2_BLOCK_SIZE}`)
    }
    if (view.getUint32(off + UF2_BLOCK_SIZE - 4, true) !== UF2_MAGIC_END) {
      throw new Error(`Not a UF2: bad end magic at block ${off / UF2_BLOCK_SIZE}`)
    }
    const flags = view.getUint32(off + 8, true)
    if (flags & UF2_FLAG_NOT_MAIN_FLASH) continue
    const addr = view.getUint32(off + 12, true)
    const len = view.getUint32(off + 16, true)
    if (len > 476) throw new Error(`Not a UF2: payload ${len} > 476 at block ${off / UF2_BLOCK_SIZE}`)
    base = Math.min(base, addr)
    end = Math.max(end, addr + len)
    blocks++
  }
  if (blocks === 0) throw new Error('UF2 contains no flash blocks')

  const data = new Uint8Array(end - base)
  for (let off = 0; off < bytes.length; off += UF2_BLOCK_SIZE) {
    const flags = view.getUint32(off + 8, true)
    if (flags & UF2_FLAG_NOT_MAIN_FLASH) continue
    const addr = view.getUint32(off + 12, true)
    const len = view.getUint32(off + 16, true)
    data.set(bytes.subarray(off + 32, off + 32 + len), addr - base)
  }
  return { data, baseAddress: base, endAddress: end, blocks }
}

/** Little-endian bytes → the Uint32Array rp2040js's loadBootrom() wants. */
export function bootromWords(bin: ArrayBuffer | Uint8Array): Uint32Array {
  const bytes = bin instanceof Uint8Array ? bin : new Uint8Array(bin)
  if (bytes.length !== 16 * 1024) {
    throw new Error(`bootrom must be exactly 16384 bytes, got ${bytes.length}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const words = new Uint32Array(bytes.length / 4)
  for (let i = 0; i < words.length; i++) words[i] = view.getUint32(i * 4, true)
  return words
}

export interface PicoFirmware {
  bootrom: Uint32Array
  /** Flat flash image; byte 0 lands at `flashBase`. */
  flash: Uint8Array
  flashBase: number
}

/**
 * Assemble the two blobs into the shape PicoEngine wants.
 *
 * `firmware` may be either a flat image or a raw .uf2 — the UF2 magic is
 * unambiguous, so sniffing it costs one comparison and removes a whole class of
 * "I pointed it at the wrong file" bug reports.
 */
export function loadPicoFirmware(
  bootromBin: ArrayBuffer | Uint8Array,
  firmware: ArrayBuffer | Uint8Array,
): PicoFirmware {
  const bytes = firmware instanceof Uint8Array ? firmware : new Uint8Array(firmware)
  const looksLikeUf2 =
    bytes.length >= UF2_BLOCK_SIZE &&
    new DataView(bytes.buffer, bytes.byteOffset, 8).getUint32(0, true) === UF2_MAGIC_START0

  if (looksLikeUf2) {
    const img = uf2ToFlashImage(bytes)
    return { bootrom: bootromWords(bootromBin), flash: img.data, flashBase: img.baseAddress }
  }
  return { bootrom: bootromWords(bootromBin), flash: bytes, flashBase: FLASH_START_ADDRESS }
}
