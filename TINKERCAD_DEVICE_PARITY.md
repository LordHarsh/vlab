# Tinkercad Device Parity — STATUS: BLOCKED (no catalogue produced)

**This file is NOT the parity catalogue.** It is an access log plus the two facts that
were actually verified. The per-component audit was not performed, because the
Tinkercad editor could not be opened. Nothing in this file is reconstructed from
memory.

Date of attempt: 2026-07-25

---

## Why there is no catalogue

The brief assumed "the owner is signed in to Tinkercad in this browser." **They are
not.** Every design, editor, and embed URL redirects to `/login`.

| URL attempted | Result |
|---|---|
| `https://www.tinkercad.com/dashboard/designs/circuits` | **[observed]** 302 → `/login` |
| `https://www.tinkercad.com/things/hfX3NiARk0m/editel` (owner's design) | **[observed]** 302 → `/login?next=/things/hfX3NiARk0m/editel` |
| `https://www.tinkercad.com/things/hfX3NiARk0m` | **[observed]** 302 → `/login` |
| `https://www.tinkercad.com/embed/hfX3NiARk0m` | **[observed]** 302 → `/login` |
| `https://www.tinkercad.com/circuits` | **[observed]** 200 — public marketing page only, no editor |
| `https://www.tinkercad.com/learn/circuits` | **[observed]** 200 — public marketing page only |

The login page offers Email/Username, Google, and Apple sign-in. **I did not sign
in and will not**: entering credentials or authenticating on the owner's behalf is
outside what I'm permitted to do, regardless of authorisation given in the task
brief. Account-level authorisation from the owner does not change this.

**To unblock:** the owner needs to sign in to Tinkercad in this Chrome profile
themselves, then the per-component audit can run as specified.

---

## What WAS verified

### 1. `InspectorInputType` enum — the authoritative control-type list

**[observed]** Extracted from the shipped editor bundle at
`https://editor.tinkercad.com/assets_v2_2n2c7n0/js/appBundle.js`, webpack module
`86452`, exported as `t.exports.InspectorInputType`. Full enum, 17 members:

| Key | Value |
|---|---|
| `TEXT` | `text` |
| `CHECKBOX` | `checkbox` |
| `SELECTBOX` | `selectbox` |
| `BUTTON` | `button` |
| `SLIDER` | `slider` |
| `SKETCH2D` | `sketch2d` |
| `FILE` | `file` |
| `HEADER_BUTTON` | `header_button` |
| `MARKDOWN` | `markdown` |
| `AUTHOR` | `author` |
| `TITLE` | `title` |
| `COLOR` | `color` |
| `KEY_BINDINGS` | `key-bindings` |
| `PRESETS` | `presets` |
| `HIDDEN` | `hidden` |
| `ACTIONABLE_STATUS` | `actionable_status` |
| `LIST` | `list` |

**Important caveat — [inferred], not observed:** this enum was found in
`appBundle.js`, which is the **3D design editor** app, not the Circuits editor
(see below). It is *plausibly* the shared Tinkercad inspector framework used by
Circuits too, but that was **not confirmed**. Do not treat it as proven to be the
Circuits control-type list until the Circuits bundle is read.

Sibling controllers exported alongside it, for context **[observed]**:
`InspectorController`, `ExitDialogController`, `ShareDialogController`,
`NotificationController`, `TutorialPanelController`, `GridPropertiesController`.

### 2. The Circuits editor bundle was not located

**[observed]** `appBundle.js` (8.6 MB) is the 3D editor. Evidence: it contains
zero occurrences of `Potentiometer`, `Breadboard`, `Resistor`, `Arduino`,
`Oscilloscope`, `Multimeter`, `partType`, `netlist`, `spice`, `avr8`. Its `ohm` /
`farad` / `henry` / `weber` / `tesla` hits are a **bundled math.js units library**,
not circuit-component units — verified by reading the surrounding symbol names
(`electricConstant`, `vacuumImpedance`, `conductanceQuantum`, `BigNumber`).

**[observed]** The editor shell at `https://editor.tinkercad.com/` loads only:
`container-query-polyfill.js`, `vendorBundle.js`, `library.min.js`, `localEnv.js`,
`nativeBridgeBundle.js`, `appBundle.js`, `communicatorBundle.js`,
`featureFlagsBundle.js`, `react-bundle.js`. No circuits bundle among them.

**[observed]** Probed and got HTTP 403 (absent) for, in
`/assets_v2_2n2c7n0/js/`: `circuitsBundle.js`, `circuits.js`,
`electronicsBundle.js`, `simulatorBundle.js`, `circuitsEditorBundle.js`,
`editorBundle.js`, `mainBundle.js`, `manifest.json`, `asset-manifest.json`,
`electronicsAppBundle.js`, `circuitsAppBundle.js`, `editelBundle.js`,
`elecBundle.js`, `breadboardBundle.js`, `dcBundle.js`, `partsBundle.js`,
`componentsBundle.js`, `arduinoBundle.js`, `avrBundle.js`, `simBundle.js`,
and others.

**[inferred]** The Circuits editor is a separate app whose asset path is
referenced only from the `/things/<id>/editel` HTML — which is login-gated. Once
signed in, that page's `<script src>` list will give the bundle directly, and the
real component/inspector definitions can be dumped from it.

---

## Not attempted

Every item below from the brief was **not** covered, because the editor never
opened. No component was placed, selected, simulated, or right-clicked.

- All ~50 listed components (resistor through mcp3008 comparators)
- Inspector fields, units, defaults, min/max, validation
- Canvas interactions and gestures
- Simulation-time behaviour and interactivity
- Right-click menus and keyboard shortcuts
- Pin counts and labels
- Multimeter / oscilloscope / function generator behaviour
- Editor-level actions (rotate, flip, copy/paste, undo/redo, Components dropdown
  categories, search, notes tool, "Send To")
- Components-Tinkercad-has-that-we-do-not gap list

Producing any of the above from model memory would be guesswork presented as
fact, which the brief explicitly forbids. It has therefore been omitted rather
than filled in.
