-- =============================================================================
-- 026_traffic_light_led_colours.sql
--
-- Gives experiment 03's three traffic-light lamps their actual colours.
--
-- WHY THIS FILE EXISTS AT ALL. The starter document lives in exactly one place
-- in the repo — the `$graph$` block in 020_native_experiments.sql, which
-- starters.test.ts §6.4 deep-compares against EXPERIMENT_STARTERS in
-- lib/simulator/model/examples.ts. That block has been corrected in place, so a
-- database built from scratch already gets the right thing and this file is a
-- no-op there. What it is for is the database 020 has ALREADY run on, where the
-- stored graph still holds three colourless — i.e. three red — LEDs.
--
-- WHY IT CARRIES NO COPY OF THE GRAPH. Embedding the corrected document here
-- would put a second copy of it in the repo, and a second copy is the entire
-- risk starters.test.ts §6 exists to manage: §6.2 requires each starter to
-- appear under exactly one `-- @starter` marker, so a copy here would either
-- trip that check or, if the marker were omitted to dodge it, sit unchecked and
-- drift. Instead this patches the three keys that actually changed. It cannot
-- disagree with the TypeScript about anything it does not touch.
--
-- The LED colour is ELECTRICAL, not decoration: green's 3.2 V forward drop
-- against red's ~2.0 V means the green lamp draws 7.47 mA where the red draws
-- 12.39 mA through the same 220 Ω on the same 5 V pad. A student measuring the
-- two and finding different numbers is seeing why a designer picks a different
-- series resistor per colour.
--
-- Idempotent, and safe on a graph a student has since edited: it rewrites only
-- the `props.color` of the three parts whose ids the starter authored, leaves
-- every other part and every wire untouched, and only ever touches the
-- role='starter' row — never a student's saved attempt.
-- =============================================================================

begin;

do $mig$
declare
  v_slug   text := 'traffic-light-arduino';
  v_exp    uuid;
  v_sim    uuid;
  v_id     text;
  v_colour text;
  v_idx    int;
  v_rows   int := 0;
begin
  select id into v_exp from experiments where slug = v_slug;
  if v_exp is null then
    raise notice 'skipping %: experiment not present', v_slug;
    return;
  end if;

  -- Same lookup 020 uses: the simulation the experiment's active simulation
  -- section points at, falling back to the oldest simulation on the experiment.
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
    raise notice 'skipping %: no simulation row to patch', v_slug;
    return;
  end if;

  -- One pass per lamp. The array index has to be found rather than assumed:
  -- jsonb_set needs a positional path, and hardcoding "parts[5]" would silently
  -- recolour whatever happened to be fifth if the starter is ever reordered.
  foreach v_id in array array['led_red', 'led_yellow', 'led_green'] loop
    v_colour := split_part(v_id, '_', 2);

    select ord - 1
      into v_idx
      from circuits c,
           lateral jsonb_array_elements(c.graph -> 'parts') with ordinality as t(part, ord)
     where c.simulation_id = v_sim
       and c.role = 'starter'
       and c.version = 1
       and t.part ->> 'id' = v_id
       and t.part ->> 'type' = 'led'
     limit 1;

    if v_idx is null then
      raise notice '%: no LED called % in the starter graph — leaving it alone', v_slug, v_id;
      continue;
    end if;

    update circuits
       set graph = jsonb_set(
             graph,
             array['parts', v_idx::text, 'props', 'color'],
             to_jsonb(v_colour),
             true
           )
     where simulation_id = v_sim
       and role = 'starter'
       and version = 1
       and graph #>> array['parts', v_idx::text, 'props', 'color'] is distinct from v_colour;

    get diagnostics v_rows = row_count;
    raise notice '%: % -> % (% row(s))', v_slug, v_id, v_colour, v_rows;
  end loop;
end $mig$;

commit;
