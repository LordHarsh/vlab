-- =============================================================================
-- 015_native_simulator.sql
--
-- Storage for the native circuit simulator (SIMULATOR_ARCHITECTURE.md §7).
--
-- Deliberately smaller than the document proposes: only `circuits` and
-- `sim_attempts` land here. sim_checks / sim_submissions / sim_sessions belong
-- to autograding, which decision D2 defers past the pilot, and unused tables
-- with speculative RLS are a liability rather than an asset.
--
-- Additive only. Nothing existing is dropped or rewritten.
-- =============================================================================

-- 'native' joins 'tinkercad' rather than replacing it. The Tinkercad embed is
-- the permanent fallback for every experiment the native simulator cannot yet
-- cover — notably the Raspberry Pi ones (§6). Never remove it.
alter table simulations drop constraint if exists simulations_type_check;
alter table simulations add constraint simulations_type_check
  check (type in ('tinkercad', 'native'));

-- -----------------------------------------------------------------------------
-- CIRCUITS
-- Authored circuit documents. role='starter' is what a student opens with;
-- role='reference' is the worked solution and must never reach a student.
-- -----------------------------------------------------------------------------
create table if not exists circuits (
  id                uuid primary key default gen_random_uuid(),
  simulation_id     uuid not null references simulations(id) on delete cascade,
  role              text not null check (role in ('starter', 'reference')),
  version           integer not null default 1,
  board             text not null default 'arduino_uno'
                    check (board in ('arduino_uno', 'arduino_nano', 'rp2040')),
  interaction_level text not null default 'free'
                    check (interaction_level in ('guided', 'assisted', 'free')),
  -- parts[] + wires[]. Nets are DERIVED on load, never stored: a stored copy is
  -- a copy that can disagree with the document it came from.
  graph             jsonb not null,
  code              jsonb not null default '{"files":[]}'::jsonb,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (simulation_id, role, version)
);

create index if not exists idx_circuits_simulation on circuits(simulation_id, role);

alter table circuits enable row level security;

-- Students and educators may read STARTER circuits, gated on the same content
-- access rule as every other experiment asset (013).
create policy "circuits: read starter"
  on circuits for select to authenticated
  using (
    role = 'starter'
    and can_read_experiment_content(
      (select experiment_id from simulations where simulations.id = circuits.simulation_id)
    )
  );

-- role='reference' is the answer key. Under the pre-013 `using (true)` pattern a
-- student could have fetched the worked solution straight from the REST
-- endpoint, so it is restricted to admins and the educator who owns a class
-- using it.
create policy "circuits: educator read reference"
  on circuits for select to authenticated
  using (
    auth_is_admin()
    or exists (
      select 1
      from simulations s
      join experiments e on e.id = s.experiment_id
      join class_labs cl on cl.lab_id = e.lab_id
      join classes c on c.id = cl.class_id
      where s.id = circuits.simulation_id
        and c.educator_id = auth_profile_id()
    )
  );

create policy "circuits: admin write"
  on circuits for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on circuits
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- SIM ATTEMPTS
-- A student's live working copy. One row per (student, simulation, class),
-- overwritten as they work — this is autosave, not history.
-- Policies mirror student_progress exactly (007).
-- -----------------------------------------------------------------------------
create table if not exists sim_attempts (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references profiles(id) on delete cascade,
  simulation_id uuid not null references simulations(id) on delete cascade,
  class_id      uuid not null references classes(id) on delete cascade,
  graph         jsonb not null,
  code          jsonb not null default '{"files":[]}'::jsonb,
  updated_at    timestamptz default now(),
  created_at    timestamptz default now(),
  unique (student_id, simulation_id, class_id)
);

create index if not exists idx_sim_attempts_student on sim_attempts(student_id, class_id);

alter table sim_attempts enable row level security;

create policy "sim_attempts: student read own"
  on sim_attempts for select to authenticated
  using (student_id = auth_profile_id());

create policy "sim_attempts: student write own"
  on sim_attempts for all to authenticated
  using (student_id = auth_profile_id())
  with check (student_id = auth_profile_id() and auth_role() = 'student');

create policy "sim_attempts: educator read own classes"
  on sim_attempts for select to authenticated
  using (is_educator_of_class(class_id));

create policy "sim_attempts: admin read all"
  on sim_attempts for select to authenticated
  using (auth_is_admin());

create trigger set_updated_at
  before update on sim_attempts
  for each row execute function set_updated_at();
