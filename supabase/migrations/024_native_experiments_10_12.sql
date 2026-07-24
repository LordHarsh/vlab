-- =============================================================================
-- 024_native_experiments_10_12.sql
--
-- Experiments 10 and 12 go native, which completes every experiment the Pico
-- track can run. Both were previously written off as impossible because
-- experiment 10's published program is a Flask web server and experiment 12's
-- posts to ThingSpeak, and MicroPython on an emulated RP2040 raises ImportError
-- for network, socket and urequests.
--
-- THAT WAS THE WRONG MEASURE. The canonical content
-- (iot_virtual_lab.html) does not simulate networking either — its experiment-10
-- widget PRINTS "GPIO17 (Light): HIGH — ON  | HTTP GET /toggle/Light" and its
-- experiment-12 widget PRINTS "... -> ThingSpeak updated". Tinkercad simulates no
-- networking on any board. So the hardware is modelled properly and the network
-- call is a printed line, which is exactly the bar the rest of this lab is held
-- to. Nothing here claims a web server is running.
--
-- Three device models had to exist first, and now do:
--
--   * a 4-channel opto-isolated relay board — PC817 input, SRD-05VDC coil with
--     its flyback diode, and an SPDT contact. ACTIVE LOW, like the real boards,
--     and it refuses to pull in below the coil's 3.75 V pick-up voltage, so a
--     5 V module fed from 3V3 lights its opto and never moves its armature.
--   * a SEN-11574 pulse sensor: an ANALOG output resting at half the supply with
--     a synthesised systolic waveform at a settable BPM. Synthesised, not PPG
--     optics, and it says so in every reading it reports.
--   * an MCP3008 10-bit SPI ADC speaking the real mode-0 frame — start bit,
--     SGL/DIFF + channel word, sample instant, null bit, ten data bits. It is
--     electrically unnecessary on a Pico (which has native ADCs) and is kept
--     because the printed circuit has it and a Raspberry Pi genuinely has no
--     analog input.
--
-- Both run on the Pico track, so `board` MUST be 'rp2040' -- migration 015
-- constrains circuits.board to ('arduino_uno','arduino_nano','rp2040') and
-- rejects the part-type string 'raspberry_pi_pico' outright. See
-- BOARDS[...].dbBoard in lib/simulator/model/boards.ts.
--
-- The graphs below are the SAME documents as EXPERIMENT_STARTERS in
-- lib/simulator/model/examples.ts and were GENERATED from them;
-- starters.test.ts parses this file and asserts the two copies are structurally
-- identical, so they cannot drift.
--
-- Idempotent, exactly as 020-023: re-running refreshes the starter graph in
-- place and leaves an already-native simulation alone. `config` is untouched,
-- so reverting an experiment is a one-line update back to 'builtin'.
--
-- After this, only experiment 11 (Arduino Mega) remains on a builtin widget.
-- =============================================================================

begin;

-- ═══ Experiment 10 — Home Automation with Raspberry Pi ═══
--
-- Pre-wired: the supply only, and it is the 3.3 V LOGIC rail. Open, and all
-- the student's: the relay module's VCC to VBUS (the Pico's 5 V pad), its GND,
-- IN1-IN4 to the four GPIOs, and the lamp through channel 1's COM/NO contacts.
--
-- LEAVING THE MODULE'S VCC OPEN IS THE EXERCISE, not an omission. An SRD-05VDC
-- coil is only guaranteed to pull in above 3.75 V, so a board hung on the
-- pre-wired 3V3 rail switches its opto-coupler and never its contact -- which is
-- exactly what happens on a bench, and what the readout says out loud.
--
-- GPIO23 in the published circuit does not exist on a Pico's header (GP23/24/25
-- are on the die but not brought out), so the fourth channel moves to GP16, the
-- pad immediately before GP17. 17, 27 and 22 are the published numbers verbatim.
do $mig$
declare
  v_slug  text := 'home-automation-rpi';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter home-automation-rpi
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
      "id": "relay",
      "type": "relay_4ch",
      "x": 55,
      "y": 450,
      "rotation": 0,
      "props": {
        "activeLow": 1
      }
    },
    {
      "id": "r220",
      "type": "resistor",
      "x": 300,
      "y": 470,
      "rotation": 0,
      "props": {
        "ohms": 220
      }
    },
    {
      "id": "led",
      "type": "led",
      "x": 400,
      "y": 450,
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

-- ═══ Experiment 12 — Smart Health Monitoring System ═══
--
-- Pre-wired: the supply only. Open: the DS18B20's VDD/GND/DQ and its 4.7 kOhm
-- pull-up, the MCP3008's supply, reference, both grounds and its four SPI lines,
-- and the pulse sensor's three leads with its output into CH0.
--
-- EVERY PUBLISHED PIN NUMBER SURVIVES THIS PORT: GPIO 4, 8, 9, 10 and 11 all
-- exist on a Pico header, so unlike experiments 09 and 10 nothing has to move.
--
-- Two things the student is meant to discover, both real and both modelled: a
-- 1-Wire bus does not work without its pull-up, and an MCP3008 with no VREF has
-- no full scale and reads zero however good the analog signal is.
do $mig$
declare
  v_slug  text := 'health-monitoring-rpi';
  v_exp   uuid;
  v_sim   uuid;
  -- @starter health-monitoring-rpi
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
      "x": 55,
      "y": 460,
      "rotation": 0,
      "props": {
        "temperature": 36.5,
        "resolution": 12
      }
    },
    {
      "id": "r4k7",
      "type": "resistor",
      "x": 110,
      "y": 480,
      "rotation": 0,
      "props": {
        "ohms": 4700
      }
    },
    {
      "id": "adc",
      "type": "mcp3008",
      "x": 200,
      "y": 450,
      "rotation": 0,
      "props": {}
    },
    {
      "id": "pulse",
      "type": "pulse_sensor",
      "x": 330,
      "y": 460,
      "rotation": 0,
      "props": {
        "bpm": 72,
        "amplitude": 8
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

-- ─── Experiment 10, procedure steps: no Flask, no IP address, no browser ───
--
-- Four steps describe things the simulated board cannot do, and each is
-- corrected by REPLACING ONE ARRAY ELEMENT matched on its exact current wording,
-- so re-running is a no-op and a later hand-edit is never clobbered. The real-
-- hardware instruction is kept in parentheses in every case: the point is to say
-- what happens HERE, not to delete what happens on a Pi.
do $mig$
declare
  v_exp   uuid;
  v_sec   uuid;
  v_steps jsonb;
  v_i     int;
  v_fix   text[][] := array[
    ['Install Flask: pip3 install flask',
     'Nothing to install: the board runs MicroPython and there is no Flask, no WiFi stack and no network to serve on. The program toggles the same GPIOs on a timer and prints the HTTP request a server would have been answering. (On a Raspberry Pi SBC you would instead run: pip3 install flask.)'],
    ['Connect 4-channel relay IN1–IN4 to GPIO17, 27, 22, 23.',
     'Connect 4-channel relay IN1–IN4 to GPIO17, 27, 22 and 16, and the module VCC to the 5V (VBUS) pad — not to 3.3V, because a 5 V relay coil will not pull in below 3.75 V. GPIO23 is used on a Raspberry Pi SBC but is not brought out on a Pico header, so the fourth channel moves to GPIO16.'],
    ['Find Pi IP: hostname -I (e.g., 192.168.1.100)',
     'There is no network interface and no IP address here. Watch the console instead: each toggle prints the GPIO level, the appliance state and the HTTP GET a browser would have sent. (On a Raspberry Pi SBC you would find the address with: hostname -I.)'],
    ['Open smartphone browser: http://192.168.1.100:5000',
     'No browser and no server: the simulated program calls the same toggle function on a timer, two seconds apart, and prints each request. (On a Raspberry Pi SBC you would open http://<pi-ip>:5000 from a phone on the same network.)'],
    ['Ensure smartphone and Pi are on the same WiFi network.',
     'Watch the relay readout in the simulator: it reports which way each armature has thrown and how much current the coils are drawing. (On a Raspberry Pi SBC the phone and the Pi must be on the same WiFi network for the page to load.)'],
    ['Run: python3 home_auto.py',
     'Press Run: the MicroPython is typed into the board''s REPL over an emulated USB serial link, exactly as it would be from Thonny. (On a Raspberry Pi SBC you would instead run: python3 home_auto.py.)'],
    ['Tap Toggle buttons to switch appliances ON/OFF.',
     'There are no buttons to tap: with no requests arriving, the program calls the same toggle function on a timer and prints each one. Watch the relay module''s state and the lamp on channel 1. (On a Raspberry Pi SBC the buttons on the served page do this.)']
  ];
  v_pair  text[];
begin
  select id into v_exp from experiments where slug = 'home-automation-rpi';
  if v_exp is null then
    raise notice 'skipping home-automation-rpi procedure fix: experiment not present';
    return;
  end if;

  select es.id into v_sec
    from experiment_sections es
   where es.experiment_id = v_exp and es.type = 'procedure' and es.status = 'active'
   order by es.order_index
   limit 1;

  if v_sec is null then
    raise notice 'skipping home-automation-rpi procedure fix: no active procedure section';
    return;
  end if;

  foreach v_pair slice 1 in array v_fix loop
    select content -> 'steps' into v_steps from experiment_sections where id = v_sec;
    if jsonb_typeof(v_steps) is distinct from 'array' then
      raise notice 'skipping home-automation-rpi procedure fix: steps is not an array';
      return;
    end if;

    v_i := null;
    select ord - 1 into v_i
      from jsonb_array_elements_text(v_steps) with ordinality as t(step, ord)
     where t.step = v_pair[1]
     limit 1;

    if v_i is null then
      raise notice 'home-automation-rpi step "%" already corrected (or reworded) — left alone', v_pair[1];
    else
      update experiment_sections
         set content = jsonb_set(content, array['steps', v_i::text], to_jsonb(v_pair[2]))
       where id = v_sec;
      raise notice 'home-automation-rpi: procedure step % corrected', v_i;
    end if;
  end loop;
end $mig$;

-- ─── Experiment 12, procedure steps: no raspi-config, no pip, no ThingSpeak ───
--
-- Five steps describe a Raspberry Pi OS workflow or a cloud service, neither of
-- which exists here. Corrected the same way as experiment 10's, keeping the
-- real-hardware instruction in parentheses.
do $mig$
declare
  v_exp   uuid;
  v_sec   uuid;
  v_steps jsonb;
  v_i     int;
  v_fix   text[][] := array[
    ['Enable SPI: sudo raspi-config → Interface Options → SPI → Enable.',
     'Nothing to enable: the program bit-bangs SPI with machine.SoftSPI on the same four pins, so there is no kernel driver to switch on. (On a Raspberry Pi SBC you would enable it with: sudo raspi-config → Interface Options → SPI.)'],
    ['Enable 1-Wire for DS18B20 (see Experiment 8).',
     'Nothing to enable: MicroPython’s onewire and ds18x20 modules are frozen into the Pico’s firmware and talk to the sensor directly. The 4.7 kΩ pull-up is still required — without it the bus never returns high and the scan finds nothing.'],
    ['Install dependencies: pip3 install spidev requests',
     'Nothing to install: SoftSPI is part of MicroPython’s machine module, and there is no requests because there is no network. (On a Raspberry Pi SBC you would instead run: pip3 install spidev requests.)'],
    ['Create a free ThingSpeak account and get your API key.',
     'No upload happens here — there is no network stack on the emulated board. The program keeps the upload function and prints the line it would have sent, ending "-> ThingSpeak updated". (On real hardware you would create a free ThingSpeak channel and paste its write API key into the code.)'],
    ['Paste your API key into the code and run it.',
     'Press Run: the MicroPython is typed into the board''s REPL over an emulated USB serial link. There is no API key to paste, because nothing is uploaded. (On real hardware you would paste your ThingSpeak write key into the code first.)'],
    ['Visit your ThingSpeak channel to see real-time charts of temperature and BPM.',
     'Read the console: each cycle prints the temperature the DS18B20 measured and the BPM the program’s own peak detector counted from the pulse sensor, with a NORMAL or ALERT status. (On real hardware those two values appear as live charts on your ThingSpeak channel.)'],
    ['Set ThingSpeak alerts for abnormal values.',
     'Move the pulse sensor’s BPM slider or the DS18B20’s temperature slider outside 60–100 BPM or 36.1–37.2 °C and watch the printed status change to ALERT. (On real hardware the same thresholds can be set as ThingSpeak alerts.)']
  ];
  v_pair  text[];
begin
  select id into v_exp from experiments where slug = 'health-monitoring-rpi';
  if v_exp is null then
    raise notice 'skipping health-monitoring-rpi procedure fix: experiment not present';
    return;
  end if;

  select es.id into v_sec
    from experiment_sections es
   where es.experiment_id = v_exp and es.type = 'procedure' and es.status = 'active'
   order by es.order_index
   limit 1;

  if v_sec is null then
    raise notice 'skipping health-monitoring-rpi procedure fix: no active procedure section';
    return;
  end if;

  foreach v_pair slice 1 in array v_fix loop
    select content -> 'steps' into v_steps from experiment_sections where id = v_sec;
    if jsonb_typeof(v_steps) is distinct from 'array' then
      raise notice 'skipping health-monitoring-rpi procedure fix: steps is not an array';
      return;
    end if;

    v_i := null;
    select ord - 1 into v_i
      from jsonb_array_elements_text(v_steps) with ordinality as t(step, ord)
     where t.step = v_pair[1]
     limit 1;

    if v_i is null then
      raise notice 'health-monitoring-rpi step "%" already corrected (or reworded) — left alone', v_pair[1];
    else
      update experiment_sections
         set content = jsonb_set(content, array['steps', v_i::text], to_jsonb(v_pair[2]))
       where id = v_sec;
      raise notice 'health-monitoring-rpi: procedure step % corrected', v_i;
    end if;
  end loop;
end $mig$;

-- ─── Experiment 12, code section: the lost shift operators ───
--
-- The published listing's two SPI lines read `(8+ch)<4` and `(r[1]&3)<8`. Both
-- lost a character somewhere in publishing: they are shifts, not comparisons, and
-- as printed they evaluate to True/False and make every reading 0 or 1. Restored
-- to `<<`, which is what every spidev MCP3008 example uses and what the
-- converter's own frame requires -- the config word puts the channel in bits 6-4
-- of the second byte, and the answer arrives in the low two bits of that byte
-- plus all of the third.
--
-- A targeted replace() rather than a rewrite of the whole listing, so it is
-- idempotent and cannot clobber any other edit to that section.
do $mig$
declare
  v_exp uuid;
  v_sec uuid;
begin
  select id into v_exp from experiments where slug = 'health-monitoring-rpi';
  if v_exp is null then
    raise notice 'skipping health-monitoring-rpi code fix: experiment not present';
    return;
  end if;

  select es.id into v_sec
    from experiment_sections es
   where es.experiment_id = v_exp and es.type = 'code' and es.status = 'active'
   order by es.order_index
   limit 1;

  if v_sec is null then
    raise notice 'skipping health-monitoring-rpi code fix: no active code section';
    return;
  end if;

  update experiment_sections
     set content = jsonb_set(
           content,
           '{code}',
           to_jsonb(
             replace(
               replace(content ->> 'code', '(8+ch)<4', '(8+ch)<<4'),
               '(r[1]&3)<8', '(r[1]&3)<<8'
             )
           )
         )
   where id = v_sec
     and (content ->> 'code' like '%(8+ch)<4%' or content ->> 'code' like '%(r[1]&3)<8%');

  if found then
    raise notice 'health-monitoring-rpi: restored the << operators in the code section';
  else
    raise notice 'health-monitoring-rpi code section already correct — left alone';
  end if;
end $mig$;

-- ─── Experiment 10, circuit section: GPIO23 is not on a Pico header ───
--
-- GP23/GP24/GP25 exist on the RP2040 die but are wired to on-board functions and
-- are not brought out, so the fourth relay channel moves to GP16 — the pad
-- immediately before GP17. 17, 27 and 22 are the published numbers verbatim.
-- Matched on the exact current value, so re-running is a no-op.
do $mig$
declare
  v_sec  uuid;
  v_conn jsonb;
  v_i    int;
begin
  select es.id into v_sec
    from experiment_sections es
    join experiments e on e.id = es.experiment_id
   where e.slug = 'home-automation-rpi' and es.type = 'circuit' and es.status = 'active'
   order by es.order_index
   limit 1;
  if v_sec is null then
    raise notice 'skipping home-automation-rpi circuit fix: no active circuit section';
    return;
  end if;

  select content -> 'connections' into v_conn from experiment_sections where id = v_sec;
  if jsonb_typeof(v_conn) is distinct from 'array' then
    raise notice 'skipping home-automation-rpi circuit fix: connections is not an array';
    return;
  end if;

  select ord - 1 into v_i
    from jsonb_array_elements(v_conn) with ordinality as t(c, ord)
   where t.c ->> 'to' = 'GPIO17, 27, 22, 23'
   limit 1;

  if v_i is null then
    raise notice 'home-automation-rpi circuit row already corrected — left alone';
  else
    update experiment_sections
       set content = jsonb_set(content, array['connections', v_i::text, 'to'],
                               to_jsonb('GPIO17, 27, 22, 16 (GPIO23 is not on a Pico header)'::text))
     where id = v_sec;
    raise notice 'home-automation-rpi: circuit connection % corrected', v_i;
  end if;
end $mig$;

commit;
