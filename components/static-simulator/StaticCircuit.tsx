'use client'

import React, { useId, useMemo } from 'react'
import type { ComponentInstance, Experiment, WireConnection } from './types'
import { COMPONENT_DEFINITIONS } from './utils/componentDefinitions'
import { getSchematicDimensions, getSchematicPinCoords } from './utils/schematicLayout'
import { ComponentSVGs } from './ComponentSVGs'
import { Wire } from './features/Wire'
import { IDLE_FRAME, type ShowreelFrame } from './showreel/useShowreel'

/**
 * A read-only drawing of one experiment's circuit.
 *
 * This is NOT a port of upstream's SimulatorWorkspace. That file is 4,277 lines
 * of editor — drag, rotate, multi-select, wire routing, undo stack, a parts
 * palette, a Monaco editor, a serial monitor, a BOM exporter and an execution
 * loop — and none of it survives a display-only brief. What is ported here is
 * the ~90 lines of it that actually put pixels on the canvas:
 *
 *   • getPinPos / getPinPosReal — absolute pin coordinates under rotation
 *     (upstream SimulatorWorkspace.tsx:1123–1180, transcribed unchanged so the
 *     wires land on the same holes their build does)
 *   • the component <g transform> and its <ComponentSVGs> call (:3336–3387)
 *   • the wire pass that maps each WireConnection through <Wire> (:3168–3200)
 *
 * Everything interactive is gone rather than disabled: there are no mouse
 * handlers on this tree at all, so there is nothing to accidentally re-enable
 * and nothing that can mutate the circuit. The component takes an Experiment
 * and renders it; it holds no state.
 *
 * IT DOES NOT HOLD A CLOCK EITHER. The `frame` prop is what makes the picture
 * move — which pins are high, what the sensors read, which properties are
 * overridden at this instant — and it is produced by useShowreel in the panel
 * above, so that the artwork, the serial log and the elapsed timer are three
 * views of one index and cannot drift apart. Omit `frame` and the circuit
 * draws inert, exactly as it did before any of this existed.
 *
 * `frame` is scripted playback, not simulation. See showreel/timelines.ts.
 */

/* ── Geometry, transcribed from upstream ──────────────────────────────── */

/** Absolute coordinates of a component pin in the breadboard view. */
function getPinPosReal(comp: ComponentInstance, pinId: string): { x: number; y: number } {
  const meta = COMPONENT_DEFINITIONS[comp.type]
  if (!meta) return { x: 0, y: 0 }

  let targetPinId = pinId
  if (comp.type === 'arduino') {
    if (!pinId.startsWith('arduino-')) {
      if (pinId === 'GND_D' || pinId === 'GND') targetPinId = 'arduino-GND'
      else if (pinId === 'GND_P1') targetPinId = 'arduino-GND1'
      else if (pinId === 'GND_P2') targetPinId = 'arduino-GND2'
      else if (pinId === 'VIN') targetPinId = 'arduino-Vin'
      else targetPinId = `arduino-${pinId}`
    }
  }

  const pin = meta.pins.find((p) => p.id === targetPinId)
  if (!pin) return { x: 0, y: 0 }

  // Centre of component
  const cx = comp.x + meta.width / 2
  const cy = comp.y + meta.height / 2

  // Relative to centre
  const rx = pin.x - meta.width / 2
  const ry = pin.y - meta.height / 2

  const rad = (comp.rotation * Math.PI) / 180
  const rotX = rx * Math.cos(rad) - ry * Math.sin(rad)
  const rotY = rx * Math.sin(rad) + ry * Math.cos(rad)

  return { x: Math.round(cx + rotX), y: Math.round(cy + rotY) }
}

/** Absolute coordinates of a component pin in the schematic view. */
function getPinPosSchematic(comp: ComponentInstance, pinId: string): { x: number; y: number } {
  const dim = getSchematicDimensions(comp.type)
  const pinCoords = getSchematicPinCoords(comp.type, pinId)

  const cx = comp.x + dim.width / 2
  const cy = comp.y + dim.height / 2

  const rx = pinCoords.x - dim.width / 2
  const ry = pinCoords.y - dim.height / 2

  const rad = (comp.rotation * Math.PI) / 180
  const rotX = rx * Math.cos(rad) - ry * Math.sin(rad)
  const rotY = rx * Math.sin(rad) + ry * Math.cos(rad)

  return { x: Math.round(cx + rotX), y: Math.round(cy + rotY) }
}

/* ── Circuit normalisation, transcribed from upstream ─────────────────── */

/**
 * Two of the twelve circuits are wrong as stored and upstream repairs them when
 * it loads a template rather than in the data (SimulatorWorkspace.tsx:546–588).
 * Reproduced here for the same reason: without it experiment 9 draws a stepper
 * motor its own build steps do not mention, trailing unconnected orange wires,
 * and experiment 10 draws a relay with nothing on the other side of it.
 *
 * Their comments are kept so the intent stays attributable. This runs on a deep
 * copy — `EXPERIMENTS` is a module-level constant shared by every render.
 *
 * EXPORTED so the components rail beside this canvas lists exactly the parts
 * the canvas draws. Reading `experiment.defaultComponents` there instead would
 * put a stepper motor in experiment 9's rail that is nowhere on its board.
 */
export function normaliseCircuit(experiment: Experiment): {
  components: ComponentInstance[]
  wires: WireConnection[]
} {
  let initialComps: ComponentInstance[] = JSON.parse(JSON.stringify(experiment.defaultComponents))
  let initialWires: WireConnection[] = JSON.parse(JSON.stringify(experiment.defaultWires))

  // Forceful Netlist/Canvas Cleanup for Experiment 9 (DC & Stepper Motor Control)
  if (experiment.id === 9) {
    const stepperMotor = initialComps.find((c) => c.type === 'stepper_motor')
    if (stepperMotor) {
      const stepperId = stepperMotor.id
      // Purge the Stepper Motor component entirely
      initialComps = initialComps.filter((c) => c.id !== stepperId)
      // Purge any wires connected to the Stepper Motor
      initialWires = initialWires.filter(
        (w) => w.fromComponentId !== stepperId && w.toComponentId !== stepperId,
      )
    }

    // Specifically target and delete any orange wires connected to the Stepper Motor or OUT terminals
    initialWires = initialWires.filter(
      (w) =>
        !(
          w.color === 'orange' &&
          (w.fromComponentId.includes('stepper') ||
            w.toComponentId.includes('stepper') ||
            w.fromPinId.includes('out') ||
            w.toPinId.includes('out'))
        ),
    )

    // Isolate the DC Motor on the L298N output terminals (OUT1 & OUT2)
    const l298n = initialComps.find((c) => c.type === 'l298n')
    if (l298n) {
      const l298nId = l298n.id
      initialWires = initialWires.filter((w) => {
        const isL298nOut1Or2 =
          (w.fromComponentId === l298nId && (w.fromPinId === 'out1' || w.fromPinId === 'out2')) ||
          (w.toComponentId === l298nId && (w.toPinId === 'out1' || w.toPinId === 'out2'))
        if (isL298nOut1Or2) {
          const connectsToDcMotor = w.fromComponentId === 'dc_1' || w.toComponentId === 'dc_1'
          const isBlueWire = w.color === 'blue'
          return connectsToDcMotor && isBlueWire
        }
        return true
      })
    }
  }

  // Forceful Netlist/Canvas Setup for Experiment 10 (Home Automation with Raspberry Pi)
  if (experiment.id === 10) {
    const hasLightbulb = initialComps.some((c) => c.type === 'lightbulb')
    if (!hasLightbulb) {
      initialComps.push({
        id: 'lightbulb_1',
        type: 'lightbulb',
        name: 'Lightbulb',
        x: 500,
        y: 80,
        rotation: 0,
        properties: { lit: false },
      })
    }
  }

  return { components: initialComps, wires: initialWires }
}

/* ── The view ─────────────────────────────────────────────────────────── */

/** Padding around the circuit's bounding box, in canvas units. */
const VIEWBOX_PADDING = 40

export function StaticCircuit({
  experiment,
  viewMode = 'breadboard',
  className = '',
  frame = IDLE_FRAME,
}: {
  experiment: Experiment
  viewMode?: 'breadboard' | 'schematic'
  className?: string
  /** The current instant of the scripted playback. Defaults to everything off. */
  frame?: ShowreelFrame
}) {
  const { components, wires } = useMemo(() => normaliseCircuit(experiment), [experiment])

  // SVG ids are document-global, so upstream's bare id="dot-grid" would collide
  // the moment two circuits shared a page. Namespaced per instance.
  const gridId = `static-sim-dot-grid-${useId()}`

  /**
   * THE ONE DELIBERATE DEPARTURE FROM UPSTREAM'S PAINT ORDER.
   *
   * Upstream draws every wire first and every component second, so the opaque
   * breadboard body covers whatever runs beneath it. In the editor that is
   * survivable — it ships a hover "flashlight" that dims the board around a
   * wire end so you can find it — but a hover affordance is no use in a picture.
   *
   * Measured on experiment 1: 12 of the 16 wire endpoints land inside the
   * breadboard's box, so 8 of the 8 wires showed only their first leg and no
   * student could tell which hole any of them went into. For a diagram whose
   * whole job is to show what connects to what, that is the wrong answer.
   *
   * So breadboards paint first, then wires, then everything else. Wires are now
   * visible across the board while still passing UNDER the parts plugged into
   * it, which is both legible and physically right. Deleting this split and
   * mapping `components` in one pass restores upstream's exact order.
   */
  const breadboards = components.filter((c) => c.type === 'breadboard')
  const parts = components.filter((c) => c.type !== 'breadboard')

  const renderComponent = (comp: ComponentInstance) => {
    const meta = COMPONENT_DEFINITIONS[comp.type]
    const dims =
      viewMode === 'schematic'
        ? getSchematicDimensions(comp.type)
        : { width: meta?.width ?? 60, height: meta?.height ?? 40 }

    // A few parts (the button cap, the relay's own flag) are drawn from
    // `properties` rather than from a pin. The override is layered on a copy;
    // EXPERIMENTS is a module-level constant and must not be written to.
    const overrides = frame.propertiesFor(comp.id)
    const instance = overrides
      ? { ...comp, properties: { ...comp.properties, ...overrides } }
      : comp

    return (
      <g
        key={comp.id}
        transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation} ${dims.width / 2} ${dims.height / 2})`}
      >
        <ComponentSVGs
          instance={instance}
          viewMode={viewMode}
          // Both are asked for: the ported artwork reads some parts as a
          // logic level and others as a voltage, and they have to agree.
          isPinActive={(pinId) => frame.isPinHigh(comp.id, pinId)}
          getPinVoltage={(pinId) => frame.pinVoltage(comp.id, pinId)}
          sensorValues={frame.sensors}
          rawPinStates={frame.rawPinStates}
        />

        {/* Upstream also drew a pin layer here — visible breadboard holes plus
            a 12 px invisible hit-target per pin for starting a wire. Only the
            holes are kept: they are part of the breadboard's appearance. The
            hit-targets are gone with the rest of the editing surface. */}
        {viewMode !== 'schematic' &&
          comp.type === 'breadboard' &&
          meta?.pins.map((pinDef) => (
            <g key={pinDef.id} style={{ pointerEvents: 'none' }}>
              <circle cx={pinDef.x} cy={pinDef.y} r={3.5} fill="#E5E7EB" />
              <circle cx={pinDef.x} cy={pinDef.y} r={3} fill="#374151" />
              <circle cx={pinDef.x} cy={pinDef.y} r={2.5} fill="#1F2937" />
            </g>
          ))}
      </g>
    )
  }

  const getPinPos = (comp: ComponentInstance, pinId: string) =>
    viewMode === 'schematic' ? getPinPosSchematic(comp, pinId) : getPinPosReal(comp, pinId)

  /**
   * The viewBox is derived from the circuit rather than fixed.
   *
   * Upstream never needed this: its canvas was a pan-and-zoom surface the
   * student moved around by hand. A static picture has no pan control, so the
   * drawing has to arrive already framed — and the twelve circuits differ in
   * size by more than a factor of two, so one hard-coded viewBox would crop
   * some and strand others in a corner. Wire elbow nodes are included in the
   * bounds because a routed wire can legitimately leave the parts' box.
   */
  const viewBox = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const comp of components) {
      const meta = COMPONENT_DEFINITIONS[comp.type]
      const dims =
        viewMode === 'schematic'
          ? getSchematicDimensions(comp.type)
          : { width: meta?.width ?? 60, height: meta?.height ?? 40 }
      minX = Math.min(minX, comp.x)
      minY = Math.min(minY, comp.y)
      maxX = Math.max(maxX, comp.x + dims.width)
      maxY = Math.max(maxY, comp.y + dims.height)
    }

    for (const w of wires) {
      for (const n of w.nodes ?? []) {
        minX = Math.min(minX, n.x)
        minY = Math.min(minY, n.y)
        maxX = Math.max(maxX, n.x)
        maxY = Math.max(maxY, n.y)
      }
    }

    // An experiment with no components at all still needs a valid viewBox.
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 800, height: 400 }

    return {
      x: minX - VIEWBOX_PADDING,
      y: minY - VIEWBOX_PADDING,
      width: maxX - minX + VIEWBOX_PADDING * 2,
      height: maxY - minY + VIEWBOX_PADDING * 2,
    }
  }, [components, wires, viewMode])

  return (
    <svg
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      /**
       * `block h-full w-full` — fills the canvas box the workspace gives it and
       * letterboxes itself inside (SVG's default `preserveAspectRatio` centres
       * the viewBox), so the circuit sits in the middle of a canvas the way it
       * does in a real editor rather than dictating the panel's height. The box
       * is what is responsive; this just fills it.
       *
       * `pointer-events-none` — the ported artwork still carries the editor's
       * affordances inside it: Wire.tsx puts `cursor: pointer` on every wire
       * group and a 15 px transparent hit-path under it, and ComponentSVGs adds
       * hover rings. Measured, that left 726 elements showing a hand cursor
       * over a diagram where clicking does nothing — an interaction advertised
       * and then not delivered. One property on the root makes the whole
       * subtree non-interactive, which is both the honest cursor and a hard
       * guarantee that no ported handler can ever fire. It costs the native
       * `<title>` tooltips on pins, which were an editing aid.
       */
      className={`pointer-events-none block h-full w-full ${className}`}
      role="img"
      aria-label={`Circuit diagram: ${experiment.title}`}
    >
      <title>{`Circuit diagram: ${experiment.title}`}</title>

      {/*
       * THE CANVAS BACKDROP, AND WHY IT IS NO LONGER UPSTREAM'S.
       *
       * Upstream painted `#1a1a2e` with white dots at 8% alpha
       * (SimulatorWorkspace.tsx:3128 and :3151) and every part in ComponentSVGs
       * was drawn to read against it. This is now a LIGHT canvas — near-white
       * with dark dots — because the workbench this panel imitates has one, and
       * a dark rectangle in the middle of a lesson page reads as an embedded
       * video rather than as a tool.
       *
       * The artwork was checked against it part by part rather than assumed to
       * survive the swap, which is the obvious way to get this wrong. What was
       * actually at risk: the bodies are dark (a navy Uno, a blue DHT11, a
       * slate L298N) so their white lettering is unaffected; the breadboard is
       * near-white and keeps its own grey outline; and the three light-grey
       * parts — the servo horn, the motor can, the flow sensor — carry
       * mid-slate strokes rather than white ones. The one thing that genuinely
       * did break was this pattern: white dots at 8% over a pale canvas are
       * invisible, so they are dark at 6% instead.
       *
       * The rect is positioned from the viewBox rather than upstream's
       * `width="100%" height="100%"`, which assumed an origin at 0,0.
       */}
      <defs>
        <pattern id={gridId} width="15" height="15" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.0" fill="rgba(15, 23, 42, 0.09)" />
        </pattern>
      </defs>
      <rect
        x={viewBox.x}
        y={viewBox.y}
        width={viewBox.width}
        height={viewBox.height}
        fill="#f7f8f9"
      />
      <rect
        x={viewBox.x}
        y={viewBox.y}
        width={viewBox.width}
        height={viewBox.height}
        fill={`url(#${gridId})`}
      />

      {/* 1. Breadboards — see the paint-order note above. */}
      {breadboards.map(renderComponent)}

      {/* 2. Wires, over the board and under the parts. */}
      {wires.map((w) => {
        const comp1 = components.find((c) => c.id === w.fromComponentId)
        const comp2 = components.find((c) => c.id === w.toComponentId)
        if (!comp1 || !comp2) return null

        const pos1 = getPinPos(comp1, w.fromPinId)
        const pos2 = getPinPos(comp2, w.toPinId)

        return (
          <Wire
            key={w.id}
            id={w.id}
            x1={pos1.x}
            y1={pos1.y}
            x2={pos2.x}
            y2={pos2.y}
            nodes={w.nodes}
            color={w.color}
            // Always false: selection is an editing concept and there is no
            // editing here. Upstream's hover glow is likewise never triggered,
            // because no handlers are passed.
            isSelected={false}
            style="manhattan"
          />
        )
      })}

      {/* 3. Everything plugged into the board. */}
      {parts.map(renderComponent)}
    </svg>
  )
}
