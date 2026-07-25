/**
 * ATmega2560 — the peripheral map avr8js does not ship.
 *
 * avr8js is an ATmega328P part in everything except its CPU core. The core is
 * genuinely device-independent (it decodes ELPM, EIND and a 22-bit PC, and
 * cpu.ts even says `MAX_INTERRUPTS = 128 // Enough for ATMega2560`), and the
 * GPIO file already carries portA…portL at the 2560's own register addresses.
 * What is 328P-specific is every INTERRUPT VECTOR: `timer0Config.ovfInterrupt`
 * is 0x20, `usart0Config.dataRegisterEmptyInterrupt` is 0x26, `adcConfig.
 * adcInterrupt` is 0x2A. None of those exist on an ATmega2560.
 *
 * WHY THAT IS THE WHOLE PROBLEM, and why it had to be fixed before anything
 * else: Arduino's `HardwareSerial::write()` does not poll. It pushes the byte
 * into a ring buffer, sets UDRIE0, and lets the USART DATA REGISTER EMPTY ISR
 * drain it. Point that ISR at the wrong vector and the interrupt lands in the
 * middle of some other handler's slot — on an ATmega2560, word address 0x26 is
 * TIMER1 COMPC, four vectors before the one Arduino installed at 0x34. Nothing
 * throws. `Serial.print` simply produces nothing, forever, and experiment 11's
 * sketch is almost entirely Serial.print. §2.3's "a wrong number is worse than
 * a refusal", in its purest form.
 *
 * ── SOURCE FOR EVERY NUMBER BELOW ────────────────────────────────────────────
 * Atmel-2549Q, "ATmega640/V-1280/V-1281/V-2560/V-2561/V" datasheet:
 *
 *   Table 14-1  "Reset and Interrupt Vectors"      — every `*Interrupt` field.
 *               Program Address is a WORD address, which is exactly what
 *               avr8js's avrInterrupt() assigns to cpu.pc, so the datasheet's
 *               own column is copied across unchanged.
 *   §33         "Register Summary"                 — every register address.
 *               Given there as an I/O address for 0x00–0x3F and a data-space
 *               address in parentheses; avr8js addresses DATA space throughout,
 *               so the parenthesised value is the one used (TIFR0 = 0x15 (0x35)
 *               → 0x35).
 *   Table 13-9 …13-19  "Port X Pins Alternate Functions" — which pad each
 *               timer compare output and external clock lands on.
 *   Table 26-4  "Input Channel Selections"         — the ADC mux table.
 *   Table 26-3  "Voltage Reference Selections"     — REFS1:0.
 *   §8.1        SRAM Data Memory                   — RAMEND = 0x21FF.
 *
 * Nothing here is derived from avr8js's 328P values by analogy. Where the two
 * chips agree (the USART0 registers really are at 0xC0–0xC6 on both) it is
 * stated as the 2560's own address and the coincidence is noted, so that a
 * future reader cannot mistake a shared value for a copied one.
 */

import {
  ADCMuxInputType,
  ADCReference,
  type ADCConfig,
  type ADCMuxConfiguration,
  type AVRExternalInterrupt,
  type AVRPinChangeInterrupt,
  type AVRPortConfig,
  type AVRTimerConfig,
} from 'avr8js'
import type { AvrChip, USARTConfig } from './chip'

// ─── Interrupt vectors (Table 14-1) ───────────────────────────────────────────

/**
 * Every vector this file uses, as the datasheet's own word address.
 *
 * Written out in full rather than as `n * 2` so that each line can be checked
 * against the printed table by eye, which is the only check available without a
 * toolchain. The ATmega2560 has 57 vectors, 2 words apart, so vector index n
 * (1-based, RESET = 1) sits at word address (n - 1) * 2.
 */
export const VECTORS = {
  /** 1 — RESET */ RESET: 0x0000,
  /** 2 */ INT0: 0x0002,
  /** 3 */ INT1: 0x0004,
  /** 4 */ INT2: 0x0006,
  /** 5 */ INT3: 0x0008,
  /** 6 */ INT4: 0x000a,
  /** 7 */ INT5: 0x000c,
  /** 8 */ INT6: 0x000e,
  /** 9 */ INT7: 0x0010,
  /** 10 */ PCINT0: 0x0012,
  /** 11 */ PCINT1: 0x0014,
  /** 12 */ PCINT2: 0x0016,
  /** 13 */ WDT: 0x0018,
  /** 14 */ TIMER2_COMPA: 0x001a,
  /** 15 */ TIMER2_COMPB: 0x001c,
  /** 16 */ TIMER2_OVF: 0x001e,
  /** 17 */ TIMER1_CAPT: 0x0020,
  /** 18 */ TIMER1_COMPA: 0x0022,
  /** 19 */ TIMER1_COMPB: 0x0024,
  /** 20 */ TIMER1_COMPC: 0x0026,
  /** 21 */ TIMER1_OVF: 0x0028,
  /** 22 */ TIMER0_COMPA: 0x002a,
  /** 23 */ TIMER0_COMPB: 0x002c,
  /** 24 */ TIMER0_OVF: 0x002e,
  /** 25 */ SPI_STC: 0x0030,
  /** 26 */ USART0_RX: 0x0032,
  /** 27 */ USART0_UDRE: 0x0034,
  /** 28 */ USART0_TX: 0x0036,
  /** 29 */ ANALOG_COMP: 0x0038,
  /** 30 */ ADC: 0x003a,
  /** 31 */ EE_READY: 0x003c,
  /** 32 */ TIMER3_CAPT: 0x003e,
  /** 33 */ TIMER3_COMPA: 0x0040,
  /** 34 */ TIMER3_COMPB: 0x0042,
  /** 35 */ TIMER3_COMPC: 0x0044,
  /** 36 */ TIMER3_OVF: 0x0046,
  /** 37 */ USART1_RX: 0x0048,
  /** 38 */ USART1_UDRE: 0x004a,
  /** 39 */ USART1_TX: 0x004c,
  /** 40 */ TWI: 0x004e,
  /** 41 */ SPM_READY: 0x0050,
  /** 42 */ TIMER4_CAPT: 0x0052,
  /** 43 */ TIMER4_COMPA: 0x0054,
  /** 44 */ TIMER4_COMPB: 0x0056,
  /** 45 */ TIMER4_COMPC: 0x0058,
  /** 46 */ TIMER4_OVF: 0x005a,
  /** 47 */ TIMER5_CAPT: 0x005c,
  /** 48 */ TIMER5_COMPA: 0x005e,
  /** 49 */ TIMER5_COMPB: 0x0060,
  /** 50 */ TIMER5_COMPC: 0x0062,
  /** 51 */ TIMER5_OVF: 0x0064,
  /** 52 */ USART2_RX: 0x0066,
  /** 53 */ USART2_UDRE: 0x0068,
  /** 54 */ USART2_TX: 0x006a,
  /** 55 */ USART3_RX: 0x006c,
  /** 56 */ USART3_UDRE: 0x006e,
  /** 57 */ USART3_TX: 0x0070,
} as const

// ─── GPIO (§33 Register Summary, Table 13-x alternate functions) ──────────────

/**
 * The eleven ports, at the 2560's own PIN/DDR/PORT addresses.
 *
 * These are NOT avr8js's exported portXConfig objects, and the difference is
 * confined to interrupt metadata. avr8js's portB/portC/portD carry the 328P's
 * PCINT0/1/2 groups and its INT0/INT1 pads; on an ATmega2560 the pin-change
 * groups sit on ports B, E+J and K, and INT0–INT3 are PD0–PD3 rather than
 * PD2/PD3. The PIN/DDR/PORT addresses themselves are identical, which is a real
 * coincidence of the two register maps and not a copy: the 2560's Register
 * Summary lists PINB at 0x23 and PORTL at 0x10B, exactly as this file does.
 */

const EIMSK = 0x3d // §33: EIMSK = 0x1D (0x3D)
const EIFR = 0x3c // §33: EIFR  = 0x1C (0x3C)
const EICRA = 0x69 // §33: EICRA — INT3:0 sense control
const EICRB = 0x6a // §33: EICRB — INT7:4 sense control

/** INT0–INT3 live on PD0–PD3 and take their sense bits from EICRA. */
const INT0_3: AVRExternalInterrupt[] = [
  { EICR: EICRA, EIMSK, EIFR, index: 0, iscOffset: 0, interrupt: VECTORS.INT0 },
  { EICR: EICRA, EIMSK, EIFR, index: 1, iscOffset: 2, interrupt: VECTORS.INT1 },
  { EICR: EICRA, EIMSK, EIFR, index: 2, iscOffset: 4, interrupt: VECTORS.INT2 },
  { EICR: EICRA, EIMSK, EIFR, index: 3, iscOffset: 6, interrupt: VECTORS.INT3 },
]

/** INT4–INT7 live on PE4–PE7 and take their sense bits from EICRB. */
const INT4_7: AVRExternalInterrupt[] = [
  { EICR: EICRB, EIMSK, EIFR, index: 4, iscOffset: 0, interrupt: VECTORS.INT4 },
  { EICR: EICRB, EIMSK, EIFR, index: 5, iscOffset: 2, interrupt: VECTORS.INT5 },
  { EICR: EICRB, EIMSK, EIFR, index: 6, iscOffset: 4, interrupt: VECTORS.INT6 },
  { EICR: EICRB, EIMSK, EIFR, index: 7, iscOffset: 6, interrupt: VECTORS.INT7 },
]

const PCICR = 0x68 // §33: PCICR = 0x68
const PCIFR = 0x3b // §33: PCIFR = 0x1B (0x3B)

/**
 * PCINT0 — PCINT7:0 on PB7:0.  PCMSK0 = 0x6B, PCIE0 = PCICR bit 0.
 */
const PCINT0: AVRPinChangeInterrupt = {
  PCIE: 0,
  PCICR,
  PCIFR,
  PCMSK: 0x6b,
  pinChangeInterrupt: VECTORS.PCINT0,
  mask: 0xff,
  offset: 0,
}

/**
 * PCINT1 — PCINT8 is PE0 and PCINT15:9 are PJ6:0, so ONE vector spans TWO
 * ports. `mask` selects which pads of the port participate and `offset` shifts
 * the pad index onto the PCMSK1 bit: PE0 is PCMSK1 bit 0 (offset 0, mask 0x01),
 * PJ0 is PCMSK1 bit 1 (offset 1, mask 0x7F for PJ6:0). PJ7 has no PCINT.
 */
const PCINT1_PORTE: AVRPinChangeInterrupt = {
  PCIE: 1,
  PCICR,
  PCIFR,
  PCMSK: 0x6c,
  pinChangeInterrupt: VECTORS.PCINT1,
  mask: 0x01,
  offset: 0,
}
const PCINT1_PORTJ: AVRPinChangeInterrupt = {
  PCIE: 1,
  PCICR,
  PCIFR,
  PCMSK: 0x6c,
  pinChangeInterrupt: VECTORS.PCINT1,
  mask: 0x7f,
  offset: 1,
}

/** PCINT2 — PCINT23:16 on PK7:0. PCMSK2 = 0x6D, PCIE2 = PCICR bit 2. */
const PCINT2: AVRPinChangeInterrupt = {
  PCIE: 2,
  PCICR,
  PCIFR,
  PCMSK: 0x6d,
  pinChangeInterrupt: VECTORS.PCINT2,
  mask: 0xff,
  offset: 0,
}

export const portA2560: AVRPortConfig = { PIN: 0x20, DDR: 0x21, PORT: 0x22, externalInterrupts: [] }
export const portB2560: AVRPortConfig = {
  PIN: 0x23,
  DDR: 0x24,
  PORT: 0x25,
  pinChange: PCINT0,
  externalInterrupts: [],
}
export const portC2560: AVRPortConfig = { PIN: 0x26, DDR: 0x27, PORT: 0x28, externalInterrupts: [] }
export const portD2560: AVRPortConfig = {
  PIN: 0x29,
  DDR: 0x2a,
  PORT: 0x2b,
  externalInterrupts: [...INT0_3],
}
export const portE2560: AVRPortConfig = {
  PIN: 0x2c,
  DDR: 0x2d,
  PORT: 0x2e,
  pinChange: PCINT1_PORTE,
  // INT4–INT7 are PE4–PE7, so the first four slots of this port have none.
  externalInterrupts: [null, null, null, null, ...INT4_7],
}
export const portF2560: AVRPortConfig = { PIN: 0x2f, DDR: 0x30, PORT: 0x31, externalInterrupts: [] }
export const portG2560: AVRPortConfig = { PIN: 0x32, DDR: 0x33, PORT: 0x34, externalInterrupts: [] }
export const portH2560: AVRPortConfig = {
  PIN: 0x100,
  DDR: 0x101,
  PORT: 0x102,
  externalInterrupts: [],
}
export const portJ2560: AVRPortConfig = {
  PIN: 0x103,
  DDR: 0x104,
  PORT: 0x105,
  pinChange: PCINT1_PORTJ,
  externalInterrupts: [],
}
export const portK2560: AVRPortConfig = {
  PIN: 0x106,
  DDR: 0x107,
  PORT: 0x108,
  pinChange: PCINT2,
  externalInterrupts: [],
}
export const portL2560: AVRPortConfig = {
  PIN: 0x109,
  DDR: 0x10a,
  PORT: 0x10b,
  externalInterrupts: [],
}

const PORTS = {
  A: portA2560,
  B: portB2560,
  C: portC2560,
  D: portD2560,
  E: portE2560,
  F: portF2560,
  G: portG2560,
  H: portH2560,
  J: portJ2560,
  K: portK2560,
  L: portL2560,
} as const

// ─── Timers (§17 8-bit Timer0, §17 16-bit Timer1/3/4/5, §20 Timer2) ───────────

/** Timer0/1/3/4/5 clock select (Table 17-9 / 20-9). 6 and 7 are external. */
const DIVIDERS_01345 = { 0: 0, 1: 1, 2: 8, 3: 64, 4: 256, 5: 1024, 6: 0, 7: 0 } as const
/** Timer2 has its own ladder (Table 20-9), including /32 and /128. */
const DIVIDERS_2 = { 0: 0, 1: 1, 2: 8, 3: 32, 4: 64, 5: 128, 6: 256, 7: 1024 } as const

/**
 * TIFRn / TIMSKn bit positions.
 *
 * The 8-bit timers (0 and 2) have no OCFnC/OCIEnC bit at all, so those read 0
 * — the same convention avr8js's own `defaultTimerBits` uses for the 328P. The
 * 16-bit timers (1, 3, 4, 5) DO have a third compare unit at bit 3.
 */
const BITS_8 = { TOV: 1, OCFA: 2, OCFB: 4, OCFC: 0, TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 0 }
const BITS_16 = { TOV: 1, OCFA: 2, OCFB: 4, OCFC: 8, TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 8 }

/**
 * Timer0 — 8-bit, and the one Arduino builds millis()/delay() on.
 *
 * The register addresses are identical to the 328P's; the vectors are not.
 * OC0A is PB7 (Mega pin 13) and OC0B is PG5 (Mega pin 4) — Table 13-9/13-14 —
 * where on a 328P they are PD6 and PD5.
 */
export const timer0Config2560: AVRTimerConfig = {
  bits: 8,
  dividers: DIVIDERS_01345,
  captureInterrupt: 0, // Timer0 has no input capture unit.
  compAInterrupt: VECTORS.TIMER0_COMPA,
  compBInterrupt: VECTORS.TIMER0_COMPB,
  compCInterrupt: 0,
  ovfInterrupt: VECTORS.TIMER0_OVF,
  TIFR: 0x35, // §33: TIFR0 = 0x15 (0x35)
  OCRA: 0x47,
  OCRB: 0x48,
  OCRC: 0,
  ICR: 0,
  TCNT: 0x46,
  TCCRA: 0x44,
  TCCRB: 0x45,
  TCCRC: 0,
  TIMSK: 0x6e, // §33: TIMSK0 = 0x6E
  compPortA: portB2560.PORT,
  compPinA: 7, // OC0A = PB7
  compPortB: portG2560.PORT,
  compPinB: 5, // OC0B = PG5
  compPortC: 0,
  compPinC: 0,
  externalClockPort: portD2560.PORT,
  externalClockPin: 7, // T0 = PD7
  ...BITS_8,
}

/** Timer1 — 16-bit, three compare units. OC1A/B/C = PB5/PB6/PB7. */
export const timer1Config2560: AVRTimerConfig = {
  bits: 16,
  dividers: DIVIDERS_01345,
  captureInterrupt: VECTORS.TIMER1_CAPT,
  compAInterrupt: VECTORS.TIMER1_COMPA,
  compBInterrupt: VECTORS.TIMER1_COMPB,
  compCInterrupt: VECTORS.TIMER1_COMPC,
  ovfInterrupt: VECTORS.TIMER1_OVF,
  TIFR: 0x36, // §33: TIFR1 = 0x16 (0x36)
  OCRA: 0x88,
  OCRB: 0x8a,
  OCRC: 0x8c,
  ICR: 0x86,
  TCNT: 0x84,
  TCCRA: 0x80,
  TCCRB: 0x81,
  TCCRC: 0x82,
  TIMSK: 0x6f, // §33: TIMSK1 = 0x6F
  compPortA: portB2560.PORT,
  compPinA: 5,
  compPortB: portB2560.PORT,
  compPinB: 6,
  compPortC: portB2560.PORT,
  compPinC: 7,
  externalClockPort: portD2560.PORT,
  externalClockPin: 6, // T1 = PD6
  ...BITS_16,
}

/** Timer2 — 8-bit, async-capable. OC2A = PB4 (pin 10), OC2B = PH6 (pin 9). */
export const timer2Config2560: AVRTimerConfig = {
  bits: 8,
  dividers: DIVIDERS_2,
  captureInterrupt: 0,
  compAInterrupt: VECTORS.TIMER2_COMPA,
  compBInterrupt: VECTORS.TIMER2_COMPB,
  compCInterrupt: 0,
  ovfInterrupt: VECTORS.TIMER2_OVF,
  TIFR: 0x37, // §33: TIFR2 = 0x17 (0x37)
  OCRA: 0xb3,
  OCRB: 0xb4,
  OCRC: 0,
  ICR: 0,
  TCNT: 0xb2,
  TCCRA: 0xb0,
  TCCRB: 0xb1,
  TCCRC: 0,
  TIMSK: 0x70, // §33: TIMSK2 = 0x70
  compPortA: portB2560.PORT,
  compPinA: 4,
  compPortB: portH2560.PORT,
  compPinB: 6,
  compPortC: 0,
  compPinC: 0,
  // Timer2's external source is the TOSC crystal, not a T2 pad.
  externalClockPort: 0,
  externalClockPin: 0,
  ...BITS_8,
}

/** Timer3 — 16-bit. OC3A/B/C = PE3/PE4/PE5 (Mega pins 5, 2, 3). */
export const timer3Config2560: AVRTimerConfig = {
  bits: 16,
  dividers: DIVIDERS_01345,
  captureInterrupt: VECTORS.TIMER3_CAPT,
  compAInterrupt: VECTORS.TIMER3_COMPA,
  compBInterrupt: VECTORS.TIMER3_COMPB,
  compCInterrupt: VECTORS.TIMER3_COMPC,
  ovfInterrupt: VECTORS.TIMER3_OVF,
  TIFR: 0x38, // §33: TIFR3 = 0x18 (0x38)
  OCRA: 0x98,
  OCRB: 0x9a,
  OCRC: 0x9c,
  ICR: 0x96,
  TCNT: 0x94,
  TCCRA: 0x90,
  TCCRB: 0x91,
  TCCRC: 0x92,
  TIMSK: 0x71, // §33: TIMSK3 = 0x71
  compPortA: portE2560.PORT,
  compPinA: 3,
  compPortB: portE2560.PORT,
  compPinB: 4,
  compPortC: portE2560.PORT,
  compPinC: 5,
  externalClockPort: portE2560.PORT,
  externalClockPin: 6, // T3 = PE6
  ...BITS_16,
}

/** Timer4 — 16-bit. OC4A/B/C = PH3/PH4/PH5 (Mega pins 6, 7, 8). */
export const timer4Config2560: AVRTimerConfig = {
  bits: 16,
  dividers: DIVIDERS_01345,
  captureInterrupt: VECTORS.TIMER4_CAPT,
  compAInterrupt: VECTORS.TIMER4_COMPA,
  compBInterrupt: VECTORS.TIMER4_COMPB,
  compCInterrupt: VECTORS.TIMER4_COMPC,
  ovfInterrupt: VECTORS.TIMER4_OVF,
  TIFR: 0x39, // §33: TIFR4 = 0x19 (0x39)
  OCRA: 0xa8,
  OCRB: 0xaa,
  OCRC: 0xac,
  ICR: 0xa6,
  TCNT: 0xa4,
  TCCRA: 0xa0,
  TCCRB: 0xa1,
  TCCRC: 0xa2,
  TIMSK: 0x72, // §33: TIMSK4 = 0x72
  compPortA: portH2560.PORT,
  compPinA: 3,
  compPortB: portH2560.PORT,
  compPinB: 4,
  compPortC: portH2560.PORT,
  compPinC: 5,
  externalClockPort: portH2560.PORT,
  externalClockPin: 7, // T4 = PH7
  ...BITS_16,
}

/** Timer5 — 16-bit, and the only peripheral above 0x100. OC5A/B/C = PL3/PL4/PL5. */
export const timer5Config2560: AVRTimerConfig = {
  bits: 16,
  dividers: DIVIDERS_01345,
  captureInterrupt: VECTORS.TIMER5_CAPT,
  compAInterrupt: VECTORS.TIMER5_COMPA,
  compBInterrupt: VECTORS.TIMER5_COMPB,
  compCInterrupt: VECTORS.TIMER5_COMPC,
  ovfInterrupt: VECTORS.TIMER5_OVF,
  TIFR: 0x3a, // §33: TIFR5 = 0x1A (0x3A)
  OCRA: 0x128,
  OCRB: 0x12a,
  OCRC: 0x12c,
  ICR: 0x126,
  TCNT: 0x124,
  TCCRA: 0x120,
  TCCRB: 0x121,
  TCCRC: 0x122,
  TIMSK: 0x73, // §33: TIMSK5 = 0x73
  compPortA: portL2560.PORT,
  compPinA: 3,
  compPortB: portL2560.PORT,
  compPinB: 4,
  compPortC: portL2560.PORT,
  compPinC: 5,
  externalClockPort: portL2560.PORT,
  externalClockPin: 2, // T5 = PL2
  ...BITS_16,
}

// ─── USART0 (§22, §33) ────────────────────────────────────────────────────────

/**
 * USART0 — `Serial` on an Arduino Mega, and the reason this file exists.
 *
 * The four USARTs are at 0xC0, 0xC8, 0xD0 and 0x130. USART0's block happens to
 * sit at the same addresses as the 328P's single USART; the vectors do not.
 */
export const usart0Config2560: USARTConfig = {
  rxCompleteInterrupt: VECTORS.USART0_RX, // 0x32
  dataRegisterEmptyInterrupt: VECTORS.USART0_UDRE, // 0x34
  txCompleteInterrupt: VECTORS.USART0_TX, // 0x36
  UCSRA: 0xc0,
  UCSRB: 0xc1,
  UCSRC: 0xc2,
  UBRRL: 0xc4,
  UBRRH: 0xc5,
  UDR: 0xc6,
}

/**
 * USART1–3 (`Serial1`…`Serial3`), recorded but NOT instantiated by the engine.
 *
 * They exist here so the addresses are written down once, from the datasheet,
 * next to USART0 — and so that adding them later is a one-line change rather
 * than a fresh reading of §33. The engine deliberately runs USART0 only: the
 * editor has a single "Serial" pane, and feeding four physically distinct
 * ports into it would present bytes that never shared a wire as one stream.
 */
export const usart1Config2560: USARTConfig = {
  rxCompleteInterrupt: VECTORS.USART1_RX,
  dataRegisterEmptyInterrupt: VECTORS.USART1_UDRE,
  txCompleteInterrupt: VECTORS.USART1_TX,
  UCSRA: 0xc8,
  UCSRB: 0xc9,
  UCSRC: 0xca,
  UBRRL: 0xcc,
  UBRRH: 0xcd,
  UDR: 0xce,
}
export const usart2Config2560: USARTConfig = {
  rxCompleteInterrupt: VECTORS.USART2_RX,
  dataRegisterEmptyInterrupt: VECTORS.USART2_UDRE,
  txCompleteInterrupt: VECTORS.USART2_TX,
  UCSRA: 0xd0,
  UCSRB: 0xd1,
  UCSRC: 0xd2,
  UBRRL: 0xd4,
  UBRRH: 0xd5,
  UDR: 0xd6,
}
export const usart3Config2560: USARTConfig = {
  rxCompleteInterrupt: VECTORS.USART3_RX,
  dataRegisterEmptyInterrupt: VECTORS.USART3_UDRE,
  txCompleteInterrupt: VECTORS.USART3_TX,
  UCSRA: 0x130,
  UCSRB: 0x131,
  UCSRC: 0x132,
  UBRRL: 0x134,
  UBRRH: 0x135,
  UDR: 0x136,
}

// ─── ADC (§26) ────────────────────────────────────────────────────────────────

/**
 * Sixteen single-ended channels, selected by MUX5:0 — and MUX5 is NOT in ADMUX.
 *
 * It is ADCSRB bit 3, which is why `muxInputMask` has to be 0x3F rather than the
 * 328P's 0xF: avr8js builds the mux index as `(ADMUX & 0x1F) | (ADCSRB.MUX5 ?
 * 0x20 : 0)` and then masks. Mask it to 0xF and A8–A15 all alias onto A0–A7,
 * silently, with a plausible number.
 *
 * Table 26-4: 0x00–0x07 → ADC0–7, 0x1E → 1.1 V bandgap, 0x1F → 0 V,
 * 0x20–0x27 → ADC8–15. The differential pairs (0x08–0x1D, 0x28–0x3D) are left
 * undefined on purpose — avr8js falls back to a constant 0 V for an unlisted
 * index, and modelling gain stages nothing in the lab uses would be inventing
 * behaviour rather than reproducing it.
 */
export const atmega2560Channels: ADCMuxConfiguration = {
  0: { type: ADCMuxInputType.SingleEnded, channel: 0 },
  1: { type: ADCMuxInputType.SingleEnded, channel: 1 },
  2: { type: ADCMuxInputType.SingleEnded, channel: 2 },
  3: { type: ADCMuxInputType.SingleEnded, channel: 3 },
  4: { type: ADCMuxInputType.SingleEnded, channel: 4 },
  5: { type: ADCMuxInputType.SingleEnded, channel: 5 },
  6: { type: ADCMuxInputType.SingleEnded, channel: 6 },
  7: { type: ADCMuxInputType.SingleEnded, channel: 7 },
  0x1e: { type: ADCMuxInputType.Constant, voltage: 1.1 },
  0x1f: { type: ADCMuxInputType.Constant, voltage: 0 },
  0x20: { type: ADCMuxInputType.SingleEnded, channel: 8 },
  0x21: { type: ADCMuxInputType.SingleEnded, channel: 9 },
  0x22: { type: ADCMuxInputType.SingleEnded, channel: 10 },
  0x23: { type: ADCMuxInputType.SingleEnded, channel: 11 },
  0x24: { type: ADCMuxInputType.SingleEnded, channel: 12 },
  0x25: { type: ADCMuxInputType.SingleEnded, channel: 13 },
  0x26: { type: ADCMuxInputType.SingleEnded, channel: 14 },
  0x27: { type: ADCMuxInputType.SingleEnded, channel: 15 },
}

export const adcConfig2560: ADCConfig = {
  ADMUX: 0x7c,
  ADCSRA: 0x7a,
  ADCSRB: 0x7b,
  ADCL: 0x78,
  ADCH: 0x79,
  DIDR0: 0x7e,
  adcInterrupt: VECTORS.ADC, // 0x3A
  numChannels: 16,
  muxInputMask: 0x3f,
  muxChannels: atmega2560Channels,
  /**
   * Table 26-3, indexed by REFS1:0. The 2560's 0b10 is the 1.1 V bandgap and
   * 0b11 is the 2.56 V reference; on a 328P 0b10 is reserved and 0b11 is the
   * 1.1 V one, so the last two entries are genuinely swapped between the parts.
   */
  adcReferences: [
    ADCReference.AREF,
    ADCReference.AVCC,
    ADCReference.Internal1V1,
    ADCReference.Internal2V56,
  ],
}

// ─── Board pin map (Arduino Mega 2560 Rev3 variant) ───────────────────────────

/**
 * Silkscreen name → (port, bit), exactly as Arduino's own
 * `variants/mega/pins_arduino.h` maps them.
 *
 * TWO STRETCHES ARE NOT MONOTONIC AND BOTH MATTER TO EXPERIMENT 11:
 *
 *   D22…D29 → PA0…PA7  (ascending)
 *   D30…D37 → PC7…PC0  (DESCENDING — pin 30 is the TOP bit of port C)
 *
 * The lab sheet drives lanes 1–4 on pins 22–33, which straddles that boundary.
 * Getting port C backwards would light lane 4's green when the sketch asked for
 * lane 3's yellow: a perfectly plausible, entirely wrong picture.
 *
 * A6/A7 and A8–A15 exist on a Mega and not on an Uno; A8–A15 are on PORTK and
 * their ADC channels need MUX5 (see adcConfig2560).
 */
export const MEGA_PIN_MAP: Record<string, readonly [string, number]> = {
  D0: ['E', 0], D1: ['E', 1], D2: ['E', 4], D3: ['E', 5],
  D4: ['G', 5], D5: ['E', 3], D6: ['H', 3], D7: ['H', 4],
  D8: ['H', 5], D9: ['H', 6], D10: ['B', 4], D11: ['B', 5],
  D12: ['B', 6], D13: ['B', 7],
  D14: ['J', 1], D15: ['J', 0], D16: ['H', 1], D17: ['H', 0],
  D18: ['D', 3], D19: ['D', 2], D20: ['D', 1], D21: ['D', 0],
  D22: ['A', 0], D23: ['A', 1], D24: ['A', 2], D25: ['A', 3],
  D26: ['A', 4], D27: ['A', 5], D28: ['A', 6], D29: ['A', 7],
  D30: ['C', 7], D31: ['C', 6], D32: ['C', 5], D33: ['C', 4],
  D34: ['C', 3], D35: ['C', 2], D36: ['C', 1], D37: ['C', 0],
  D38: ['D', 7], D39: ['G', 2], D40: ['G', 1], D41: ['G', 0],
  D42: ['L', 7], D43: ['L', 6], D44: ['L', 5], D45: ['L', 4],
  D46: ['L', 3], D47: ['L', 2], D48: ['L', 1], D49: ['L', 0],
  D50: ['B', 3], D51: ['B', 2], D52: ['B', 1], D53: ['B', 0],
  A0: ['F', 0], A1: ['F', 1], A2: ['F', 2], A3: ['F', 3],
  A4: ['F', 4], A5: ['F', 5], A6: ['F', 6], A7: ['F', 7],
  A8: ['K', 0], A9: ['K', 1], A10: ['K', 2], A11: ['K', 3],
  A12: ['K', 4], A13: ['K', 5], A14: ['K', 6], A15: ['K', 7],
}

/** Analog pin id → ADC channel, in readout order. */
export const MEGA_ADC_PINS: ReadonlyArray<readonly [string, number]> = Array.from(
  { length: 16 },
  (_, ch) => [`A${ch}`, ch] as const,
)

/**
 * The chip, as the engine consumes it.
 *
 * `flashBytes` 0x40000 is not merely "enough room". avr8js decides the PC width
 * from it — `pc22Bits = progBytes.length > 0x20000` in cpu.ts — and pc22Bits is
 * what makes CALL/RET/RETI and avrInterrupt() push and pop a THREE-byte return
 * address. Size the program memory at 128 KB and every interrupt return on a
 * 256 KB part corrupts the stack. So the flash size is load-bearing behaviour,
 * not an allocation hint.
 *
 * `cpuSramBytes` 8448 puts RAMEND at 0x21FF (§8.1). avr8js allocates
 * `sramBytes + 0x100`, and the 2560's internal SRAM starts at 0x200 rather than
 * 0x100 because it has a full page of extended I/O registers below it — so the
 * figure is 8192 bytes of SRAM plus the 256-byte extended I/O page, and the
 * reset stack pointer lands exactly on the datasheet's RAMEND.
 */
export const ATMEGA2560: AvrChip = {
  id: 'atmega2560',
  label: 'ATmega2560',
  flashBytes: 0x40000,
  cpuSramBytes: 8448,
  pinMap: MEGA_PIN_MAP,
  ports: PORTS,
  /**
   * ALL SIX, including 3, 4 and 5 — which experiment 11 does not need.
   *
   * Its sketch drives twelve LEDs with digitalWrite and reads four pots with
   * analogRead; the only timer on its critical path is Timer0, which millis()
   * and therefore delay() are built on. Timers 3-5 exist here for everything
   * else a student will reach for: on an Arduino Mega, analogWrite() on pins
   * 2, 3, 5 (Timer3), 6, 7, 8 (Timer4) and 44, 45, 46 (Timer5) goes nowhere
   * without them, and "PWM silently does nothing on nine of the board's
   * fifteen PWM pins" is the same class of defect as the vector bug above.
   *
   * The cost was measured rather than guessed. Arduino's init() starts every
   * timer at prescaler 64, and with all six running the emulator sustains
   * 37.7 Mcycles/s against the 328P's 44.6 with three — 2.36x realtime against
   * 2.79x. Fifteen percent for nine working PWM pins is worth paying.
   */
  timers: [
    timer0Config2560,
    timer1Config2560,
    timer2Config2560,
    timer3Config2560,
    timer4Config2560,
    timer5Config2560,
  ],
  usart0: usart0Config2560,
  adc: adcConfig2560,
  adcPins: MEGA_ADC_PINS,
}
