-- =============================================================================
-- 025_native_experiment_11.sql
--
-- Experiment 11 goes native, on an ARDUINO MEGA — the third board in the lab
-- and the first that needed a new chip rather than a new track.
--
-- WHAT WAS ACTUALLY BLOCKING IT, since "no Mega support" was never quite the
-- problem: avr8js runs an ATmega2560 core perfectly well (it decodes ELPM, a
-- 22-bit program counter, and its own cpu.ts says "MAX_INTERRUPTS = 128 //
-- Enough for ATMega2560"), and it already ships portA...portL at the 2560's
-- register addresses. What it does NOT ship is a single correct interrupt
-- vector: timer0 overflow is 0x20, the USART data-register-empty vector is
-- 0x26, the ADC is 0x2A. On an ATmega2560 those are 0x2E, 0x34 and 0x3A.
--
-- That mattered most for Serial. Arduino's HardwareSerial::write() does not
-- poll — it buffers the byte, sets UDRIE0, and lets the UDRE interrupt drain
-- it — so with a 328P vector table `Serial.print` produces nothing at all,
-- silently, forever. This experiment's published sketch is almost entirely
-- Serial.print. The vector map now lives in lib/simulator/avr/atmega2560.ts
-- with the datasheet table cited for every address, and
-- lib/simulator/__tests__/mega.test.ts proves it by running hand-assembled AVR
-- code twice: once with the ATmega2560 vectors (the whole string comes out)
-- and once with avr8js's stock 328P vectors (nothing comes out, and a sentinel
-- byte shows the interrupt landed on TIMER1 COMPARE C instead).
--
-- ── THIS MIGRATION WIDENS A CHECK CONSTRAINT ─────────────────────────────────
-- `circuits.board` was created in migration 015 with a CHECK admitting exactly
-- three values — arduino_uno, arduino_nano and rp2040 — which predates both the
-- Pico part and this one. (Deliberately not written here in constraint syntax:
-- tooling scans these files for the live constraint and must not find an
-- obsolete one in a comment.) An Arduino Mega row is
-- REJECTED OUTRIGHT by that constraint, so the insert below cannot happen until
-- it is widened. The change is purely ADDITIVE — the three existing values stay
-- valid and no existing row can be invalidated — but it is still a schema
-- change to a shipped table, and it is called out here rather than buried:
-- BOARDS[...].dbBoard in lib/simulator/model/boards.ts is the one place the
-- mapping lives, and pico.test.ts group J reads the migration directory in
-- order and checks every board profile against the LAST constraint it finds.
--
-- ── WHAT IS AND IS NOT SHIPPED ───────────────────────────────────────────────
-- The bill of materials lists a 16x2 LCD and four optional IR sensors. Neither
-- is shipped: there is no display part in the library, and the published sketch
-- uses neither — it prints its status to Serial and reads lane density from the
-- four potentiometers, which ARE shipped. Faking parts the program cannot
-- observe would be furniture.
--
-- The sketch drives twelve LEDs with digitalWrite and reads four pots with
-- analogRead. It uses no PWM, so timers 3, 4 and 5 are not on its critical
-- path; they are emulated anyway (see avr/atmega2560.ts) so that analogWrite on
-- a Mega's pins 2-13 and 44-46 works for anyone who reaches for it.
--
-- The graph below is the SAME document as EXPERIMENT_STARTERS['smart-traffic-controller']
-- in lib/simulator/model/examples.ts; starters.test.ts parses this file and
-- asserts the two copies are structurally identical, so they cannot drift.
--
-- Idempotent, exactly as 020-023: re-running refreshes the starter graph in
-- place and leaves an already-native simulation alone. `config` is untouched,
-- so reverting the experiment is a one-line update back to 'builtin'.
-- =============================================================================

begin;

-- ═══ The board vocabulary ═══
--
-- Additive: the three values migration 015 allowed are all still allowed. The
-- constraint has to be dropped and re-added because 015 declared it inline in
-- `create table`, so there is no ALTER that can extend it in place.
alter table circuits drop constraint if exists circuits_board_check;
alter table circuits
  add constraint circuits_board_check
  check (board in ('arduino_uno', 'arduino_nano', 'rp2040', 'arduino_mega'));

-- ═══ Experiment 11 — Smart Traffic Light Controller ═══
--
-- Pre-wired: the supply only, as in every other starter. Open, and all the
-- student's: twelve LED chains (pin -> 220 Ohm -> anode, cathode to the ground
-- rail) on pins 22-33 in lane order, and four density pots across the rails
-- with their wipers on A0-A3.
--
-- WHY THE BOARD IS THE LESSON HERE: twelve digital outputs plus four analog
-- inputs is sixteen signals. An Uno has fourteen digital pins, two of which are
-- the serial port this sketch prints through. The Mega is the answer to a real
-- constraint, not a bigger board for its own sake.
do $mig$
declare
  v_slug  text := 'smart-traffic-controller';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter smart-traffic-controller
  v_graph jsonb := $graph${
  "parts": [
    {
      "id": "mega",
      "type": "arduino_mega",
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
      "id": "led1_red",
      "type": "led",
      "x": 40,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led1_yellow",
      "type": "led",
      "x": 88,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led1_green",
      "type": "led",
      "x": 136,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led2_red",
      "type": "led",
      "x": 184,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led2_yellow",
      "type": "led",
      "x": 232,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led2_green",
      "type": "led",
      "x": 280,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led3_red",
      "type": "led",
      "x": 328,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led3_yellow",
      "type": "led",
      "x": 376,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led3_green",
      "type": "led",
      "x": 424,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led4_red",
      "type": "led",
      "x": 472,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led4_yellow",
      "type": "led",
      "x": 520,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "led4_green",
      "type": "led",
      "x": 568,
      "y": 445,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "r1_red",
      "type": "resistor",
      "x": 40,
      "y": 512,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r1_yellow",
      "type": "resistor",
      "x": 108,
      "y": 512,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r1_green",
      "type": "resistor",
      "x": 176,
      "y": 512,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r2_red",
      "type": "resistor",
      "x": 244,
      "y": 512,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r2_yellow",
      "type": "resistor",
      "x": 312,
      "y": 512,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r2_green",
      "type": "resistor",
      "x": 380,
      "y": 512,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r3_red",
      "type": "resistor",
      "x": 40,
      "y": 545,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r3_yellow",
      "type": "resistor",
      "x": 108,
      "y": 545,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r3_green",
      "type": "resistor",
      "x": 176,
      "y": 545,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r4_red",
      "type": "resistor",
      "x": 244,
      "y": 545,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r4_yellow",
      "type": "resistor",
      "x": 312,
      "y": 545,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "r4_green",
      "type": "resistor",
      "x": 380,
      "y": 545,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "pot1",
      "type": "potentiometer",
      "x": 560,
      "y": 505,
      "rotation": 0,
      "props": {
        "position": 50
      }
    },
    {
      "id": "pot2",
      "type": "potentiometer",
      "x": 645,
      "y": 505,
      "rotation": 0,
      "props": {
        "position": 50
      }
    },
    {
      "id": "pot3",
      "type": "potentiometer",
      "x": 730,
      "y": 505,
      "rotation": 0,
      "props": {
        "position": 50
      }
    },
    {
      "id": "pot4",
      "type": "potentiometer",
      "x": 815,
      "y": 505,
      "rotation": 0,
      "props": {
        "position": 50
      }
    }
  ],
  "wires": [
    {
      "id": "pw_5v",
      "from": {
        "partId": "mega",
        "pinId": "5V"
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
        "partId": "mega",
        "pinId": "GND.2"
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
  values (v_sim, 'starter', 1, 'arduino_mega', 'free', v_graph)
  on conflict (simulation_id, role, version) do update
    set graph             = excluded.graph,
        board             = excluded.board,
        interaction_level = excluded.interaction_level;

  update simulations set type = 'native' where id = v_sim and type is distinct from 'native';

  raise notice 'native: % -> simulation %', v_slug, v_sim;
end $mig$;

commit;
