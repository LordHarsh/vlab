-- =============================================================================
-- 021_native_experiments_2_4_6.sql
--
-- Second wave of native experiments. Migration 020 could only move experiments
-- 1 and 3 because every other lab sheet asked for a part the model library did
-- not have. Three of those gaps are now closed — lib/simulator/model/parts.ts
-- carries real `hc_sr04`, `pir_motion` and `flow_sensor` models, plus a real
-- `buzzer` (BUZZER_5V, a ~167 Ω load with a maxVolts safety check) instead of
-- the old resistive stub — so three more experiments qualify:
--
--   * ultrasonic-pir-arduino  Uno + breadboard + HC-SR04 + PIR + LED + 220 Ω
--   * water-flow-arduino      Uno + breadboard + YF-S201 + 10 kΩ
--   * pir-alarm-arduino       Uno + breadboard + PIR + buzzer + 2 LEDs + 2 × 220 Ω
--
-- Still blocked, and still on their `builtin` widgets: experiment 11 (Arduino
-- Mega) and experiments 5, 7, 8, 9, 10, 12 (Raspberry Pi board). The owner's
-- decision is that all twelve become native; this migration moves the ones
-- whose device models actually exist and invents nothing.
--
-- The graphs below are the SAME documents as EXPERIMENT_STARTERS in
-- lib/simulator/model/examples.ts. lib/simulator/__tests__/starters.test.ts
-- parses this file and asserts the two copies are structurally identical, so
-- they cannot drift apart silently.
--
-- Idempotent, exactly as 020: re-running refreshes the starter graph in place
-- and leaves an already-native simulation alone. Nothing is deleted, and
-- `config` is left untouched (it still carries the old `sim_type`), so reverting
-- an experiment is a one-line update back to 'builtin'.
--
-- NOTE ON `board`: migration 015 constrains circuits.board to
-- ('arduino_uno', 'arduino_nano', 'rp2040'). It is 'arduino_uno' here, not
-- 'uno' — 'uno' violates the check constraint.
-- =============================================================================

begin;

-- ═══ Experiment 02 — Ultrasonic Sensor & PIR Sensor Interfacing ═══
--
-- Pre-wired: the supply only. Uno 5V and GND reach the board's top rails, and
-- the top rails are bridged to the bottom pair. Every signal wire the lab sheet
-- asks about — HC-SR04 VCC/GND/TRIG(D9)/ECHO(D10), PIR VCC/GND/OUT(D7), and
-- D13 → 220 Ω → LED → GND — is the student's to make. The sensors' OWN supply
-- pins are left open on purpose: the behavioural models refuse to answer on an
-- unpowered VCC, so "signal wired, power forgotten" stays a mistake the student
-- can make and diagnose.
do $mig$
declare
  v_slug  text := 'ultrasonic-pir-arduino';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter ultrasonic-pir-arduino
  v_graph jsonb := $graph${
  "parts": [
    { "id": "uno",    "type": "arduino_uno", "x": 40,  "y": 20,  "rotation": 0, "props": {} },
    { "id": "bb",     "type": "breadboard",  "x": 40,  "y": 260, "rotation": 0, "props": {} },
    { "id": "hcsr04", "type": "hc_sr04",     "x": 60,  "y": 470, "rotation": 0, "props": { "distance": 50 } },
    { "id": "pir",    "type": "pir_motion",  "x": 270, "y": 470, "rotation": 0, "props": { "motion": 0, "hold": 5, "warmup": 0 } },
    { "id": "r220",   "type": "resistor",    "x": 400, "y": 490, "rotation": 0, "props": { "ohms": 220 } },
    { "id": "led",    "type": "led",         "x": 500, "y": 470, "rotation": 0, "props": {} }
  ],
  "wires": [
    { "id": "pw_5v",        "from": { "partId": "uno", "pinId": "5V" },    "to": { "partId": "bb", "pinId": "tp2" },  "color": "#e04a4a" },
    { "id": "pw_gnd",       "from": { "partId": "uno", "pinId": "GND.2" }, "to": { "partId": "bb", "pinId": "tn2" },  "color": "#111827" },
    { "id": "pw_bridge_p",  "from": { "partId": "bb",  "pinId": "tp29" },  "to": { "partId": "bb", "pinId": "bp29" }, "color": "#e04a4a" },
    { "id": "pw_bridge_n",  "from": { "partId": "bb",  "pinId": "tn29" },  "to": { "partId": "bb", "pinId": "bn29" }, "color": "#111827" }
  ]
}$graph$::jsonb;
begin
  select id into v_exp from experiments where slug = v_slug;
  if v_exp is null then
    raise notice 'skipping %: experiment not present', v_slug;
    return;
  end if;

  -- Target the simulation the experiment's own simulation SECTION points at:
  -- that is the row the student route loads, so it is the row that must flip.
  -- Fall back to the experiment's first simulation for a section that was never
  -- linked. A hardcoded uuid is never used — ids differ per environment.
  select (es.content ->> 'simulation_id')::uuid
    into v_sim
    from experiment_sections es
   where es.experiment_id = v_exp
     and es.type = 'simulation'
     and es.status = 'active'
     and es.content ->> 'simulation_id' is not null
   order by es.order_index
   limit 1;

  if v_sim is null or not exists (select 1 from simulations where id = v_sim) then
    select id into v_sim from simulations
     where experiment_id = v_exp order by created_at limit 1;
  end if;

  if v_sim is null then
    raise notice 'skipping %: no simulation row to attach a circuit to', v_slug;
    return;
  end if;

  insert into circuits (simulation_id, role, version, board, interaction_level, graph)
  values (v_sim, 'starter', 1, 'arduino_uno', 'free', v_graph)
  on conflict (simulation_id, role, version) do update
    set graph             = excluded.graph,
        board             = excluded.board,
        interaction_level = excluded.interaction_level;

  update simulations set type = 'native' where id = v_sim and type is distinct from 'native';

  raise notice 'native: % -> simulation %', v_slug, v_sim;
end $mig$;

-- ═══ Experiment 04 — Water Flow Detection using Arduino ═══
--
-- Same pre-wiring rule: supply plumbing done, every signal path open. The
-- student wires YF-S201 VCC/GND to the rails and SIG into D2 (INT0 — the sketch
-- attaches a FALLING-edge interrupt, so no other pin will do) with the 10 kΩ
-- pull-up to +5 V.
--
-- The lab sheet's bill of materials does not list a breadboard; one ships here
-- anyway, because the pull-up needs a tie point where SIG and D2 already meet
-- and because pre-wired rails are the convention every other starter opens
-- with. A student who prefers header-to-header wiring can ignore it.
do $mig$
declare
  v_slug  text := 'water-flow-arduino';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter water-flow-arduino
  v_graph jsonb := $graph${
  "parts": [
    { "id": "uno",  "type": "arduino_uno", "x": 40,  "y": 20,  "rotation": 0, "props": {} },
    { "id": "bb",   "type": "breadboard",  "x": 40,  "y": 260, "rotation": 0, "props": {} },
    { "id": "flow", "type": "flow_sensor", "x": 60,  "y": 470, "rotation": 0, "props": { "flow": 10 } },
    { "id": "r10k", "type": "resistor",    "x": 170, "y": 490, "rotation": 0, "props": { "ohms": 10000 } }
  ],
  "wires": [
    { "id": "pw_5v",        "from": { "partId": "uno", "pinId": "5V" },    "to": { "partId": "bb", "pinId": "tp2" },  "color": "#e04a4a" },
    { "id": "pw_gnd",       "from": { "partId": "uno", "pinId": "GND.2" }, "to": { "partId": "bb", "pinId": "tn2" },  "color": "#111827" },
    { "id": "pw_bridge_p",  "from": { "partId": "bb",  "pinId": "tp29" },  "to": { "partId": "bb", "pinId": "bp29" }, "color": "#e04a4a" },
    { "id": "pw_bridge_n",  "from": { "partId": "bb",  "pinId": "tn29" },  "to": { "partId": "bb", "pinId": "bn29" }, "color": "#111827" }
  ]
}$graph$::jsonb;
begin
  select id into v_exp from experiments where slug = v_slug;
  if v_exp is null then
    raise notice 'skipping %: experiment not present', v_slug;
    return;
  end if;

  select (es.content ->> 'simulation_id')::uuid
    into v_sim
    from experiment_sections es
   where es.experiment_id = v_exp
     and es.type = 'simulation'
     and es.status = 'active'
     and es.content ->> 'simulation_id' is not null
   order by es.order_index
   limit 1;

  if v_sim is null or not exists (select 1 from simulations where id = v_sim) then
    select id into v_sim from simulations
     where experiment_id = v_exp order by created_at limit 1;
  end if;

  if v_sim is null then
    raise notice 'skipping %: no simulation row to attach a circuit to', v_slug;
    return;
  end if;

  insert into circuits (simulation_id, role, version, board, interaction_level, graph)
  values (v_sim, 'starter', 1, 'arduino_uno', 'free', v_graph)
  on conflict (simulation_id, role, version) do update
    set graph             = excluded.graph,
        board             = excluded.board,
        interaction_level = excluded.interaction_level;

  update simulations set type = 'native' where id = v_sim and type is distinct from 'native';

  raise notice 'native: % -> simulation %', v_slug, v_sim;
end $mig$;

-- ═══ Experiment 06 — Motion Sensor Alarm using PIR Sensor ═══
--
-- Same pre-wiring rule again. Open: PIR VCC/GND/OUT(D7), buzzer +(D8)/−(GND),
-- red LED on D12 and green LED on D11, each through its own 220 Ω.
--
-- `"passive": 0` is the ACTIVE buzzer the bill of materials calls for, and the
-- distinction is electrical, not cosmetic: an active buzzer is a resistive load
-- that sounds on a bare digitalWrite (which is all the sketch does), while a
-- passive one is a piezo — a capacitor, an open at DC — that would draw no
-- current here at all.
do $mig$
declare
  v_slug  text := 'pir-alarm-arduino';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter pir-alarm-arduino
  v_graph jsonb := $graph${
  "parts": [
    { "id": "uno",       "type": "arduino_uno", "x": 40,  "y": 20,  "rotation": 0, "props": {} },
    { "id": "bb",        "type": "breadboard",  "x": 40,  "y": 260, "rotation": 0, "props": {} },
    { "id": "pir",       "type": "pir_motion",  "x": 60,  "y": 470, "rotation": 0, "props": { "motion": 0, "hold": 5, "warmup": 0 } },
    { "id": "buzzer",    "type": "buzzer",      "x": 190, "y": 470, "rotation": 0, "props": { "passive": 0 } },
    { "id": "r_red",     "type": "resistor",    "x": 270, "y": 490, "rotation": 0, "props": { "ohms": 220 } },
    { "id": "r_green",   "type": "resistor",    "x": 370, "y": 490, "rotation": 0, "props": { "ohms": 220 } },
    { "id": "led_red",   "type": "led",         "x": 470, "y": 470, "rotation": 0, "props": {} },
    { "id": "led_green", "type": "led",         "x": 540, "y": 470, "rotation": 0, "props": {} }
  ],
  "wires": [
    { "id": "pw_5v",        "from": { "partId": "uno", "pinId": "5V" },    "to": { "partId": "bb", "pinId": "tp2" },  "color": "#e04a4a" },
    { "id": "pw_gnd",       "from": { "partId": "uno", "pinId": "GND.2" }, "to": { "partId": "bb", "pinId": "tn2" },  "color": "#111827" },
    { "id": "pw_bridge_p",  "from": { "partId": "bb",  "pinId": "tp29" },  "to": { "partId": "bb", "pinId": "bp29" }, "color": "#e04a4a" },
    { "id": "pw_bridge_n",  "from": { "partId": "bb",  "pinId": "tn29" },  "to": { "partId": "bb", "pinId": "bn29" }, "color": "#111827" }
  ]
}$graph$::jsonb;
begin
  select id into v_exp from experiments where slug = v_slug;
  if v_exp is null then
    raise notice 'skipping %: experiment not present', v_slug;
    return;
  end if;

  select (es.content ->> 'simulation_id')::uuid
    into v_sim
    from experiment_sections es
   where es.experiment_id = v_exp
     and es.type = 'simulation'
     and es.status = 'active'
     and es.content ->> 'simulation_id' is not null
   order by es.order_index
   limit 1;

  if v_sim is null or not exists (select 1 from simulations where id = v_sim) then
    select id into v_sim from simulations
     where experiment_id = v_exp order by created_at limit 1;
  end if;

  if v_sim is null then
    raise notice 'skipping %: no simulation row to attach a circuit to', v_slug;
    return;
  end if;

  insert into circuits (simulation_id, role, version, board, interaction_level, graph)
  values (v_sim, 'starter', 1, 'arduino_uno', 'free', v_graph)
  on conflict (simulation_id, role, version) do update
    set graph             = excluded.graph,
        board             = excluded.board,
        interaction_level = excluded.interaction_level;

  update simulations set type = 'native' where id = v_sim and type is distinct from 'native';

  raise notice 'native: % -> simulation %', v_slug, v_sim;
end $mig$;

commit;
