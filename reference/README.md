# Reference source of truth

`iot_virtual_lab.html` is the **original single-file lab** this project was built
from, kept here verbatim. On the owner's instruction it is the source of truth
for every experiment's content: title, platform, aim, theory, components,
**connections**, code, procedure and quiz.

Nothing in this directory is imported, bundled, or served. It is checked in so
that the canonical data lives in version control rather than in someone's
Downloads folder, and so any future disagreement about what an experiment is
supposed to contain has one file to settle it.

## Why it is here

Our shipped data had already drifted from it, silently. Experiment 9 is the
clearest case:

| | `reference/iot_virtual_lab.html` | what we shipped |
|---|---|---|
| stepper motor | 28BYJ-48 + ULN2003 driver, wired `IN1-IN4 → GPIO17,27,22,5` | absent entirely |
| DC motor pins | `ENA→GPIO18, IN1→GPIO23, IN2→GPIO24` | `ENA→GP13, IN1→GP14, IN2→GP15` |
| sketch | steps the motor (`seq`, `step(512)`) | no stepper code at all |

A code comment in `components/static-simulator/circuits.ts` had justified
omitting the stepper on the grounds that "their sketch never steps it" — true
of the *ported* `components/static-simulator/utils/experimentData.ts`, which had
itself diverged from this file. The reasoning was sound; the input was not.
That is the failure mode this directory exists to prevent.

## Shape of the data

The experiments live in one array in the inline `<script>` (`const experiments =
[ ... ]`, around line 385). Each entry:

```js
{
  id, color, platform, title, tags,
  aim, theory,
  components: ['Arduino Uno', 'DHT11 Sensor', ...],
  connections: [['DHT11 VCC','Arduino 5V'], ['DHT11 DATA','Arduino D2'], ...],
  code: `...`,          // HTML, with <span class="kw|fn|str|num|cm|pp"> highlighting
  procedure: [...],
  quiz: [{q, opts, ans}, ...],
  simType,              // 'dht11' | 'ultrasonic' | 'traffic' | 'motor' | ...
}
```

`connections` is the canonical wiring — plain-English pin pairs, not coordinates.
Circuit drawings are a rendering *of* it and must agree with it.
