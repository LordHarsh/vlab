-- =============================================================================
-- 005_classes.sql
-- Class management: classes, class_labs, class_invites, invite_emails, enrollments
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CLASSES
-- An educator creates a class (a named student group).
-- A class can have multiple labs assigned to it via class_labs.
-- Students join via join_code or an invite.
-- -----------------------------------------------------------------------------
create table classes (
  id                    uuid primary key default gen_random_uuid(),
  educator_id           uuid not null references profiles(id) on delete restrict,
  name                  text not null,
  description           text,
  academic_year         text,          -- e.g. "2025-26"
  semester              text check (semester in ('odd', 'even', 'summer')),
  join_code             text unique not null,
  join_code_expires_at  timestamptz,   -- null = never expires
  max_students          integer,       -- null = no cap
  status                text not null default 'active'
                        check (status in ('active', 'completed', 'archived')),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table classes enable row level security;

-- Educators see their own classes
create policy "classes: educator read own"
  on classes for select to authenticated
  using (educator_id = auth_profile_id());

-- Admins see all
create policy "classes: admin read all"
  on classes for select to authenticated
  using (auth_is_admin());

-- Educators manage their own classes
create policy "classes: educator write own"
  on classes for all to authenticated
  using (educator_id = auth_profile_id() and auth_role() = 'educator')
  with check (educator_id = auth_profile_id() and auth_role() = 'educator');

-- Admins manage all classes
create policy "classes: admin write all"
  on classes for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on classes
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- CLASS LABS
-- Which labs are assigned to a class, in what order, and when they unlock.
-- A class can have multiple labs; same lab can appear in multiple classes.
-- -----------------------------------------------------------------------------
create table class_labs (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references classes(id) on delete cascade,
  lab_id       uuid not null references labs(id) on delete cascade,
  order_index  integer not null default 0,
  unlock_at    timestamptz,  -- null = available immediately on enrollment
  unique (class_id, lab_id)
);

create index on class_labs(class_id, order_index);

alter table class_labs enable row level security;

create policy "class_labs: educator read own"
  on class_labs for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_labs.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_labs: admin read all"
  on class_labs for select to authenticated
  using (auth_is_admin());

create policy "class_labs: educator write own"
  on class_labs for all to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_labs.class_id
              and classes.educator_id = auth_profile_id())
  )
  with check (
    exists (select 1 from classes
            where classes.id = class_labs.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_labs: admin write all"
  on class_labs for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- CLASS INVITES
-- Educators generate invite tokens. Students use them to enroll.
-- type:
--   link       = shareable URL token (anyone with link can join up to max_uses)
--   email      = single email invite
--   csv_batch  = bulk email upload (creates invite_emails rows)
--   manual     = educator manually adds student by email
-- -----------------------------------------------------------------------------
create table class_invites (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  created_by  uuid not null references profiles(id) on delete restrict,
  type        text not null check (type in ('link', 'email', 'csv_batch', 'manual')),
  token       text unique not null,
  expires_at  timestamptz,  -- null = never
  max_uses    integer,      -- null = unlimited
  use_count   integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz default now()
);

alter table class_invites enable row level security;

create policy "class_invites: educator read own"
  on class_invites for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_invites.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_invites: admin read all"
  on class_invites for select to authenticated
  using (auth_is_admin());

create policy "class_invites: educator write own"
  on class_invites for all to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_invites.class_id
              and classes.educator_id = auth_profile_id())
  )
  with check (
    exists (select 1 from classes
            where classes.id = class_invites.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_invites: admin write all"
  on class_invites for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- INVITE EMAILS
-- Used for csv_batch and email invite types.
-- When a student registers with a matching email, the application:
--   1. Sets status = 'accepted', student_id = <new profile id>
--   2. Creates the enrollment row automatically
-- -----------------------------------------------------------------------------
create table invite_emails (
  id           uuid primary key default gen_random_uuid(),
  invite_id    uuid not null references class_invites(id) on delete cascade,
  email        text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'expired')),
  student_id   uuid references profiles(id) on delete set null,
  created_at   timestamptz default now(),
  accepted_at  timestamptz,
  unique (invite_id, email)
);

alter table invite_emails enable row level security;

create policy "invite_emails: educator read own"
  on invite_emails for select to authenticated
  using (
    exists (
      select 1 from class_invites
      join classes on classes.id = class_invites.class_id
      where class_invites.id = invite_emails.invite_id
        and classes.educator_id = auth_profile_id()
    )
  );

create policy "invite_emails: admin read all"
  on invite_emails for select to authenticated
  using (auth_is_admin());

create policy "invite_emails: educator write own"
  on invite_emails for all to authenticated
  using (
    exists (
      select 1 from class_invites
      join classes on classes.id = class_invites.class_id
      where class_invites.id = invite_emails.invite_id
        and classes.educator_id = auth_profile_id()
    )
  )
  with check (
    exists (
      select 1 from class_invites
      join classes on classes.id = class_invites.class_id
      where class_invites.id = invite_emails.invite_id
        and classes.educator_id = auth_profile_id()
    )
  );

create policy "invite_emails: admin write all"
  on invite_emails for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- ENROLLMENTS
-- A student belongs to a class. Many-to-many (student can be in many classes).
-- UNIQUE(class_id, student_id) prevents double-enrollment.
-- Dropping is a soft-delete (status='dropped'); all progress/submissions kept.
-- enrolled_via tracks how the student joined for analytics.
-- -----------------------------------------------------------------------------
create table enrollments (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references classes(id) on delete cascade,
  student_id    uuid not null references profiles(id) on delete cascade,
  status        text not null default 'active'
                check (status in ('active', 'dropped', 'completed')),
  enrolled_via  text check (enrolled_via in ('code', 'invite_link', 'email_invite', 'manual')),
  enrolled_at   timestamptz default now(),
  dropped_at    timestamptz,
  unique (class_id, student_id)
);

create index on enrollments(student_id, status);
create index on enrollments(class_id);

alter table enrollments enable row level security;

-- Students see their own enrollments
create policy "enrollments: student read own"
  on enrollments for select to authenticated
  using (student_id = auth_profile_id());

-- Educators see enrollments in their classes
create policy "enrollments: educator read own classes"
  on enrollments for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = enrollments.class_id
              and classes.educator_id = auth_profile_id())
  );

-- Admins read all
create policy "enrollments: admin read all"
  on enrollments for select to authenticated
  using (auth_is_admin());

-- Students enroll themselves (application validates the code/invite before inserting)
create policy "enrollments: student insert own"
  on enrollments for insert to authenticated
  with check (student_id = auth_profile_id() and auth_role() = 'student');

-- Students can drop themselves
create policy "enrollments: student drop own"
  on enrollments for update to authenticated
  using (student_id = auth_profile_id())
  with check (student_id = auth_profile_id() and status = 'dropped');

-- Educators manage enrollments in their classes (add/remove/update status)
create policy "enrollments: educator write own classes"
  on enrollments for all to authenticated
  using (
    exists (select 1 from classes
            where classes.id = enrollments.class_id
              and classes.educator_id = auth_profile_id())
  )
  with check (
    exists (select 1 from classes
            where classes.id = enrollments.class_id
              and classes.educator_id = auth_profile_id())
  );

-- Admins manage all
create policy "enrollments: admin write all"
  on enrollments for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- DEFERRED POLICIES: classes and class_labs need to see enrollments table
-- These couldn't be defined in 005 until enrollments existed
-- -----------------------------------------------------------------------------

-- Students can see classes they're actively enrolled in
create policy "classes: student read enrolled"
  on classes for select to authenticated
  using (
    exists (
      select 1 from enrollments
      where enrollments.class_id = classes.id
        and enrollments.student_id = auth_profile_id()
        and enrollments.status = 'active'
    )
  );

-- Students can see class_labs rows for classes they're enrolled in
create policy "class_labs: student read enrolled"
  on class_labs for select to authenticated
  using (
    exists (
      select 1 from enrollments
      where enrollments.class_id = class_labs.class_id
        and enrollments.student_id = auth_profile_id()
        and enrollments.status = 'active'
    )
  );
