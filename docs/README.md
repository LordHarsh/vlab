# Documentation

Design notes, audits and findings. Many are referenced from code comments by
path, so moving or renaming one means updating those references too.

## Architecture & design
| File | What it covers |
|---|---|
| [SIMULATOR_ARCHITECTURE.md](SIMULATOR_ARCHITECTURE.md) | The simulator's design. Most-referenced doc in the codebase. |
| [DESIGN.md](DESIGN.md) | Product and data-model design. |
| [TRANSIENT_DESIGN.md](TRANSIENT_DESIGN.md) | Transient (time-stepped) analysis. |
| [WIRE_RENDERING_SPEC.md](WIRE_RENDERING_SPEC.md) | How wires are routed and drawn. |
| [DESIGN_REFERENCE_SRMEEEVLAB.md](DESIGN_REFERENCE_SRMEEEVLAB.md) | Visual reference compiled from the SRM EEE virtual-labs site. |
| [BUILD_NOTES.md](BUILD_NOTES.md) | Build and toolchain notes. |

## Device & simulator capability
| File | What it covers |
|---|---|
| [OUR_DEVICE_CAPABILITIES.md](OUR_DEVICE_CAPABILITIES.md) | What the simulator's devices actually model. |
| [DEVICE_CONTROLS_AUDIT.md](DEVICE_CONTROLS_AUDIT.md) | Audit of per-device interactive controls. |
| [TINKERCAD_DEVICE_PARITY.md](TINKERCAD_DEVICE_PARITY.md) | Parity notes against Tinkercad Circuits. |
| [PICO_TRACK_FINDINGS.md](PICO_TRACK_FINDINGS.md) | RP2040 / MicroPython findings. |
| [AVR_COMPILE_FINDINGS.md](AVR_COMPILE_FINDINGS.md) | AVR toolchain and compile findings. |

## Audits & status
| File | What it covers |
|---|---|
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | RLS and data-access audit. Carries a remediation status header. |
| [CODE_AUDIT.md](CODE_AUDIT.md) | Codebase audit. |
| [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) | Background and scope. |
| [PHASE0_RESULTS.md](PHASE0_RESULTS.md) | Phase-0 spike results. |

Not here, and deliberately: `README.md` (repo root, by convention),
`CLAUDE.md` / `AGENTS.md` (agent tooling reads these from the root), and
`reference/` (the original lab HTML, which is source data rather than a doc).
