/**
 * Running the existing behavioural device models on an RP2040 clock.
 *
 * WHY THIS EXISTS
 * ---------------
 * `behavioural.ts` (the DHT11, HC-SR04, PIR and flow-sensor models) schedules
 * its own transitions on the emulator's clock, which is what makes the timing
 * exact rather than polled — a sketch measuring a 27 µs pulse measures a real
 * 27 µs pulse. Those models were written against `avr8js`, so their scheduling
 * surface is avr8js's `CPU`: a cycle counter and addClockEvent/clearClockEvent.
 * rp2040js counts NANOSECONDS and schedules through `IClock.createAlarm()`.
 *
 * The models are shared content — a DHT11 is a DHT11 whichever board reads it —
 * so the choice was to fork them per board or to translate the clock. Forking
 * duplicates every datasheet constant and guarantees the two copies drift.
 * This translates.
 *
 * THE ONE PLACE IT IS NOT TYPE-SAFE, AND WHAT GUARDS IT
 * ----------------------------------------------------
 * `BehaviouralContext.cpu` is typed as avr8js's `CPU` class, which has private
 * fields, so no external object can structurally satisfy it — the hand-off in
 * pico/engine.ts is an unavoidable cast. What makes that safe rather than
 * hopeful is that the models touch exactly three members of `CPU` (cycles,
 * addClockEvent, clearClockEvent). `AvrClockSurface` below pins that list
 * against the real avr8js type, so a rename in avr8js breaks the build; and
 * pico.test.ts greps behavioural.ts for `ctx.cpu.<member>` and fails if a
 * device ever reaches for a fourth one.
 *
 * WHY 16 MHz AND NOT 125 MHz
 * --------------------------
 * `behavioural.ts` converts its datasheet microseconds to cycles with its own
 * private `CLOCK_HZ = 16_000_000`. The shim therefore has to present cycles on
 * that same 16 MHz scale, or every datasheet interval would come out 7.8x
 * short. One AVR cycle is 62.5 ns exactly, so the conversion is exact in both
 * directions and no timing is lost in the translation.
 */

import type { CPU } from 'avr8js'
import type { RP2040 } from 'rp2040js'

/**
 * Both libraries keep these behind their public entry points, so they are
 * derived from the types that ARE exported rather than deep-imported out of
 * `dist/`. Derivation also means a signature change upstream shows up as a
 * compile error here.
 */
type AVRClockEventCallback = Parameters<CPU['addClockEvent']>[0]
type IClock = RP2040['clock']
type IAlarm = ReturnType<IClock['createAlarm']>

/** Nanoseconds per notional AVR cycle: 1e9 / 16e6, exactly. */
export const NANOS_PER_AVR_CYCLE = 62.5

/**
 * Exactly the part of avr8js's CPU that behavioural.ts uses.
 *
 * Written as a `Pick` of the real class rather than a hand-copied interface so
 * the signatures cannot drift: if avr8js changes `addClockEvent`, this stops
 * compiling here instead of failing at runtime inside a sensor.
 */
export type AvrClockSurface = Pick<CPU, 'cycles' | 'addClockEvent' | 'clearClockEvent'>

/** The `CPU` members behavioural.ts is allowed to touch. Pinned by pico.test.ts. */
export const BEHAVIOURAL_CPU_SURFACE: readonly string[] = [
  'cycles',
  'addClockEvent',
  'clearClockEvent',
]

/**
 * An avr8js-shaped clock backed by rp2040js's nanosecond clock.
 *
 * `cycles` is a getter, which matters: avr8js's is a mutable field that the
 * interpreter increments, and a device reading a stale snapshot of it would
 * measure pulse widths against a frozen clock.
 */
export class PicoBehaviouralClock implements AvrClockSurface {
  /**
   * One alarm per callback identity.
   *
   * avr8js queues multiple pending events for the same callback; this
   * reschedules the single alarm instead. No shipped device schedules the same
   * callback twice before it fires — each one advances a state machine by
   * booking its own next step — and rescheduling is the safer of the two
   * behaviours if one ever did, because a duplicated alarm would double-advance
   * the state machine.
   */
  private readonly alarms = new Map<AVRClockEventCallback, IAlarm>()

  constructor(private readonly clock: IClock) {}

  get cycles(): number {
    return this.clock.nanos / NANOS_PER_AVR_CYCLE
  }

  addClockEvent(callback: AVRClockEventCallback, cycles: number): AVRClockEventCallback {
    let alarm = this.alarms.get(callback)
    if (!alarm) {
      // The alarm fires the device's own callback directly. rp2040js sets the
      // clock to the alarm's exact scheduled nanosecond before invoking it
      // (SimulationClock.tick), so a device reading `cycles` inside its own
      // callback sees the instant it asked for, not the instruction boundary
      // that happened to cross it.
      alarm = this.clock.createAlarm(callback)
      this.alarms.set(callback, alarm)
    }
    alarm.schedule(Math.max(cycles, 0) * NANOS_PER_AVR_CYCLE)
    return callback
  }

  clearClockEvent(callback: AVRClockEventCallback): boolean {
    const alarm = this.alarms.get(callback)
    if (!alarm) return false
    alarm.cancel()
    return true
  }

  /** Cancel everything still pending — used when a rewire discards the devices. */
  cancelAll(): void {
    for (const alarm of this.alarms.values()) alarm.cancel()
    this.alarms.clear()
  }
}
