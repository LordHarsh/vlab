'use client'

/**
 * L298N DC motor + 28BYJ-48 stepper control.
 * Ported from `simMotor` / `motorFwd` / `motorRev` / `motorStop` / `simStepper`
 * in the reference lab HTML.
 */

import { useEffect, useRef, useState } from 'react'
import { CtrlButton, CtrlRow, SimLog, SimPanel, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

type Dir = 'forward' | 'reverse' | 'stopped'

export function MotorSim({ platform }: SimProps) {
  const [speed, setSpeed] = useState(0)
  const [dir, setDir] = useState<Dir>('stopped')
  const { lines, log } = useSimLog()
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current)
    }
  }, [])

  /** Port of simMotor() — reads the current speed and direction. */
  function runMotor(s: number, d: Dir) {
    log(
      `DC Motor: ${s > 0 ? d.toUpperCase() : ' STOPPED'}  Duty Cycle: ${s}%  PWM: ${Math.round(
        s * 10.23
      )}/1023`
    )
  }

  function forward() {
    setDir('forward')
    setSpeed(75)
    runMotor(75, 'forward')
  }

  function reverse() {
    setDir('reverse')
    log('DC Motor: REVERSE at current speed')
  }

  function stop() {
    setDir('stopped')
    setSpeed(0)
    runMotor(0, 'stopped')
  }

  function stepper() {
    if (stepTimer.current) clearTimeout(stepTimer.current)
    log('Stepper: Running 512 steps (half-step mode) — ~1 revolution @ 28BYJ-48')
    stepTimer.current = setTimeout(() => {
      log('Stepper: 512 steps COMPLETE')
      stepTimer.current = null
    }, 1200)
  }

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        L298N DC motor + 28BYJ-48 stepper{platform ? ` · ${platform}` : ''}. PWM duty cycle maps to
        0–1023.
      </p>

      <SliderRow
        label="DC Motor Speed (%)"
        value={speed}
        display={`${speed}%`}
        min={0}
        max={100}
        onChange={(v) => {
          setSpeed(v)
          runMotor(v, dir)
        }}
      />

      {/* Reference: all four motor buttons are plain controls — none latch. */}
      <CtrlRow>
        <CtrlButton onClick={forward}>▶ FORWARD</CtrlButton>
        <CtrlButton onClick={reverse}>◀ REVERSE</CtrlButton>
        <CtrlButton onClick={stop}>■ STOP</CtrlButton>
        <CtrlButton onClick={stepper}>⟳ STEP (512)</CtrlButton>
      </CtrlRow>

      <SimLog lines={lines} />
    </SimPanel>
  )
}
