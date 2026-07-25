/** Props every built-in simulation accepts. All optional — none may be required. */
export type SimProps = {
  /** 'Arduino' | 'Raspberry Pi' | … — best-effort, may be absent. */
  platform?: string | null
}
