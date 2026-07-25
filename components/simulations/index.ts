/**
 * Registry for the built-in simulations.
 *
 * `simulations.type = 'builtin'` rows carry `config.sim_type`; that key selects
 * the component rendered here. Eleven distinct keys cover the twelve rows —
 * `dht11` is shared by the Arduino and the Raspberry Pi DHT11 experiments.
 *
 * Behaviour for every entry is ported from the reference lab HTML.
 */

import type { ComponentType } from 'react'
import type { SimProps } from './types'

import { Dht11Sim } from './Dht11Sim'
import { UltrasonicSim } from './UltrasonicSim'
import { TrafficSim } from './TrafficSim'
import { FlowSim } from './FlowSim'
import { RpiLedSim } from './RpiLedSim'
import { PirAlarmSim } from './PirAlarmSim'
import { Ds18b20Sim } from './Ds18b20Sim'
import { MotorSim } from './MotorSim'
import { HomeAutoSim } from './HomeAutoSim'
import { SmartTrafficSim } from './SmartTrafficSim'
import { HealthSim } from './HealthSim'

export const SIM_REGISTRY: Record<string, ComponentType<SimProps>> = {
  dht11: Dht11Sim,
  ultrasonic: UltrasonicSim,
  traffic: TrafficSim,
  flow: FlowSim,
  rpi_led: RpiLedSim,
  pir_alarm: PirAlarmSim,
  ds18b20: Ds18b20Sim,
  motor: MotorSim,
  home_auto: HomeAutoSim,
  smart_traffic: SmartTrafficSim,
  health: HealthSim,
}

/** Human labels, used by the dev harness and by error copy. */
export const SIM_LABELS: Record<string, string> = {
  dht11: 'DHT11 Temperature & Humidity',
  ultrasonic: 'Ultrasonic Distance & PIR',
  traffic: 'Traffic Light Sequencer',
  flow: 'Water Flow Sensor',
  rpi_led: 'Raspberry Pi LED & Push Button',
  pir_alarm: 'PIR Motion Alarm',
  ds18b20: 'DS18B20 1-Wire Temperature',
  motor: 'DC Motor & Stepper Control',
  home_auto: 'Home Automation Relays',
  smart_traffic: 'Smart Traffic Controller',
  health: 'Health Monitoring System',
}

export const SIM_KEYS = Object.keys(SIM_REGISTRY)

export type { SimProps }
