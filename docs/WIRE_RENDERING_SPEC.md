# Tinkercad Circuits — Wire Rendering Spec

Research date: 2026-07-24. Target: replace the spline/droop wire renderer in
`components/simulator/CircuitCanvas.tsx` with Tinkercad-equivalent geometry.

Every claim below is tagged **[observed]** (seen in a live DOM, in Tinkercad's own
shipped source, or in an official screenshot) or **[inferred]** (reasoned, not
directly seen). Sources are named per finding.

---

## Verdict

**Tinkercad wires are straight polylines with small circular-arc fillets at the bends.**

Not splines. Not orthogonal-only. Not drooping. A wire is the ordered list
`[startPin, ...bendPoints, endPin]`; consecutive points are joined by a **straight
line**, and each interior vertex is replaced by a **quarter/partial circular arc of
radius 10 world units** (= exactly one 0.1 in breadboard pitch). A wire with no bend
points is a **single straight line** between the two pins — including a diagonal one.

Segments are *frequently* axis-aligned because users route them that way, but the
renderer does not force it: I observed plain diagonal wires in a real published design.

Confidence: **very high.** This comes from Tinkercad's shipped drawing function, not
from looking at pictures. See "Primary evidence" below.

---

## Primary evidence

Two public Tinkercad designs load a fully functional editor with **no login**:

- `https://www.tinkercad.com/embed/iJzitNsx5VT?editbtn=1` — "LDR Sensor with Arduino"
- `https://www.tinkercad.com/embed/jv6YGxWk6oA?editbtn=1` — "Light Dependent Resistor controls LED light"

Their wire DOM, and the shipped bundle
`https://editor.tinkercad.com/assets_cc_3g62bj1/js/circuits-compiled.js`, are the
source for most findings. The relevant shipped function, de-minified by hand
(**[observed]**, `circuits-compiled.js`):

```js
Circuits.BreadboardEditor.prototype.drawBendableWire = function (points, color, ...) {
  var pathData = new Circuits.PathData(root, points[0]);
  points.forEach(function (p, i) {
    if (i > 0) pathData.addObject(new Circuits.PathObjectData(root, p, Circuits.PathType.BENDABLE));
  });
  var d = pathData.toSVG({}).attr("d");

  this.lineBorder = this.svg.path(this.lineControl, d, {
    fill: "none",
    stroke: Circuits.BreadboardWire.ColorMap[color || "green"][1],
    "stroke-width": "2.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });
  this.line = this.svg.path(this.lineControl, d, {
    fill: "none",
    stroke: Circuits.BreadboardWire.ColorMap[color || "green"][0],
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });
};
```

And the wire data model (**[observed]**, same bundle, `Circuits.BendableWireData`):

```js
this.color  = this.value("color", "green", ...);
this.maxDistanceFromVertexToCurve = 10;
this.selectMargin = 2;
this.colors = ["black","red","orange","yellow","green","turquoise",
               "blue","purple","pink","brown","grey","white"];
```

---

## 1. Routing geometry

**Straight segments + arc fillets. Diagonals fully supported. No auto-routing.**

**[observed]** Real wire path data pulled from the live DOM of the two designs above
(coordinates truncated to 2dp for readability):

```
# "Light Dependent Resistor controls LED light" — all four wires
#EC2222  M55.48,-141.19 L55.48,-141.19 L40.07,-25
#3C4042  M65.48,-141.19 L65.48,-141.19 L90.07,-55
#40B942  M135.48,-141.19 L135.48,-141.19 L135.48,-25 A10,10 135 0,1 125.48,-15 L80.07,-15
#40B942  M9.48,-331.19  L9.48,-331.19  L9.48,-361.19 A10,10 -45 0,1 19.48,-371.19 L115.48,-371.19

# "LDR Sensor with Arduino" — one wire, two corners
#3C4042  M191.69,236.07 L191.69,236.07 L191.69,246.07
         A10,10 45 0,0 201.69,256.07 L315.69,256.07
         A10,10 -45 0,0 325.69,246.07 L325.69,6.07
```

Read off directly:

- The first two wires are **single straight diagonal lines** with no arc at all
  (`M p L p L q`). This is what a bend-free wire looks like. It is *not* orthogonal
  and it does *not* sag.
- The others are polylines whose corners are `A 10,10` — a **circular arc, rx = ry = 10**.
- Only `L` and `A` commands appear. **No `C`, `Q`, or `S` anywhere** — there is no
  spline in a Tinkercad wire.
- The leading `M p L p` duplicates the first point. A harmless quirk of their path
  serialiser; do not copy it.

**Bend points added by the user** **[observed]**: `Circuits.HandleModel.prototype.doubleClickAction`
cycles a handle between `Circuits.PathPointMode.STRAIGHT`, `.ANGLE`, and `.SMOOTH`.
`ANGLE` is the arc-fillet corner seen above and is the mode wires use in practice;
`STRAIGHT` is a sharp mitre; `SMOOTH` is a curved (tangent-handle) vertex. So a sharp
corner and a curved corner are both reachable, but **the default a bend lands in is the
rounded arc**.

**Auto-routing around components: no.** **[observed]** The strings `elbow`,
`orthogonal`, `routeAround`, `avoidComponents`, and `manhattan` do not occur in
`circuits-compiled.js` at all. The only `autorouter` hits are inside an embedded EAGLE
PCB design-rules XML blob used for board export — unrelated to breadboard wires. Wires
run straight through whatever is in the way; the user is expected to place bends.
Tinkercad's own help text agrees: adjust bends so the wire clears overlapping
components ([Wiring Components](https://www.tinkercad.com/learn/overview/OLORCO6L20FZRZ7?type=circuits)).

**Not determined:** whether dragging pin-to-pin *auto-creates* one elbow bend, or
whether every bend is user-clicked. Circumstantially, the two L-shaped wires above each
have their single vertex at exactly `(start.x, end.y)`, which is what an auto-elbow
would produce — but two samples is not proof, and I could not create a wire (read-only
inspection only). Two of the four wires in that same design have no bend at all, so if
an auto-elbow exists it is not unconditional.

## 2. Corner treatment

**Circular arc fillet, radius 10 world units.** **[observed]** — from the `A10,10`
commands above and from `this.maxDistanceFromVertexToCurve = 10` in `BendableWireData`.

Since one breadboard pitch is also 10 world units (**[observed]**: adjacent breadboard
column hit-paths in design `2EnyfUfdui7` sit at x = −195.50 and −185.50), the corner
radius is **exactly one 0.1 in pitch**. That is the single most important number for
making our wires read as Tinkercad's.

Verified on the two-corner wire: vertex at (191.69, 256.07), arc start (191.69, 246.07),
arc end (201.69, 256.07) — tangent length 10 on both sides, consistent with a 90° corner
of radius 10.

**[inferred]** The variable name says *max* distance from vertex to curve, so on a
corner tighter than 90° the tangent length is capped at 10 and the radius shrinks; on
segments shorter than 20 units the fillet must shrink further or adjacent arcs would
overlap. I could not find a short-segment corner to confirm the clamp empirically, so
treat the clamp formula in §"Implementation" as inferred.

## 3. Stroke rendering

**Two stacked round strokes on one shared path — a darker casing under a lighter core.
No drop shadow, no gradient, no filled outline.** **[observed]**, from
`drawBendableWire` and confirmed against the live DOM.

Paint order, bottom to top, all sharing the identical `d`:

| Layer | Width (world units) | Colour | Notes |
|---|---|---|---|
| Selection/hover halo | **5** | `#3b8ed7` | `opacity` 0 normally, **0.5** when hovered or selected; `class="cgfx__selected"` |
| Casing / `lineBorder` | **2.5** | `ColorMap[c][1]` | the darker shade |
| Core / `line` | **1.8** | `ColorMap[c][0]` | the bright shade |
| Hit band | **4.5** | `blue`, `opacity="0"` | `class="wire-segment"`, one per segment |

That gives a casing rim of exactly **(2.5 − 1.8) / 2 = 0.35 units on each side** — a
thin dark keyline, not a heavy outline. This restraint is most of why Tinkercad's wires
look clean.

**Screen px at default zoom** **[inferred]**: I measured the canvas CTM scale at
**1.345** in an auto-fitted embed, giving core ≈ 2.4 px, casing ≈ 3.4 px, fillet radius
≈ 13.5 px. But an embed auto-fits, so that is not a canonical "100%". The reliable
statement is the pitch-relative one: **core = 0.18 × pitch, casing = 0.25 × pitch,
radius = 1.0 × pitch, hit band = 0.45 × pitch, halo = 0.5 × pitch.**

## 4. End caps

**Round.** **[observed]** — `"stroke-linecap": "round"` on both the casing and the core
in `drawBendableWire`, and `"stroke-linejoin": "round"` on both. Confirmed on the live
DOM elements.

A `normal`-type wire terminates at a pin with nothing but its own round cap; the cap's
radius (1.25 units for the casing) sits over the hole. There is no drawn ferrule,
plug, or solder blob. The `hookup` and `alligator` types draw an extra connector
graphic at each end (`class="wire-end"`, `Circuits.BreadboardWireEnd.type`); the
`normal` type does not.

## 5. Colour palette

**[observed]** — `Circuits.BreadboardWire.ColorMap`, lifted verbatim from
`circuits-compiled.js`. Index `[0]` is the core, `[1]` is the casing, `[2]` is a third
darker shade.

| Name | `[0]` core (1.8) | `[1]` casing (2.5) | `[2]` darkest |
|---|---|---|---|
| black | `#3C4042` | `#171919` | `#070909` |
| red | `#EC2222` | `#C11F1F` | `#B10F0F` |
| orange | `#F78300` | `#CC6600` | `#BC5600` |
| yellow | `#FFDF01` | `#CCAE02` | `#BC9E02` |
| green | `#40B942` | `#369936` | `#268926` |
| turquoise | `#71cedc` | `#58a1a8` | `#489198` |
| blue | `#009ed9` | `#007ea5` | `#006e95` |
| indigo | `#3853a5` | `#283c70` | `#182c60` |
| purple | `#7f3b9a` | `#522866` | `#421856` |
| pink | `#d9288c` | `#a52073` | `#951063` |
| brown | `#aa7b4c` | `#755335` | `#654325` |
| grey | `#999ea1` | `#63696b` | `#53595b` |
| white | `#ffffff` | `#b8b8b8` | `#a8a8a8` |

**The default wire colour is `green`.** **[observed]** — `this.value("color", "green", …)`
in `BendableWireData`, and the `ColorMap[color || "green"]` fallback in `drawBendableWire`.

**The picker offers 12 of these 13 — `indigo` is in the ColorMap but absent from the
selectable `colors` array.** **[observed]**. Custom colours are not supported
([CanadaCAD](https://www.canadacad.ca/how-to-change-wire-color-in-tinkercad/)).

New wires take the **last colour the user picked**, not a per-wire cycle
(**[observed]**: `editorModel.newWireColor`, which the toolbar writes on change and the
wire tool reads).

**Not determined:** what index `[2]` is used for. It is not referenced by
`drawBendableWire`. Most likely the hookup/alligator end-connector shading. Do not
build anything on it.

**Toolbar swatch** **[observed]**, incidental but useful: an 18 px rounded square,
`background-color: ColorMap[c][0]`, `border-radius: round(0.28 × size)`,
`border: 1px solid white` (`#dfe3e8` for the white swatch).

## 6. Wire "style" options

**A `Type` dropdown with exactly three options: `normal`, `alligator`, `hookup`.**

**[observed]** — screenshot in Tinkercad's own blog post
[New Wire Options in Tinkercad Circuits](https://www.tinkercad.com/blog/new-wire-options-in-tinkercad-circuits)
(Donald Bell, 31 Mar 2021) shows the properties panel: a header `Wire`, a `Color`
dropdown reading `black`, and a `Type` dropdown open with `normal` / `alligator` /
`hookup`, `alligator` ticked. Corroborated in code by
`Circuits.BreadboardWireEnd.type` = `NONE` / `AUTO` / `HOOKUP` / `ALLIGATOR`
(**[observed]**).

**There is no thickness option and no dashed option.** The three types differ only in
the connector art drawn at the ends; the blog states they are functionally identical
and exist only to represent your design more accurately. One real behavioural
difference the post calls out: the non-default types let you angle the wire ends more
freely, which helps fan several connections out of one pad.

**Colour and type are two separate dropdowns**, both in the same properties panel —
not a swatch plus a style menu.

## 7. Selection and hover states

**Both draw the same halo: `#3b8ed7`, stroke-width 5, round cap and join, opacity 0.5,
painted *underneath* the casing and core.** **[observed]**, from
`Circuits.BreadboardWire.prototype.draw`:

```js
var attrs = {
  fill: "none", stroke: "#3b8ed7", "stroke-width": "5",
  "stroke-linecap": "round", "stroke-linejoin": "round",
  opacity: (selected || hasSelectedHandles) ? 0.5 : 0,
  class: "cgfx__selected"
};
var narrower = Object.assign({}, attrs, { "stroke-width": "3.5" });
```

and

```js
Circuits.BreadboardWire.prototype.setHighlight = function (on) {
  this.highlight.attr("opacity", (on || this.selected || this.hasSelectedHandles) ? 0.5 : 0);
};
```

`setHighlight(true)` is bound to the segment group's `mouseover` and
`setHighlight(false)` to `mouseout` (**[observed]**, `Circuits.PathSegment.prototype.draw`).
So **hover and selection are visually identical** — a soft blue glow 1.25 units proud
of the casing on each side. The 3.5-width variant is used for the narrower end/connector
pieces.

I verified the halo elements exist in the live DOM at `opacity="0"` when idle
(**[observed]**), but **could not verify the lit state visually** — the public embeds
are view-only and clicking a wire does not select it. The mechanism above is from
shipped source, so I am confident in it; I simply never saw it on screen.

`selectMargin = 2` (**[observed]**) alongside the 4.5-wide invisible `wire-segment` hit
band is how generous the click target is.

## 8. Grid snapping

**Wire endpoints snap to pins/holes. Bend points appear not to snap to the grid.**

**[observed]** In the LDR design, all coordinates share the fractional part
`.69176882662` (x) and `.065564798599` (y) — an artefact of where the parts were
dropped, not of any grid. The horizontal distance between the two bend vertices of one
wire is 134.0 units — **13.4 pitches, not a whole number**. If bends snapped to a 10-unit
grid that value would be impossible.

**[inferred]** Bend vertices in the samples land at `(start.x, end.y)`, i.e. they
inherit their coordinates from the *pins*, which are themselves on each part's own
0.1 in grid. Two parts placed at arbitrary offsets therefore have grids out of phase
with each other, which is exactly what the 134.0 shows. So bends are constrained to
their neighbours' coordinates, not to a global grid.

**Not determined:** whether dragging a bend handle applies any snapping at all. I could
not drag one (read-only embeds).

---

## What a real jumper wire looks like

Worth stating because Tinkercad made a deliberate choice here, and our renderer made
the opposite one.

Real breadboard wiring comes in two flavours:

- **Stiff solid-core hookup wire**, cut to length and bent by hand. It holds whatever
  shape you bend it into — flat against the board, square corners, hugging the
  surface. This is what a tidy lab bench or a textbook breadboard photo looks like.
- **Flexible stranded jumpers** with moulded Dupont ends. These *do* drape and loop in
  slack arcs, because nothing holds them down.

**Tinkercad models the stiff solid-core wire**, and its `normal` type has no drape at
all — straight runs, crisp fillets, flat on the board. That is a deliberate legibility
decision: a schematic you can read beats a photograph you can't. The blog post frames
the default wire as "a tidy and colorful way to represent your circuit design", with
the flexible/alligator options added later purely as a stylistic alternative.

The implication for us: **a slack, drooping wire is not "more realistic" — it is a
different kind of wire, and the wrong one for the default.**

---

## Implementation spec for our renderer

Our `PITCH` is already `10`, identical to Tinkercad's, so **every constant below
transfers 1:1 into our world units** with no scaling.

Items marked ✅ already landed in the tree during this research (see "What our current
renderer does wrong"); the rest are outstanding.

### Constants

```ts
const WIRE_CORE       = 1.8   // ✅ landed
const WIRE_CASING     = 2.5   // ✅ landed
const CORNER_RADIUS   = 10    // ✅ landed as BEND_RADIUS = PITCH
const WIRE_HIT        = 4.5   // outstanding — currently 9
const WIRE_HALO       = 5     // outstanding — no halo exists yet
const WIRE_HALO_COLOR = '#3b8ed7'
const WIRE_HALO_OPACITY = 0.5
```

### Colour set

Replace the six ad-hoc hexes in `WIRE_COLORS` with the ColorMap, keeping core and
casing as an authored pair rather than deriving one from the other:

```ts
export const WIRE_COLORS = {
  black:     ['#3C4042', '#171919'],
  red:       ['#EC2222', '#C11F1F'],
  orange:    ['#F78300', '#CC6600'],
  yellow:    ['#FFDF01', '#CCAE02'],
  green:     ['#40B942', '#369936'],
  turquoise: ['#71cedc', '#58a1a8'],
  blue:      ['#009ed9', '#007ea5'],
  purple:    ['#7f3b9a', '#522866'],
  pink:      ['#d9288c', '#a52073'],
  brown:     ['#aa7b4c', '#755335'],
  grey:      ['#999ea1', '#63696b'],
  white:     ['#ffffff', '#b8b8b8'],
} as const

export const DEFAULT_WIRE_COLOR = 'green'
```

This deletes `shade()` and its cache entirely — the casing is looked up, not computed.
Our `shade()` multiplies by 0.55, which is far darker than Tinkercad's hand-picked
casings (e.g. red `#EC2222` → ours `#821212`, Tinkercad's `#C11F1F`).

### Path construction

✅ **This has landed** as `filletPath()` / `fillet()` in `lib/simulator/model/wire-path.ts`,
and the implementation there is equivalent to the reference below. Kept here as the
specification of record — use it to check the shipped code, not to replace it.

The reference algorithm, replacing the old `wirePath()` / `droopPath()` / `splinePath()`:

```ts
/**
 * Straight polyline through [a, ...waypoints, b], with a circular arc fillet
 * of radius CORNER_RADIUS at each interior vertex.
 *
 * This is Tinkercad's geometry: no spline, no sag. A wire with no waypoints
 * is a single straight line, diagonal included.
 */
export function wirePath(a: Point, b: Point, waypoints?: Point[]): string {
  const pts = [a, ...(waypoints ?? []), b]
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const v = pts[i]
    const next = pts[i + 1]

    const inLen = Math.hypot(v.x - prev.x, v.y - prev.y)
    const outLen = Math.hypot(next.x - v.x, next.y - v.y)
    if (inLen < 1e-6 || outLen < 1e-6) continue

    // Unit vectors INTO and OUT OF the vertex.
    const ix = (v.x - prev.x) / inLen,  iy = (v.y - prev.y) / inLen
    const ox = (next.x - v.x) / outLen, oy = (next.y - v.y) / outLen

    const cross = ix * oy - iy * ox
    const dot = ix * ox + iy * oy
    // Collinear (straight through, or a doubled-back spike): no fillet.
    if (Math.abs(cross) < 1e-6) { d += ` L ${f(v.x)} ${f(v.y)}`; continue }

    // Turn angle, and the tangent length that gives radius r.
    const theta = Math.atan2(Math.abs(cross), dot)      // 0..PI
    let t = CORNER_RADIUS * Math.tan(theta / 2)
    // Never eat more than half of either adjacent segment, and never exceed
    // Tinkercad's maxDistanceFromVertexToCurve.
    t = Math.min(t, CORNER_RADIUS, inLen / 2, outLen / 2)
    const r = t / Math.tan(theta / 2)

    const sx = v.x - ix * t, sy = v.y - iy * t          // arc start
    const ex = v.x + ox * t, ey = v.y + oy * t          // arc end
    const sweep = cross > 0 ? 1 : 0                     // SVG y-down

    d += ` L ${f(sx)} ${f(sy)} A ${f(r)} ${f(r)} 0 0 ${sweep} ${f(ex)} ${f(ey)}`
  }

  const last = pts[pts.length - 1]
  return d + ` L ${f(last.x)} ${f(last.y)}`
}
```

The `sweep = cross > 0 ? 1 : 0` rule is **[observed]-verified against all four real
corners** I extracted (down→right and right→up both gave sweep 0; down→left and up→right
both gave sweep 1). The SVG x-axis-rotation is emitted as `0`; Tinkercad emits ±45/135
there, but for `rx === ry` it is ignored by every renderer.

For a 90° corner this reduces exactly to Tinkercad's output: `theta = π/2`,
`tan(π/4) = 1`, so `t = 10` and `r = 10` → `A 10 10 0 0 s …`.

### Stroke layers

Four `<path>` elements sharing one `d`, in this order:

```tsx
{/* 1. hover/selection halo — under everything */}
<path d={d} fill="none" stroke="#3b8ed7" strokeWidth={5}
      strokeLinecap="round" strokeLinejoin="round"
      opacity={hover || selected ? 0.5 : 0} pointerEvents="none" />
{/* 2. casing */}
<path d={d} fill="none" stroke={casing} strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
{/* 3. core */}
<path d={d} fill="none" stroke={core} strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
{/* 4. hit band */}
<path d={d} fill="none" stroke="transparent" strokeWidth={4.5}
      strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" />
```

`fill="none"` on the hit band must stay — it is already correct in our code and the
reason is still valid.

---

## What our current renderer does wrong

**Important:** the working tree changed *while this research was running*. When I first
read `components/simulator/CircuitCanvas.tsx` it still used the Catmull-Rom spline and
the droop curve. By the time I finished, a new `lib/simulator/model/wire-path.ts` had
appeared implementing arc fillets, and `CircuitCanvas.tsx` had been rewired to it. The
sections below are split accordingly.

### Already fixed (landed concurrently — and it agrees with this research)

Worth recording, because it was derived independently and lands on the same numbers:

- `droopPath()` and `splinePath()` are **gone**. `wirePath()` now delegates to
  `filletPath()` in `lib/simulator/model/wire-path.ts`, which walks the polyline and
  emits `L … A r r 0 0 sweep …` per corner — the correct family.
- `BEND_RADIUS = PITCH` (= 10). **Matches Tinkercad's `maxDistanceFromVertexToCurve = 10`
  exactly.**
- `WIRE_CORE = 1.8`, `WIRE_CASING = 2.5`. **Match `drawBendableWire` exactly.**
- Round `strokeLinecap` and `strokeLinejoin` on both layers. Correct.
- It emits `0` for the SVG x-axis-rotation with a comment noting Tinkercad emits 45.
  Correct — the value is ignored when `rx === ry`.
- `MAX_TRIM = 0.5` (a corner may eat at most half of the shorter adjoining segment) is
  the same clamp I inferred. Still **[inferred]** on both sides — neither of us observed
  Tinkercad's actual short-segment behaviour.

Only the geometry and stroke widths were fixed. The colour and interaction layers were
not, and those are what remain.

### Still wrong

1. **The colour set is not Tinkercad's.** `WIRE_COLORS` in
   `lib/simulator/model/document.ts:58` is still six ad-hoc hexes
   (`#e04a4a`, `#111827`, `#2f7d32`, `#2563eb`, `#eab308`, `#7c3aed`). Tinkercad ships
   **twelve named** colours. Replace with the table in §5.

2. **The casing colour is still computed, not authored.** `shade()`
   (`CircuitCanvas.tsx:510`) multiplies each channel by 0.55. Tinkercad hand-picks the
   casing per colour, and it sits much closer in value to the core — a keyline, not a
   shadow. Compare red: ours yields `#821212`, Tinkercad ships `#C11F1F`. Now that the
   widths are right (2.5 over 1.8, a 0.35-unit rim), an over-dark casing is the most
   visible remaining error. Delete `shade()` and look the pair up.

3. **Colour is assigned by creation order.** `WIRE_COLORS[doc.wires.length % 6]`
   (`CircuitCanvas.tsx:269`) means a wire's colour depends on how many wires already
   exist, so every design ends up rainbow-striped and colour carries no meaning.
   Tinkercad uses the **last colour the user picked** (`editorModel.newWireColor`),
   defaulting to **green**.

4. **No hover/selection halo, and `lit` restyles the wire.** The `lit` path swaps the
   core to `ACCENT` (blue) and thickens it to `WIRE_CORE_LIT`/`WIRE_CASING_LIT` — it
   *replaces the wire's own colour* at the exact moment the user is trying to trace it.
   Tinkercad never changes the wire's colour: it adds `#3b8ed7` at width 5, opacity 0.5,
   **underneath** the casing, for both hover and selection. Adopt the halo; keep the
   core colour fixed.

5. **The hit band is twice Tinkercad's.** `WIRE_HIT = 9` vs 4.5 (plus their
   `selectMargin = 2`). The in-repo comment defends this — "1.8 units is not a target" —
   and that is a fair argument. But at 9 units a wire grabs clicks 4.5 units away on
   both sides, which on a 10-unit pitch means it overlaps the neighbouring row. Worth
   reconsidering at ~5–6.

6. **Click-to-delete on the wire body.** `endGesture()` (`CircuitCanvas.tsx:220`)
   dispatches `removeWire` on a click that didn't drag. Tinkercad *selects* on click;
   deletion is separate and deliberate. A data-loss footgun rather than a rendering
   fault, but it lives in the same code path.

7. **Waypoint handles don't support corner modes.** Tinkercad's handles respond to
   **double-click by cycling sharp / rounded / smooth**
   (`HandleModel.doubleClickAction`). Ours double-click to delete. Optional — but it is
   why Tinkercad corners sometimes look different from one another.

---

## Could not determine

- **Whether a new wire auto-creates an elbow bend.** Two sampled L-wires had their
  vertex at `(start.x, end.y)`, which looks auto-generated; two other wires in the same
  design had no bend at all. I could not create a wire to test (read-only inspection).
- **Whether dragging a bend handle snaps.** Bend coordinates in finished designs are not
  on any global grid, but that does not rule out snapping relative to a neighbour.
- **The fillet clamp on short segments.** The `min(…, inLen/2, outLen/2)` in my
  implementation is a safe inference, not an observation; I found no corner tight enough
  to force the clamp.
- **What `ColorMap[…][2]` is for.** Not referenced by `drawBendableWire`. Probably the
  hookup/alligator connector shading.
- **The lit selection state on screen.** The halo elements are in the DOM at
  `opacity="0"`; the public embeds are view-only so I never saw one at 0.5. The
  behaviour is taken from shipped source.
- **A canonical "100% zoom" px figure.** The 1.345 scale I measured is an embed's
  auto-fit, not a defined zoom level. Use the pitch-relative ratios instead.
- **The exact geometry of `hookup` and `alligator` end connectors.** Both designs I could
  load used `normal` wires only; I have the blog screenshot but not the art.

---

## Sources

- [New Wire Options in Tinkercad Circuits](https://www.tinkercad.com/blog/new-wire-options-in-tinkercad-circuits) — Tinkercad blog, Donald Bell, 31 Mar 2021. Wire types and the properties-panel screenshot.
- [Wiring Components](https://www.tinkercad.com/learn/overview/OLORCO6L20FZRZ7?type=circuits) — Tinkercad Learn.
- `https://editor.tinkercad.com/assets_cc_3g62bj1/js/circuits-compiled.js` — Tinkercad's shipped Circuits bundle. `drawBendableWire`, `BendableWireData`, `BreadboardWire.ColorMap`, `BreadboardWire.prototype.draw`, `setHighlight`, `HandleModel.doubleClickAction`, `PathPointMode`.
- Live DOM of public designs [`iJzitNsx5VT`](https://www.tinkercad.com/embed/iJzitNsx5VT?editbtn=1), [`jv6YGxWk6oA`](https://www.tinkercad.com/embed/jv6YGxWk6oA?editbtn=1), [`2EnyfUfdui7`](https://www.tinkercad.com/embed/2EnyfUfdui7?editbtn=1).
- [How to Change Wire Color in Tinkercad](https://www.canadacad.ca/how-to-change-wire-color-in-tinkercad/), [How to Bend Wire in Tinkercad](https://www.canadacad.ca/how-to-bend-wire-in-tinkercad/) — CanadaCAD, corroborating the fixed palette and bend workflow.
