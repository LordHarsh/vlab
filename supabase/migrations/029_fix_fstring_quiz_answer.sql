-- Experiment 7, question 3: correct an answer inherited from the lab sheet.
--
-- The question is "Python f-string syntax:" with options
--   a  f"text{var}"
--   b  "{var}".format()
--   c  str(var)
--   d  All of these
-- and 016_backfill_authored_content.sql stores 'd' as correct. That is a
-- faithful transcription — reference/iot_virtual_lab.html has `ans:3` for this
-- question — but the reference is wrong. Only (a) is f-string syntax; `.format()`
-- is the older str.format() API and `str()` is a constructor. A student who
-- knows the material picks (a) and is marked incorrect, which is the worst way
-- for a quiz to be wrong.
--
-- WHY THE ANSWER MOVES AND THE QUESTION DOES NOT. There are two coherent fixes:
-- reword the stem to "Ways to format a string in Python:" and keep 'd', or keep
-- the stem and move the answer to 'a'. This takes the second. The experiment's
-- own sketch prints with an f-string —
--   print(f"Temp: {temp}°C, Humidity: {hum}%")
-- — so "which of these is an f-string" is the thing this experiment actually
-- teaches, and the first fix would quietly replace it with a broader question
-- about string formatting the lab never covers.
--
-- Scoped by the question text AND the experiment slug: `quiz_questions` has no
-- natural key, migration 016 inserts by position, and another experiment could
-- legitimately carry a similarly-worded question later.

update public.quiz_questions q
set correct_answer = 'a'
from public.quizzes z
join public.experiments e on e.id = z.experiment_id
where q.quiz_id = z.id
  and e.slug = 'dht11-rpi'
  and q.question_text = 'Python f-string syntax:'
  and q.correct_answer = 'd';

do $$
declare
  n integer;
begin
  select count(*) into n
  from public.quiz_questions q
  join public.quizzes z on z.id = q.quiz_id
  join public.experiments e on e.id = z.experiment_id
  where e.slug = 'dht11-rpi'
    and q.question_text = 'Python f-string syntax:'
    and q.correct_answer = 'a';

  if n <> 1 then
    raise exception 'expected exactly 1 corrected f-string question, found %', n;
  end if;
end $$;
