/**
 * Behavioural parts — tier 2 in SIMULATOR_ARCHITECTURE.md §7.1.
 *
 * A resistor is data. A DHT11 is not: it is a state machine that talks a
 * bit-banged wire protocol with microsecond timing, so it needs code. These
 * devices drive their own net through a Norton port and schedule their
 * transitions on the emulator's clock, which makes their timing exact rather
 * than approximated — the whole point of running real firmware is that the
 * student's own bit-banging loop has something real to talk to.
 */

import type { CPU } from 'avr8js'

const CLOCK_HZ = 16_000_000
const VCC = 5

/** Drive strengths for a device pulling a shared open-drain style line. */
export const R_PULLDOWN = 40
export const G_RELEASED = 1e-9

export interface BehaviouralContext {
  cpu: CPU
  /**
   * Set this device's drive on its signal net.
   *
   * Routed through the engine rather than written to the port directly, because
   * the memoisation cache is keyed on drive state (§2.4). A device that mutated
   * its port behind the cache's back would find every re-solve returning the
   * previous cached solution — which is exactly what happened: the DHT11 pulled
   * its line down and the solver kept reporting it high.
   */
  drive(level: 'low' | 'release'): void
  /** Voltage on the signal net at the last solve. */
  voltage(): number
  /** Live props from the document (sliders in the inspector). */
  props(): Record<string, number | string>
}

export interface BehaviouralDevice {
  readonly partId: string
  /** Called on every solve, so the device can watch its line. */
  poll(): void
}

type Level = 'low' | 'release'

interface Step {
  micros: number
  level: Level
}

/**
 * DHT11 temperature/humidity sensor.
 *
 * Single-wire protocol, from the datasheet:
 *   - host pulls the line low for >=18 ms, then releases it
 *   - sensor answers 80 us low, 80 us high
 *   - then 40 bits, each 50 us low followed by 26-28 us high for 0 or 70 us
 *     high for 1
 *   - 5 bytes: humidity integer, humidity decimal, temperature integer,
 *     temperature decimal, checksum. A DHT11 always sends 0 for both decimals.
 *
 * The sensor is open-drain: it only ever pulls DOWN, and "releasing" means going
 * high-impedance and letting the host's pull-up raise the line. Modelling it as
 * a push-pull driver would fight the host instead of sharing the wire.
 */
export class DHT11 implements BehaviouralDevice {
  private seq: Step[] = []
  private step = -1
  private lowSinceCycle: number | null = null
  private wasLow = false
  private busy = false

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {
    // Start released; the host's pull-up owns the line at rest.
    ctx.drive('release')
  }

  poll(): void {
    if (this.busy) return

    // A real DHT11 sees a logic low well below Vcc/2; 1.5 V is the datasheet's
    // worst-case VIL for a 5 V part.
    const low = this.ctx.voltage() < 1.5

    if (low && !this.wasLow) {
      this.lowSinceCycle = this.ctx.cpu.cycles
    } else if (!low && this.wasLow && this.lowSinceCycle !== null) {
      const heldMicros = ((this.ctx.cpu.cycles - this.lowSinceCycle) / CLOCK_HZ) * 1e6
      // The datasheet asks for >=18 ms. Accept a little less: libraries differ,
      // and a student whose timing is marginally short should still get an
      // answer rather than a silent failure they cannot diagnose.
      if (heldMicros >= 15_000) this.beginResponse()
      this.lowSinceCycle = null
    }
    this.wasLow = low
  }

  private beginResponse(): void {
    const p = this.ctx.props()
    const tempC = Math.round(Number(p.temperature ?? 24))
    const humidity = Math.round(Number(p.humidity ?? 45))

    const bytes = [humidity, 0, tempC, 0]
    const checksum = (bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff
    bytes.push(checksum)

    const seq: Step[] = [
      // Sensor acknowledges: pulls low 80 us, then lets the line rise 80 us.
      { micros: 30, level: 'release' },
      { micros: 80, level: 'low' },
      { micros: 80, level: 'release' },
    ]
    for (const byte of bytes) {
      for (let bit = 7; bit >= 0; bit--) {
        const one = (byte >> bit) & 1
        seq.push({ micros: 50, level: 'low' })
        seq.push({ micros: one ? 70 : 27, level: 'release' })
      }
    }
    // Final low before letting go of the bus.
    seq.push({ micros: 50, level: 'low' })
    seq.push({ micros: 0, level: 'release' })

    this.seq = seq
    this.step = -1
    this.busy = true
    this.advance()
  }

  /**
   * Play the next step, scheduling the one after it on the CPU clock.
   *
   * addClockEvent is what makes this exact: the transition lands on a specific
   * cycle rather than whenever a polling loop next happens to run, so a sketch
   * measuring pulse widths measures the real thing.
   */
  private advance = (): void => {
    this.step++
    if (this.step >= this.seq.length) {
      this.busy = false
      this.ctx.drive('release')
      this.wasLow = this.ctx.voltage() < 1.5
      return
    }

    const s = this.seq[this.step]
    this.ctx.drive(s.level)

    const cycles = Math.max(1, Math.round((s.micros * CLOCK_HZ) / 1e6))
    this.ctx.cpu.addClockEvent(this.advance, cycles)
  }
}

/** Reported so the UI can show what the sensor is currently sending. */
export function dht11Reading(props: Record<string, number | string>): {
  temperature: number
  humidity: number
} {
  return {
    temperature: Math.round(Number(props.temperature ?? 24)),
    humidity: Math.round(Number(props.humidity ?? 45)),
  }
}

export { VCC }
