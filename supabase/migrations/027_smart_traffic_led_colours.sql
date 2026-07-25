-- =============================================================================
-- 027_smart_traffic_led_colours.sql
--
-- Gives experiment 11's twelve traffic-light lamps their actual colours.
--
-- The same defect 026 fixed for experiment 03, in the starter authored later:
-- all twelve LEDs carried `props: {}` while eight of them are NAMED
-- `*_yellow` and `*_green`. Every lamp on all four approaches rendered red, and
-- 020's own comment about experiment 03 says exactly why that matters — a
-- traffic light whose lamps are all one colour "is the first thing a student
-- would notice was wrong".
--
-- IT IS NOT COSMETIC, and that is the more important half. LED colour is
-- ELECTRICAL: green and yellow lamps have forward drops of 3.2 V and 2.1 V
-- against red's ~2.0 V, so through the same 220 Ω on the same 5 V Mega pad they
-- pass 7.47 mA, 11.84 mA and 12.39 mA. Twelve lamps solved as red put three
-- wrong currents in the Measurements panel and, on a rail with any droop, the
-- wrong brightness on eight of them.
--
-- WHY THIS FILE EXISTS AT ALL, and why it carries no copy of the graph: both
-- reasons are 026's, verbatim. The starter document lives in exactly one place
-- in the repo — the `$graph$` block in 025_native_experiment_11.sql, which
-- starters.test.ts §6.4 deep-compares against EXPERIMENT_STARTERS in
-- lib/simulator/model/examples.ts. That block has been regenerated from the
-- TypeScript, so a database built from scratch already gets the right thing and
-- this file is a no-op there. What it is for is the database 025 has ALREADY
-- run on, where the stored graph still holds twelve colourless — i.e. twelve
-- red — LEDs. Embedding a corrected copy of the document here would create the
-- second copy that §6.2 exists to prevent, so this patches only the one key per
-- lamp that actually changed and cannot disagree about anything else.
--
-- Idempotent, and safe on a graph a student has since edited: it rewrites only
-- the `props.color` of the twelve parts whose ids the starter authored, leaves
-- every other part and every wire untouched, and only ever touches the
-- role='starter' row — never a student's saved attempt.
-- =============================================================================

begin;

do $mig$
declare
  v_slug   text := 'smart-traffic-controller';
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

  -- Same lookup 025 uses: the simulation the experiment's active simulation
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

  -- One pass per lamp. The colour comes out of the lamp's own id, which is
  -- where the authored intent already was: `led3_yellow` is the yellow lamp on
  -- approach 3, and split_part gives 'yellow'. The array index has to be found
  -- rather than assumed — jsonb_set needs a positional path, and hardcoding
  -- "parts[5]" would silently recolour whatever happened to be fifth if the
  -- starter is ever reordered.
  foreach v_id in array array[
    'led1_red', 'led1_yellow', 'led1_green',
    'led2_red', 'led2_yellow', 'led2_green',
    'led3_red', 'led3_yellow', 'led3_green',
    'led4_red', 'led4_yellow', 'led4_green'
  ] loop
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
