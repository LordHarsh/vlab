#!/usr/bin/env node
/**
 * verify-schema.mjs
 *
 * Proves that supabase/schema.sql produces the SAME database as replaying
 * supabase/migrations/001..NNN in order.
 *
 * It does not parse SQL and guess. It builds TWO real Postgres databases in
 * memory (PGlite — actual Postgres compiled to WASM), runs the migration chain
 * into one and schema.sql into the other, then diffs the system catalogs:
 *
 *     tables · columns · constraints · indexes · functions · RLS flags ·
 *     policies · table grants · column grants · triggers
 *
 * Any object present in one database and not the other is reported. The bar is
 * zero differences except the ones listed in EXPECTED_DIFFS below, each of
 * which carries a reason.
 *
 * Usage:
 *     node scripts/verify-schema.mjs
 *
 * Requires @electric-sql/pglite. If it is not installed the script says so and
 * exits 2 rather than pretending to pass:
 *     npm i -D @electric-sql/pglite
 *
 * Exit codes: 0 = match, 1 = differences found, 2 = could not run.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Postgres errors from PGlite carry a megabyte of bundled source in the stack.
// Print the message, not the novel.
process.on('uncaughtException', (e) => {
  console.error(`\nFATAL: ${e.message}`);
  if (e.query) console.error(`  in query: ${String(e.query).trim().slice(0, 400)}`);
  process.exit(2);
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
// Optional arg lets you diff a candidate file (and lets the harness be
// negative-tested against a deliberately broken copy).
const SCHEMA_FILE = process.argv[2]
  ? resolve(process.argv[2])
  : join(ROOT, 'supabase', 'schema.sql');

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  // Fallback: an install that lives outside this repo, e.g.
  //   PGLITE_PATH=/tmp/pgtest/node_modules/@electric-sql/pglite/dist/index.js
  if (process.env.PGLITE_PATH) {
    try {
      ({ PGlite } = await import(new URL('file://' + resolve(process.env.PGLITE_PATH)).href));
    } catch (e) {
      console.error(`FATAL: PGLITE_PATH set but not loadable: ${e.message}`);
      process.exit(2);
    }
  } else {
    console.error(
      'FATAL: @electric-sql/pglite is not installed.\n' +
        '       npm i -D @electric-sql/pglite   (or set PGLITE_PATH)\n' +
        '       (this script refuses to report success without executing the SQL)'
    );
    process.exit(2);
  }
}

/* ---------------------------------------------------------------------------
 * Differences that are correct and deliberate. Anything not listed here fails.
 * ------------------------------------------------------------------------ */
// Currently EMPTY, and that is the result worth protecting: the two paths
// produce byte-identical catalogs. schema.sql does state two grants the
// migration chain never had to (`grant usage on schema public` and `grant all
// on all tables`), but both are already true via Supabase's default privileges,
// so they show up as no-ops rather than differences.
//
// To allow a future difference, add { section, match, reason } here. A reason is
// mandatory — an unexplained diff fails the run.
const EXPECTED_DIFFS = [];

/* ---------------------------------------------------------------------------
 * Supabase shim.
 * A bare Postgres has no `auth` schema, no anon/authenticated/service_role
 * roles, and none of Supabase's default privileges. Both databases get exactly
 * the same shim, so it cancels out of the diff.
 * ------------------------------------------------------------------------ */
const SUPABASE_SHIM = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema if not exists auth;
  create or replace function auth.jwt() returns jsonb
    language sql stable as $shim$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $shim$;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
`;

/* ---------------------------------------------------------------------------
 * Catalog probes. Every query is ordered so output is stable and comparable.
 * ------------------------------------------------------------------------ */
const PROBES = {
  tables: `
    select c.relname || (case when c.relrowsecurity then '  [RLS]' else '  [no RLS]' end) as line
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1`,

  columns: `
    select table_name || '.' || column_name
           || ' :: ' || coalesce(data_type,'?')
           || coalesce('(' || character_maximum_length || ')','')
           || coalesce(' num(' || numeric_precision || ',' || numeric_scale || ')','')
           || ' ' || is_nullable
           || coalesce(' default ' || column_default, '') as line
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, column_name`,

  constraints: `
    select rel.relname || ' :: ' || con.conname || ' :: ' || pg_get_constraintdef(con.oid) as line
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
    order by 1`,

  indexes: `
    select indexname || ' :: ' || indexdef as line
    from pg_indexes where schemaname = 'public'
    order by 1`,

  functions: `
    select p.proname
           || '(' || pg_get_function_identity_arguments(p.oid) || ')'
           || ' returns ' || pg_get_function_result(p.oid)
           || ' lang=' || l.lanname
           || ' secdef=' || p.prosecdef
           || ' volatile=' || p.provolatile::text
           || ' config=' || coalesce(array_to_string(p.proconfig, ','), 'NONE')
           || ' body=' || md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) as line
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
    order by 1`,

  // Separate probe so a body-only drift is reported readably, not as an md5.
  function_bodies: `
    select p.proname || ' :: ' || regexp_replace(btrim(p.prosrc), '\\s+', ' ', 'g') as line
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by 1`,

  policies: `
    select tablename || ' :: ' || policyname
           || ' :: cmd=' || cmd
           || ' :: permissive=' || permissive
           || ' :: roles=' || array_to_string(roles, '+')
           || ' :: using=' || coalesce(regexp_replace(qual, '\\s+', ' ', 'g'), 'NULL')
           || ' :: check=' || coalesce(regexp_replace(with_check, '\\s+', ' ', 'g'), 'NULL') as line
    from pg_policies where schemaname = 'public'
    order by tablename, policyname`,

  table_grants: `
    select grantee || ' :: ' || table_name || ' :: ' || privilege_type as line
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon','authenticated','service_role','PUBLIC')
    order by 1`,

  column_grants: `
    select grantee || ' :: ' || table_name || '.' || column_name || ' :: ' || privilege_type as line
    from information_schema.column_privileges
    where table_schema = 'public'
      and grantee in ('anon','authenticated','service_role','PUBLIC')
      and privilege_type = 'SELECT'
      and table_name = 'quiz_questions'
    order by 1`,

  schema_privileges: `
    select r.rolname || ' :: schema public :: ' || p.priv as line
    from pg_roles r
    cross join (values ('USAGE'),('CREATE')) as p(priv)
    where r.rolname in ('anon','authenticated','service_role')
      and has_schema_privilege(r.rolname, 'public', p.priv)
    order by 1`,

  triggers: `
    select c.relname || ' :: ' || t.tgname || ' :: ' || pg_get_triggerdef(t.oid) as line
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
    order by 1`,
};

/* ------------------------------------------------------------------------ */

async function buildDb(label, apply) {
  const db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);
  await apply(db);
  return db;
}

async function runFile(db, path, label) {
  const sql = readFileSync(path, 'utf8');
  try {
    await db.exec(sql);
  } catch (err) {
    console.error(`\nFAILED executing ${label}\n  ${err.message}`);
    if (err.position) {
      const pos = Number(err.position);
      console.error(`  near: ...${sql.slice(Math.max(0, pos - 160), pos + 160)}...`);
    }
    throw err;
  }
}

async function probe(db) {
  const out = {};
  for (const [name, sql] of Object.entries(PROBES)) {
    const res = await db.query(sql);
    out[name] = res.rows.map((r) => r.line);
  }
  return out;
}

function explain(section, line) {
  for (const d of EXPECTED_DIFFS) {
    if (d.section === section && d.match(line)) return d.reason;
  }
  return null;
}

/* ------------------------------------------------------------------------ */

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

console.log('='.repeat(78));
console.log('SCHEMA CONSOLIDATION CHECK');
console.log('='.repeat(78));
console.log(`migrations : ${migrationFiles.length} files (${migrationFiles[0]} .. ${migrationFiles.at(-1)})`);
console.log(`consolidated: supabase/schema.sql`);

const chainDb = await buildDb('migrations', async (db) => {
  for (const f of migrationFiles) {
    await runFile(db, join(MIGRATIONS_DIR, f), `migrations/${f}`);
  }
});
console.log(`\n[ok] migration chain applied (${migrationFiles.length} files)`);

const consolidatedDb = await buildDb('schema.sql', async (db) => {
  await runFile(db, SCHEMA_FILE, 'supabase/schema.sql');
});
console.log('[ok] schema.sql applied');

// Idempotency: schema.sql must survive being run a second time.
await runFile(consolidatedDb, SCHEMA_FILE, 'supabase/schema.sql (re-run)');
console.log('[ok] schema.sql re-applied (idempotent)');

const chain = await probe(chainDb);
const consolidated = await probe(consolidatedDb);

let hardFailures = 0;
let explained = 0;
const report = [];

for (const section of Object.keys(PROBES)) {
  const a = new Set(chain[section]);
  const b = new Set(consolidated[section]);
  const onlyChain = [...a].filter((x) => !b.has(x));
  const onlyConsolidated = [...b].filter((x) => !a.has(x));

  const rows = [];
  for (const line of onlyChain) {
    const why = explain(section, line);
    if (why) { explained++; rows.push(['~ MIGRATIONS ONLY (expected)', line, why]); }
    else { hardFailures++; rows.push(['! MISSING FROM schema.sql', line, null]); }
  }
  for (const line of onlyConsolidated) {
    const why = explain(section, line);
    if (why) { explained++; rows.push(['~ schema.sql ONLY (expected)', line, why]); }
    else { hardFailures++; rows.push(['! EXTRA IN schema.sql', line, null]); }
  }

  report.push({ section, count: a.size, rows });
}

console.log('\n' + '='.repeat(78));
console.log('RESULTS');
console.log('='.repeat(78));

for (const { section, count, rows } of report) {
  const status = rows.length === 0 ? 'MATCH' : `${rows.length} diff(s)`;
  console.log(`\n${section.padEnd(20)} ${String(count).padStart(4)} objects   ${status}`);
  for (const [tag, line, why] of rows) {
    console.log(`   ${tag}`);
    console.log(`      ${line}`);
    if (why) console.log(`      reason: ${why}`);
  }
}

/* ---------------------------------------------------------------------------
 * BEHAVIOURAL ASSERTIONS
 *
 * Structural equality proves schema.sql matches the migrations. These prove the
 * result is actually CORRECT — that the security fixes 013/014/018/019 bought
 * are live in a database built from schema.sql alone. Run against the
 * consolidated database only.
 * ------------------------------------------------------------------------ */
console.log('\n' + '='.repeat(78));
console.log('BEHAVIOURAL ASSERTIONS (against a database built from schema.sql)');
console.log('='.repeat(78));

const db = consolidatedDb;
let assertFailures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  [pass] ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    assertFailures++;
    console.log(`  [FAIL] ${name}\n         ${e.message}`);
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const one = async (sql) => (await db.query(sql)).rows[0];

// --- Seed a minimal world as the owner (owner bypasses RLS) ------------------
await db.exec(`
  insert into profiles (clerk_user_id, email, role, approval_status)
    values ('clerk_student', 's@x.test', 'student', 'approved'),
           ('clerk_teacher', 't@x.test', 'educator', 'approved'),
           ('clerk_outsider','o@x.test', 'student', 'approved');
  insert into labs (slug, title, published) values ('lab1', 'Lab One', true);
  insert into experiments (lab_id, slug, title, published)
    select id, 'exp1', 'Exp One', true from labs where slug = 'lab1';
  insert into experiment_sections (experiment_id, type, order_index, content)
    select id, 'theory', 1, '{"introduction":"secret theory"}'::jsonb
    from experiments where slug = 'exp1';
  insert into classes (educator_id, name, join_code)
    select id, 'Class A', 'JOIN1' from profiles where clerk_user_id = 'clerk_teacher';
  insert into class_labs (class_id, lab_id)
    select c.id, l.id from classes c, labs l where c.join_code='JOIN1' and l.slug='lab1';
  insert into enrollments (class_id, student_id, status)
    select c.id, p.id, 'active' from classes c, profiles p
    where c.join_code='JOIN1' and p.clerk_user_id='clerk_student';
  insert into quizzes (experiment_id, type, title)
    select id, 'pretest', 'Q1' from experiments where slug='exp1';
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
    select id, 'What is 2+2?', '[{"id":"a","text":"4"}]'::jsonb, 'a', 'because maths', 1
    from quizzes where title='Q1';
`);

const asStudent  = `set role authenticated; set request.jwt.claims = '{"sub":"clerk_student"}';`;
const asOutsider = `set role authenticated; set request.jwt.claims = '{"sub":"clerk_outsider"}';`;
const asAnon     = `set role anon; set request.jwt.claims = '{"sub":"nobody"}';`;
const reset      = `reset role; reset request.jwt.claims;`;

await check('enrolled student CAN read gated experiment_sections', async () => {
  await db.exec(asStudent);
  const r = await one(`select count(*)::int n from experiment_sections`);
  await db.exec(reset);
  must(r.n === 1, `expected 1 readable section, got ${r.n}`);
  return '1 section visible';
});

await check('NON-enrolled student CANNOT read gated experiment_sections [013]', async () => {
  await db.exec(asOutsider);
  const r = await one(`select count(*)::int n from experiment_sections`);
  await db.exec(reset);
  must(r.n === 0, `content leak: outsider saw ${r.n} section(s)`);
  return '0 sections visible';
});

await check('authenticated CANNOT read quiz_questions.correct_answer [013]', async () => {
  await db.exec(asStudent);
  let denied = false;
  try { await db.query(`select correct_answer from quiz_questions`); }
  catch (e) { denied = /permission denied/i.test(e.message); }
  await db.exec(reset);
  must(denied, 'ANSWER KEY LEAK: authenticated could select correct_answer');
  return 'permission denied, as intended';
});

await check('authenticated CANNOT read quiz_questions.explanation [013]', async () => {
  await db.exec(asStudent);
  let denied = false;
  try { await db.query(`select explanation from quiz_questions`); }
  catch (e) { denied = /permission denied/i.test(e.message); }
  await db.exec(reset);
  must(denied, 'authenticated could select explanation');
  return 'permission denied, as intended';
});

await check('authenticated CAN still read the safe quiz_questions columns', async () => {
  await db.exec(asStudent);
  const r = await one(`select count(*)::int n from quiz_questions`);
  await db.exec(reset);
  must(r.n === 1, `expected 1 question, got ${r.n} — the column grant is too tight`);
  return '1 question visible';
});

await check('anon has NO select on quiz_questions at all [013]', async () => {
  await db.exec(asAnon);
  let denied = false;
  try { await db.query(`select id from quiz_questions`); }
  catch (e) { denied = /permission denied/i.test(e.message); }
  await db.exec(reset);
  must(denied, 'anon could select from quiz_questions');
  return 'permission denied, as intended';
});

await check('student CANNOT self-enroll into an arbitrary class [019]', async () => {
  const cls = await one(`select id from classes where join_code='JOIN1'`);
  const out = await one(`select id from profiles where clerk_user_id='clerk_outsider'`);
  await db.exec(asOutsider);
  let denied = false;
  try {
    await db.query(`insert into enrollments (class_id, student_id) values ('${cls.id}','${out.id}')`);
  } catch (e) { denied = /row-level security|permission denied/i.test(e.message); }
  await db.exec(reset);
  must(denied, 'SELF-ENROLL BYPASS: student inserted their own enrollment row');
  return 'insert refused by RLS';
});

await check('student CANNOT self-promote to educator [018]', async () => {
  await db.exec(asStudent);
  let blocked = false;
  try {
    const r = await db.query(
      `update profiles set role='educator', approval_status='approved'
       where clerk_user_id='clerk_student' returning id`
    );
    blocked = r.rows.length === 0;
  } catch (e) { blocked = /row-level security|violates/i.test(e.message); }
  await db.exec(reset);
  const still = await one(`select role from profiles where clerk_user_id='clerk_student'`);
  must(blocked || still.role === 'student', 'PRIVILEGE ESCALATION: student became educator');
  must(still.role === 'student', `role changed to ${still.role}`);
  return 'role still student';
});

await check('student CAN still edit their own harmless profile fields', async () => {
  await db.exec(asStudent);
  const r = await db.query(
    `update profiles set first_name='Ada' where clerk_user_id='clerk_student' returning id`
  );
  await db.exec(reset);
  must(r.rows.length === 1, 'the 018 pin broke legitimate self-edits');
  return 'first_name updated';
});

await check('all 9 RLS helpers are SECURITY DEFINER with search_path pinned [010/012/013/018]', async () => {
  const r = await db.query(`
    select proname, prosecdef, array_to_string(proconfig,',') cfg
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (proname like 'auth\\_%' or proname like 'can\\_read\\_%' or proname like 'is\\_%')
    order by 1`);
  must(r.rows.length === 9, `expected 9 helpers, found ${r.rows.length}`);
  for (const f of r.rows) {
    must(f.prosecdef === true, `${f.proname} is not SECURITY DEFINER`);
    must(/search_path=/.test(f.cfg || ''), `${f.proname} has a mutable search_path`);
  }
  return r.rows.map((f) => f.proname).join(', ');
});

await check('EXECUTE on the helpers is NOT revoked from PUBLIC [014 — load-bearing]', async () => {
  const r = await db.query(`
    select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (proname like 'auth\\_%' or proname like 'can\\_read\\_%' or proname like 'is\\_%')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
  must(r.rows.length === 0,
    `RLS WILL BREAK: authenticated lost EXECUTE on ${r.rows.map(x=>x.proname).join(', ')}`);
  return 'authenticated retains EXECUTE on all 9';
});

await check('set_updated_at has search_path pinned and fires [014]', async () => {
  const f = await one(`select array_to_string(proconfig,',') cfg from pg_proc
                       where proname='set_updated_at'`);
  must(/search_path=/.test(f.cfg || ''), 'set_updated_at has a mutable search_path');
  const t = await one(`select count(*)::int n from pg_trigger where tgname='set_updated_at'
                       and not tgisinternal`);
  must(t.n === 12, `expected 12 set_updated_at triggers, found ${t.n}`);
  return '12 triggers, search_path pinned';
});

await check('update_updated_at_column() is gone [014]', async () => {
  const r = await one(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and proname='update_updated_at_column'`);
  must(r.n === 0, 'the dead pre-rebuild trigger function is still present');
  return 'absent';
});

await check("simulations.type accepts exactly tinkercad/native/builtin [011->015->016]", async () => {
  const c = await one(`select pg_get_constraintdef(oid) def from pg_constraint
                       where conname='simulations_type_check'`);
  for (const v of ['tinkercad', 'native', 'builtin'])
    must(c.def.includes(`'${v}'`), `${v} missing from simulations_type_check`);
  for (const v of ['builtin_js', 'wokwi', 'iframe'])
    must(!c.def.includes(`'${v}'`), `${v} should have been dropped from simulations_type_check`);
  return c.def.replace(/\s+/g, ' ');
});

console.log('\n' + '='.repeat(78));
if (hardFailures === 0 && assertFailures === 0) {
  console.log(`PASS — schema.sql and the migration chain produce identical databases,`);
  console.log(`       and every security invariant holds in the consolidated build.`);
  console.log(`       ${explained} expected difference(s), all justified.`);
  console.log('='.repeat(78));
  process.exit(0);
} else {
  if (hardFailures) console.log(`FAIL — ${hardFailures} unexplained catalog difference(s).`);
  if (assertFailures) console.log(`FAIL — ${assertFailures} behavioural assertion(s) failed.`);
  console.log('='.repeat(78));
  process.exit(1);
}
