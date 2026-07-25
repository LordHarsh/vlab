/**
 * ATmega2560 / Arduino Mega — the peripheral map, proved against the datasheet
 * and against executed AVR code.
 *
 * WHY THIS FILE IS SHAPED THE WAY IT IS. There is no avr-gcc and no arduino-cli
 * on this machine and no Mega .hex in the repository, so the usual proof — run
 * the real sketch, read the serial output — is not available. Faking a .hex
 * would be worse than useless. Instead every claim here is settled one of two
 * ways:
 *
 *   1. RESTATEMENT. Each address is written out again from the Atmel-2549Q
 *      datasheet, with the table it came from named, and compared to what
 *      avr/atmega2560.ts produces. Two independent transcriptions of the same
 *      printed table is a real check; it is exactly how a wrong digit gets
 *      caught without a toolchain.
 *
 *   2. EXECUTION. Small AVR programs are hand-assembled (avr8js ships an
 *      assembler) and run on a real CPU with the real peripherals attached.
 *      These are not mocks — the vector table is a genuine table of JMPs, the
 *      ISRs are entered by avrInterrupt(), and the bytes come out of AVRUSART's
 *      own transmit callback.
 *
 * AND EVERY EXECUTION TEST HAS A NEGATIVE CONTROL. The same program is run a
 * second time with avr8js's stock ATmega328P peripheral configuration, which is
 * what the engine used before this work. Each vector table entry that is not
 * the one under test is a `JMP` to a handler that writes a sentinel byte, so a
 * misdirected interrupt is visible rather than silent. That pairing is the
 * measurement: the Mega configuration produces the output, the 328P
 * configuration produces the sentinel and NOTHING ELSE.
 *
 * The bug being pinned is the one that would otherwise have shipped:
 * `Serial.print` on an emulated Mega producing no output at all, forever,
 * because Arduino's HardwareSerial transmits from the USART DATA REGISTER
 * EMPTY interrupt and avr8js points that interrupt at word address 0x26 — which
 * on an ATmega2560 is TIMER1 COMPARE C, four vectors before the right one.
 *
 * Run: npx tsx lib/simulator/__tests__/mega.test.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  adcConfig as adcConfig328,
  avrInstruction,
  portDConfig,
  timer0Config as timer0Config328,
  usart0Config as usart0Config328,
} from 'avr8js'
import { asmProgram } from 'avr8js/dist/esm/utils/test-utils'
import { ATMEGA328P, chipForDoc, type USARTConfig } from '../avr/chip'
import {
  ATMEGA2560,
  MEGA_PIN_MAP,
  VECTORS,
  adcConfig2560,
  timer0Config2560,
  timer1Config2560,
  timer2Config2560,
  timer3Config2560,
  timer4Config2560,
  timer5Config2560,
  usart0Config2560,
} from '../avr/atmega2560'
import { CLOCK_HZ, SimulationEngine, parseIntelHex } from '../engine'
import { BOARDS, detectBoard } from '../model/boards'
import { compile } from '../model/compile'
import type { CircuitDoc } from '../model/document'
import { EXPERIMENT_STARTERS } from '../model/examples'
import { getPart } from '../model/parts'

// ─── Harness ──────────────────────────────────────────────────────────────────

interface Row {
  group: string
  name: string
  expected: string
  actual: string
  pass: boolean
}
const rows: Row[] = []
let currentGroup = ''
function group(g: string): void {
  currentGroup = g
}
function truth(name: string, pass: boolean, expected: string, actual: string): void {
  rows.push({ group: currentGroup, name, expected, actual, pass })
}
function eq(name: string, actual: unknown, expected: unknown): void {
  const a = typeof actual === 'number' ? hex(actual) : String(actual)
  const e = typeof expected === 'number' ? hex(expected) : String(expected)
  truth(name, a === e, e, a)
}
function hex(n: number): string {
  return n < 0 ? String(n) : '0x' + n.toString(16).padStart(2, '0')
}

// ══════════════════════════════════════════════════════════════════════════════
group('A. Interrupt vectors, restated from Atmel-2549Q Table 14-1')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The printed table, transcribed independently of avr/atmega2560.ts.
   *
   * Columns are the datasheet's own: "Vector No." (1-based, RESET = 1) and
   * "Program Address" in WORDS. The ATmega2560 uses two-word JMP entries, so
   * the address is (No. - 1) * 2 — checked below rather than assumed, because
   * an off-by-one in that relation is precisely the kind of mistake that puts
   * an ISR four slots away and produces silence.
   */
  const DATASHEET: Array<[no: number, word: number, name: keyof typeof VECTORS]> = [
    [1, 0x0000, 'RESET'],
    [2, 0x0002, 'INT0'],
    [3, 0x0004, 'INT1'],
    [4, 0x0006, 'INT2'],
    [5, 0x0008, 'INT3'],
    [6, 0x000a, 'INT4'],
    [7, 0x000c, 'INT5'],
    [8, 0x000e, 'INT6'],
    [9, 0x0010, 'INT7'],
    [10, 0x0012, 'PCINT0'],
    [11, 0x0014, 'PCINT1'],
    [12, 0x0016, 'PCINT2'],
    [13, 0x0018, 'WDT'],
    [14, 0x001a, 'TIMER2_COMPA'],
    [15, 0x001c, 'TIMER2_COMPB'],
    [16, 0x001e, 'TIMER2_OVF'],
    [17, 0x0020, 'TIMER1_CAPT'],
    [18, 0x0022, 'TIMER1_COMPA'],
    [19, 0x0024, 'TIMER1_COMPB'],
    [20, 0x0026, 'TIMER1_COMPC'],
    [21, 0x0028, 'TIMER1_OVF'],
    [22, 0x002a, 'TIMER0_COMPA'],
    [23, 0x002c, 'TIMER0_COMPB'],
    [24, 0x002e, 'TIMER0_OVF'],
    [25, 0x0030, 'SPI_STC'],
    [26, 0x0032, 'USART0_RX'],
    [27, 0x0034, 'USART0_UDRE'],
    [28, 0x0036, 'USART0_TX'],
    [29, 0x0038, 'ANALOG_COMP'],
    [30, 0x003a, 'ADC'],
    [31, 0x003c, 'EE_READY'],
    [32, 0x003e, 'TIMER3_CAPT'],
    [33, 0x0040, 'TIMER3_COMPA'],
    [34, 0x0042, 'TIMER3_COMPB'],
    [35, 0x0044, 'TIMER3_COMPC'],
    [36, 0x0046, 'TIMER3_OVF'],
    [37, 0x0048, 'USART1_RX'],
    [38, 0x004a, 'USART1_UDRE'],
    [39, 0x004c, 'USART1_TX'],
    [40, 0x004e, 'TWI'],
    [41, 0x0050, 'SPM_READY'],
    [42, 0x0052, 'TIMER4_CAPT'],
    [43, 0x0054, 'TIMER4_COMPA'],
    [44, 0x0056, 'TIMER4_COMPB'],
    [45, 0x0058, 'TIMER4_COMPC'],
    [46, 0x005a, 'TIMER4_OVF'],
    [47, 0x005c, 'TIMER5_CAPT'],
    [48, 0x005e, 'TIMER5_COMPA'],
    [49, 0x0060, 'TIMER5_COMPB'],
    [50, 0x0062, 'TIMER5_COMPC'],
    [51, 0x0064, 'TIMER5_OVF'],
    [52, 0x0066, 'USART2_RX'],
    [53, 0x0068, 'USART2_UDRE'],
    [54, 0x006a, 'USART2_TX'],
    [55, 0x006c, 'USART3_RX'],
    [56, 0x006e, 'USART3_UDRE'],
    [57, 0x0070, 'USART3_TX'],
  ]

  eq('the table has 57 vectors, as the datasheet lists', DATASHEET.length, 57)
  let spacingOk = true
  for (const [no, word, name] of DATASHEET) {
    if (word !== (no - 1) * 2) spacingOk = false
    eq(`vector ${String(no).padStart(2)} ${name} at word ${hex(word)}`, VECTORS[name], word)
  }
  truth(
    'every entry is exactly two words after the previous one (two-word JMP slots)',
    spacingOk,
    'word = (No. - 1) * 2',
    spacingOk ? 'word = (No. - 1) * 2' : 'spacing broken',
  )

  eq(
    'nothing in VECTORS is missing from the datasheet transcription',
    Object.keys(VECTORS).sort().join(','),
    DATASHEET.map(([, , n]) => n)
      .sort()
      .join(','),
  )

  // ── The four that the peripherals actually consume ──
  eq('timer0Config2560.ovfInterrupt is TIMER0_OVF', timer0Config2560.ovfInterrupt, 0x2e)
  eq(
    'usart0Config2560.dataRegisterEmptyInterrupt is USART0_UDRE',
    usart0Config2560.dataRegisterEmptyInterrupt,
    0x34,
  )
  eq('usart0Config2560.rxCompleteInterrupt is USART0_RX', usart0Config2560.rxCompleteInterrupt, 0x32)
  eq('usart0Config2560.txCompleteInterrupt is USART0_TX', usart0Config2560.txCompleteInterrupt, 0x36)
  eq('adcConfig2560.adcInterrupt is ADC', adcConfig2560.adcInterrupt, 0x3a)

  // ── And that they are NOT the 328P's, which is the defect being fixed ──
  eq('avr8js ships the 328P TIMER0_OVF vector (0x20)', timer0Config328.ovfInterrupt, 0x20)
  eq(
    'avr8js ships the 328P USART UDRE vector (0x26)',
    usart0Config328.dataRegisterEmptyInterrupt,
    0x26,
  )
  eq('avr8js ships the 328P ADC vector (0x2A)', adcConfig328.adcInterrupt, 0x2a)
  truth(
    'and 0x26 on an ATmega2560 is TIMER1 COMPARE C — a real, wrong, silent handler',
    VECTORS.TIMER1_COMPC === usart0Config328.dataRegisterEmptyInterrupt,
    'the 328P UDRE vector collides with TIMER1_COMPC',
    `0x26 = ${
      (Object.keys(VECTORS) as Array<keyof typeof VECTORS>).find((k) => VECTORS[k] === 0x26) ??
      'unmapped'
    }`,
  )

  const megaVecs = [
    ...ATMEGA2560.timers.flatMap((t) => [
      t.ovfInterrupt,
      t.compAInterrupt,
      t.compBInterrupt,
      t.compCInterrupt,
      t.captureInterrupt,
    ]),
    ATMEGA2560.usart0.rxCompleteInterrupt,
    ATMEGA2560.usart0.dataRegisterEmptyInterrupt,
    ATMEGA2560.usart0.txCompleteInterrupt,
    ATMEGA2560.adc.adcInterrupt,
  ].filter((v) => v !== 0)
  const known = new Set<number>(Object.values(VECTORS))
  truth(
    'every vector the Mega chip uses is one the datasheet table actually defines',
    megaVecs.every((v) => known.has(v)),
    'all in Table 14-1',
    megaVecs.filter((v) => !known.has(v)).map(hex).join(',') || 'all in Table 14-1',
  )
  truth(
    'and none of them repeats (two peripherals sharing a slot would be silent)',
    new Set(megaVecs).size === megaVecs.length,
    `${megaVecs.length} distinct`,
    `${new Set(megaVecs).size} distinct of ${megaVecs.length}`,
  )
  truth(
    'the highest vector fits avr8js’s MAX_INTERRUPTS of 128',
    Math.max(...Object.values(VECTORS)) < 128,
    '< 128',
    String(Math.max(...Object.values(VECTORS))),
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('B. Register addresses, restated from Atmel-2549Q §33 Register Summary')
// ══════════════════════════════════════════════════════════════════════════════
{
  // USART0 — §33 lists UCSR0A at 0xC0 through UDR0 at 0xC6 (0xC3 is unused).
  eq('UCSR0A', usart0Config2560.UCSRA, 0xc0)
  eq('UCSR0B', usart0Config2560.UCSRB, 0xc1)
  eq('UCSR0C', usart0Config2560.UCSRC, 0xc2)
  eq('UBRR0L', usart0Config2560.UBRRL, 0xc4)
  eq('UBRR0H', usart0Config2560.UBRRH, 0xc5)
  eq('UDR0', usart0Config2560.UDR, 0xc6)

  // ADC — §33: ADCL 0x78, ADCH 0x79, ADCSRA 0x7A, ADCSRB 0x7B, ADMUX 0x7C,
  // DIDR2 0x7D, DIDR0 0x7E, DIDR1 0x7F.
  eq('ADCL', adcConfig2560.ADCL, 0x78)
  eq('ADCH', adcConfig2560.ADCH, 0x79)
  eq('ADCSRA', adcConfig2560.ADCSRA, 0x7a)
  eq('ADCSRB', adcConfig2560.ADCSRB, 0x7b)
  eq('ADMUX', adcConfig2560.ADMUX, 0x7c)
  eq('DIDR0', adcConfig2560.DIDR0, 0x7e)
  eq('16 single-ended channels (ADC0-ADC15)', adcConfig2560.numChannels, 16)
  /**
   * MUX5 lives in ADCSRB bit 3, not in ADMUX, so the mux index is six bits
   * wide. avr8js builds it as (ADMUX & 0x1F) | (MUX5 ? 0x20 : 0) and then
   * masks with muxInputMask — mask it to the 328P's 0xF and A8-A15 silently
   * alias onto A0-A7. Group I measures that aliasing rather than asserting it.
   */
  eq('muxInputMask keeps MUX5 (six-bit mux index)', adcConfig2560.muxInputMask, 0x3f)
  eq('the 328P mask is four bits, which would drop MUX5', adcConfig328.muxInputMask, 0x0f)

  // Timers — §33. TIFRn are in low I/O space, TIMSKn are not.
  const T: Array<[string, { TIFR: number; TIMSK: number; TCCRA: number; TCNT: number }, number[]]> =
    [
      ['timer0', timer0Config2560, [0x35, 0x6e, 0x44, 0x46]],
      ['timer1', timer1Config2560, [0x36, 0x6f, 0x80, 0x84]],
      ['timer2', timer2Config2560, [0x37, 0x70, 0xb0, 0xb2]],
      ['timer3', timer3Config2560, [0x38, 0x71, 0x90, 0x94]],
      ['timer4', timer4Config2560, [0x39, 0x72, 0xa0, 0xa4]],
      ['timer5', timer5Config2560, [0x3a, 0x73, 0x120, 0x124]],
    ]
  for (const [name, cfg, [tifr, timsk, tccra, tcnt]] of T) {
    eq(`${name} TIFR`, cfg.TIFR, tifr)
    eq(`${name} TIMSK`, cfg.TIMSK, timsk)
    eq(`${name} TCCRxA`, cfg.TCCRA, tccra)
    eq(`${name} TCNTx`, cfg.TCNT, tcnt)
  }

  // Compare-output pads — Table 13-9…13-19.
  eq('OC0A is PB7 (Mega pin 13)', `${portName(timer0Config2560.compPortA)}${timer0Config2560.compPinA}`, 'B7')
  eq('OC0B is PG5 (Mega pin 4)', `${portName(timer0Config2560.compPortB)}${timer0Config2560.compPinB}`, 'G5')
  eq('OC1A is PB5 (Mega pin 11)', `${portName(timer1Config2560.compPortA)}${timer1Config2560.compPinA}`, 'B5')
  eq('OC2B is PH6 (Mega pin 9)', `${portName(timer2Config2560.compPortB)}${timer2Config2560.compPinB}`, 'H6')
  eq('OC3A is PE3 (Mega pin 5)', `${portName(timer3Config2560.compPortA)}${timer3Config2560.compPinA}`, 'E3')
  eq('OC4A is PH3 (Mega pin 6)', `${portName(timer4Config2560.compPortA)}${timer4Config2560.compPinA}`, 'H3')
  eq('OC5A is PL3 (Mega pin 46)', `${portName(timer5Config2560.compPortA)}${timer5Config2560.compPinA}`, 'L3')

  // Ports — §33 PINA 0x20 … PORTL 0x10B.
  const PORT_ADDR: Record<string, [number, number, number]> = {
    A: [0x20, 0x21, 0x22],
    B: [0x23, 0x24, 0x25],
    C: [0x26, 0x27, 0x28],
    D: [0x29, 0x2a, 0x2b],
    E: [0x2c, 0x2d, 0x2e],
    F: [0x2f, 0x30, 0x31],
    G: [0x32, 0x33, 0x34],
    H: [0x100, 0x101, 0x102],
    J: [0x103, 0x104, 0x105],
    K: [0x106, 0x107, 0x108],
    L: [0x109, 0x10a, 0x10b],
  }
  eq('eleven ports, A-L with no I', Object.keys(ATMEGA2560.ports).join(''), 'ABCDEFGHJKL')
  for (const [letter, [pin, ddr, port]] of Object.entries(PORT_ADDR)) {
    const c = ATMEGA2560.ports[letter]
    eq(`PIN${letter}/DDR${letter}/PORT${letter}`, `${hex(c.PIN)},${hex(c.DDR)},${hex(c.PORT)}`, `${hex(pin)},${hex(ddr)},${hex(port)}`)
  }

  // Pin-change and external interrupt groups (§15).
  eq('PCINT0 group is on port B (PCINT7:0 = PB7:0)', ATMEGA2560.ports.B.pinChange?.pinChangeInterrupt ?? -1, VECTORS.PCINT0)
  eq('PCINT1 group covers PE0 (PCINT8)', ATMEGA2560.ports.E.pinChange?.mask ?? -1, 0x01)
  eq('PCINT1 group covers PJ6:0 (PCINT15:9), offset by one bit', `${ATMEGA2560.ports.J.pinChange?.mask},${ATMEGA2560.ports.J.pinChange?.offset}`, '127,1')
  eq('PCINT2 group is on port K (PCINT23:16 = PK7:0)', ATMEGA2560.ports.K.pinChange?.pinChangeInterrupt ?? -1, VECTORS.PCINT2)
  eq('INT0 is PD0 on a Mega, not PD2 as on a 328P', ATMEGA2560.ports.D.externalInterrupts[0]?.interrupt ?? -1, VECTORS.INT0)
  eq('and avr8js maps INT0 to PD2, the 328P pad', portDConfig.externalInterrupts[2]?.interrupt ?? -1, 0x02)
  eq('INT4 is PE4', ATMEGA2560.ports.E.externalInterrupts[4]?.interrupt ?? -1, VECTORS.INT4)
}

function portName(addr: number): string {
  for (const [letter, c] of Object.entries(ATMEGA2560.ports)) if (c.PORT === addr) return letter
  return '?' + hex(addr)
}

// ══════════════════════════════════════════════════════════════════════════════
group('C. Memory geometry — the part of the chip that is behaviour, not size')
// ══════════════════════════════════════════════════════════════════════════════
{
  eq('256 KB of flash (§7.1)', ATMEGA2560.flashBytes, 0x40000)
  const cpu = new CPU(new Uint16Array(ATMEGA2560.flashBytes / 2), ATMEGA2560.cpuSramBytes)
  /**
   * pc22Bits is the flag that makes CALL/RET/RETI and avrInterrupt() push a
   * THREE-byte return address. It is derived from the program memory's byte
   * length, so under-sizing the flash silently corrupts the stack on the very
   * first interrupt return rather than merely truncating the program.
   */
  truth('the CPU takes a 22-bit program counter', cpu.pc22Bits, 'pc22Bits true', String(cpu.pc22Bits))
  eq('RAMEND is 0x21FF (§8.1: 8 KB SRAM based at 0x200)', cpu.data.length - 1, 0x21ff)
  eq('and the reset stack pointer lands on it', cpu.SP, 0x21ff)

  const uno = new CPU(new Uint16Array(ATMEGA328P.flashBytes / 2), ATMEGA328P.cpuSramBytes)
  truth(
    'a 32 KB ATmega328P does NOT take the 22-bit path',
    !uno.pc22Bits,
    'pc22Bits false',
    String(uno.pc22Bits),
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('D. parseIntelHex — extended addressing, which a Mega hex needs')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * avr-gcc emits a type 04 "extended linear address" record before crossing
   * each 64 KB boundary, because a data record's own address field is only 16
   * bits. The old parser dropped every record type but 00 and 01, so a Mega
   * hex's upper banks were all overlaid on the first 64 KB — a program that
   * loads without complaint and executes the wrong bytes.
   */
  const hexFile = [
    ':020000040000FA', // linear base 0x00000
    ':020000000102FB', // 0x0000: 01 02
    ':020000040001F9', // linear base 0x10000
    ':020000000304F7', // 0x10000: 03 04
    ':020000040002F8', // linear base 0x20000
    ':020000000506F3', // 0x20000: 05 06
    ':00000001FF',
  ].join('\n')
  const words = parseIntelHex(hexFile, ATMEGA2560.flashBytes)
  eq('type 00 at base 0 lands at word 0', words[0], 0x0201)
  eq('type 04 base 0x0001 puts the next record at word 0x8000', words[0x8000], 0x0403)
  eq('type 04 base 0x0002 puts the next record at word 0x10000', words[0x10000], 0x0403 + 0x0202)
  truth(
    'and the upper banks did NOT overwrite the reset vector',
    words[0] === 0x0201,
    '0x0201 survives',
    hex(words[0]),
  )

  // Type 02 (extended segment) — the older encoding, shifted by 4 rather than 16.
  const seg = parseIntelHex(
    [':020000021000EC', ':02000000AABB99', ':00000001FF'].join('\n'),
    0x40000,
  )
  eq('type 02 base 0x1000 puts the record at byte 0x10000 (word 0x8000)', seg[0x8000], 0xbbaa)

  let refused = ''
  try {
    parseIntelHex([':020000040001F9', ':020000000304F7', ':00000001FF'].join('\n'), 0x8000)
  } catch (e) {
    refused = e instanceof Error ? e.message : String(e)
  }
  truth(
    'a Mega hex loaded into 32 KB is REFUSED, not silently truncated',
    refused.includes('past the end'),
    'throws',
    refused || 'no error — bytes silently dropped',
  )

  // The Uno's own firmware must be unaffected by all of the above.
  const blink = readSim('blink.hex')
  const unoWords = parseIntelHex(blink)
  truth(
    'public/sim/blink.hex still parses to a runnable Uno image',
    unoWords.length === 0x4000 && unoWords[0] !== 0,
    '0x4000 words, non-zero reset vector',
    `${unoWords.length} words, first ${hex(unoWords[0])}`,
  )
}

function readSim(name: string): string {
  return readFileSync(join(process.cwd(), 'public', 'sim', name), 'utf8')
}

// ══════════════════════════════════════════════════════════════════════════════
group('D2. Board pin map — Arduino variants/mega/pins_arduino.h')
// ══════════════════════════════════════════════════════════════════════════════
{
  eq('54 digital pins plus 16 analog', Object.keys(MEGA_PIN_MAP).length, 70)

  /**
   * The two stretches experiment 11 drives, and the one that is a trap.
   * D22-D29 walk PORTA UP; D30-D37 walk PORTC DOWN. Getting port C backwards
   * lights lane 4's green when the sketch asked for lane 3's yellow.
   */
  for (let i = 0; i < 8; i++) {
    eq(`D${22 + i} is PA${i}`, `${MEGA_PIN_MAP[`D${22 + i}`][0]}${MEGA_PIN_MAP[`D${22 + i}`][1]}`, `A${i}`)
  }
  for (let i = 0; i < 8; i++) {
    eq(`D${30 + i} is PC${7 - i} (descending)`, `${MEGA_PIN_MAP[`D${30 + i}`][0]}${MEGA_PIN_MAP[`D${30 + i}`][1]}`, `C${7 - i}`)
  }
  eq('A0-A3 (the density pots) are PF0-PF3', ['A0', 'A1', 'A2', 'A3'].map((p) => `${MEGA_PIN_MAP[p][0]}${MEGA_PIN_MAP[p][1]}`).join(','), 'F0,F1,F2,F3')
  eq('A8 is PK0, not another PORTF pad', `${MEGA_PIN_MAP.A8[0]}${MEGA_PIN_MAP.A8[1]}`, 'K0')
  eq('D13 is PB7 on a Mega (PB5 on an Uno)', `${MEGA_PIN_MAP.D13[0]}${MEGA_PIN_MAP.D13[1]}`, 'B7')
  eq('D0/D1 are the USART0 pads PE0/PE1', `${MEGA_PIN_MAP.D0[0]}${MEGA_PIN_MAP.D0[1]},${MEGA_PIN_MAP.D1[0]}${MEGA_PIN_MAP.D1[1]}`, 'E0,E1')

  const badPort = Object.entries(MEGA_PIN_MAP).filter(([, [p, b]]) => !ATMEGA2560.ports[p] || b < 0 || b > 7)
  truth('every mapped pin names a port this chip has, and a bit 0-7', badPort.length === 0, 'none bad', badPort.map(([n]) => n).join(',') || 'none bad')

  const seen = new Map<string, string>()
  const dupes: string[] = []
  for (const [name, [p, b]] of Object.entries(MEGA_PIN_MAP)) {
    const key = `${p}${b}`
    if (seen.has(key)) dupes.push(`${name}=${seen.get(key)}`)
    else seen.set(key, name)
  }
  truth('no two board pins share a silicon pad', dupes.length === 0, 'none', dupes.join(',') || 'none')

  // The part definition and the chip must agree about which pins exist.
  const mega = getPart('arduino_mega')
  const ioPins = mega.pins.filter((p) => p.type === 'digital' || p.type === 'analog').map((p) => p.id)
  const unmapped = ioPins.filter((id) => !MEGA_PIN_MAP[id])
  truth(
    'every wireable I/O pin on the PART has an entry in the chip pin map',
    unmapped.length === 0,
    'none unmapped',
    unmapped.join(',') || 'none unmapped',
  )
  eq('the part exposes exactly the 70 I/O pins the map knows', ioPins.length, 70)
}

// ─── Assembly helpers ─────────────────────────────────────────────────────────

/** ATmega2560 vector count — see group A. */
const N_VECTORS = 57
/** Where a sentinel byte is parked when a WRONG vector is entered. */
const SENTINEL = 0x200
/** Where the Serial test's RAM transmit buffer lives. */
const TXBUF = 0x300

/**
 * A full ATmega2560 vector table in which exactly one slot is live.
 *
 * Every other slot jumps to `bad`, which stamps a sentinel into SRAM. That is
 * what turns "the interrupt went somewhere else" from an invisible event into a
 * measurement — and it is the whole reason the negative controls below are
 * evidence rather than an absence of evidence.
 */
function vectorTable(live: Record<number, string>): string {
  const lines: string[] = []
  for (let v = 0; v < N_VECTORS; v++) {
    lines.push(`_LOC ${v * 4}`)
    const word = v * 2
    if (word === 0) lines.push('JMP reset')
    else lines.push(`JMP ${live[word] ?? 'bad'}`)
  }
  return lines.join('\n')
}

/** SP = RAMEND (0x21FF). SPL/SPH are I/O 0x3D/0x3E. */
const SET_STACK = ['LDI R16, 0xFF', 'OUT 0x3D, R16', 'LDI R16, 0x21', 'OUT 0x3E, R16'].join('\n')

const BAD_HANDLER = ['bad:', `LDI R16, 0xBD`, `STS ${SENTINEL}, R16`, 'RETI'].join('\n')

/** Assemble into a full-size ATmega2560 flash image. */
function megaImage(source: string): Uint16Array {
  const { program } = asmProgram(source)
  const image = new Uint16Array(ATMEGA2560.flashBytes / 2)
  image.set(program)
  return image
}

// ══════════════════════════════════════════════════════════════════════════════
group('E. SERIAL — the crux. Executed AVR code, through the UDRE interrupt')
// ══════════════════════════════════════════════════════════════════════════════

const MESSAGE = 'Lane 1 Green: 3000ms\n'

/**
 * The Arduino HardwareSerial pattern, in assembly.
 *
 * `Serial.print` does NOT poll UDRE. It appends to a RAM ring buffer, sets
 * UDRIE0, and returns; the USART DATA REGISTER EMPTY ISR drains one byte per
 * interrupt and clears UDRIE0 when the buffer empties. This program is that,
 * with a straight buffer instead of a ring — which is the only part of the
 * mechanism the vector table cannot tell apart.
 */
function serialProgram(): string {
  const fill: string[] = []
  for (let i = 0; i < MESSAGE.length; i++) {
    fill.push(`LDI R16, ${MESSAGE.charCodeAt(i)}`, `STS ${TXBUF + i}, R16`)
  }
  fill.push('LDI R16, 0', `STS ${TXBUF + MESSAGE.length}, R16`) // NUL terminator

  return [
    vectorTable({ [VECTORS.USART0_UDRE]: 'udre' }),
    '_LOC 1024',
    'reset:',
    SET_STACK,
    ...fill,
    // Z points at the buffer.
    `LDI R30, ${TXBUF & 0xff}`,
    `LDI R31, ${(TXBUF >> 8) & 0xff}`,
    // UBRR0 = 103 -> 9600 baud at 16 MHz with U2X0 clear.
    'LDI R16, 0',
    `STS ${usart0Config2560.UBRRH}, R16`,
    'LDI R16, 103',
    `STS ${usart0Config2560.UBRRL}, R16`,
    // UCSR0C = UCSZ01|UCSZ00 -> 8 data bits, no parity, 1 stop bit.
    'LDI R16, 6',
    `STS ${usart0Config2560.UCSRC}, R16`,
    // UCSR0B = TXEN0.
    'LDI R16, 8',
    `STS ${usart0Config2560.UCSRB}, R16`,
    'SEI',
    // UCSR0B = TXEN0 | UDRIE0 — the line that hands transmission to the ISR.
    'LDI R16, 40',
    `STS ${usart0Config2560.UCSRB}, R16`,
    'spin:',
    'RJMP spin',
    // ── ISR ──
    'udre:',
    'LD R17, Z+',
    'CPI R17, 0',
    'BREQ udre_done',
    `STS ${usart0Config2560.UDR}, R17`,
    'RETI',
    'udre_done:',
    'LDI R16, 8', // clear UDRIE0: nothing left to send
    `STS ${usart0Config2560.UCSRB}, R16`,
    'RETI',
    BAD_HANDLER,
  ].join('\n')
}

{
  const image = megaImage(serialProgram())

  /** Run the identical image with whichever USART configuration is under test. */
  function run(cfg: USARTConfig, cycles: number): { out: string; sentinel: number } {
    const cpu = new CPU(image, ATMEGA2560.cpuSramBytes)
    const usart = new AVRUSART(cpu, cfg, CLOCK_HZ)
    let out = ''
    usart.onByteTransmit = (b) => {
      out += String.fromCharCode(b)
    }
    while (cpu.cycles < cycles) {
      avrInstruction(cpu)
      cpu.tick()
    }
    return { out, sentinel: cpu.data[SENTINEL] }
  }

  /**
   * 9600 baud is 16e6 / (16 * (103 + 1)) = 9615 Bd; ten bit-times per frame is
   * 16 640 cycles. Twenty-one characters therefore need ~350 000 cycles. Run
   * for 600 000 so a failure is "nothing came out", never "not enough time".
   */
  const BUDGET = 600_000

  const mega = run(usart0Config2560, BUDGET)
  truth(
    'THE MEASUREMENT: an ATmega2560-vectored USART emits the whole string',
    mega.out === MESSAGE,
    JSON.stringify(MESSAGE),
    JSON.stringify(mega.out),
  )
  eq('and no interrupt ever landed on a wrong vector', mega.sentinel, 0)

  /**
   * THE NEGATIVE CONTROL, and the honest answer to "was this bug real?".
   *
   * Same flash image, same CPU, same sketch. The only difference is the USART
   * configuration avr8js ships, whose UDRE vector is 0x26 — TIMER1 COMPARE C on
   * this part. The interrupt is raised, dispatched, and enters the wrong
   * handler; the sentinel proves it went somewhere, and the empty string proves
   * where it did not go.
   */
  const uno = run(usart0Config328, BUDGET)
  truth(
    'THE CONTROL: avr8js’s 328P vectors emit NOTHING from the same program',
    uno.out === '',
    '"" (Serial.print silently produces no output)',
    JSON.stringify(uno.out),
  )
  eq('and the wrong-vector sentinel is set, proving the interrupt fired', uno.sentinel, 0xbd)

  // A direct register-level check as well, independent of the ISR path: a
  // polled write to UDR0 must reach the transmit callback.
  {
    const cpu = new CPU(new Uint16Array(ATMEGA2560.flashBytes / 2), ATMEGA2560.cpuSramBytes)
    const usart = new AVRUSART(cpu, usart0Config2560, CLOCK_HZ)
    let seen = -1
    usart.onByteTransmit = (b) => {
      seen = b
    }
    cpu.writeData(usart0Config2560.UCSRB, 0x08) // TXEN0
    cpu.writeData(usart0Config2560.UDR, 0x41)
    eq('a bare write to UDR0 (0xC6) transmits the byte', seen, 0x41)
  }

  // And that enabling UDRIE0 queues the interrupt at the ATmega2560 address.
  {
    const cpu = new CPU(new Uint16Array(ATMEGA2560.flashBytes / 2), ATMEGA2560.cpuSramBytes)
    new AVRUSART(cpu, usart0Config2560, CLOCK_HZ)
    cpu.writeData(usart0Config2560.UCSRB, 0x08 | 0x20) // TXEN0 | UDRIE0
    eq('enabling UDRIE0 queues an interrupt at word 0x34', cpu.nextInterrupt, 0x34)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('F. TIMER0 OVERFLOW — the vector millis() and delay() are built on')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Arduino's `init()` starts Timer0 and counts its overflows in TIMER0_OVF_vect
   * to make millis(). Experiment 11's sketch is a chain of delay() calls, so a
   * misdirected Timer0 overflow does not slow the sketch down — it stops time.
   */
  const COUNT = 0x210
  const source = [
    vectorTable({ [VECTORS.TIMER0_OVF]: 'tovf' }),
    '_LOC 1024',
    'reset:',
    SET_STACK,
    'CLR R18',
    'LDI R16, 1',
    `STS ${timer0Config2560.TIMSK}, R16`, // TIMSK0 = TOIE0
    'LDI R16, 1',
    `OUT ${timer0Config2560.TCCRB - 0x20}, R16`, // TCCR0B = CS00 (no prescaler)
    'SEI',
    'spin:',
    'RJMP spin',
    'tovf:',
    'INC R18',
    `STS ${COUNT}, R18`,
    'RETI',
    BAD_HANDLER,
  ].join('\n')
  const image = megaImage(source)

  function run(cfg: typeof timer0Config2560, cycles: number) {
    const cpu = new CPU(image, ATMEGA2560.cpuSramBytes)
    new AVRTimer(cpu, cfg)
    while (cpu.cycles < cycles) {
      avrInstruction(cpu)
      cpu.tick()
    }
    return { count: cpu.data[COUNT], sentinel: cpu.data[SENTINEL] }
  }

  // An unprescaled 8-bit timer overflows every 256 cycles. Setup costs a few
  // hundred cycles, so over 20 000 the count is 20000/256 = 78 give or take one.
  const mega = run(timer0Config2560, 20_000)
  truth(
    'an ATmega2560-vectored Timer0 reaches its overflow ISR ~78 times in 20 000 cycles',
    mega.count >= 74 && mega.count <= 78,
    '74-78 overflows',
    `${mega.count} overflows`,
  )
  eq('with nothing landing on a wrong vector', mega.sentinel, 0)

  const uno = run(timer0Config328, 20_000)
  eq('THE CONTROL: the 328P vector (0x20) never enters the handler', uno.count, 0)
  eq('and stamps the wrong-vector sentinel instead', uno.sentinel, 0xbd)
}

// ══════════════════════════════════════════════════════════════════════════════
group('G. ADC — 16 channels, and the MUX5 bit that makes A8-A15 reachable')
// ══════════════════════════════════════════════════════════════════════════════
{
  const RESULT_L = 0x220
  const RESULT_H = 0x221
  const RAN = 0x222

  /** Convert one channel, publish ADCL/ADCH to SRAM from the ADC ISR. */
  function adcProgram(admux: number, adcsrb: number): string {
    return [
      vectorTable({ [VECTORS.ADC]: 'adcisr' }),
      '_LOC 1024',
      'reset:',
      SET_STACK,
      `LDI R16, ${admux}`,
      `STS ${adcConfig2560.ADMUX}, R16`,
      `LDI R16, ${adcsrb}`,
      `STS ${adcConfig2560.ADCSRB}, R16`,
      // ADEN | ADSC | ADIE | prescaler 128
      'LDI R16, 207',
      `STS ${adcConfig2560.ADCSRA}, R16`,
      'SEI',
      'spin:',
      'RJMP spin',
      'adcisr:',
      `LDS R17, ${adcConfig2560.ADCL}`,
      `STS ${RESULT_L}, R17`,
      `LDS R17, ${adcConfig2560.ADCH}`,
      `STS ${RESULT_H}, R17`,
      'LDI R16, 238',
      `STS ${RAN}, R16`,
      'RETI',
      BAD_HANDLER,
    ].join('\n')
  }

  function run(source: string, cfg: typeof adcConfig2560, volts: Record<number, number>) {
    const cpu = new CPU(megaImage(source), ATMEGA2560.cpuSramBytes)
    const adc = new AVRADC(cpu, cfg)
    for (const [ch, v] of Object.entries(volts)) adc.channelValues[Number(ch)] = v
    while (cpu.cycles < 200_000) {
      avrInstruction(cpu)
      cpu.tick()
    }
    return {
      counts: cpu.data[RESULT_L] | (cpu.data[RESULT_H] << 8),
      ran: cpu.data[RAN],
      sentinel: cpu.data[SENTINEL],
    }
  }

  // ADMUX = REFS0 | 3 -> AVCC reference, single-ended channel 3 (Mega pin A3).
  const ch3 = run(adcProgram(0x43, 0x00), adcConfig2560, { 3: 2.5 })
  eq('ADC3 at 2.5 V of a 5 V reference reads 512 counts', ch3.counts, 512)
  eq('and the conversion-complete ISR really ran (vector 0x3A)', ch3.ran, 0xee)
  eq('with nothing on a wrong vector', ch3.sentinel, 0)

  const ch3uno = run(adcProgram(0x43, 0x00), adcConfig328, { 3: 2.5 })
  eq('THE CONTROL: the 328P ADC vector (0x2A) never enters the handler', ch3uno.ran, 0)
  eq('and stamps the wrong-vector sentinel', ch3uno.sentinel, 0xbd)

  /**
   * A9 is ADC channel 9, which needs MUX5 — ADCSRB bit 3 — on top of MUX2:0.
   * With the 328P's four-bit mux mask the index 0x21 collapses to 0x01 and the
   * chip reads A1 instead, returning a completely plausible wrong number. That
   * is measured here rather than asserted.
   */
  const ch9 = run(adcProgram(0x41, 0x08), adcConfig2560, { 1: 4.0, 9: 1.25 })
  eq('ADC9 (Mega pin A9) at 1.25 V reads 256 counts', ch9.counts, 256)

  /**
   * THE CONTROL, with the vector held right and ONLY the mask made wrong.
   *
   * Using avr8js's whole 328P ADC configuration here would prove nothing about
   * MUX5: its vector is 0x2A, so the ISR would never run and the reading would
   * be absent rather than wrong. Absence is the easy failure to notice. This
   * hybrid keeps the ATmega2560 vector and narrows only `muxInputMask` to the
   * 328P's four bits, so the conversion completes, the ISR runs, and a number
   * comes back — 819 counts from A1, which is exactly as plausible as the 256
   * the student asked for and is the reading nobody would question.
   */
  const ch9alias = run(
    adcProgram(0x41, 0x08),
    { ...adcConfig2560, muxInputMask: 0x0f },
    { 1: 4.0, 9: 1.25 },
  )
  eq('THE CONTROL: a four-bit mux mask makes A9 silently read A1', ch9alias.counts, 819)
  eq('and it looks entirely healthy — the ISR ran and returned a number', ch9alias.ran, 0xee)

  eq(
    'the reference ladder is the 2560’s: 0b10 is 1.1 V and 0b11 is 2.56 V',
    adcConfig2560.adcReferences.join(','),
    '1,0,2,3',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('H. GPIO — eleven ports, driven from executed code')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Drive PORTA and PORTC from the program and read the pads back through
   * AVRIOPort, the same object the engine's PinBridge listens to. PORTC is the
   * interesting one: the Mega maps D30-D37 onto PC7-PC0, so writing bit 7 must
   * light the pin the silkscreen calls 30.
   */
  const source = [
    vectorTable({}),
    '_LOC 1024',
    'reset:',
    SET_STACK,
    'LDI R16, 255',
    `STS ${ATMEGA2560.ports.A.DDR}, R16`, // DDRA = outputs
    `STS ${ATMEGA2560.ports.C.DDR}, R16`, // DDRC = outputs
    'LDI R16, 5', // PA0 and PA2 high -> Mega pins 22 and 24
    `STS ${ATMEGA2560.ports.A.PORT}, R16`,
    'LDI R16, 128', // PC7 high -> Mega pin 30
    `STS ${ATMEGA2560.ports.C.PORT}, R16`,
    'BREAK',
    BAD_HANDLER,
  ].join('\n')

  const cpu = new CPU(megaImage(source), ATMEGA2560.cpuSramBytes)
  const ports = new Map<string, AVRIOPort>()
  for (const [letter, cfg] of Object.entries(ATMEGA2560.ports)) {
    ports.set(letter, new AVRIOPort(cpu, cfg))
  }
  for (let i = 0; i < 400 && cpu.progMem[cpu.pc] !== 0x9598; i++) {
    avrInstruction(cpu)
    cpu.tick()
  }

  /** PinState: 0 Low, 1 High, 2 Input, 3 InputPullUp. */
  const state = (name: string): number => {
    const [p, b] = MEGA_PIN_MAP[name]
    return ports.get(p)!.pinState(b)
  }
  eq('Mega pin 22 (PA0) is driven HIGH', state('D22'), 1)
  eq('Mega pin 23 (PA1) is driven LOW', state('D23'), 0)
  eq('Mega pin 24 (PA2) is driven HIGH', state('D24'), 1)
  eq('Mega pin 30 (PC7) is driven HIGH', state('D30'), 1)
  eq('Mega pin 37 (PC0) is driven LOW', state('D37'), 0)
  eq('Mega pin 13 (PB7) is still an input — DDRB was never touched', state('D13'), 2)
  eq('all eleven ports were constructed without collision', cpu.gpioPorts.size, 11)
}

// ══════════════════════════════════════════════════════════════════════════════
group('I. Board selection — the document really picks the Mega')
// ══════════════════════════════════════════════════════════════════════════════
{
  const doc: CircuitDoc = {
    parts: [{ id: 'mega', type: 'arduino_mega', x: 0, y: 0, rotation: 0, props: {} }],
    wires: [],
  }
  eq('detectBoard resolves an arduino_mega part', detectBoard(doc).board?.type ?? 'none', 'arduino_mega')
  eq('and it is on the avr track', BOARDS.arduino_mega.track, 'avr')
  eq('at 5 V logic, like the Uno', BOARDS.arduino_mega.logicVolts, 5)
  eq('chipForDoc picks the ATmega2560', chipForDoc(doc).id, 'atmega2560')
  eq(
    'and an Uno document still picks the ATmega328P',
    chipForDoc({
      parts: [{ id: 'uno', type: 'arduino_uno', x: 0, y: 0, rotation: 0, props: {} }],
      wires: [],
    }).id,
    'atmega328p',
  )

  const both: CircuitDoc = {
    parts: [
      { id: 'uno', type: 'arduino_uno', x: 0, y: 0, rotation: 0, props: {} },
      { id: 'mega', type: 'arduino_mega', x: 500, y: 0, rotation: 0, props: {} },
    ],
    wires: [],
  }
  const d = detectBoard(both)
  truth(
    'two AVR boards is still a refusal — one engine advances one clock',
    d.board === null && (d.problem ?? '').includes('Mega'),
    'refused, naming both boards',
    d.board ? `ran ${d.board.type}` : (d.problem ?? ''),
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('J. End to end — SimulationEngine on a Mega document')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The whole stack: an assembled ATmega2560 program, the real DC solver, and
   * the engine's PinBridge. Two lanes' worth of experiment 11 — an LED on pin
   * 22 (PA0) and one on pin 30 (PC7) — plus a density pot on A0 and the same
   * ISR-driven serial output.
   */
  const doc: CircuitDoc = {
    parts: [
      { id: 'mega', type: 'arduino_mega', x: 0, y: 0, rotation: 0, props: {} },
      { id: 'r22', type: 'resistor', x: 0, y: 300, rotation: 0, props: { ohms: 220 } },
      { id: 'led22', type: 'led', x: 120, y: 300, rotation: 0, props: {} },
      { id: 'r30', type: 'resistor', x: 0, y: 380, rotation: 0, props: { ohms: 220 } },
      { id: 'led30', type: 'led', x: 120, y: 380, rotation: 0, props: {} },
      { id: 'pot', type: 'potentiometer', x: 260, y: 300, rotation: 0, props: { position: 50 } },
    ],
    wires: [
      w('a1', 'mega', 'D22', 'r22', '1'),
      w('a2', 'r22', '2', 'led22', 'A'),
      w('a3', 'led22', 'C', 'mega', 'GND.1'),
      w('b1', 'mega', 'D30', 'r30', '1'),
      w('b2', 'r30', '2', 'led30', 'A'),
      w('b3', 'led30', 'C', 'mega', 'GND.2'),
      w('p1', 'pot', '1', 'mega', 'GND.3'),
      w('p2', 'pot', '3', 'mega', '5V'),
      w('p3', 'pot', '2', 'mega', 'A0'),
    ],
  }

  const source = [
    vectorTable({ [VECTORS.USART0_UDRE]: 'udre' }),
    '_LOC 1024',
    'reset:',
    SET_STACK,
    'LDI R16, 255',
    `STS ${ATMEGA2560.ports.A.DDR}, R16`,
    `STS ${ATMEGA2560.ports.C.DDR}, R16`,
    'LDI R16, 1', // PA0 high -> pin 22 lit
    `STS ${ATMEGA2560.ports.A.PORT}, R16`,
    'LDI R16, 128', // PC7 high -> pin 30 lit
    `STS ${ATMEGA2560.ports.C.PORT}, R16`,
    // Serial, exactly as in group E.
    ...(() => {
      const fill: string[] = []
      for (let i = 0; i < MESSAGE.length; i++) {
        fill.push(`LDI R16, ${MESSAGE.charCodeAt(i)}`, `STS ${TXBUF + i}, R16`)
      }
      fill.push('LDI R16, 0', `STS ${TXBUF + MESSAGE.length}, R16`)
      return fill
    })(),
    `LDI R30, ${TXBUF & 0xff}`,
    `LDI R31, ${(TXBUF >> 8) & 0xff}`,
    'LDI R16, 0',
    `STS ${usart0Config2560.UBRRH}, R16`,
    'LDI R16, 103',
    `STS ${usart0Config2560.UBRRL}, R16`,
    'LDI R16, 6',
    `STS ${usart0Config2560.UCSRC}, R16`,
    'LDI R16, 8',
    `STS ${usart0Config2560.UCSRB}, R16`,
    // ADC: AVCC reference, channel 0, free-running off, single conversion.
    'LDI R16, 64',
    `STS ${adcConfig2560.ADMUX}, R16`,
    'LDI R16, 199', // ADEN | ADSC | prescaler 128
    `STS ${adcConfig2560.ADCSRA}, R16`,
    'SEI',
    'LDI R16, 40',
    `STS ${usart0Config2560.UCSRB}, R16`,
    'spin:',
    'RJMP spin',
    'udre:',
    'LD R17, Z+',
    'CPI R17, 0',
    'BREQ udre_done',
    `STS ${usart0Config2560.UDR}, R17`,
    'RETI',
    'udre_done:',
    'LDI R16, 8',
    `STS ${usart0Config2560.UCSRB}, R16`,
    'RETI',
    BAD_HANDLER,
  ].join('\n')

  const engine = new SimulationEngine(megaImage(source), doc)
  eq('the engine built itself as an ATmega2560', engine.chip.id, 'atmega2560')
  engine.run(60_000) // 60 ms of simulated time — ~21 characters at 9600 baud
  const snap = engine.snapshot()

  eq('pin 22 is reported HIGH', snap.pins.D22, 'high')
  eq('pin 30 is reported HIGH', snap.pins.D30, 'high')
  eq('pin 23, which the program never drove, is not', snap.pins.D23, 'float')
  truth(
    'the LED on pin 22 is lit, through the real DC solver',
    snap.ledBrightness.led22 > 0.5,
    '> 0.5',
    snap.ledBrightness.led22.toFixed(3),
  )
  truth(
    'and draws the ~12.4 mA a 220 Ω series resistor allows on a 5 V rail',
    Math.abs(snap.currents.led22 - 0.0124) < 0.002,
    '12.4 mA +/- 2',
    `${(snap.currents.led22 * 1000).toFixed(1)} mA`,
  )
  truth(
    'the LED on pin 30 (PC7, the descending half of PORTC) is lit too',
    snap.ledBrightness.led30 > 0.5,
    '> 0.5',
    snap.ledBrightness.led30.toFixed(3),
  )
  truth(
    'the pot at 50% reads ~512 counts on A0',
    Math.abs(snap.adc.A0 - 512) <= 2,
    '512 +/- 2',
    String(snap.adc.A0),
  )
  eq('the readout carries all sixteen Mega analog inputs', Object.keys(snap.adc).length, 16)
  truth(
    'AND SERIAL OUTPUT REACHES THE SNAPSHOT',
    snap.serial === MESSAGE,
    JSON.stringify(MESSAGE),
    JSON.stringify(snap.serial),
  )
  truth('no solver error', snap.solveError === null, 'null', String(snap.solveError))
  truth(
    'no destructive fault',
    snap.faults.filter((f) => f.severity === 'destructive').length === 0,
    'none',
    snap.faults.map((f) => f.kind).join(',') || 'none',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('K. The experiment 11 starter, and whether a student can finish it')
// ══════════════════════════════════════════════════════════════════════════════
{
  const starter = EXPERIMENT_STARTERS['smart-traffic-controller']
  eq('the starter is a Mega document', detectBoard(starter).board?.type ?? 'none', 'arduino_mega')
  eq('30 parts: board, breadboard, 12 LEDs, 12 resistors, 4 pots', starter.parts.length, 30)
  eq('and only the supply is pre-wired', starter.wires.length, 4)

  const counts: Record<string, number> = {}
  for (const p of starter.parts) counts[p.type] = (counts[p.type] ?? 0) + 1
  eq(
    'the bill of materials the experiment prints',
    JSON.stringify(Object.fromEntries(Object.entries(counts).sort())),
    JSON.stringify({ arduino_mega: 1, breadboard: 1, led: 12, potentiometer: 12 - 8, resistor: 12 }),
  )

  const bad = starter.wires
    .flatMap((wi) => [wi.from, wi.to])
    .filter((r) => {
      const p = starter.parts.find((q) => q.id === r.partId)
      return !p || !getPart(p.type).pins.some((pin) => pin.id === r.pinId)
    })
  truth('every pre-wired endpoint names a pin that exists', bad.length === 0, 'none bad', bad.map((r) => `${r.partId}.${r.pinId}`).join(',') || 'none bad')

  const opened = compile(starter)
  truth(
    'as opened it solves cleanly — the to-do list is unwired parts and nothing else',
    opened.problems.every((p) => p.includes('is not connected to anything')),
    'only "not connected" notices',
    opened.problems.filter((p) => !p.includes('is not connected to anything')).join(' | ') || 'only "not connected" notices',
  )
  eq('one notice per unwired part', opened.problems.length, 28)

  /**
   * FINISHED, the way the experiment's own Circuit section describes it:
   * lane 1 R/Y/G on pins 22/23/24, lane 2 on 25/26/27, lane 3 on 28/29/30,
   * lane 4 on 31/32/33, each through a 220 Ω to an LED whose cathode returns to
   * the ground rail; the four density pots across the rails with their wipers on
   * A0-A3.
   *
   * Pins 30-33 are the ones worth having in a test: they are the far end of the
   * PORTC run, which the Mega maps DESCENDING.
   */
  const LANE_PINS = [
    ['D22', 'D23', 'D24'],
    ['D25', 'D26', 'D27'],
    ['D28', 'D29', 'D30'],
    ['D31', 'D32', 'D33'],
  ]
  const COLOURS = ['red', 'yellow', 'green']
  const wires = [...starter.wires]
  for (let lane = 0; lane < 4; lane++) {
    for (let ci = 0; ci < 3; ci++) {
      const led = `led${lane + 1}_${COLOURS[ci]}`
      const res = `r${lane + 1}_${COLOURS[ci]}`
      // Columns 3-14 on the bottom negative rail. The rail is ONE strip, so the
      // column is cosmetic; it just has to be a hole that exists.
      const col = 3 + lane * 3 + ci
      wires.push(
        w(`${res}_in`, 'mega', LANE_PINS[lane][ci], res, '1'),
        w(`${res}_out`, res, '2', led, 'A'),
        w(`${led}_gnd`, led, 'C', 'bb', `bn${col}`),
      )
    }
  }
  for (let p = 1; p <= 4; p++) {
    const col = 16 + p
    wires.push(
      w(`pot${p}_lo`, `pot${p}`, '1', 'bb', `bn${col}`),
      w(`pot${p}_hi`, `pot${p}`, '3', 'bb', `bp${col}`),
      w(`pot${p}_w`, `pot${p}`, '2', 'mega', `A${p - 1}`),
    )
  }
  const finished: CircuitDoc = { parts: starter.parts, wires }

  /**
   * EVERY endpoint of the finished wiring has to name a pin that exists, and
   * this check earns its place: `bb`/`bp31` looks entirely plausible and is not
   * a hole on a 30-column board. compile() unions it into a net of its own
   * without complaint, a potentiometer is exempt from the dangling-lead notice
   * (a rheostat legitimately leaves one leg open), and the only visible symptom
   * is that A2 reads 0 V — a wiring mistake presenting as a sensor reading.
   */
  const badFinished = wires
    .flatMap((wi) => [wi.from, wi.to])
    .filter((r) => {
      const p = finished.parts.find((q) => q.id === r.partId)
      return !p || !getPart(p.type).pins.some((pin) => pin.id === r.pinId)
    })
  truth(
    'every endpoint of the finished wiring names a hole that exists',
    badFinished.length === 0,
    'none bad',
    badFinished.map((r) => `${r.partId}.${r.pinId}`).join(',') || 'none bad',
  )

  const c = compile(finished)
  eq('finished, compile() reports NO problems at all', c.problems.join(' | '), '')
  truth('and no shorted pin', c.shortedPins.length === 0, 'none', c.shortedPins.map((s) => s.pinId).join(',') || 'none')

  // Drive lane 1 green and lane 2 red, as the sketch does mid-cycle.
  const HIGH = ['D24', 'D25', 'D28', 'D31']
  for (const [name, port] of c.mcuPorts) {
    if (HIGH.includes(name)) port.set(1 / 25, 5 / 25)
    else port.set(1e-8, 0)
  }
  const t0 = Date.now()
  const res = c.circuit.solve()
  const solveMs = Date.now() - t0
  truth('the finished circuit solves', res.ok, 'ok', res.ok ? 'ok' : (res.error ?? 'failed'))
  eq('with no faults', res.faults.length, 0)
  truth(
    `${c.unknowns} unknowns solve in ${solveMs} ms — well inside an interactive budget`,
    solveMs < 250,
    '< 250 ms',
    `${solveMs} ms`,
  )

  const lit = HIGH.map((pin) => {
    const lane = LANE_PINS.findIndex((l) => l.includes(pin))
    return `led${lane + 1}_${COLOURS[LANE_PINS[lane].indexOf(pin)]}`
  })
  /**
   * PER COLOUR, and that is the point of this block now.
   *
   * It used to assert a flat ~12.4 mA for every lit lamp and passed — because
   * all twelve LEDs in the starter carried `props: {}` and were solved as RED,
   * including the eight named `*_yellow` and `*_green`. The test was encoding
   * the bug that migration 027 fixes.
   *
   * The three figures are parts.ts's own, measured through the compiler on a
   * 5 V pad through 220 Ω, and they differ because the forward drops do:
   * red ~2.0 V, yellow 2.1 V, green 3.2 V (Kingbright WP7113 family). A green
   * lamp really does run at 60 % of a red one's current on the same resistor.
   */
  const EXPECTED_MA: Record<string, number> = { red: 12.39, yellow: 11.84, green: 7.47 }
  for (const id of lit) {
    const led = c.leds.get(id)!
    const colour = id.split('_')[1]
    const want = EXPECTED_MA[colour]
    truth(
      `${id} draws ~${want} mA through its 220 Ω — the ${colour} figure, not red's`,
      Math.abs(led.current * 1000 - want) < 0.15,
      `${want} mA +/- 0.15`,
      `${(led.current * 1000).toFixed(2)} mA`,
    )
  }
  const darkCurrent = [...c.leds.entries()]
    .filter(([id]) => !lit.includes(id))
    .reduce((m, [, d]) => Math.max(m, Math.abs(d.current)), 0)
  truth(
    'and the eight LEDs on undriven pins carry essentially nothing',
    darkCurrent < 1e-4,
    '< 0.1 mA',
    `${(darkCurrent * 1e6).toFixed(1)} uA`,
  )

  // The pots really divide the rail, which is what makes analogRead() mean
  // something for the density input the sketch reads.
  const wiper = c.analogNets.get('A2')
  truth(
    'pot 3 at 50% puts half the 5 V rail on A2',
    wiper !== undefined && Math.abs(res.voltages[wiper] - 2.5) < 0.02,
    '2.50 V +/- 0.02',
    wiper === undefined ? 'A2 has no net' : `${res.voltages[wiper].toFixed(3)} V`,
  )
  eq('all four density pots reach an analog input', ['A0', 'A1', 'A2', 'A3'].filter((p) => c.analogNets.has(p)).join(','), 'A0,A1,A2,A3')
}

// ─── Report ───────────────────────────────────────────────────────────────────

// Capped, because two rows carry a whole serial message and would otherwise
// pad every other line out to 200 columns.
const nameW = Math.min(84, Math.max(56, ...rows.map((r) => r.name.length)))
const expW = Math.min(46, Math.max(20, ...rows.map((r) => r.expected.length)))
const actW = Math.min(46, Math.max(20, ...rows.map((r) => r.actual.length)))

let lastGroup = ''
for (const r of rows) {
  if (r.group !== lastGroup) {
    lastGroup = r.group
    console.log('\n' + r.group)
    console.log('-'.repeat(Math.min(200, nameW + expW + actW + 14)))
  }
  console.log(
    `${r.name.padEnd(nameW)}  ${r.expected.padEnd(expW)}  ${r.actual.padEnd(actW)}  ` +
      (r.pass ? 'PASS' : '*** FAIL ***'),
  )
}

const failures = rows.filter((r) => !r.pass)
console.log('\n' + '='.repeat(Math.min(200, nameW + expW + actW + 14)))
console.log(`${rows.length - failures.length}/${rows.length} passed`)
if (failures.length) {
  console.log('\nFAILURES')
  for (const f of failures) {
    console.log(`  [${f.group}] ${f.name}`)
    console.log(`      expected: ${f.expected}`)
    console.log(`      actual  : ${f.actual}`)
  }
}
process.exit(failures.length > 0 ? 1 : 0)

function w(id: string, fromPart: string, fromPin: string, toPart: string, toPin: string) {
  return {
    id,
    from: { partId: fromPart, pinId: fromPin },
    to: { partId: toPart, pinId: toPin },
    color: '#2563eb',
  }
}
