-- 017_fix_smart_traffic_code_meta.sql
--
-- Repairs the code section of `smart-traffic-controller`, which migration 016
-- wrote with the wrong language and a non-platform platform.
--
-- Two mistakes, both in the generator behind 016:
--
--   1. language = 'python' on an Arduino C sketch. The generator stripped the
--      source's syntax-highlight markup for STORAGE but sniffed the UNSTRIPPED
--      string to pick the language, so `void setup` never matched literally —
--      the raw field reads `<span class="kw">void</span> <span
--      class="fn">setup</span>()`. Every other experiment happened to be saved
--      by its platform string; this one is the only row whose platform
--      ("Advanced") named neither Arduino nor Raspberry Pi, so it was the only
--      row that reached the faulty sniff.
--
--   2. platform = 'Advanced', which is a difficulty level, not a board. The
--      authored source conflates the two in this one entry. The sketch drives
--      pins 22-33, which an Uno does not have, so the board is a Mega 2560.
--
-- CodeSection renders both fields verbatim as a header, so a student currently
-- reads "PYTHON · Advanced" above Arduino C. No highlighting depends on it —
-- the body is a plain <pre><code> — so this is a label fix, not a render fix.
--
-- Idempotent: re-running changes nothing once applied.

begin;

update experiment_sections s
   set content = s.content
               || jsonb_build_object('language', 'arduino_c')
               || jsonb_build_object('platform', 'Arduino Mega 2560')
  from experiments e
 where e.id = s.experiment_id
   and e.slug = 'smart-traffic-controller'
   and s.type = 'code';

commit;
