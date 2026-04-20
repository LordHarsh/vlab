-- =============================================================================
-- 002_content.sql
-- Content tables: labs, experiments, experiment_sections, simulations
-- Admin-only write. Public read for published content.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- LABS
-- Top-level grouping (e.g. "IoT Fundamentals", "Arduino Programming").
-- Only admins create/edit. Anyone can browse published titles + descriptions.
-- -----------------------------------------------------------------------------
create table labs (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  title            text not null,
  description      text,
  thumbnail_url    text,
  difficulty       text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  tags             text[] not null default '{}',
  published        boolean not null default false,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table labs enable row level security;

-- Anyone (even unauthenticated) can browse published lab titles + descriptions
create policy "labs: public read published"
  on labs for select
  using (published = true);

-- Admins see all including drafts
create policy "labs: admin read all"
  on labs for select to authenticated
  using (auth_is_admin());

-- Educators see published labs (to assign to their classes)
create policy "labs: educator read published"
  on labs for select to authenticated
  using (published = true and auth_role() = 'educator');

-- Only admins create/edit/delete labs
create policy "labs: admin write"
  on labs for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on labs
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- EXPERIMENTS
-- Individual experiments within a lab (e.g. "DHT11 Sensor Interfacing").
-- Ordered by order_index within the lab.
-- -----------------------------------------------------------------------------
create table experiments (
  id                 uuid primary key default gen_random_uuid(),
  lab_id             uuid not null references labs(id) on delete cascade,
  slug               text not null,
  title              text not null,
  description        text,
  order_index        integer not null default 0,
  difficulty         text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  estimated_duration integer,            -- minutes
  published          boolean not null default false,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (lab_id, slug)
);

create index on experiments(lab_id, order_index);

alter table experiments enable row level security;

-- Published experiments are visible to all (content gated by enrollment in app layer)
create policy "experiments: read published"
  on experiments for select
  using (published = true);

-- Admins see all
create policy "experiments: admin read all"
  on experiments for select to authenticated
  using (auth_is_admin());

-- Only admins write
create policy "experiments: admin write"
  on experiments for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on experiments
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- EXPERIMENT SECTIONS
-- Ordered content blocks within an experiment.
-- type determines the shape of the content JSONB field:
--
--   aim:        { objectives: string[], outcomes: string[], note?: string }
--   theory:     { introduction: string, sections: [{heading, body}] }
--   components: { items: [{name, quantity, notes?}] }
--   circuit:    { svg_data?: string, connections: [{from, to}] }
--   procedure:  { steps: string[] }
--   code:       { language: "arduino_c"|"python", platform: string, code: string }
--   simulation: { simulation_id: uuid }   -- FK into simulations table
--   quiz:       { quiz_id: uuid }         -- FK into quizzes table
--   feedback:   { form_id: uuid }         -- FK into feedback_forms table
--   references: { items: [{title, url, type?}] }
--   video:      { url: string, caption?: string }
--   text:       { content: string }       -- markdown / rich text
-- -----------------------------------------------------------------------------
create table experiment_sections (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null references experiments(id) on delete cascade,
  type            text not null check (type in (
                    'aim', 'theory', 'components', 'circuit',
                    'procedure', 'code', 'simulation', 'quiz',
                    'feedback', 'references', 'text', 'video'
                  )),
  title           text,
  order_index     integer not null,
  content         jsonb,
  is_required     boolean not null default true,
  status          text not null default 'active'
                  check (status in ('active', 'archived')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index on experiment_sections(experiment_id, order_index);

alter table experiment_sections enable row level security;

-- Active sections are publicly readable (enrollment enforcement is app-layer)
create policy "experiment_sections: read active"
  on experiment_sections for select
  using (status = 'active');

-- Admins see all including archived
create policy "experiment_sections: admin read all"
  on experiment_sections for select to authenticated
  using (auth_is_admin());

-- Only admins write
create policy "experiment_sections: admin write"
  on experiment_sections for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on experiment_sections
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- SIMULATIONS
-- Linked from experiment_sections where type = 'simulation'.
-- type determines config shape:
--   builtin_js:  { sim_type: "dht11"|"traffic"|"ultrasonic"|"flow"|
--                             "rpi_led"|"pir_alarm"|"ds18b20"|"motor"|
--                             "home_auto"|"smart_traffic"|"health" }
--   wokwi:       { project_id: string, height: integer }
--   tinkercad:   { design_id: string, height: integer }
--   iframe:      { url: string, height: integer }
-- -----------------------------------------------------------------------------
create table simulations (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null references experiments(id) on delete cascade,
  type            text not null check (type in ('builtin_js', 'wokwi', 'tinkercad', 'iframe')),
  title           text,
  description     text,
  config          jsonb not null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table simulations enable row level security;

-- Simulations are publicly readable
create policy "simulations: read"
  on simulations for select
  using (true);

-- Only admins write
create policy "simulations: admin write"
  on simulations for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on simulations
  for each row execute function set_updated_at();
