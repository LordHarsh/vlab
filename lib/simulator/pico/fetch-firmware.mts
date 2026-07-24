/**
 * Fetch and convert the two binary blobs the Pico track needs into public/pico/.
 *
 * Run:  npx tsx lib/simulator/pico/fetch-firmware.mts
 *
 * Both outputs are checked in (like public/sim/*.hex), so this script is only
 * needed to reproduce them or to bump the MicroPython version. It exists so the
 * provenance of a 300 KB binary in the repository is a script and not folklore.
 *
 * LICENSING — both are redistributable, which is why shipping them is viable:
 *   bootrom      Raspberry Pi's pico-bootrom, BSD-3-Clause.
 *   micropython  MicroPython, MIT.
 *
 * SIZES, measured:
 *   bootrom.bin        16,384 B  →  13.2 KB gzip
 *   micropython.bin   319,232 B  → 226.1 KB gzip
 * The .uf2 micropython.org publishes is 638,464 B; the UF2 container is exactly
 * 2x its payload (256 useful bytes per 512-byte block), so converting it here
 * halves the download for free.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { uf2ToFlashImage } from './firmware'

const BOOTROM_URL = 'https://raw.githubusercontent.com/wokwi/rp2040js/master/demo/bootrom.ts'
const MICROPYTHON_URL =
  'https://micropython.org/resources/firmware/RPI_PICO-20230426-v1.20.0.uf2'

const OUT_DIR = new URL('../../../public/pico/', import.meta.url)

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  // ─── bootrom ───────────────────────────────────────────────────────────────
  //
  // rp2040js publishes the bootrom as a TypeScript source file holding a
  // Uint32Array literal, not as a binary. Parsing the hex literals out is more
  // robust than importing it, because it does not require the file to be valid
  // TypeScript for whatever compiler happens to be in the tree.
  const bootromSrc = await (await fetch(BOOTROM_URL)).text()
  const words = [...bootromSrc.matchAll(/0x[0-9a-fA-F]{1,8}/g)].map((m) => parseInt(m[0], 16))
  if (words.length !== 4096) {
    throw new Error(`Expected 4096 bootrom words, parsed ${words.length}`)
  }
  const bootrom = Buffer.alloc(words.length * 4)
  words.forEach((w, i) => bootrom.writeUInt32LE(w >>> 0, i * 4))
  await writeFile(new URL('bootrom.bin', OUT_DIR), bootrom)
  console.log(`bootrom.bin      ${bootrom.length} B (${kb(gzipSync(bootrom).length)} gzip)`)

  // ─── MicroPython ───────────────────────────────────────────────────────────
  const uf2 = new Uint8Array(await (await fetch(MICROPYTHON_URL)).arrayBuffer())
  const img = uf2ToFlashImage(uf2)
  if (img.baseAddress !== 0x10000000) {
    throw new Error(`Firmware does not start at flash base: 0x${img.baseAddress.toString(16)}`)
  }
  await writeFile(new URL('micropython.bin', OUT_DIR), img.data)
  console.log(
    `micropython.bin  ${img.data.length} B (${kb(gzipSync(img.data).length)} gzip) ` +
      `from a ${uf2.length} B .uf2 of ${img.blocks} blocks`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
