-- =============================================================================
-- 020_native_experiments.sql
--
-- Moves the experiments the native simulator can ALREADY build onto the native
-- circuit editor, and gives each one its own starter document.
--
-- Two experiments qualify today, and only two. The rule is that every part the
-- lab sheet asks for must have a REAL model in lib/simulator/model/parts.ts —
-- resistor, led, push_button, potentiometer, photoresistor, diode, dht11,
-- capacitor, arduino_uno, breadboard:
--
--   * led-dht11-arduino    Uno + breadboard + LED + 220 Ω + DHT11 + 10 kΩ
--   * traffic-light-arduino  Uno + breadboard + 3 LEDs + 3 × 220 Ω + button
--
-- The other ten are blocked on models this migration must not invent: HC-SR04
-- and PIR (exp 2, 6), a YF-S201 flow sensor (exp 4), an Arduino Mega (exp 11),
-- and a Raspberry Pi board (exp 5, 7, 8, 9, 10, 12). They keep their `builtin`
-- widgets, which migration 016 installed and which stay as the fallback until
-- every experiment has migrated.
--
-- The graphs below are the SAME documents as EXPERIMENT_STARTERS in
-- lib/simulator/model/examples.ts. lib/simulator/__tests__/starters.test.ts
-- parses this file and asserts the two copies are byte-identical, so they
-- cannot drift apart silently.
--
-- Idempotent. Re-running refreshes the starter graph in place and leaves an
-- already-native simulation alone. Nothing is deleted, and `config` is left
-- untouched (it still carries the old `sim_type`), so reverting an experiment
-- is a one-line update back to 'builtin'.
--
-- NOTE ON `board`: migration 015 constrains circuits.board to
-- ('arduino_uno', 'arduino_nano', 'rp2040'). It is 'arduino_uno' here, not
-- 'uno' — 'uno' violates the check constraint.
-- =============================================================================

begin;

-- ═══ Experiment 01 — LED & DHT11 Temperature/Humidity Sensor Interfacing ═══
--
-- Pre-wired: the supply only. Uno 5V and GND reach the board's top rails, and
-- the top rails are bridged to the bottom pair. Every signal wire the lab sheet
-- asks about — DHT11 VCC/GND/DATA, the 10 kΩ pull-up, D13 → 220 Ω → LED → GND —
-- is the student's to make.
do $mig$
declare
  v_slug  text := 'led-dht11-arduino';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter led-dht11-arduino
  v_graph jsonb := $graph${
  "parts": [
    { "id": "uno",  "type": "arduino_uno", "x": 40,  "y": 20,  "rotation": 0, "props": {} },
    { "id": "bb",   "type": "breadboard",  "x": 40,  "y": 260, "rotation": 0, "props": {} },
    { "id": "dht",  "type": "dht11",       "x": 60,  "y": 470, "rotation": 0, "props": { "temperature": 24, "humidity": 45 } },
    { "id": "r10k", "type": "resistor",    "x": 150, "y": 480, "rotation": 0, "props": { "ohms": 10000 } },
    { "id": "r220", "type": "resistor",    "x": 250, "y": 480, "rotation": 0, "props": { "ohms": 220 } },
    { "id": "led",  "type": "led",         "x": 350, "y": 460, "rotation": 0, "props": {} }
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

-- ═══ Experiment 03 — Traffic Light Simulator ═══
--
-- Same pre-wiring rule: supply plumbing done, every signal path open. The three
-- LED branches (D2/D3/D4 → 220 Ω → anode, cathodes to the ground rail) and the
-- optional D5 pedestrian button are the student's work.
do $mig$
declare
  v_slug  text := 'traffic-light-arduino';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter traffic-light-arduino
  v_graph jsonb := $graph${
  "parts": [
    { "id": "uno",        "type": "arduino_uno", "x": 40,  "y": 20,  "rotation": 0, "props": {} },
    { "id": "bb",         "type": "breadboard",  "x": 40,  "y": 260, "rotation": 0, "props": {} },
    { "id": "r_red",      "type": "resistor",    "x": 60,  "y": 480, "rotation": 0, "props": { "ohms": 220 } },
    { "id": "r_yellow",   "type": "resistor",    "x": 160, "y": 480, "rotation": 0, "props": { "ohms": 220 } },
    { "id": "r_green",    "type": "resistor",    "x": 260, "y": 480, "rotation": 0, "props": { "ohms": 220 } },
    { "id": "led_red",    "type": "led",         "x": 370, "y": 460, "rotation": 0, "props": {} },
    { "id": "led_yellow", "type": "led",         "x": 430, "y": 460, "rotation": 0, "props": {} },
    { "id": "led_green",  "type": "led",         "x": 490, "y": 460, "rotation": 0, "props": {} },
    { "id": "btn",        "type": "push_button", "x": 560, "y": 470, "rotation": 0, "props": { "pressed": 0 } }
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
