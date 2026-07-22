-- 016_backfill_authored_content.sql
--
-- Backfills the nine placeholder experiments from the authored lab content,
-- and repairs the three that were already populated.
--
-- Source: iot_virtual_lab.html (the original single-file lab), which carries
-- all 12 experiments with aim/theory/components/connections/procedure/code
-- and 48 quiz questions. Production had 3 populated experiments and 12
-- questions; experiments 4-12 were shells whose quizzes could never be
-- submitted because QuizSection gates Submit on questions.length > 0.
--
-- Idempotent: safe to re-run. Sections and questions for the rebuilt
-- experiments are deleted and reinserted; nothing else is destructive.

begin;

-- ── Simulation kinds ────────────────────────────────────────────────────
--
-- Migration 011 narrowed this to 'tinkercad'; 015 added 'native' for the
-- circuit editor. The authored lab drives a third kind: a purpose-built
-- widget per experiment, keyed by config->>'sim_type'. That is neither an
-- external embed nor the free-form editor, so it gets its own value.
alter table simulations drop constraint if exists simulations_type_check;
alter table simulations add constraint simulations_type_check
  check (type in ('tinkercad', 'native', 'builtin'));

-- ═══ 1. LED & DHT11 Temperature/Humidity Sensor Interfacing ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'led-dht11-arduino';
  if v_exp is null then
    raise notice 'skipping %: not present', 'led-dht11-arduino';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'LED & DHT11 Temperature/Humidity Sensor Interfacing Simulation', '{"sim_type":"dht11"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'LED & DHT11 Temperature/Humidity Sensor Interfacing Simulation',
           config = '{"sim_type":"dht11"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'LED & DHT11 Temperature/Humidity Sensor Interfacing Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What is the operating voltage of the DHT11?', '[{"id":"a","text":"1.8V"},{"id":"b","text":"3.3V"},{"id":"c","text":"5V"},{"id":"d","text":"12V"}]'::jsonb, 'c', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What is the temperature range of DHT11?', '[{"id":"a","text":"-40 to 80°C"},{"id":"b","text":"0 to 50°C"},{"id":"c","text":"-10 to 60°C"},{"id":"d","text":"0 to 100°C"}]'::jsonb, 'b', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'How many wires does DHT11 use for data?', '[{"id":"a","text":"2"},{"id":"b","text":"3"},{"id":"c","text":"1"},{"id":"d","text":"4"}]'::jsonb, 'c', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What resistor is recommended for DHT11 pull-up?', '[{"id":"a","text":"1kΩ"},{"id":"b","text":"4.7kΩ"},{"id":"c","text":"10kΩ"},{"id":"d","text":"100kΩ"}]'::jsonb, 'c', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections already populated in a richer shape; left as authored.
  -- Repair only: point the simulation section at the real row, and drop
  -- the duplicate empty quiz section (experiment 1 carries two).
  update experiment_sections
     set content = jsonb_build_object('simulation_id', v_sim)
   where experiment_id = v_exp and type = 'simulation';
  delete from experiment_sections
   where experiment_id = v_exp and type = 'quiz' and (content is null or content = '{}'::jsonb);
  update experiment_sections
     set content = jsonb_build_object('quiz_id', v_quiz)
   where experiment_id = v_exp and type = 'quiz';
end $mig$;

-- ═══ 2. Ultrasonic Sensor & PIR Sensor Interfacing ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'ultrasonic-pir-arduino';
  if v_exp is null then
    raise notice 'skipping %: not present', 'ultrasonic-pir-arduino';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'Ultrasonic Sensor & PIR Sensor Interfacing Simulation', '{"sim_type":"ultrasonic"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'Ultrasonic Sensor & PIR Sensor Interfacing Simulation',
           config = '{"sim_type":"ultrasonic"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'Ultrasonic Sensor & PIR Sensor Interfacing Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What frequency does HC-SR04 use?', '[{"id":"a","text":"20 kHz"},{"id":"b","text":"40 kHz"},{"id":"c","text":"100 kHz"},{"id":"d","text":"1 MHz"}]'::jsonb, 'b', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Maximum range of HC-SR04?', '[{"id":"a","text":"100 cm"},{"id":"b","text":"200 cm"},{"id":"c","text":"400 cm"},{"id":"d","text":"800 cm"}]'::jsonb, 'c', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What does PIR stand for?', '[{"id":"a","text":"Passive Infrared"},{"id":"b","text":"Positive IR"},{"id":"c","text":"Programmable IR"},{"id":"d","text":"Pulse Infrared"}]'::jsonb, 'a', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Distance formula: Speed of sound ≈', '[{"id":"a","text":"100 m/s"},{"id":"b","text":"340 m/s"},{"id":"c","text":"500 m/s"},{"id":"d","text":"1500 m/s"}]'::jsonb, 'b', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections already populated in a richer shape; left as authored.
  -- Repair only: point the simulation section at the real row, and drop
  -- the duplicate empty quiz section (experiment 1 carries two).
  update experiment_sections
     set content = jsonb_build_object('simulation_id', v_sim)
   where experiment_id = v_exp and type = 'simulation';
  delete from experiment_sections
   where experiment_id = v_exp and type = 'quiz' and (content is null or content = '{}'::jsonb);
  update experiment_sections
     set content = jsonb_build_object('quiz_id', v_quiz)
   where experiment_id = v_exp and type = 'quiz';
end $mig$;

-- ═══ 3. Traffic Light Simulator ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'traffic-light-arduino';
  if v_exp is null then
    raise notice 'skipping %: not present', 'traffic-light-arduino';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'Traffic Light Simulator Simulation', '{"sim_type":"traffic"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'Traffic Light Simulator Simulation',
           config = '{"sim_type":"traffic"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'Traffic Light Simulator Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'In a standard traffic sequence, which comes after Green?', '[{"id":"a","text":"Red"},{"id":"b","text":"Blue"},{"id":"c","text":"Yellow"},{"id":"d","text":"White"}]'::jsonb, 'c', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What is the purpose of the Yellow light?', '[{"id":"a","text":"Emergency stop"},{"id":"b","text":"Prepare to stop"},{"id":"c","text":"U-turn allowed"},{"id":"d","text":"Pedestrian walk"}]'::jsonb, 'b', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Which Arduino function is used for timing?', '[{"id":"a","text":"millis()"},{"id":"b","text":"time()"},{"id":"c","text":"delay()"},{"id":"d","text":"timer()"}]'::jsonb, 'c', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What limits current through an LED?', '[{"id":"a","text":"Capacitor"},{"id":"b","text":"Resistor"},{"id":"c","text":"Transistor"},{"id":"d","text":"Diode"}]'::jsonb, 'b', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections already populated in a richer shape; left as authored.
  -- Repair only: point the simulation section at the real row, and drop
  -- the duplicate empty quiz section (experiment 1 carries two).
  update experiment_sections
     set content = jsonb_build_object('simulation_id', v_sim)
   where experiment_id = v_exp and type = 'simulation';
  delete from experiment_sections
   where experiment_id = v_exp and type = 'quiz' and (content is null or content = '{}'::jsonb);
  update experiment_sections
     set content = jsonb_build_object('quiz_id', v_quiz)
   where experiment_id = v_exp and type = 'quiz';
end $mig$;

-- ═══ 4. Water Flow Detection using Arduino ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'water-flow-arduino';
  if v_exp is null then
    raise notice 'skipping %: not present', 'water-flow-arduino';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'Water Flow Detection using Arduino Simulation', '{"sim_type":"flow"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'Water Flow Detection using Arduino Simulation',
           config = '{"sim_type":"flow"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'Water Flow Detection using Arduino Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'YF-S201 uses which sensing technology?', '[{"id":"a","text":"Optical"},{"id":"b","text":"Ultrasonic"},{"id":"c","text":"Hall-Effect"},{"id":"d","text":"Capacitive"}]'::jsonb, 'c', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Flow rate formula with pulse freq F:', '[{"id":"a","text":"F/7.5"},{"id":"b","text":"F×7.5"},{"id":"c","text":"F/60"},{"id":"d","text":"F+7.5"}]'::jsonb, 'a', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Which Arduino pin supports hardware interrupts (INT0)?', '[{"id":"a","text":"D0"},{"id":"b","text":"D2"},{"id":"c","text":"D5"},{"id":"d","text":"A0"}]'::jsonb, 'b', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What is "volatile" used for in Arduino?', '[{"id":"a","text":"Increase speed"},{"id":"b","text":"Flag for ISR variables"},{"id":"c","text":"Save memory"},{"id":"d","text":"Increase voltage"}]'::jsonb, 'b', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Arduino","objectives":["To interface a YF-S201 water flow sensor with Arduino to measure flow rate and total water volume."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"The YF-S201 water flow sensor contains a hall-effect sensor and a plastic turbine. When water flows, the turbine spins, generating pulses via the hall-effect sensor. The Arduino counts these pulses using an interrupt on pin D2. Flow Rate (L/min) = Pulse Frequency / 7.5. Volume (L) = Total Pulses / 450. This is widely used in water dispensers, irrigation systems, and industrial flow monitoring.","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Arduino Uno","quantity":1},{"name":"YF-S201 Flow Sensor","quantity":1},{"name":"16×2 LCD (optional)","quantity":1},{"name":"10kΩ Resistor (pull-up)","quantity":1},{"name":"Connecting Wires","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"Flow Sensor VCC","to":"Arduino 5V"},{"from":"Flow Sensor GND","to":"Arduino GND"},{"from":"Flow Sensor Signal","to":"Arduino D2 (INT0)"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Connect the YF-S201 sensor: Red→5V, Black→GND, Yellow→D2.","Add a 10kΩ pull-up resistor between the signal wire and 5V.","Upload the code. Open Serial Monitor at 9600 baud.","Allow water to flow through the sensor.","Observe flow rate (L/min) and cumulative volume (L) on Serial Monitor.","Test with different flow rates and compare readings."]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Arduino Code', v_ix, '{"code":"volatile int pulseCount = 0;\nfloat flowRate, totalLitres;\nunsigned long lastTime;\n\nvoid pulseCounter() {\n  pulseCount++;\n}\n\nvoid setup() {\n  Serial.begin(9600);\n  pinMode(2, INPUT_PULLUP);\n  attachInterrupt(digitalPinToInterrupt(2), pulseCounter, FALLING);\n  lastTime = millis();\n  totalLitres = 0;\n}\n\nvoid loop() {\n  if (millis() - lastTime >= 1000) {\n    detachInterrupt(digitalPinToInterrupt(2));\n\n    flowRate   = pulseCount / 7.5;\n    totalLitres += flowRate / 60;\n\n    Serial.print(\"Flow Rate: \");    Serial.print(flowRate);   Serial.println(\" L/min\");\n    Serial.print(\"Total Volume: \"); Serial.print(totalLitres); Serial.println(\" L\");\n\n    pulseCount = 0;\n    lastTime   = millis();\n    attachInterrupt(digitalPinToInterrupt(2), pulseCounter, FALLING);\n  }\n}","language":"arduino_c","platform":"Arduino"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

-- ═══ 5. LED & Push Button Interfacing with Raspberry Pi ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'led-button-rpi';
  if v_exp is null then
    raise notice 'skipping %: not present', 'led-button-rpi';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'LED & Push Button Interfacing with Raspberry Pi Simulation', '{"sim_type":"rpi_led"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'LED & Push Button Interfacing with Raspberry Pi Simulation',
           config = '{"sim_type":"rpi_led"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'LED & Push Button Interfacing with Raspberry Pi Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Which Python library is used for Raspberry Pi GPIO?', '[{"id":"a","text":"pyGPIO"},{"id":"b","text":"RPi.GPIO"},{"id":"c","text":"gpio-py"},{"id":"d","text":"Pi.GPIO"}]'::jsonb, 'b', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'GPIO.BCM refers to:', '[{"id":"a","text":"Board pin numbers"},{"id":"b","text":"Broadcom chip numbering"},{"id":"c","text":"Binary coded mode"},{"id":"d","text":"None"}]'::jsonb, 'b', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'What does GPIO.cleanup() do?', '[{"id":"a","text":"Resets GPIO pins to safe defaults"},{"id":"b","text":"Deletes Python files"},{"id":"c","text":"Turns off Pi"},{"id":"d","text":"Clears RAM"}]'::jsonb, 'a', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Raspberry Pi GPIO operates at:', '[{"id":"a","text":"5V"},{"id":"b","text":"3.3V"},{"id":"c","text":"1.8V"},{"id":"d","text":"12V"}]'::jsonb, 'b', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Raspberry Pi","objectives":["To interface an LED and Push Button with Raspberry Pi using Python and the RPi.GPIO library."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"The Raspberry Pi exposes General Purpose Input/Output (GPIO) pins that can be configured as digital inputs or outputs. Using Python''s RPi.GPIO library, pins are set as INPUT (for button) or OUTPUT (for LED). The button uses a pull-up resistor so the input reads HIGH normally and goes LOW when pressed. The LED is toggled based on button state. GPIO.BCM mode uses Broadcom chip numbering; GPIO.BOARD uses physical pin numbers.","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Raspberry Pi (any model)","quantity":1},{"name":"LED","quantity":1},{"name":"220Ω Resistor","quantity":1},{"name":"Push Button","quantity":1},{"name":"10kΩ Pull-down Resistor","quantity":1},{"name":"Connecting Wires","quantity":1},{"name":"Breadboard","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"LED Anode","to":"GPIO17 (Pin 11) via 220Ω"},{"from":"LED Cathode","to":"GND (Pin 6)"},{"from":"Button Pin 1","to":"GPIO27 (Pin 13)"},{"from":"Button Pin 2","to":"3.3V (Pin 1) via 10kΩ"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Boot Raspberry Pi and open a terminal.","Install RPi.GPIO: sudo apt-get install python3-rpi.gpio","Connect LED to GPIO17 via 220Ω resistor; cathode to GND.","Connect button between GPIO27 and GND (use PUD_DOWN resistor in code).","Create a new file: nano led_button.py and paste the code.","Run: python3 led_button.py","Press the button to toggle the LED. Press Ctrl+C to exit cleanly."]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Python Code', v_ix, '{"code":"import RPi.GPIO as GPIO\nimport time\n\n# Pin configuration\nLED_PIN    = 17\nBUTTON_PIN = 27\n\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(LED_PIN,    GPIO.OUT)\nGPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)\n\nprint(\"Press button to toggle LED. Ctrl+C to exit.\")\n\nled_state = False\n\ntry:\n    while True:\n        if GPIO.input(BUTTON_PIN) == GPIO.HIGH:\n            led_state = not led_state\n            GPIO.output(LED_PIN, led_state)\n            state_str = \"ON\" if led_state else \"OFF\"\n            print(f\"LED {state_str}\")\n            time.sleep(0.3)  # debounce\n        time.sleep(0.05)\n\nexcept KeyboardInterrupt:\n    print(\"Cleaning up GPIO...\")\n    GPIO.cleanup()","language":"python","platform":"Raspberry Pi"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

-- ═══ 6. Motion Sensor Alarm using PIR Sensor ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'pir-alarm-arduino';
  if v_exp is null then
    raise notice 'skipping %: not present', 'pir-alarm-arduino';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'Motion Sensor Alarm using PIR Sensor Simulation', '{"sim_type":"pir_alarm"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'Motion Sensor Alarm using PIR Sensor Simulation',
           config = '{"sim_type":"pir_alarm"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'Motion Sensor Alarm using PIR Sensor Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'PIR sensor detects:', '[{"id":"a","text":"Visible light"},{"id":"b","text":"Ultrasonic waves"},{"id":"c","text":"Infrared radiation"},{"id":"d","text":"Magnetic fields"}]'::jsonb, 'c', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'HC-SR501 warm-up time needed:', '[{"id":"a","text":"5 sec"},{"id":"b","text":"30–60 sec"},{"id":"c","text":"5 min"},{"id":"d","text":"None"}]'::jsonb, 'b', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Active buzzer vs passive buzzer:', '[{"id":"a","text":"Active needs external tone"},{"id":"b","text":"Active has internal oscillator"},{"id":"c","text":"No difference"},{"id":"d","text":"Passive is louder"}]'::jsonb, 'b', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Which adjusts PIR detection range?', '[{"id":"a","text":"Tx knob"},{"id":"b","text":"Sx knob"},{"id":"c","text":"Reset pin"},{"id":"d","text":"Power LED"}]'::jsonb, 'b', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Arduino / RPi","objectives":["To design a motion-activated alarm system using a PIR sensor and buzzer with Arduino."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"A PIR (Passive Infrared) sensor detects changes in infrared radiation caused by moving warm bodies. The HC-SR501 PIR module has adjustable sensitivity (Sx) and time delay (Tx) potentiometers. When motion is detected, the output pin goes HIGH. The Arduino reads this signal and activates a buzzer/LED alarm. The alarm can include a countdown timer before reset, making it suitable for home security systems.","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Arduino Uno","quantity":1},{"name":"PIR Sensor HC-SR501","quantity":1},{"name":"Active Buzzer","quantity":1},{"name":"Red LED","quantity":1},{"name":"Green LED","quantity":1},{"name":"220Ω Resistors","quantity":1},{"name":"Connecting Wires","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"PIR VCC","to":"Arduino 5V"},{"from":"PIR GND","to":"Arduino GND"},{"from":"PIR OUT","to":"Arduino D7"},{"from":"Buzzer +","to":"Arduino D8"},{"from":"Buzzer −","to":"GND"},{"from":"Red LED","to":"Arduino D12 (via 220Ω)"},{"from":"Green LED","to":"Arduino D11 (via 220Ω)"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Allow PIR sensor to warm up for ~60 seconds after power-on.","Connect PIR OUT to Arduino D7; Buzzer to D8; LEDs to D11 and D12.","Upload the code and open Serial Monitor.","Green LED stays ON in idle state.","Walk in front of PIR — Red LED turns ON and buzzer beeps 10 times.","Adjust PIR sensitivity (Sx) and hold time (Tx) knobs for tuning.","Experiment: add a timestamp or SMS alert via GSM module."]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Arduino Code', v_ix, '{"code":"#define PIR_PIN    7\n#define BUZZER     8\n#define RED_LED    12\n#define GREEN_LED  11\n\nvoid setup() {\n  Serial.begin(9600);\n  pinMode(PIR_PIN,   INPUT);\n  pinMode(BUZZER,    OUTPUT);\n  pinMode(RED_LED,   OUTPUT);\n  pinMode(GREEN_LED, OUTPUT);\n  // System ready indication\n  digitalWrite(GREEN_LED, HIGH);\n  Serial.println(\"PIR Alarm Ready — Waiting...\");\n}\n\nvoid loop() {\n  int motion = digitalRead(PIR_PIN);\n\n  if (motion == HIGH) {\n    Serial.println(\"⚠ MOTION DETECTED — ALARM!\");\n    digitalWrite(GREEN_LED, LOW);\n    digitalWrite(RED_LED,   HIGH);\n\n    for (int i = 0; i < 10; i++) {\n      digitalWrite(BUZZER, HIGH); delay(200);\n      digitalWrite(BUZZER, LOW);  delay(200);\n    }\n    digitalWrite(RED_LED, LOW);\n    digitalWrite(GREEN_LED, HIGH);\n  } else {\n    Serial.println(\"No motion — System Idle\");\n  }\n  delay(500);\n}","language":"arduino_c","platform":"Arduino / RPi"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

-- ═══ 7. DHT11 Temperature & Humidity with Raspberry Pi ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'dht11-rpi';
  if v_exp is null then
    raise notice 'skipping %: not present', 'dht11-rpi';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'DHT11 Temperature & Humidity with Raspberry Pi Simulation', '{"sim_type":"dht11"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'DHT11 Temperature & Humidity with Raspberry Pi Simulation',
           config = '{"sim_type":"dht11"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'DHT11 Temperature & Humidity with Raspberry Pi Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'DHT11 data pin on Raspberry Pi needs:', '[{"id":"a","text":"Pull-down"},{"id":"b","text":"Pull-up"},{"id":"c","text":"No resistor"},{"id":"d","text":"Capacitor"}]'::jsonb, 'b', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'read_retry() retries how many times by default?', '[{"id":"a","text":"3"},{"id":"b","text":"5"},{"id":"c","text":"15"},{"id":"d","text":"1"}]'::jsonb, 'c', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Python f-string syntax:', '[{"id":"a","text":"f\"text{var}\""},{"id":"b","text":"\"{var}\".format()"},{"id":"c","text":"str(var)"},{"id":"d","text":"All of these"}]'::jsonb, 'd', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'CSV stands for:', '[{"id":"a","text":"Comma Separated Values"},{"id":"b","text":"Code Save Version"},{"id":"c","text":"Calibrated Sensor Values"},{"id":"d","text":"None"}]'::jsonb, 'a', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Raspberry Pi","objectives":["To interface the DHT11 temperature and humidity sensor with Raspberry Pi using Python and the Adafruit DHT library."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"The DHT11 sensor communicates via a single-wire protocol. On Raspberry Pi, the Adafruit_DHT Python library handles the low-level timing. The sensor is connected to any GPIO pin. Python reads temperature in Celsius and humidity as a percentage. The data can be logged to a file, displayed in real-time, or sent to an IoT cloud platform. Typical use cases include greenhouse monitoring, HVAC control, and weather stations.","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Raspberry Pi","quantity":1},{"name":"DHT11 Sensor","quantity":1},{"name":"10kΩ Resistor","quantity":1},{"name":"Connecting Wires","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"DHT11 VCC","to":"3.3V (Pin 1)"},{"from":"DHT11 GND","to":"GND (Pin 6)"},{"from":"DHT11 DATA","to":"GPIO4 (Pin 7) + 10kΩ pull-up to 3.3V"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Install the library: pip3 install Adafruit_DHT","Connect DHT11 DATA pin to GPIO4 with a 10kΩ pull-up resistor to 3.3V.","Create the Python script and run: python3 dht_rpi.py","Observe temperature and humidity values printed every 2 seconds.","Check dht_log.csv for logged data.","Optionally plot data using matplotlib: pip3 install matplotlib"]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Python Code', v_ix, '{"code":"import Adafruit_DHT\nimport time\n\nDHT_SENSOR = Adafruit_DHT.DHT11\nDHT_PIN    = 4   # GPIO4\n\nprint(\"DHT11 on Raspberry Pi — Reading sensor...\")\n\nwhile True:\n    humidity, temperature = Adafruit_DHT.read_retry(DHT_SENSOR, DHT_PIN)\n\n    if humidity is not None and temperature is not None:\n        print(f\"Temp={temperature:.1f}°C  Humidity={humidity:.1f}%\")\n\n        # Log to CSV file\n        with open(\"dht_log.csv\", \"a\") as f:\n            ts = time.strftime(\"%Y-%m-%d %H:%M:%S\")\n            f.write(f\"{ts},{temperature:.1f},{humidity:.1f}\n\")\n    else:\n        print(\"Failed to read sensor!\")\n\n    time.sleep(2)","language":"python","platform":"Raspberry Pi"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

-- ═══ 8. DS18B20 Temperature Sensor with Raspberry Pi ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'ds18b20-rpi';
  if v_exp is null then
    raise notice 'skipping %: not present', 'ds18b20-rpi';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'DS18B20 Temperature Sensor with Raspberry Pi Simulation', '{"sim_type":"ds18b20"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'DS18B20 Temperature Sensor with Raspberry Pi Simulation',
           config = '{"sim_type":"ds18b20"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'DS18B20 Temperature Sensor with Raspberry Pi Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'DS18B20 protocol:', '[{"id":"a","text":"SPI"},{"id":"b","text":"I2C"},{"id":"c","text":"1-Wire"},{"id":"d","text":"UART"}]'::jsonb, 'c', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Temperature range of DS18B20:', '[{"id":"a","text":"0 to 100°C"},{"id":"b","text":"-55 to 125°C"},{"id":"c","text":"-10 to 60°C"},{"id":"d","text":"0 to 50°C"}]'::jsonb, 'b', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Pull-up resistor value for 1-Wire:', '[{"id":"a","text":"1kΩ"},{"id":"b","text":"4.7kΩ"},{"id":"c","text":"10kΩ"},{"id":"d","text":"100kΩ"}]'::jsonb, 'b', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Sensor ID prefix in /sys/bus/w1/devices:', '[{"id":"a","text":"11-"},{"id":"b","text":"28-"},{"id":"c","text":"ds-"},{"id":"d","text":"tmp-"}]'::jsonb, 'b', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Raspberry Pi","objectives":["To interface the DS18B20 digital temperature sensor with Raspberry Pi using the 1-Wire protocol."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"The DS18B20 is a waterproof digital thermometer with 9–12 bit resolution (-55°C to +125°C). It uses the Dallas 1-Wire protocol on GPIO4 by default. The Raspberry Pi kernel includes 1-Wire support; it must be enabled in raspi-config or /boot/config.txt. Each DS18B20 has a unique 64-bit serial code, allowing multiple sensors on the same data line — ideal for multi-zone temperature monitoring.","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Raspberry Pi","quantity":1},{"name":"DS18B20 Sensor (waterproof probe)","quantity":1},{"name":"4.7kΩ Resistor","quantity":1},{"name":"Connecting Wires","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"DS18B20 Red (VDD)","to":"3.3V"},{"from":"DS18B20 Black (GND)","to":"GND"},{"from":"DS18B20 Yellow (Data)","to":"GPIO4 + 4.7kΩ pull-up to 3.3V"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Enable 1-Wire: sudo raspi-config → Interface Options → 1-Wire → Enable.","Reboot: sudo reboot","Connect DS18B20 data line to GPIO4 with 4.7kΩ pull-up to 3.3V.","Verify sensor detected: ls /sys/bus/w1/devices/ (should see 28-xxxx directory)","Run the Python script: python3 ds18b20.py","Dip probe in warm and cold water to test different temperatures.","Multiple sensors: add more DS18B20 on same data line; each has unique ID."]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Python Code', v_ix, '{"code":"import os, glob, time\n\n# Enable 1-Wire: add dtoverlay=w1-gpio to /boot/config.txt\nos.system(''modprobe w1-gpio'')\nos.system(''modprobe w1-therm'')\n\nbase_dir   = ''/sys/bus/w1/devices/''\ndevice_dir = glob.glob(base_dir + ''28*'')[0]\ndevice_file = device_dir + ''/w1_slave''\n\ndef read_temp_raw():\n    with open(device_file, ''r'') as f:\n        return f.readlines()\n\ndef read_temp():\n    lines = read_temp_raw()\n    while lines[0].strip()[-3:] != ''YES'':\n        time.sleep(0.2)\n        lines = read_temp_raw()\n    eq_pos = lines[1].find(''t='')\n    temp_c = float(lines[1][eq_pos+2:]) / 1000.0\n    return temp_c\n\nwhile True:\n    temp = read_temp()\n    print(f\"Temperature: {temp:.3f}°C  |  {temp*9/5+32:.3f}°F\")\n    time.sleep(1)","language":"python","platform":"Raspberry Pi"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

-- ═══ 9. DC Motor & Stepper Motor Control with Raspberry Pi ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'motor-control-rpi';
  if v_exp is null then
    raise notice 'skipping %: not present', 'motor-control-rpi';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'DC Motor & Stepper Motor Control with Raspberry Pi Simulation', '{"sim_type":"motor"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'DC Motor & Stepper Motor Control with Raspberry Pi Simulation',
           config = '{"sim_type":"motor"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'DC Motor & Stepper Motor Control with Raspberry Pi Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'L298N is a:', '[{"id":"a","text":"Sensor"},{"id":"b","text":"H-Bridge Motor Driver"},{"id":"c","text":"Voltage regulator"},{"id":"d","text":"Amplifier"}]'::jsonb, 'b', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'PWM frequency used in the code:', '[{"id":"a","text":"100 Hz"},{"id":"b","text":"500 Hz"},{"id":"c","text":"1000 Hz"},{"id":"d","text":"2000 Hz"}]'::jsonb, 'c', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, '28BYJ-48 steps per revolution (half-step):', '[{"id":"a","text":"200"},{"id":"b","text":"512"},{"id":"c","text":"1024"},{"id":"d","text":"4096"}]'::jsonb, 'd', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Duty cycle 0 means:', '[{"id":"a","text":"Full speed"},{"id":"b","text":"Half speed"},{"id":"c","text":"Motor stopped"},{"id":"d","text":"Reverse"}]'::jsonb, 'c', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Raspberry Pi","objectives":["To control a DC motor (speed & direction) and stepper motor using Raspberry Pi with Python and L298N motor driver."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"DC motors require an H-bridge driver (L298N) to control direction and PWM for speed. The L298N has Enable, IN1, IN2 pins per motor. PWM via GPIO allows variable speed control (0–100%). Stepper motors (28BYJ-48 with ULN2003 driver) move in discrete steps via coil sequences. Half-step sequence (8 steps) provides smoother motion at lower torque; full-step (4 steps) gives higher torque. RPM = (Steps/sec) / (Steps per revolution).","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Raspberry Pi","quantity":1},{"name":"L298N Motor Driver","quantity":1},{"name":"DC Motor (5V)","quantity":1},{"name":"28BYJ-48 Stepper Motor","quantity":1},{"name":"ULN2003 Driver Board","quantity":1},{"name":"12V Power Supply","quantity":1},{"name":"Connecting Wires","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"L298N ENA","to":"GPIO18 (PWM)"},{"from":"L298N IN1","to":"GPIO23"},{"from":"L298N IN2","to":"GPIO24"},{"from":"L298N 12V","to":"External 12V"},{"from":"L298N GND","to":"Common GND"},{"from":"ULN2003 IN1-IN4","to":"GPIO17,27,22,5"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Connect L298N: ENA→GPIO18, IN1→GPIO23, IN2→GPIO24.","Connect stepper via ULN2003: IN1-IN4 → GPIO17, 27, 22, 5.","Power the L298N with external 12V; share common GND with Pi.","Run python3 motor.py — DC motor runs at 75% speed for 3s.","Stepper rotates 512 steps (~1 revolution for 28BYJ-48).","Adjust delay in step() to control stepper speed.","Modify ChangeDutyCycle value (0–100) to control DC motor speed."]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Python Code', v_ix, '{"code":"import RPi.GPIO as GPIO\nimport time\n\nGPIO.setmode(GPIO.BCM)\n\n# ── DC Motor (L298N) ─────────────────────\nENA, IN1, IN2 = 18, 23, 24\nGPIO.setup([ENA, IN1, IN2], GPIO.OUT)\npwm = GPIO.PWM(ENA, 1000)\npwm.start(0)\n\ndef motor_forward(speed):\n    GPIO.output(IN1, GPIO.HIGH)\n    GPIO.output(IN2, GPIO.LOW)\n    pwm.ChangeDutyCycle(speed)\n\ndef motor_stop():\n    pwm.ChangeDutyCycle(0)\n\n# ── Stepper Motor (ULN2003) ───────────────\nstep_pins = [17, 27, 22, 5]\nseq = [[1,0,0,1],[1,0,0,0],[1,1,0,0],[0,1,0,0],\n       [0,1,1,0],[0,0,1,0],[0,0,1,1],[0,0,0,1]]\nfor p in step_pins: GPIO.setup(p, GPIO.OUT)\n\ndef step(steps, delay=0.001):\n    for _ in range(steps):\n        for s in seq:\n            for i, p in enumerate(step_pins):\n                GPIO.output(p, GPIO.HIGH if s[i] else GPIO.LOW)\n            time.sleep(delay)\n\n# ── Demo ──────────────────────────────────\nmotor_forward(75); time.sleep(3); motor_stop()\nstep(512)   # ~one full revolution\nGPIO.cleanup()","language":"python","platform":"Raspberry Pi"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

-- ═══ 10. Smartphone Controlled Home Automation with Raspberry Pi ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'home-automation-rpi';
  if v_exp is null then
    raise notice 'skipping %: not present', 'home-automation-rpi';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'Smartphone Controlled Home Automation with Raspberry Pi Simulation', '{"sim_type":"home_auto"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'Smartphone Controlled Home Automation with Raspberry Pi Simulation',
           config = '{"sim_type":"home_auto"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'Smartphone Controlled Home Automation with Raspberry Pi Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Flask runs on which default port?', '[{"id":"a","text":"80"},{"id":"b","text":"3000"},{"id":"c","text":"5000"},{"id":"d","text":"8080"}]'::jsonb, 'c', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'host="0.0.0.0" means:', '[{"id":"a","text":"Only localhost"},{"id":"b","text":"All network interfaces"},{"id":"c","text":"Only WiFi"},{"id":"d","text":"Only LAN"}]'::jsonb, 'b', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Why use relay with Raspberry Pi?', '[{"id":"a","text":"Increase speed"},{"id":"b","text":"Electrical isolation for AC loads"},{"id":"c","text":"Save power"},{"id":"d","text":"Reduce noise"}]'::jsonb, 'b', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'HTTP method for visiting a URL in browser:', '[{"id":"a","text":"POST"},{"id":"b","text":"PUT"},{"id":"c","text":"GET"},{"id":"d","text":"DELETE"}]'::jsonb, 'c', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Raspberry Pi","objectives":["To implement a smartphone-controlled home automation system using Raspberry Pi as a WiFi server and Flask web framework."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"Raspberry Pi runs a Flask web server accessible over the local WiFi network. A smartphone browser sends HTTP GET requests to control GPIO pins. Each pin maps to a home appliance (light, fan, etc.) via a relay module. The relay provides electrical isolation between 3.3V GPIO logic and 230V AC loads. The web interface shows real-time status of each appliance and provides toggle buttons, accessible from any device on the same network.","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Raspberry Pi 3/4","quantity":1},{"name":"4-Channel Relay Module","quantity":1},{"name":"LEDs (simulate loads)","quantity":1},{"name":"WiFi Network","quantity":1},{"name":"Smartphone / PC Browser","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"Relay IN1–IN4","to":"GPIO17, 27, 22, 23"},{"from":"Relay VCC","to":"5V"},{"from":"Relay GND","to":"GND"},{"from":"Note","to":"Use opto-isolated relay for 230V AC loads"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Install Flask: pip3 install flask","Connect 4-channel relay IN1–IN4 to GPIO17, 27, 22, 23.","Run: python3 home_auto.py","Find Pi IP: hostname -I (e.g., 192.168.1.100)","Open smartphone browser: http://192.168.1.100:5000","Tap Toggle buttons to switch appliances ON/OFF.","Ensure smartphone and Pi are on the same WiFi network."]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Python Code', v_ix, '{"code":"from flask import Flask, render_template_string, redirect\nimport RPi.GPIO as GPIO\n\napp = Flask(__name__)\nGPIO.setmode(GPIO.BCM)\n\ndevices = {\n    ''Light'': 17, ''Fan'': 27, ''AC'': 22, ''TV'': 23\n}\nstate = {k: False for k in devices}\nfor pin in devices.values(): GPIO.setup(pin, GPIO.OUT, initial=GPIO.LOW)\n\nHTML = \"\"\"\n<h1>Home Automation</h1>\n{% for name, pin in devices.items() %}\n  <p>{{name}}: {{state[name]}}\n  <a href=\"/toggle/{{name}}\">Toggle</a></p>\n{% endfor %}\"\"\"\n\n@app.route(''/'')\ndef index():\n    return render_template_string(HTML, devices=devices, state=state)\n\n@app.route(''/toggle/<name>'')\ndef toggle(name):\n    if name in devices:\n        state[name] = not state[name]\n        GPIO.output(devices[name], state[name])\n    return redirect(''/'')\n\nif __name__ == ''__main__'':\n    app.run(host=''0.0.0.0'', port=5000)","language":"python","platform":"Raspberry Pi"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

-- ═══ 11. Smart Traffic Light Controller ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'smart-traffic-controller';
  if v_exp is null then
    raise notice 'skipping %: not present', 'smart-traffic-controller';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'Smart Traffic Light Controller Simulation', '{"sim_type":"smart_traffic"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'Smart Traffic Light Controller Simulation',
           config = '{"sim_type":"smart_traffic"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'Smart Traffic Light Controller Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Smart traffic adjusts green time based on:', '[{"id":"a","text":"Time of day"},{"id":"b","text":"Vehicle density"},{"id":"c","text":"Temperature"},{"id":"d","text":"Random"}]'::jsonb, 'b', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'analogRead() returns a value of:', '[{"id":"a","text":"0–255"},{"id":"b","text":"0–1023"},{"id":"c","text":"0–5"},{"id":"d","text":"0–100"}]'::jsonb, 'b', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Advantage of smart traffic over fixed timing:', '[{"id":"a","text":"Lower cost"},{"id":"b","text":"Reduced waiting time"},{"id":"c","text":"Simpler wiring"},{"id":"d","text":"None"}]'::jsonb, 'b', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Yellow light duration in this code:', '[{"id":"a","text":"1s"},{"id":"b","text":"2s"},{"id":"c","text":"3s"},{"id":"d","text":"5s"}]'::jsonb, 'b', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Advanced","objectives":["To design an adaptive Smart Traffic Light Controller that adjusts green light duration based on simulated traffic density."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"A smart traffic system uses sensors (IR, ultrasonic, or camera) to detect vehicle density at each lane. The controller allocates more green time to the lane with higher density using a weighted round-robin algorithm. In simulation, potentiometers represent traffic density. A microcontroller calculates green phase duration = Base_Time + (Density × Scale_Factor). Emergency vehicle detection can force all lights red. This reduces average waiting time by 40–60% over fixed-timing systems.","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Arduino Mega","quantity":1},{"name":"12× LEDs (3 sets RGYG)","quantity":1},{"name":"4× Potentiometers","quantity":1},{"name":"4× IR Sensors (optional)","quantity":1},{"name":"LCD 16×2","quantity":1},{"name":"Connecting Wires","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"Lane 1 R/Y/G LEDs","to":"Pins 22,23,24"},{"from":"Lane 2 R/Y/G LEDs","to":"Pins 25,26,27"},{"from":"Lane 3 R/Y/G LEDs","to":"Pins 28,29,30"},{"from":"Lane 4 R/Y/G LEDs","to":"Pins 31,32,33"},{"from":"Density Pots","to":"A0, A1, A2, A3"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Set up 4 lanes with R/Y/G LEDs on Arduino Mega.","Connect potentiometers to A0–A3 to simulate traffic density.","Upload the code. Open Serial Monitor.","Rotate pots to different positions — observe green times change.","Lane with highest density (pot fully turned) gets longest green phase.","Extend: add IR sensors for real vehicle detection.","Extend: display countdown timer on LCD."]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Arduino Code', v_ix, '{"code":"int redPins[]   = {22,25,28,31};\nint yelPins[]   = {23,26,29,32};\nint grnPins[]   = {24,27,30,33};\nint densityPin[]= {A0, A1, A2, A3};\n\nvoid allRed() {\n  for(int i=0;i<4;i++){\n    digitalWrite(redPins[i],HIGH);\n    digitalWrite(yelPins[i],LOW);\n    digitalWrite(grnPins[i],LOW);\n  }\n}\n\nvoid setGreen(int lane) {\n  allRed();\n  digitalWrite(redPins[lane], LOW);\n  digitalWrite(grnPins[lane], HIGH);\n}\n\nvoid setup() {\n  for(int i=0;i<4;i++){\n    pinMode(redPins[i],OUTPUT);\n    pinMode(yelPins[i],OUTPUT);\n    pinMode(grnPins[i],OUTPUT);\n  }\n  allRed(); Serial.begin(9600);\n}\n\nvoid loop() {\n  for(int i=0;i<4;i++){\n    int density  = analogRead(densityPin[i]);\n    int greenTime = 3000 + (long)density * 7;\n    Serial.print(\"Lane \"); Serial.print(i+1);\n    Serial.print(\" Green: \"); Serial.print(greenTime); Serial.println(\"ms\");\n    setGreen(i);  delay(greenTime);\n    // Yellow transition\n    digitalWrite(grnPins[i], LOW);\n    digitalWrite(yelPins[i], HIGH);\n    delay(2000);\n  }\n}","language":"python","platform":"Advanced"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

-- ═══ 12. Smart Health Monitoring System ═══
do $mig$
declare
  v_exp  uuid;
  v_sim  uuid;
  v_quiz uuid;
  v_form uuid;
  v_ix   int := 0;
begin
  select id into v_exp from experiments where slug = 'health-monitoring-rpi';
  if v_exp is null then
    raise notice 'skipping %: not present', 'health-monitoring-rpi';
    return;
  end if;

  -- Simulation: built-in widget keyed by sim_type.
  select id into v_sim from simulations where experiment_id = v_exp limit 1;
  if v_sim is null then
    insert into simulations (experiment_id, type, title, config)
    values (v_exp, 'builtin', 'Smart Health Monitoring System Simulation', '{"sim_type":"health"}'::jsonb)
    returning id into v_sim;
  else
    update simulations
       set type = 'builtin',
           title = 'Smart Health Monitoring System Simulation',
           config = '{"sim_type":"health"}'::jsonb
     where id = v_sim;
  end if;

  -- Pre-test quiz.
  select id into v_quiz from quizzes where experiment_id = v_exp and type = 'pretest' limit 1;
  if v_quiz is null then
    insert into quizzes (experiment_id, type, title)
    values (v_exp, 'pretest', 'Smart Health Monitoring System Pre-Test')
    returning id into v_quiz;
  end if;

  -- Questions come from the authored source for every experiment, so the
  -- three that were already populated stay in step with the other nine.
  delete from quiz_questions where quiz_id = v_quiz;
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Why use MCP3008 with Raspberry Pi?', '[{"id":"a","text":"GPIO shortage"},{"id":"b","text":"Pi has no ADC pins"},{"id":"c","text":"Faster processing"},{"id":"d","text":"Cost reduction"}]'::jsonb, 'b', 1);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'Normal human body temperature range:', '[{"id":"a","text":"34–36°C"},{"id":"b","text":"36.1–37.2°C"},{"id":"c","text":"37.5–39°C"},{"id":"d","text":"35–40°C"}]'::jsonb, 'b', 2);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'ThingSpeak is used for:', '[{"id":"a","text":"GPS tracking"},{"id":"b","text":"IoT cloud data logging"},{"id":"c","text":"Motor control"},{"id":"d","text":"Image processing"}]'::jsonb, 'b', 3);
  insert into quiz_questions (quiz_id, question_text, options, correct_answer, order_number)
  values (v_quiz, 'PPG (photoplethysmography) detects:', '[{"id":"a","text":"Blood pressure"},{"id":"b","text":"Oxygen saturation"},{"id":"c","text":"Blood volume pulse"},{"id":"d","text":"All of these"}]'::jsonb, 'c', 4);

  select id into v_form from feedback_forms where experiment_id = v_exp limit 1;
  if v_form is null then
    insert into feedback_forms (experiment_id, title)
    values (v_exp, 'Feedback') returning id into v_form;
  end if;

  -- Sections rebuilt from the authored source.
  delete from experiment_sections where experiment_id = v_exp;

  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'aim', 'Aim', v_ix, '{"note":"Experiment platform: Raspberry Pi","objectives":["To build a smart health monitoring system using Raspberry Pi that measures body temperature and heart rate, and logs data to a cloud dashboard."],"outcomes":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'theory', 'Theory', v_ix, '{"introduction":"The Smart Health Monitoring System integrates a DS18B20 temperature sensor (body temperature) and a pulse sensor (heart rate via photoplethysmography). The Raspberry Pi reads these values, computes BPM using peak detection on pulse sensor ADC data (via MCP3008 SPI ADC since Pi lacks analog pins), and evaluates thresholds: Normal Temp 36.1–37.2°C, Normal BPM 60–100. Alerts are triggered on abnormal readings. Data is sent to ThingSpeak IoT cloud using HTTP API for remote monitoring by healthcare providers.","sections":[]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'components', 'Components Required', v_ix, '{"items":[{"name":"Raspberry Pi 3/4","quantity":1},{"name":"DS18B20 Temperature Sensor","quantity":1},{"name":"Pulse Sensor (SEN-11574)","quantity":1},{"name":"MCP3008 ADC","quantity":1},{"name":"4.7kΩ Resistor","quantity":1},{"name":"OLED Display (optional)","quantity":1},{"name":"WiFi Dongle","quantity":1}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'circuit', 'Circuit Diagram', v_ix, '{"connections":[{"from":"DS18B20 Data","to":"GPIO4 + 4.7kΩ pull-up"},{"from":"MCP3008 CLK/MOSI/MISO/CS","to":"GPIO11,10,9,8 (SPI0)"},{"from":"Pulse Sensor OUT","to":"MCP3008 CH0"}]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'procedure', 'Procedure', v_ix, '{"steps":["Enable SPI: sudo raspi-config → Interface Options → SPI → Enable.","Enable 1-Wire for DS18B20 (see Experiment 8).","Install dependencies: pip3 install spidev requests","Wire pulse sensor via MCP3008 SPI ADC.","Create a free ThingSpeak account and get your API key.","Paste your API key into the code and run it.","Visit your ThingSpeak channel to see real-time charts of temperature and BPM.","Set ThingSpeak alerts for abnormal values."]}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'simulation', 'Simulation', v_ix, jsonb_build_object('simulation_id', v_sim));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'code', 'Python Code', v_ix, '{"code":"import time, requests, spidev\nimport RPi.GPIO as GPIO\nimport glob\n\n# ── DS18B20 setup ────────────────────────\ndevice = glob.glob(''/sys/bus/w1/devices/28*'')[0]\n\ndef read_temp():\n    with open(device+''/w1_slave'') as f: raw = f.read()\n    return float(raw.split(''t='')[1]) / 1000\n\n# ── MCP3008 SPI ──────────────────────────\nspi = spidev.SpiDev(); spi.open(0,0); spi.max_speed_hz=1350000\n\ndef read_adc(ch):\n    r = spi.xfer2([1, (8+ch)<4, 0])\n    return ((r[1]&3)<8) + r[2]\n\n# ── ThingSpeak Config ─────────────────────\nAPI_KEY = \"YOUR_THINGSPEAK_API_KEY\"\nURL     = \"https://api.thingspeak.com/update\"\n\ndef upload(temp, bpm):\n    requests.get(URL, params={''api_key'':API_KEY,\n        ''field1'':temp, ''field2'':bpm})\n\nwhile True:\n    temp = read_temp()\n    bpm_raw = [read_adc(0) for _ in range(100)]\n    bpm = 60 + ((max(bpm_raw)-min(bpm_raw))//10)  # simplified\n\n    status = \"NORMAL\"\n    if not (36.1 <= temp <= 37.2): status = \"⚠ TEMP ALERT\"\n    if not (60   <= bpm  <= 100):  status = \"⚠ BPM ALERT\"\n\n    print(f\"Temp:{temp:.1f}°C BPM:{bpm} [{status}]\")\n    upload(temp, bpm)\n    time.sleep(15)","language":"python","platform":"Raspberry Pi"}'::jsonb);
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'quiz', 'Pre-Test', v_ix, jsonb_build_object('quiz_id', v_quiz));
  v_ix := v_ix + 1;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp, 'feedback', 'Feedback', v_ix, jsonb_build_object('form_id', v_form));
end $mig$;

commit;
