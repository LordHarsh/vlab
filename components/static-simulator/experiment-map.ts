import { EXPERIMENTS } from './utils/experimentData'
import type { Experiment } from './types'

/**
 * The ONE place this app's experiment slugs meet the ported simulator's
 * numeric experiment ids. Nothing else should look up an id.
 *
 * The ported `EXPERIMENTS` array (components/static-simulator/utils/
 * experimentData.ts, from upstream 1a1eb78) defines ids 1–14. Ids 1–12 are the
 * twelve lab experiments and correspond, in order, to the twelve slugs in
 * supabase/seeds/003_experiments.sql. Ids 13 and 14 are blank Arduino /
 * Raspberry Pi sandboxes with no lab sheet behind them, so they are
 * deliberately absent from this table.
 *
 * The correspondence below was verified title-by-title against BOTH sources
 * rather than assumed from ordering; the titles are quoted here so a future
 * re-sync can re-check it by reading, without opening either file.
 *
 * The two sources used to spell the same experiment two ways — ours abbreviated
 * ("DHT11 with Raspberry Pi"), the seed's written out. They now agree, because
 * both take their titles from the original lab sheet
 * (reference/iot_virtual_lab.html) verbatim.
 *
 *   id  our slug                    title (lab sheet = seed = experimentData.ts)
 *   ──  ──────────────────────────  ───────────────────────────────────────────────────────
 *    1  led-dht11-arduino           LED & DHT11 Temperature/Humidity Sensor Interfacing
 *    2  ultrasonic-pir-arduino      Ultrasonic Sensor & PIR Sensor Interfacing
 *    3  traffic-light-arduino       Traffic Light Simulator
 *    4  water-flow-arduino          Water Flow Detection using Arduino
 *    5  led-button-rpi              LED & Push Button Interfacing with Raspberry Pi
 *    6  pir-alarm-arduino           Motion Sensor Alarm using PIR Sensor
 *    7  dht11-rpi                   DHT11 Temperature & Humidity with Raspberry Pi
 *    8  ds18b20-rpi                 DS18B20 Temperature Sensor with Raspberry Pi
 *    9  motor-control-rpi           DC Motor & Stepper Motor Control with Raspberry Pi
 *   10  home-automation-rpi         Smartphone Controlled Home Automation with Raspberry Pi
 *   11  smart-traffic-controller    Smart Traffic Light Controller
 *   12  health-monitoring-rpi       Smart Health Monitoring System
 *
 * Every pairing is the same experiment under the same name. There is no slug
 * whose meaning had to be stretched to make the table line up.
 */
export const SLUG_TO_STATIC_EXPERIMENT_ID: Readonly<Record<string, number>> = {
  'led-dht11-arduino': 1,
  'ultrasonic-pir-arduino': 2,
  'traffic-light-arduino': 3,
  'water-flow-arduino': 4,
  'led-button-rpi': 5,
  'pir-alarm-arduino': 6,
  'dht11-rpi': 7,
  'ds18b20-rpi': 8,
  'motor-control-rpi': 9,
  'home-automation-rpi': 10,
  'smart-traffic-controller': 11,
  'health-monitoring-rpi': 12,
}

/**
 * The ported circuit for an experiment slug, or null when there isn't one.
 *
 * Returns null rather than throwing or falling back to a default circuit: a
 * slug this simulator has no drawing for is a content-configuration question,
 * and showing the WRONG circuit under the right heading would be worse than
 * showing none. Callers render a notice.
 */
export function getStaticExperiment(slug: string | null | undefined): Experiment | null {
  if (!slug) return null
  const id = SLUG_TO_STATIC_EXPERIMENT_ID[slug]
  if (id === undefined) return null
  return EXPERIMENTS.find((e) => e.id === id) ?? null
}
