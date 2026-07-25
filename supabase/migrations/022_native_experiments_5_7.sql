-- =============================================================================
-- 022_native_experiments_5_7.sql
--
-- The first RASPBERRY PI experiments to go native. Migrations 020 and 021 moved
-- the five Arduino ones; everything left was blocked either on a missing device
-- model or on there being no second emulator at all. The second emulator now
-- exists — rp2040js running a prebuilt MicroPython, driving the same analog
-- solver the AVR track uses (lib/simulator/pico/) — so two more experiments
-- qualify:
--
--   * led-button-rpi   Pico + breadboard + LED + 220 Ω + push button + 10 kΩ
--   * dht11-rpi        Pico + breadboard + DHT11 + 10 kΩ
--
-- Still blocked, and still on their `builtin` widgets: experiment 11 (Arduino
-- Mega, no emulator), and experiments 8, 9, 10, 12 (DS18B20, L298N/ULN2003,
-- networking and a multi-sensor dashboard — device models that do not exist
-- yet). This migration moves the two whose hardware really runs and invents
-- nothing.
--
-- NOTE ON `board`, AND IT IS NOT COSMETIC: migration 015 created
-- circuits.board with `check (board in ('arduino_uno','arduino_nano','rp2040'))`
-- long before a Pico part existed, so the value here MUST be 'rp2040'. The
-- string 'raspberry_pi_pico' — which is what the part type and the palette call
-- it — is rejected outright by that constraint. The mapping is recorded in code
-- as BOARDS[…].dbBoard in lib/simulator/model/boards.ts rather than left for a
-- migration author to guess, and lib/simulator/__tests__/pico.test.ts group J
-- checks it against the text of migration 015.
--
-- The graphs below are the SAME documents as EXPERIMENT_STARTERS in
-- lib/simulator/model/examples.ts. lib/simulator/__tests__/starters.test.ts
-- parses this file and asserts the two copies are structurally identical, so
-- they cannot drift apart silently.
--
-- Idempotent, exactly as 020 and 021: re-running refreshes the starter graph in
-- place and leaves an already-native simulation alone. Nothing is deleted, and
-- `config` is left untouched (it still carries the old `sim_type`), so reverting
-- an experiment is a one-line update back to 'builtin'.
-- =============================================================================

begin;

-- ═══ Experiment 05 — LED & Push Button Interfacing with Raspberry Pi ═══
--
-- Pre-wired: the supply only. The Pico's 3V3(OUT) and GND reach the board's top
-- rails, and the top rails are bridged to the bottom pair. Every signal wire the
-- lab sheet asks about — GP17 → 220 Ω → LED → GND, and GP27 → button → 10 kΩ →
-- 3V3 — is the student's to make.
--
-- The rail is 3.3 V, not 5 V, and the pin id is '3.3V' rather than '5V' (a
-- Pico's '5V' pad is VBUS — USB power passed straight through, not the logic
-- rail). 220 Ω is nonetheless the correct series resistor here, because the
-- published content targets a Raspberry Pi SBC, which is also a 3.3 V part: the
-- values port across unchanged. What does NOT port across is the current —
-- ~5.2 mA here against ~12.4 mA for the same parts on an Uno.
do $mig$
declare
  v_slug  text := 'led-button-rpi';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter led-button-rpi
  v_graph jsonb := $graph${
  "parts": [
    { "id": "pico", "type": "raspberry_pi_pico", "x": 40,  "y": 20,  "rotation": 0, "props": {} },
    { "id": "bb",   "type": "breadboard",        "x": 40,  "y": 260, "rotation": 0, "props": {} },
    { "id": "r220", "type": "resistor",          "x": 60,  "y": 490, "rotation": 0, "props": { "ohms": 220 } },
    { "id": "r10k", "type": "resistor",          "x": 170, "y": 490, "rotation": 0, "props": { "ohms": 10000 } },
    { "id": "led",  "type": "led",               "x": 280, "y": 470, "rotation": 0, "props": {} },
    { "id": "btn",  "type": "push_button",       "x": 370, "y": 470, "rotation": 0, "props": { "pressed": 0 } }
  ],
  "wires": [
    { "id": "pw_3v3",       "from": { "partId": "pico", "pinId": "3.3V" },  "to": { "partId": "bb", "pinId": "tp2" },  "color": "#e04a4a" },
    { "id": "pw_gnd",       "from": { "partId": "pico", "pinId": "GND.7" }, "to": { "partId": "bb", "pinId": "tn2" },  "color": "#111827" },
    { "id": "pw_bridge_p",  "from": { "partId": "bb",   "pinId": "tp29" },  "to": { "partId": "bb", "pinId": "bp29" }, "color": "#e04a4a" },
    { "id": "pw_bridge_n",  "from": { "partId": "bb",   "pinId": "tn29" },  "to": { "partId": "bb", "pinId": "bn29" }, "color": "#111827" }
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
  values (v_sim, 'starter', 1, 'rp2040', 'free', v_graph)
  on conflict (simulation_id, role, version) do update
    set graph             = excluded.graph,
        board             = excluded.board,
        interaction_level = excluded.interaction_level;

  update simulations set type = 'native' where id = v_sim and type is distinct from 'native';

  raise notice 'native: % -> simulation %', v_slug, v_sim;
end $mig$;

-- ═══ Experiment 07 — DHT11 Temperature & Humidity with Raspberry Pi ═══
--
-- Same pre-wiring rule. Open: DHT11 VCC/GND to the rails, DATA to GP4, and the
-- 10 kΩ from DATA up to 3V3. The pull-up is not optional and not decorative —
-- the DHT11 is open-drain and MicroPython's `dht` driver puts GP4 in open-drain
-- mode too, so with nothing pulling the line up the read times out.
--
-- The bill of materials does not list a breadboard; one ships anyway, for the
-- same two reasons as experiment 04 — the pull-up needs a tie point where DATA
-- and GP4 already meet, and pre-wired rails are the convention every other
-- starter opens with.
do $mig$
declare
  v_slug  text := 'dht11-rpi';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter dht11-rpi
  v_graph jsonb := $graph${
  "parts": [
    { "id": "pico", "type": "raspberry_pi_pico", "x": 40,  "y": 20,  "rotation": 0, "props": {} },
    { "id": "bb",   "type": "breadboard",        "x": 40,  "y": 260, "rotation": 0, "props": {} },
    { "id": "dht",  "type": "dht11",             "x": 60,  "y": 470, "rotation": 0, "props": { "temperature": 24, "humidity": 45 } },
    { "id": "r10k", "type": "resistor",          "x": 150, "y": 490, "rotation": 0, "props": { "ohms": 10000 } }
  ],
  "wires": [
    { "id": "pw_3v3",       "from": { "partId": "pico", "pinId": "3.3V" },  "to": { "partId": "bb", "pinId": "tp2" },  "color": "#e04a4a" },
    { "id": "pw_gnd",       "from": { "partId": "pico", "pinId": "GND.7" }, "to": { "partId": "bb", "pinId": "tn2" },  "color": "#111827" },
    { "id": "pw_bridge_p",  "from": { "partId": "bb",   "pinId": "tp29" },  "to": { "partId": "bb", "pinId": "bp29" }, "color": "#e04a4a" },
    { "id": "pw_bridge_n",  "from": { "partId": "bb",   "pinId": "tn29" },  "to": { "partId": "bb", "pinId": "bn29" }, "color": "#111827" }
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
  values (v_sim, 'starter', 1, 'rp2040', 'free', v_graph)
  on conflict (simulation_id, role, version) do update
    set graph             = excluded.graph,
        board             = excluded.board,
        interaction_level = excluded.interaction_level;

  update simulations set type = 'native' where id = v_sim and type is distinct from 'native';

  raise notice 'native: % -> simulation %', v_slug, v_sim;
end $mig$;

-- ═══ Content corrections ═════════════════════════════════════════════════════
--
-- Two statements in the published text are false against the circuit the student
-- now runs. Both are corrected by REPLACING ONE ARRAY ELEMENT, matched by its
-- exact current wording, so re-running the migration is a no-op and a later
-- hand-edit is never clobbered.
--
-- WHAT WAS CHECKED AND FOUND ALREADY CORRECT, recorded so the next person does
-- not go looking: experiment 05's `circuit` section reads "Button Pin 2 →
-- 3.3V (Pin 1) via 10kΩ", which AGREES with the code's PUD_DOWN / `== HIGH`
-- pair. An earlier note claimed that section said "GND (common)"; it does not,
-- in this database. The contradiction is one section further on, in `procedure`.

-- ─── Experiment 05, procedure step: the button must SOURCE 3.3 V ───
--
-- The step said to wire the button between GPIO27 and GND while the code sets
-- an internal PULL_DOWN and tests for HIGH. Those cannot both hold: with a
-- pull-down on the pin and the other contact at GND, the input reads LOW whether
-- or not the button is pressed and the LED never toggles. The code and the
-- circuit diagram agree with each other, so this step is what moves.
do $mig$
declare
  v_exp   uuid;
  v_sec   uuid;
  v_steps jsonb;
  v_i     int;
  v_old   text := 'Connect button between GPIO27 and GND (use PUD_DOWN resistor in code).';
  v_new   text := 'Connect button pin 1 to GPIO27 and pin 2 to 3.3V through the 10kΩ. The code enables an internal PUD_DOWN, so the switch must SOURCE 3.3V — wired to GND the pin reads LOW whether or not it is pressed.';
begin
  select id into v_exp from experiments where slug = 'led-button-rpi';
  if v_exp is null then
    raise notice 'skipping led-button-rpi procedure fix: experiment not present';
    return;
  end if;

  select es.id, es.content -> 'steps'
    into v_sec, v_steps
    from experiment_sections es
   where es.experiment_id = v_exp and es.type = 'procedure' and es.status = 'active'
   order by es.order_index
   limit 1;

  if v_sec is null or jsonb_typeof(v_steps) is distinct from 'array' then
    raise notice 'skipping led-button-rpi procedure fix: no active procedure step list';
    return;
  end if;

  select ord - 1 into v_i
    from jsonb_array_elements_text(v_steps) with ordinality as t(step, ord)
   where t.step = v_old
   limit 1;

  if v_i is null then
    raise notice 'led-button-rpi procedure step already corrected (or reworded) — left alone';
  else
    update experiment_sections
       set content = jsonb_set(content, array['steps', v_i::text], to_jsonb(v_new))
     where id = v_sec;
    raise notice 'led-button-rpi: procedure step % corrected', v_i;
  end if;
end $mig$;

-- ─── Experiment 07, procedure steps: no pip, and no CSV file ───
--
-- Two capabilities the simulated board does not have, stated rather than faked:
--
--   * there is nothing to `pip3 install`. The board runs MicroPython, whose
--     `dht` module is FROZEN INTO the firmware image; Adafruit_DHT is a CPython
--     library for a Raspberry Pi SBC and has no meaning here.
--   * the CSV log cannot be written. rp2040js does not implement the SSI
--     peripheral, so the emulated flash is read-only — an `open(..., "a")` in
--     the student's script fails. The readings are printed instead.
do $mig$
declare
  v_exp   uuid;
  v_sec   uuid;
  v_steps jsonb;
  v_i     int;
  v_fix   text[][] := array[
    ['Install the library: pip3 install Adafruit_DHT',
     'No library to install: MicroPython''s dht module is frozen into the Pico''s firmware. (On a Raspberry Pi SBC running CPython you would instead run: pip3 install Adafruit_DHT.)'],
    ['Check dht_log.csv for logged data.',
     'Read the values in the console output. The simulated Pico''s flash is read-only, so no dht_log.csv is written — on real hardware the same script can append to a file.']
  ];
  v_pair  text[];
begin
  select id into v_exp from experiments where slug = 'dht11-rpi';
  if v_exp is null then
    raise notice 'skipping dht11-rpi procedure fix: experiment not present';
    return;
  end if;

  select es.id into v_sec
    from experiment_sections es
   where es.experiment_id = v_exp and es.type = 'procedure' and es.status = 'active'
   order by es.order_index
   limit 1;

  if v_sec is null then
    raise notice 'skipping dht11-rpi procedure fix: no active procedure section';
    return;
  end if;

  foreach v_pair slice 1 in array v_fix loop
    select content -> 'steps' into v_steps from experiment_sections where id = v_sec;
    if jsonb_typeof(v_steps) is distinct from 'array' then
      raise notice 'skipping dht11-rpi procedure fix: steps is not an array';
      return;
    end if;

    v_i := null;
    select ord - 1 into v_i
      from jsonb_array_elements_text(v_steps) with ordinality as t(step, ord)
     where t.step = v_pair[1]
     limit 1;

    if v_i is null then
      raise notice 'dht11-rpi step "%" already corrected (or reworded) — left alone', v_pair[1];
    else
      update experiment_sections
         set content = jsonb_set(content, array['steps', v_i::text], to_jsonb(v_pair[2]))
       where id = v_sec;
      raise notice 'dht11-rpi: procedure step % corrected', v_i;
    end if;
  end loop;
end $mig$;

commit;
