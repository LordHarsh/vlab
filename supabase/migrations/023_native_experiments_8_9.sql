-- =============================================================================
-- 023_native_experiments_8_9.sql
--
-- Experiments 8 and 9 go native. Both were blocked on device models that did
-- not exist: a DS18B20 speaking real Dallas 1-Wire (including SEARCH ROM, which
-- MicroPython's ds18x20.scan() requires), and the L298N / ULN2003 / 28BYJ-48
-- driver chain. Those models now exist and are tested against datasheet
-- behaviour, so both experiments can be built on the real solver.
--
-- Both run on the Pico track, so `board` MUST be 'rp2040' -- migration 015
-- constrains circuits.board to ('arduino_uno','arduino_nano','rp2040') and
-- rejects the part-type string 'raspberry_pi_pico' outright. See
-- BOARDS[...].dbBoard in lib/simulator/model/boards.ts.
--
-- The graphs below are the SAME documents as EXPERIMENT_STARTERS in
-- lib/simulator/model/examples.ts; starters.test.ts parses this file and
-- asserts the two copies are structurally identical, so they cannot drift.
--
-- Idempotent, exactly as 020-022: re-running refreshes the starter graph in
-- place and leaves an already-native simulation alone. `config` is untouched,
-- so reverting an experiment is a one-line update back to 'builtin'.
--
-- After this, only experiment 11 (Arduino Mega -- no emulator yet) and
-- experiments 10 and 12 remain on their builtin widgets.
-- =============================================================================

begin;

-- ═══ Experiment 08 — DS18B20 Temperature Sensor with Raspberry Pi ═══
--
-- Pre-wired: the supply only. Open, and all the student's: DS18B20 VDD/GND to
-- the rails, DQ to the data pin, and the 4.7 kOhm pull-up from DQ to 3V3.
--
-- The pull-up is load-bearing, not decorative. 1-Wire is open-drain: the device
-- only ever pulls the line low or lets go, so with nothing pulling it up the
-- bus never returns high and the master reads a permanent presence pulse.
-- MicroPython's onewire.scan() fails first, which is line one of the sketch.
do $mig$
declare
  v_slug  text := 'ds18b20-rpi';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter ds18b20-rpi
  v_graph jsonb := $graph${
  "parts": [
    {
      "id": "pico",
      "type": "raspberry_pi_pico",
      "x": 40,
      "y": 20,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "bb",
      "type": "breadboard",
      "x": 40,
      "y": 260,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "ds",
      "type": "ds18b20",
      "x": 60,
      "y": 470,
      "rotation": 0,
      "props": {
        "temperature": 25,
        "resolution": 12
      }
    },
    {
      "id": "r4k7",
      "type": "resistor",
      "x": 150,
      "y": 490,
      "rotation": 0,
      "props": {
        "ohms": 4700
      }
    }
  ],
  "wires": [
    {
      "id": "pw_3v3",
      "from": {
        "partId": "pico",
        "pinId": "3.3V"
      },
      "to": {
        "partId": "bb",
        "pinId": "tp2"
      },
      "color": "#e04a4a"
    },
    {
      "id": "pw_gnd",
      "from": {
        "partId": "pico",
        "pinId": "GND.7"
      },
      "to": {
        "partId": "bb",
        "pinId": "tn2"
      },
      "color": "#111827"
    },
    {
      "id": "pw_bridge_p",
      "from": {
        "partId": "bb",
        "pinId": "tp29"
      },
      "to": {
        "partId": "bb",
        "pinId": "bp29"
      },
      "color": "#e04a4a"
    },
    {
      "id": "pw_bridge_n",
      "from": {
        "partId": "bb",
        "pinId": "tn29"
      },
      "to": {
        "partId": "bb",
        "pinId": "bn29"
      },
      "color": "#111827"
    }
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

-- ═══ Experiment 09 — DC & Stepper Motor Control with Raspberry Pi ═══
--
-- The largest starter so far: two motors and two driver ICs. Pre-wired: the
-- supply only. Open: every logic input (L298N IN1/IN2/ENA, ULN2003 IN1-IN4),
-- the L298N's OUT1/OUT2 to the DC motor, and the ULN2003's outputs to the
-- stepper's four phase leads plus its COM tap.
--
-- Two things the student is meant to discover here, both real and both modelled:
-- the L298N eats roughly 2.5 V in saturation, so the motor never sees the full
-- supply; and the 28BYJ-48's coils must be energised in the correct ring
-- sequence -- an off-ring pattern (opposing coils) produces no net field and the
-- shaft does not move.
do $mig$
declare
  v_slug  text := 'motor-control-rpi';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter motor-control-rpi
  v_graph jsonb := $graph${
  "parts": [
    {
      "id": "pico",
      "type": "raspberry_pi_pico",
      "x": 40,
      "y": 20,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "bb",
      "type": "breadboard",
      "x": 40,
      "y": 260,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "l298n",
      "type": "l298n",
      "x": 60,
      "y": 470,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "motor",
      "type": "dc_motor",
      "x": 240,
      "y": 500,
      "rotation": 0,
      "props": {
        "load": 0
      }
    },
    {
      "id": "uln",
      "type": "uln2003",
      "x": 320,
      "y": 470,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "stepper",
      "type": "stepper_28byj48",
      "x": 430,
      "y": 470,
      "rotation": 0,
      "props": {}
    }
  ],
  "wires": [
    {
      "id": "pw_3v3",
      "from": {
        "partId": "pico",
        "pinId": "3.3V"
      },
      "to": {
        "partId": "bb",
        "pinId": "tp2"
      },
      "color": "#e04a4a"
    },
    {
      "id": "pw_gnd",
      "from": {
        "partId": "pico",
        "pinId": "GND.7"
      },
      "to": {
        "partId": "bb",
        "pinId": "tn2"
      },
      "color": "#111827"
    },
    {
      "id": "pw_bridge_p",
      "from": {
        "partId": "bb",
        "pinId": "tp29"
      },
      "to": {
        "partId": "bb",
        "pinId": "bp29"
      },
      "color": "#e04a4a"
    },
    {
      "id": "pw_bridge_n",
      "from": {
        "partId": "bb",
        "pinId": "tn29"
      },
      "to": {
        "partId": "bb",
        "pinId": "bn29"
      },
      "color": "#111827"
    }
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

commit;
