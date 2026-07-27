'use client'

import type { ShowreelSensors } from '../showreel/timelines'
import type { SensorControlSpec } from '../showreel/sensorOverrides'

/**
 * THE THIRD AND FOURTH REAL CONTROLS IN THIS PANEL, on the owner's explicit
 * instruction: a slider that nudges a sensor's reading, and a toggle for the
 * one sensor (a PIR) whose real-world reading is binary rather than
 * continuous — see showreel/sensorOverrides.ts's header for why the PIR gets
 * a switch and not a second slider.
 *
 * SITS IN THE STATUS STRIP, NOT ON THE CANVAS. Tinkercad draws its own
 * equivalents ON the part's artwork (TINKERCAD_DEVICE_PARITY.md's photoresistor
 * and TMP36 sliders). That was tried here first and dropped: the read-only
 * canvas has no exposed hook for the view (pan/zoom transform) it fits itself
 * to on every resize, so an on-canvas control would either duplicate that
 * private fit algorithm pixel-for-pixel (fragile — two copies of a transform
 * with no shared source of truth) or drift out of alignment with the artwork
 * the moment a panel's box changes size, which happens constantly here: the
 * canvas is 260 px tall on a phone, 320 at `sm`, 380 at `lg`. The status strip
 * is DOM, not SVG transformed by a value this file cannot read, so it cannot
 * drift off the thing it controls at any width — including the narrowest one
 * this page supports, simulated by stripping the responsive `sm:`/`lg:`
 * variants the way the framing-fix commit already did to check 390 px.
 *
 * ONE CLOCK. Every value drawn here comes from the SAME `frame.sensors` the
 * canvas and the rail read — see useSensorOverride.ts. A slider never shows a
 * number the readout beside it disagrees with, because they are the same
 * number.
 */
export function SensorControls({
  controls,
  sensors,
  warn,
  onChange,
}: {
  controls: readonly SensorControlSpec[]
  /** The reading each control shows — scripted or overridden, same field either way. */
  sensors: ShowreelSensors
  /** Recolour the live value: the current reading is past the line the sketch itself draws. */
  warn: boolean
  onChange: (field: SensorControlSpec['field'], value: number | boolean) => void
}) {
  if (controls.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {controls.map((spec) =>
        spec.kind === 'slider' ? (
          <SliderControl
            key={spec.field}
            spec={spec}
            value={typeof sensors[spec.field] === 'number' ? (sensors[spec.field] as number) : spec.min}
            warn={warn}
            onChange={onChange}
          />
        ) : (
          <ToggleControl key={spec.field} spec={spec} value={sensors[spec.field] === true} onChange={onChange} />
        ),
      )}
    </div>
  )
}

function SliderControl({
  spec,
  value,
  warn,
  onChange,
}: {
  spec: Extract<SensorControlSpec, { kind: 'slider' }>
  value: number
  warn: boolean
  onChange: (field: SensorControlSpec['field'], value: number | boolean) => void
}) {
  const id = `sensor-slider-${spec.partId}-${spec.propKey}`
  return (
    <label htmlFor={id} className="flex shrink-0 items-center gap-1.5 text-[11px] text-[#566573]">
      <span className="shrink-0">{spec.label}</span>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(spec.field, Number(e.target.value))}
        aria-label={`${spec.label} — nudge the simulated reading`}
        className="h-1.5 w-16 shrink-0 cursor-pointer accent-[#1477d1] sm:w-24"
      />
      <span
        className={`w-14 shrink-0 font-mono tabular-nums ${warn ? 'text-[#c0392b]' : 'text-[#34495e]'}`}
      >
        {value}
        {spec.unit}
      </span>
    </label>
  )
}

function ToggleControl({
  spec,
  value,
  onChange,
}: {
  spec: Extract<SensorControlSpec, { kind: 'toggle' }>
  value: boolean
  onChange: (field: SensorControlSpec['field'], value: number | boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(spec.field, !value)}
      title={`${spec.label} — simulate the sensor detecting it`}
      className={`flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] focus-visible:ring-offset-1 ${
        value
          ? 'border-[#f4c568] bg-[#fdf2df] text-[#92400e]'
          : 'border-[#dfe3e8] bg-white text-[#566573] hover:border-[#1477d1] hover:text-[#1477d1]'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${value ? 'bg-[#d97706]' : 'bg-[#9aa3ab]'}`}
        aria-hidden="true"
      />
      {spec.label}: {value ? 'detected' : 'clear'}
    </button>
  )
}
