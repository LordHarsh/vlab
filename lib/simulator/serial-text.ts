/**
 * Serial bytes → text, decoded as UTF-8 across write boundaries.
 *
 * WHAT THIS REPLACES, AND WHY IT WAS WRONG. Both engines used to append
 * `String.fromCharCode(b)` per byte, which is a LATIN-1 decode: it maps each
 * byte to the code point of the same number. A sketch printing "No motion —
 * System Idle" puts the em dash on the wire as its UTF-8 encoding, `e2 80 94`, and a Latin-1
 * decode turns those three bytes into three separate characters — `â` — which
 * is exactly the mojibake a student saw. Every temperature sketch that prints
 * `°C` (`c2 b0`) or `µ` (`c2 b5`) had the same defect.
 *
 * WHY IT MUST STREAM. A UTF-8 sequence is one to four bytes and nothing aligns
 * it to a write: the AVR USART hands this layer ONE byte at a time, and the
 * Pico's USB CDC hands it whatever fitted in the last packet, so `e2 80 94` is
 * routinely split. A fresh `TextDecoder` per write would see an incomplete
 * sequence, emit U+FFFD, and corrupt precisely the characters this fix exists
 * to repair. `{ stream: true }` is what makes the decoder hold the partial
 * sequence and finish it on the next call — so this class is deliberately
 * STATEFUL and there is one per engine instance.
 *
 * A byte that is not part of any valid sequence still becomes U+FFFD, which is
 * the honest answer: the board really did send something that is not UTF-8, and
 * inventing a Latin-1 character for it would be the original bug in a new coat.
 */
export class SerialTextDecoder {
  private decoder = new TextDecoder('utf-8')
  /** Reused so a byte-at-a-time stream does not allocate per byte. */
  private readonly one = new Uint8Array(1)

  /** One byte from a UART. Returns '' while a multi-byte sequence is open. */
  byte(b: number): string {
    this.one[0] = b & 0xff
    return this.decoder.decode(this.one, { stream: true })
  }

  /** A whole packet. A sequence split across two packets survives the join. */
  bytes(buf: Uint8Array): string {
    return this.decoder.decode(buf, { stream: true })
  }

  /**
   * Forget any half-finished sequence.
   *
   * Call this wherever the byte stream itself is discontinuous — the MCU has
   * been reset, or the transcript cleared — so that the first byte of the new
   * stream is not glued onto the tail of a sequence from the old one. Both
   * workers reset by rebuilding the engine, which gets a new decoder anyway;
   * this exists so that a cheaper reset later cannot silently reintroduce the
   * bug.
   */
  reset(): void {
    this.decoder = new TextDecoder('utf-8')
  }
}
