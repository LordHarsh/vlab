-- =============================================================================
-- seeds/003_experiments.sql
-- All 12 experiments for the IoT Virtual Lab.
-- =============================================================================

do $$
declare
  v_lab_id uuid;
  v_exp_id uuid;
begin
  select id into v_lab_id from labs where slug = 'iot-virtual-lab';

  -- ============================================================
  -- EXP 01: LED & DHT11 Temperature/Humidity Sensor (Arduino)
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'led-dht11-arduino', 'LED & DHT11 Temperature/Humidity Sensor Interfacing',
    'Interface an LED and DHT11 sensor with Arduino to display temperature and humidity on the Serial Monitor.',
    1, 'beginner', 45, true)
  on conflict (lab_id, slug) do nothing
  returning id into v_exp_id;

  if v_exp_id is null then
    select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'led-dht11-arduino';
  end if;

  insert into experiment_sections (experiment_id, type, title, order_index, content) values
  (v_exp_id, 'aim', 'Aim', 1, '{
    "objectives": ["Interface DHT11 sensor with Arduino Uno", "Read temperature and humidity via Serial Monitor", "Use LED as a visual threshold alert"],
    "outcomes": ["Understand single-wire sensor protocol", "Write Arduino code using the DHT library", "Implement threshold-based output control"],
    "note": "Experiment platform: Arduino Uno"
  }'),
  (v_exp_id, 'theory', 'Theory', 2, '{
    "introduction": "The DHT11 is a low-cost digital sensor that measures relative humidity (20–90% RH) and temperature (0–50°C) using a single-wire serial interface.",
    "sections": [
      {"heading": "DHT11 Protocol", "body": "The sensor outputs calibrated digital data sequentially: 8 bits humidity integer, 8 bits humidity decimal, 8 bits temperature integer, 8 bits temperature decimal, and 8 bits checksum."},
      {"heading": "LED Threshold Control", "body": "An external LED connected to D13 is turned ON when temperature exceeds 30°C, demonstrating simple threshold-based actuator control."}
    ]
  }'),
  (v_exp_id, 'components', 'Components Required', 3, '{
    "items": [
      {"name": "Arduino Uno", "quantity": 1},
      {"name": "DHT11 Sensor", "quantity": 1},
      {"name": "LED (Red)", "quantity": 1},
      {"name": "220Ω Resistor", "quantity": 1},
      {"name": "10kΩ Pull-up Resistor", "quantity": 1},
      {"name": "Connecting Wires", "quantity": 10},
      {"name": "Breadboard", "quantity": 1}
    ]
  }'),
  (v_exp_id, 'circuit', 'Circuit Diagram', 4, '{
    "connections": [
      {"from": "DHT11 VCC", "to": "Arduino 5V"},
      {"from": "DHT11 GND", "to": "Arduino GND"},
      {"from": "DHT11 DATA", "to": "Arduino D2 (+ 10kΩ pull-up to 5V)"},
      {"from": "LED Anode", "to": "Arduino D13 via 220Ω"},
      {"from": "LED Cathode", "to": "Arduino GND"}
    ]
  }'),
  (v_exp_id, 'procedure', 'Procedure', 5, '{
    "steps": [
      "Connect DHT11 VCC to Arduino 5V and GND to GND.",
      "Connect DHT11 DATA pin to Arduino D2 with a 10kΩ pull-up resistor to 5V.",
      "Connect LED anode to Arduino D13 via a 220Ω resistor; cathode to GND.",
      "Include the DHT library in Arduino IDE (Sketch → Include Library → search DHT sensor library).",
      "Upload the provided code to Arduino.",
      "Open Serial Monitor at 9600 baud to observe temperature and humidity readings.",
      "Breathe on the sensor to increase humidity and observe the change."
    ]
  }'),
  (v_exp_id, 'code', 'Arduino Code', 6, '{
    "language": "arduino_c",
    "platform": "Arduino Uno",
    "code": "#include <DHT.h>\n\n#define DHTPIN   2\n#define DHTTYPE  DHT11\n#define LED_PIN  13\n\nDHT dht(DHTPIN, DHTTYPE);\n\nvoid setup() {\n  Serial.begin(9600);\n  dht.begin();\n  pinMode(LED_PIN, OUTPUT);\n}\n\nvoid loop() {\n  delay(2000);\n  float h = dht.readHumidity();\n  float t = dht.readTemperature();\n  if (isnan(h) || isnan(t)) { Serial.println(\"Sensor read failed!\"); return; }\n  Serial.print(\"Humidity: \"); Serial.print(h); Serial.println(\" %\");\n  Serial.print(\"Temperature: \"); Serial.print(t); Serial.println(\" C\");\n  digitalWrite(LED_PIN, t > 30 ? HIGH : LOW);\n}"
  }'),
  (v_exp_id, 'references', 'References', 9, '{
    "items": [
      {"title": "DHT Sensor Library", "url": "https://github.com/adafruit/DHT-sensor-library"},
      {"title": "Arduino Reference", "url": "https://arduino.cc/reference"}
    ]
  }');

  -- simulation
  insert into simulations (experiment_id, type, title, config)
  values (v_exp_id, 'builtin_js', 'DHT11 Interactive Simulation', '{"sim_type": "dht11"}');

  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp_id, 'simulation', 'Simulation', 7,
    jsonb_build_object('simulation_id', (select id from simulations where experiment_id = v_exp_id limit 1)));

  -- quiz
  insert into quizzes (experiment_id, type, title, default_passing_percentage)
  values (v_exp_id, 'pretest', 'DHT11 Pre-Test', 70)
  on conflict do nothing;

  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
  select id, 'What is the operating voltage of the DHT11?',
    '[{"id":"a","text":"1.8V"},{"id":"b","text":"3.3V"},{"id":"c","text":"5V"},{"id":"d","text":"12V"}]',
    'c', 'DHT11 operates at 3.3V–5V. When used with Arduino Uno it is powered from 5V.', 1
  from quizzes where experiment_id = v_exp_id and type = 'pretest';

  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
  select id, 'What is the temperature measurement range of DHT11?',
    '[{"id":"a","text":"-40 to 80°C"},{"id":"b","text":"0 to 50°C"},{"id":"c","text":"-10 to 60°C"},{"id":"d","text":"0 to 100°C"}]',
    'b', 'DHT11 measures temperature in the range 0–50°C with ±2°C accuracy.', 2
  from quizzes where experiment_id = v_exp_id and type = 'pretest';

  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
  select id, 'How many data wires does DHT11 use?',
    '[{"id":"a","text":"2"},{"id":"b","text":"3"},{"id":"c","text":"1"},{"id":"d","text":"4"}]',
    'c', 'DHT11 uses a single-wire (1-Wire style) serial interface for data.', 3
  from quizzes where experiment_id = v_exp_id and type = 'pretest';

  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
  select id, 'What pull-up resistor value is recommended for the DHT11 data line?',
    '[{"id":"a","text":"1kΩ"},{"id":"b","text":"4.7kΩ"},{"id":"c","text":"10kΩ"},{"id":"d","text":"100kΩ"}]',
    'c', 'A 10kΩ pull-up resistor on the data line is recommended by the DHT11 datasheet.', 4
  from quizzes where experiment_id = v_exp_id and type = 'pretest';

  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp_id, 'quiz', 'Pre-Test', 8,
    jsonb_build_object('quiz_id', (select id from quizzes where experiment_id = v_exp_id and type = 'pretest')));

  -- feedback form
  insert into feedback_forms (experiment_id, title) values (v_exp_id, 'DHT11 Experiment Feedback')
  on conflict (experiment_id) do nothing;

  insert into feedback_questions (form_id, question_text, question_type, config, order_index)
  select id, 'How would you rate this experiment overall?', 'rating', '{"min":1,"max":5}', 1
  from feedback_forms where experiment_id = v_exp_id;

  insert into feedback_questions (form_id, question_text, question_type, order_index)
  select id, 'What did you find most challenging?', 'text', 2
  from feedback_forms where experiment_id = v_exp_id;

  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp_id, 'feedback', 'Feedback', 10,
    jsonb_build_object('form_id', (select id from feedback_forms where experiment_id = v_exp_id)));

  -- ============================================================
  -- EXP 02: Ultrasonic & PIR Sensor (Arduino)
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'ultrasonic-pir-arduino', 'Ultrasonic Sensor & PIR Sensor Interfacing',
    'Interface HC-SR04 Ultrasonic and PIR motion sensors with Arduino to measure distance and detect motion.',
    2, 'beginner', 45, true)
  on conflict (lab_id, slug) do nothing
  returning id into v_exp_id;

  if v_exp_id is null then
    select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'ultrasonic-pir-arduino';
  end if;

  insert into experiment_sections (experiment_id, type, title, order_index, content) values
  (v_exp_id, 'aim', 'Aim', 1, '{"objectives":["Measure distance using HC-SR04 ultrasonic sensor","Detect motion using PIR HC-SR501 sensor","Combine both sensors for a proximity alarm system"],"outcomes":["Understand pulse-echo distance measurement","Use Arduino interrupts and digital reads","Build a security/proximity detection system"]}'),
  (v_exp_id, 'theory', 'Theory', 2, '{"introduction":"Two sensors are combined to create a proximity and motion detection system.","sections":[{"heading":"HC-SR04 Ultrasonic Sensor","body":"Uses 40 kHz sound waves. Sends pulse via TRIG, measures echo return time via ECHO. Distance = (Time × 0.034) / 2. Range: 2–400 cm, resolution: 3 mm."},{"heading":"PIR Sensor HC-SR501","body":"Detects changes in infrared radiation from warm moving bodies. Output goes HIGH when motion is detected. Has adjustable sensitivity (Sx) and delay (Tx) potentiometers."}]}'),
  (v_exp_id, 'components', 'Components Required', 3, '{"items":[{"name":"Arduino Uno","quantity":1},{"name":"HC-SR04 Ultrasonic Sensor","quantity":1},{"name":"PIR Sensor HC-SR501","quantity":1},{"name":"LED","quantity":1},{"name":"220Ω Resistor","quantity":1},{"name":"Connecting Wires","quantity":12},{"name":"Breadboard","quantity":1}]}'),
  (v_exp_id, 'circuit', 'Circuit Diagram', 4, '{"connections":[{"from":"HC-SR04 VCC","to":"Arduino 5V"},{"from":"HC-SR04 GND","to":"Arduino GND"},{"from":"HC-SR04 TRIG","to":"Arduino D9"},{"from":"HC-SR04 ECHO","to":"Arduino D10"},{"from":"PIR VCC","to":"Arduino 5V"},{"from":"PIR GND","to":"Arduino GND"},{"from":"PIR OUT","to":"Arduino D7"},{"from":"LED Anode","to":"Arduino D13 via 220Ω"},{"from":"LED Cathode","to":"GND"}]}'),
  (v_exp_id, 'procedure', 'Procedure', 5, '{"steps":["Connect HC-SR04: VCC→5V, GND→GND, TRIG→D9, ECHO→D10.","Connect PIR: VCC→5V, GND→GND, OUT→D7.","Connect LED to D13 via 220Ω resistor.","Upload the code and open Serial Monitor at 9600 baud.","Move an object near the ultrasonic sensor to observe distance readings.","Wave your hand in front of the PIR sensor — observe DETECTED output.","Allow 30–60 seconds for PIR warm-up on startup."]}'),
  (v_exp_id, 'code', 'Arduino Code', 6, '{"language":"arduino_c","platform":"Arduino Uno","code":"#define TRIG_PIN  9\n#define ECHO_PIN  10\n#define PIR_PIN   7\n#define LED_PIN   13\n\nvoid setup() {\n  Serial.begin(9600);\n  pinMode(TRIG_PIN, OUTPUT);\n  pinMode(ECHO_PIN, INPUT);\n  pinMode(PIR_PIN, INPUT);\n  pinMode(LED_PIN, OUTPUT);\n}\n\nlong readDistance() {\n  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);\n  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);\n  digitalWrite(TRIG_PIN, LOW);\n  return pulseIn(ECHO_PIN, HIGH) * 0.034 / 2;\n}\n\nvoid loop() {\n  long dist = readDistance();\n  int pir = digitalRead(PIR_PIN);\n  Serial.print(\"Distance: \"); Serial.print(dist); Serial.println(\" cm\");\n  Serial.println(pir ? \"Motion: DETECTED\" : \"Motion: None\");\n  digitalWrite(LED_PIN, (pir || dist < 20) ? HIGH : LOW);\n  delay(500);\n}"}'),
  (v_exp_id, 'references', 'References', 9, '{"items":[{"title":"HC-SR04 Datasheet","url":"https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf"},{"title":"PIR Sensor Guide","url":"https://learn.adafruit.com/pir-passive-infrared-proximity-motion-sensor"}]}');

  insert into simulations (experiment_id, type, title, config)
  values (v_exp_id, 'builtin_js', 'Ultrasonic + PIR Simulation', '{"sim_type":"ultrasonic"}');

  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp_id, 'simulation', 'Simulation', 7,
    jsonb_build_object('simulation_id', (select id from simulations where experiment_id = v_exp_id limit 1)));

  insert into quizzes (experiment_id, type, title) values (v_exp_id, 'pretest', 'Ultrasonic & PIR Pre-Test') on conflict do nothing;

  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
  select id, 'What frequency does the HC-SR04 use?',
    '[{"id":"a","text":"20 kHz"},{"id":"b","text":"40 kHz"},{"id":"c","text":"100 kHz"},{"id":"d","text":"1 MHz"}]',
    'b', 'HC-SR04 transmits ultrasonic pulses at 40 kHz.', 1
  from quizzes where experiment_id = v_exp_id and type = 'pretest';

  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
  select id, 'Maximum measuring range of HC-SR04?',
    '[{"id":"a","text":"100 cm"},{"id":"b","text":"200 cm"},{"id":"c","text":"400 cm"},{"id":"d","text":"800 cm"}]',
    'c', 'HC-SR04 has a maximum range of 400 cm (4 m).', 2
  from quizzes where experiment_id = v_exp_id and type = 'pretest';

  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
  select id, 'What does PIR stand for?',
    '[{"id":"a","text":"Passive Infrared"},{"id":"b","text":"Positive IR"},{"id":"c","text":"Programmable IR"},{"id":"d","text":"Pulse Infrared"}]',
    'a', 'PIR stands for Passive Infrared — it passively detects IR radiation emitted by warm objects.', 3
  from quizzes where experiment_id = v_exp_id and type = 'pretest';

  insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
  select id, 'Speed of sound used in distance calculation ≈',
    '[{"id":"a","text":"100 m/s"},{"id":"b","text":"340 m/s"},{"id":"c","text":"500 m/s"},{"id":"d","text":"1500 m/s"}]',
    'b', 'Speed of sound in air at room temperature is approximately 340 m/s (0.034 cm/μs).', 4
  from quizzes where experiment_id = v_exp_id and type = 'pretest';

  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp_id, 'quiz', 'Pre-Test', 8,
    jsonb_build_object('quiz_id', (select id from quizzes where experiment_id = v_exp_id and type = 'pretest')));

  insert into feedback_forms (experiment_id, title) values (v_exp_id, 'Ultrasonic & PIR Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id, question_text, question_type, config, order_index)
  select id, 'Rate your understanding after this experiment.', 'rating', '{"min":1,"max":5}', 1 from feedback_forms where experiment_id = v_exp_id;
  insert into feedback_questions (form_id, question_text, question_type, order_index)
  select id, 'Any suggestions to improve this experiment?', 'text', 2 from feedback_forms where experiment_id = v_exp_id;
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp_id, 'feedback', 'Feedback', 10, jsonb_build_object('form_id', (select id from feedback_forms where experiment_id = v_exp_id)));

  -- ============================================================
  -- EXP 03: Traffic Light Simulator (Arduino)
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'traffic-light-arduino', 'Traffic Light Simulator',
    'Design and simulate a Traffic Light Controller using Arduino with Red, Yellow, and Green LEDs.',
    3, 'beginner', 30, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'traffic-light-arduino'; end if;

  insert into experiment_sections (experiment_id, type, title, order_index, content) values
  (v_exp_id, 'aim', 'Aim', 1, '{"objectives":["Control three LEDs to simulate a traffic light","Implement timed phase sequencing in Arduino"],"outcomes":["Use digitalWrite and delay functions","Understand state machines in embedded systems"]}'),
  (v_exp_id, 'theory', 'Theory', 2, '{"introduction":"A traffic light cycles: Green → Yellow → Red. Three LEDs simulate the lights; Arduino controls timing.","sections":[{"heading":"State Machine","body":"Green (5s): vehicles go. Yellow (2s): prepare to stop. Red (5s): vehicles stop. The cycle repeats indefinitely."},{"heading":"Extension","body":"A pedestrian button on D5 can force an early Red phase."}]}'),
  (v_exp_id, 'components', 'Components Required', 3, '{"items":[{"name":"Arduino Uno","quantity":1},{"name":"Red LED","quantity":1},{"name":"Yellow LED","quantity":1},{"name":"Green LED","quantity":1},{"name":"220Ω Resistors","quantity":3},{"name":"Push Button (optional)","quantity":1},{"name":"Connecting Wires","quantity":10},{"name":"Breadboard","quantity":1}]}'),
  (v_exp_id, 'circuit', 'Circuit Diagram', 4, '{"connections":[{"from":"Red LED Anode","to":"Arduino D2 via 220Ω"},{"from":"Yellow LED Anode","to":"Arduino D3 via 220Ω"},{"from":"Green LED Anode","to":"Arduino D4 via 220Ω"},{"from":"All LED Cathodes","to":"GND"}]}'),
  (v_exp_id, 'procedure', 'Procedure', 5, '{"steps":["Connect Red, Yellow, Green LEDs to D2, D3, D4 via 220Ω resistors.","All cathodes to GND.","Upload the code to Arduino.","Observe the traffic sequence: Green → Yellow → Red.","Modify delay values to change phase durations.","Optional: add push button to D5 for pedestrian mode."]}'),
  (v_exp_id, 'code', 'Arduino Code', 6, '{"language":"arduino_c","platform":"Arduino Uno","code":"#define RED_PIN    2\n#define YELLOW_PIN 3\n#define GREEN_PIN  4\n\nvoid setLight(int r,int y,int g){\n  digitalWrite(RED_PIN,r); digitalWrite(YELLOW_PIN,y); digitalWrite(GREEN_PIN,g);\n}\nvoid setup(){\n  pinMode(RED_PIN,OUTPUT); pinMode(YELLOW_PIN,OUTPUT); pinMode(GREEN_PIN,OUTPUT);\n  Serial.begin(9600);\n}\nvoid loop(){\n  setLight(LOW,LOW,HIGH);  Serial.println(\"GREEN\");  delay(5000);\n  setLight(LOW,HIGH,LOW);  Serial.println(\"YELLOW\"); delay(2000);\n  setLight(HIGH,LOW,LOW);  Serial.println(\"RED\");    delay(5000);\n}"}'),
  (v_exp_id, 'references', 'References', 9, '{"items":[{"title":"Arduino delay() Reference","url":"https://www.arduino.cc/reference/en/language/functions/time/delay/"}]}');

  insert into simulations (experiment_id, type, title, config)
  values (v_exp_id, 'builtin_js', 'Traffic Light Simulation', '{"sim_type":"traffic"}');
  insert into experiment_sections (experiment_id, type, title, order_index, content)
  values (v_exp_id, 'simulation', 'Simulation', 7, jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));

  insert into quizzes (experiment_id, type, title) values (v_exp_id,'pretest','Traffic Light Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'In a standard traffic sequence, which phase comes after Green?','[{"id":"a","text":"Red"},{"id":"b","text":"Blue"},{"id":"c","text":"Yellow"},{"id":"d","text":"White"}]','c','Green → Yellow → Red is the standard sequence. Yellow is the transition/warning phase.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'What is the purpose of the Yellow light?','[{"id":"a","text":"Emergency stop"},{"id":"b","text":"Prepare to stop"},{"id":"c","text":"U-turn allowed"},{"id":"d","text":"Pedestrian walk"}]','b','Yellow signals drivers to slow down and prepare to stop before Red.',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Which Arduino function is used for timing delays?','[{"id":"a","text":"millis()"},{"id":"b","text":"time()"},{"id":"c","text":"delay()"},{"id":"d","text":"timer()"}]','c','delay(ms) pauses execution for the given number of milliseconds.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'What component limits current through an LED?','[{"id":"a","text":"Capacitor"},{"id":"b","text":"Resistor"},{"id":"c","text":"Transistor"},{"id":"d","text":"Diode"}]','b','A series resistor limits current to a safe level for the LED.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'Traffic Light Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Comments or suggestions?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 04: Water Flow Detection (Arduino)
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'water-flow-arduino', 'Water Flow Detection using Arduino',
    'Interface a YF-S201 water flow sensor with Arduino to measure flow rate and total water volume.',
    4, 'intermediate', 45, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'water-flow-arduino'; end if;

  insert into experiment_sections (experiment_id, type, title, order_index, content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Measure water flow rate in L/min","Calculate cumulative volume using pulse counting"],"outcomes":["Understand hall-effect flow sensing","Use hardware interrupts on Arduino"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"The YF-S201 uses a hall-effect sensor and turbine. Pulses are counted via hardware interrupt.","sections":[{"heading":"Flow Rate Formula","body":"Flow Rate (L/min) = Pulse Frequency / 7.5. Volume (L) = Total Pulses / 450."},{"heading":"Hardware Interrupts","body":"Arduino INT0 on D2 counts every FALLING edge from the sensor, ensuring no pulses are missed."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Arduino Uno","quantity":1},{"name":"YF-S201 Flow Sensor","quantity":1},{"name":"10kΩ Pull-up Resistor","quantity":1},{"name":"Connecting Wires","quantity":5}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"Flow Sensor VCC (Red)","to":"Arduino 5V"},{"from":"Flow Sensor GND (Black)","to":"Arduino GND"},{"from":"Flow Sensor Signal (Yellow)","to":"Arduino D2 + 10kΩ pull-up to 5V"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Connect VCC→5V, GND→GND, Signal→D2 with 10kΩ pull-up.","Upload the code. Open Serial Monitor at 9600 baud.","Allow water to flow through the sensor.","Observe flow rate (L/min) and cumulative volume (L).","Test with different flow rates and compare."]}'),
  (v_exp_id,'code','Arduino Code',6,'{"language":"arduino_c","platform":"Arduino Uno","code":"volatile int pulseCount = 0;\nfloat flowRate, totalLitres;\nunsigned long lastTime;\n\nvoid pulseCounter() { pulseCount++; }\n\nvoid setup() {\n  Serial.begin(9600);\n  pinMode(2, INPUT_PULLUP);\n  attachInterrupt(digitalPinToInterrupt(2), pulseCounter, FALLING);\n  lastTime = millis(); totalLitres = 0;\n}\n\nvoid loop() {\n  if (millis() - lastTime >= 1000) {\n    detachInterrupt(digitalPinToInterrupt(2));\n    flowRate = pulseCount / 7.5;\n    totalLitres += flowRate / 60;\n    Serial.print(\"Flow: \"); Serial.print(flowRate); Serial.println(\" L/min\");\n    Serial.print(\"Volume: \"); Serial.print(totalLitres); Serial.println(\" L\");\n    pulseCount = 0; lastTime = millis();\n    attachInterrupt(digitalPinToInterrupt(2), pulseCounter, FALLING);\n  }\n}"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"YF-S201 Datasheet","url":"https://www.seeedstudio.com/Water-Flow-Sensor-YF-S201-p-635.html"}]}');

  insert into simulations (experiment_id, type, title, config) values (v_exp_id,'builtin_js','Flow Sensor Simulation','{"sim_type":"flow"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','Flow Sensor Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'What sensing technology does YF-S201 use?','[{"id":"a","text":"Optical"},{"id":"b","text":"Ultrasonic"},{"id":"c","text":"Hall-Effect"},{"id":"d","text":"Capacitive"}]','c','YF-S201 uses a hall-effect sensor triggered by a magnet on the turbine.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Flow rate formula given pulse frequency F (L/min):','[{"id":"a","text":"F/7.5"},{"id":"b","text":"F×7.5"},{"id":"c","text":"F/60"},{"id":"d","text":"F+7.5"}]','a','Flow Rate = F / 7.5 where F is pulse frequency in Hz.',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Which Arduino pin supports INT0 hardware interrupt?','[{"id":"a","text":"D0"},{"id":"b","text":"D2"},{"id":"c","text":"D5"},{"id":"d","text":"A0"}]','b','D2 is INT0 on Arduino Uno.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'What is the volatile keyword used for in Arduino?','[{"id":"a","text":"Increase speed"},{"id":"b","text":"Flag variables shared with ISR"},{"id":"c","text":"Save memory"},{"id":"d","text":"Increase voltage"}]','b','volatile tells the compiler not to cache the variable; it may be changed by an ISR.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'Flow Sensor Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 05: LED & Push Button with Raspberry Pi
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'led-button-rpi', 'LED & Push Button Interfacing with Raspberry Pi',
    'Interface an LED and Push Button with Raspberry Pi using Python and the RPi.GPIO library.',
    5, 'beginner', 40, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'led-button-rpi'; end if;

  insert into experiment_sections (experiment_id,type,title,order_index,content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Configure Raspberry Pi GPIO pins as input and output","Toggle LED state with a push button using Python"],"outcomes":["Use RPi.GPIO library","Understand BCM vs BOARD pin numbering","Implement software debounce"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"Raspberry Pi GPIO pins can be configured as digital inputs or outputs using RPi.GPIO in Python.","sections":[{"heading":"GPIO Modes","body":"GPIO.BCM uses Broadcom chip numbering. GPIO.BOARD uses physical pin numbers. BCM is more portable."},{"heading":"Pull Resistors","body":"PUD_DOWN pulls the input LOW when button is not pressed; PUD_UP pulls it HIGH. This determines the logic level when the button is open."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Raspberry Pi (any model)","quantity":1},{"name":"LED","quantity":1},{"name":"220Ω Resistor","quantity":1},{"name":"Push Button","quantity":1},{"name":"Connecting Wires","quantity":6},{"name":"Breadboard","quantity":1}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"LED Anode","to":"GPIO17 (Pin 11) via 220Ω"},{"from":"LED Cathode","to":"GND (Pin 6)"},{"from":"Button Pin 1","to":"GPIO27 (Pin 13)"},{"from":"Button Pin 2","to":"GND (common)"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Boot Raspberry Pi and open a terminal.","Install RPi.GPIO if needed: sudo apt-get install python3-rpi.gpio","Connect LED to GPIO17 via 220Ω; cathode to GND.","Connect button between GPIO27 and GND (PUD_DOWN in code).","Create led_button.py and paste the code.","Run: python3 led_button.py","Press the button to toggle LED. Ctrl+C to exit cleanly."]}'),
  (v_exp_id,'code','Python Code',6,'{"language":"python","platform":"Raspberry Pi","code":"import RPi.GPIO as GPIO\nimport time\n\nLED_PIN    = 17\nBUTTON_PIN = 27\n\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(LED_PIN,    GPIO.OUT)\nGPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)\n\nled_state = False\nprint(\"Press button to toggle LED. Ctrl+C to exit.\")\n\ntry:\n    while True:\n        if GPIO.input(BUTTON_PIN) == GPIO.HIGH:\n            led_state = not led_state\n            GPIO.output(LED_PIN, led_state)\n            print(\"LED\", \"ON\" if led_state else \"OFF\")\n            time.sleep(0.3)\n        time.sleep(0.05)\nexcept KeyboardInterrupt:\n    GPIO.cleanup()"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"RPi.GPIO Documentation","url":"https://pypi.org/project/RPi.GPIO/"},{"title":"Raspberry Pi GPIO Pinout","url":"https://pinout.xyz"}]}');

  insert into simulations (experiment_id,type,title,config) values (v_exp_id,'builtin_js','RPi LED & Button Simulation','{"sim_type":"rpi_led"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','RPi GPIO Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Which Python library is used for Raspberry Pi GPIO control?','[{"id":"a","text":"pyGPIO"},{"id":"b","text":"RPi.GPIO"},{"id":"c","text":"gpio-py"},{"id":"d","text":"Pi.GPIO"}]','b','RPi.GPIO is the standard Python library for controlling Raspberry Pi GPIO pins.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'GPIO.BCM refers to:','[{"id":"a","text":"Board pin numbers"},{"id":"b","text":"Broadcom chip numbering"},{"id":"c","text":"Binary coded mode"},{"id":"d","text":"None of the above"}]','b','BCM mode uses the Broadcom SOC channel numbering printed on the chip.',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'What does GPIO.cleanup() do?','[{"id":"a","text":"Resets GPIO pins to safe state"},{"id":"b","text":"Deletes Python files"},{"id":"c","text":"Turns off the Pi"},{"id":"d","text":"Clears RAM"}]','a','GPIO.cleanup() resets all GPIO pins to their default safe input state.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Raspberry Pi GPIO logic level:','[{"id":"a","text":"5V"},{"id":"b","text":"3.3V"},{"id":"c","text":"1.8V"},{"id":"d","text":"12V"}]','b','Raspberry Pi GPIO operates at 3.3V logic — connecting 5V signals directly will damage the Pi.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'RPi GPIO Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 06: Motion Sensor Alarm using PIR (Arduino)
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'pir-alarm-arduino', 'Motion Sensor Alarm using PIR Sensor',
    'Design a motion-activated alarm system using a PIR sensor and buzzer with Arduino.',
    6, 'beginner', 40, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'pir-alarm-arduino'; end if;

  insert into experiment_sections (experiment_id,type,title,order_index,content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Detect motion using PIR HC-SR501","Activate buzzer and LED alarm on motion"],"outcomes":["Understand PIR sensor operation","Implement an alarm state machine"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"PIR detects IR changes from warm moving bodies. HC-SR501 has adjustable sensitivity (Sx) and hold time (Tx).","sections":[{"heading":"Active vs Passive Buzzer","body":"Active buzzer has internal oscillator — just apply voltage. Passive requires an external tone signal via PWM."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Arduino Uno","quantity":1},{"name":"PIR Sensor HC-SR501","quantity":1},{"name":"Active Buzzer","quantity":1},{"name":"Red LED","quantity":1},{"name":"Green LED","quantity":1},{"name":"220Ω Resistors","quantity":2},{"name":"Connecting Wires","quantity":10}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"PIR VCC","to":"Arduino 5V"},{"from":"PIR GND","to":"Arduino GND"},{"from":"PIR OUT","to":"Arduino D7"},{"from":"Buzzer +","to":"Arduino D8"},{"from":"Buzzer −","to":"GND"},{"from":"Red LED","to":"Arduino D12 via 220Ω"},{"from":"Green LED","to":"Arduino D11 via 220Ω"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Allow PIR 60s warm-up after power-on.","Wire PIR→D7, Buzzer→D8, Red LED→D12, Green LED→D11.","Upload code and open Serial Monitor.","Green LED stays ON in idle. Walk in front of PIR to trigger alarm."]}'),
  (v_exp_id,'code','Arduino Code',6,'{"language":"arduino_c","platform":"Arduino Uno","code":"#define PIR_PIN   7\n#define BUZZER    8\n#define RED_LED   12\n#define GREEN_LED 11\n\nvoid setup(){\n  Serial.begin(9600);\n  pinMode(PIR_PIN,INPUT); pinMode(BUZZER,OUTPUT);\n  pinMode(RED_LED,OUTPUT); pinMode(GREEN_LED,OUTPUT);\n  digitalWrite(GREEN_LED,HIGH);\n}\nvoid loop(){\n  if(digitalRead(PIR_PIN)==HIGH){\n    Serial.println(\"MOTION DETECTED\");\n    digitalWrite(GREEN_LED,LOW); digitalWrite(RED_LED,HIGH);\n    for(int i=0;i<10;i++){digitalWrite(BUZZER,HIGH);delay(200);digitalWrite(BUZZER,LOW);delay(200);}\n    digitalWrite(RED_LED,LOW); digitalWrite(GREEN_LED,HIGH);\n  }\n  delay(500);\n}"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"HC-SR501 PIR Datasheet","url":"https://www.mpja.com/download/31227sc.pdf"}]}');

  insert into simulations (experiment_id,type,title,config) values (v_exp_id,'builtin_js','PIR Alarm Simulation','{"sim_type":"pir_alarm"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','PIR Alarm Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'PIR sensor detects:','[{"id":"a","text":"Visible light"},{"id":"b","text":"Ultrasonic waves"},{"id":"c","text":"Infrared radiation"},{"id":"d","text":"Magnetic fields"}]','c','PIR detects changes in infrared radiation emitted by warm bodies.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'HC-SR501 warm-up time needed after power-on:','[{"id":"a","text":"5 sec"},{"id":"b","text":"30–60 sec"},{"id":"c","text":"5 min"},{"id":"d","text":"No warm-up"}]','b','HC-SR501 requires 30–60 seconds to stabilise its internal reference after power-on.',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Active buzzer vs passive buzzer:','[{"id":"a","text":"Active needs external tone"},{"id":"b","text":"Active has internal oscillator"},{"id":"c","text":"No difference"},{"id":"d","text":"Passive is always louder"}]','b','Active buzzers contain an internal oscillator and only need a DC voltage.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Which potentiometer on HC-SR501 adjusts detection range?','[{"id":"a","text":"Tx knob"},{"id":"b","text":"Sx knob"},{"id":"c","text":"Reset pin"},{"id":"d","text":"Power LED"}]','b','Sx (sensitivity) adjusts the detection range up to ~7 m.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'PIR Alarm Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 07: DHT11 with Raspberry Pi
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'dht11-rpi', 'DHT11 Temperature & Humidity with Raspberry Pi',
    'Interface the DHT11 sensor with Raspberry Pi using Python and the Adafruit DHT library.',
    7, 'beginner', 40, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'dht11-rpi'; end if;

  insert into experiment_sections (experiment_id,type,title,order_index,content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Read temperature and humidity from DHT11 on Raspberry Pi","Log sensor data to a CSV file"],"outcomes":["Use Adafruit_DHT Python library","Log timestamped data for analysis"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"On Raspberry Pi the Adafruit_DHT library handles low-level single-wire timing.","sections":[{"heading":"Data Logging","body":"Data can be written to a CSV file with timestamps and later plotted using matplotlib."},{"heading":"Use Cases","body":"Greenhouse monitoring, HVAC control, and weather stations."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Raspberry Pi","quantity":1},{"name":"DHT11 Sensor","quantity":1},{"name":"10kΩ Pull-up Resistor","quantity":1},{"name":"Connecting Wires","quantity":4}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"DHT11 VCC","to":"3.3V (Pin 1)"},{"from":"DHT11 GND","to":"GND (Pin 6)"},{"from":"DHT11 DATA","to":"GPIO4 (Pin 7) + 10kΩ pull-up to 3.3V"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Install library: pip3 install Adafruit_DHT","Connect DHT11 DATA to GPIO4 with 10kΩ pull-up.","Create dht_rpi.py and run: python3 dht_rpi.py","Observe readings every 2 seconds.","Check dht_log.csv for logged data."]}'),
  (v_exp_id,'code','Python Code',6,'{"language":"python","platform":"Raspberry Pi","code":"import Adafruit_DHT, time\n\nDHT_SENSOR = Adafruit_DHT.DHT11\nDHT_PIN    = 4\n\nwhile True:\n    humidity, temperature = Adafruit_DHT.read_retry(DHT_SENSOR, DHT_PIN)\n    if humidity is not None and temperature is not None:\n        print(f\"Temp={temperature:.1f}C  Humidity={humidity:.1f}%\")\n        with open(\"dht_log.csv\",\"a\") as f:\n            f.write(f\"{time.strftime(\\'%Y-%m-%d %H:%M:%S\\')},{temperature:.1f},{humidity:.1f}\\n\")\n    else:\n        print(\"Sensor read failed\")\n    time.sleep(2)"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"Adafruit DHT Python Library","url":"https://github.com/adafruit/Adafruit_Python_DHT"}]}');

  insert into simulations (experiment_id,type,title,config) values (v_exp_id,'builtin_js','DHT11 RPi Simulation','{"sim_type":"dht11"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','DHT11 RPi Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'DHT11 data pin on Raspberry Pi requires:','[{"id":"a","text":"Pull-down"},{"id":"b","text":"Pull-up"},{"id":"c","text":"No resistor"},{"id":"d","text":"Capacitor"}]','b','A 10kΩ pull-up to 3.3V is required on the data line.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'read_retry() retries how many times by default?','[{"id":"a","text":"3"},{"id":"b","text":"5"},{"id":"c","text":"15"},{"id":"d","text":"1"}]','c','Adafruit_DHT.read_retry retries 15 times by default.',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Python f-string syntax:','[{"id":"a","text":"f\"text{var}\""},{"id":"b","text":"\"{var}\".format()"},{"id":"c","text":"str(var)"},{"id":"d","text":"All of these"}]','d','All three are valid Python string formatting approaches.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'CSV stands for:','[{"id":"a","text":"Comma Separated Values"},{"id":"b","text":"Code Save Version"},{"id":"c","text":"Calibrated Sensor Values"},{"id":"d","text":"None"}]','a','CSV = Comma Separated Values, a plain-text format for tabular data.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'DHT11 RPi Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 08: DS18B20 Temperature Sensor with Raspberry Pi
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'ds18b20-rpi', 'DS18B20 Temperature Sensor with Raspberry Pi',
    'Interface the DS18B20 digital temperature sensor with Raspberry Pi using the 1-Wire protocol.',
    8, 'intermediate', 45, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'ds18b20-rpi'; end if;

  insert into experiment_sections (experiment_id,type,title,order_index,content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Read temperature from DS18B20 using 1-Wire protocol","Support multiple DS18B20 sensors on a single data line"],"outcomes":["Enable and use 1-Wire kernel module","Parse w1_slave file format"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"DS18B20 is a waterproof digital thermometer (-55 to +125°C) using Dallas 1-Wire protocol on GPIO4 by default.","sections":[{"heading":"1-Wire Protocol","body":"Each DS18B20 has a unique 64-bit serial ID, allowing multiple sensors on one wire. The kernel w1-gpio and w1-therm modules handle the protocol."},{"heading":"Resolution","body":"Configurable 9–12 bit resolution. 12-bit gives 0.0625°C accuracy but takes up to 750ms per reading."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Raspberry Pi","quantity":1},{"name":"DS18B20 Waterproof Probe","quantity":1},{"name":"4.7kΩ Resistor","quantity":1},{"name":"Connecting Wires","quantity":4}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"DS18B20 Red (VDD)","to":"3.3V"},{"from":"DS18B20 Black (GND)","to":"GND"},{"from":"DS18B20 Yellow (Data)","to":"GPIO4 + 4.7kΩ pull-up to 3.3V"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Enable 1-Wire: sudo raspi-config → Interface Options → 1-Wire → Enable. Reboot.","Connect DS18B20 data to GPIO4 with 4.7kΩ pull-up.","Verify: ls /sys/bus/w1/devices/ (should see 28-xxxx)","Run: python3 ds18b20.py","Dip probe in warm/cold water to test.","Multiple sensors: add more DS18B20 on same data line."]}'),
  (v_exp_id,'code','Python Code',6,'{"language":"python","platform":"Raspberry Pi","code":"import os, glob, time\n\nos.system(\"modprobe w1-gpio\")\nos.system(\"modprobe w1-therm\")\n\nbase_dir   = \"/sys/bus/w1/devices/\"\ndevice_dir = glob.glob(base_dir + \"28*\")[0]\ndevice_file = device_dir + \"/w1_slave\"\n\ndef read_temp():\n    with open(device_file,\"r\") as f: lines = f.readlines()\n    while lines[0].strip()[-3:] != \"YES\":\n        time.sleep(0.2)\n        with open(device_file,\"r\") as f: lines = f.readlines()\n    eq_pos = lines[1].find(\"t=\")\n    return float(lines[1][eq_pos+2:]) / 1000.0\n\nwhile True:\n    t = read_temp()\n    print(f\"Temperature: {t:.3f}C  |  {t*9/5+32:.3f}F\")\n    time.sleep(1)"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"DS18B20 Datasheet","url":"https://datasheets.maximintegrated.com/en/ds/DS18B20.pdf"}]}');

  insert into simulations (experiment_id,type,title,config) values (v_exp_id,'builtin_js','DS18B20 Simulation','{"sim_type":"ds18b20"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','DS18B20 Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'DS18B20 uses which communication protocol?','[{"id":"a","text":"SPI"},{"id":"b","text":"I2C"},{"id":"c","text":"1-Wire"},{"id":"d","text":"UART"}]','c','DS18B20 uses Dallas 1-Wire protocol.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Temperature range of DS18B20:','[{"id":"a","text":"0 to 100°C"},{"id":"b","text":"-55 to 125°C"},{"id":"c","text":"-10 to 60°C"},{"id":"d","text":"0 to 50°C"}]','b','-55 to +125°C with ±0.5°C accuracy in the -10 to +85°C range.',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Pull-up resistor for 1-Wire data line:','[{"id":"a","text":"1kΩ"},{"id":"b","text":"4.7kΩ"},{"id":"c","text":"10kΩ"},{"id":"d","text":"100kΩ"}]','b','4.7kΩ is the recommended pull-up for 1-Wire bus.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Device ID prefix in /sys/bus/w1/devices/:','[{"id":"a","text":"11-"},{"id":"b","text":"28-"},{"id":"c","text":"ds-"},{"id":"d","text":"tmp-"}]','b','DS18B20 devices appear as 28-xxxxxxxxxxxx in the w1 device tree.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'DS18B20 Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 09: DC Motor & Stepper Motor with Raspberry Pi
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'motor-control-rpi', 'DC Motor & Stepper Motor Control with Raspberry Pi',
    'Control a DC motor (speed & direction) and stepper motor using Raspberry Pi and L298N motor driver.',
    9, 'intermediate', 60, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'motor-control-rpi'; end if;

  insert into experiment_sections (experiment_id,type,title,order_index,content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Control DC motor speed and direction via L298N H-bridge","Drive 28BYJ-48 stepper motor using ULN2003 driver"],"outcomes":["Use PWM for speed control","Implement half-step sequence for stepper"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"DC motors require an H-bridge (L298N) for direction control and PWM for speed. Steppers move in discrete coil-sequence steps.","sections":[{"heading":"L298N H-Bridge","body":"Enable pin controls PWM speed. IN1/IN2 set direction. ChangeDutyCycle(0–100) varies speed."},{"heading":"Stepper Motor Half-Step","body":"8-step sequence gives smoother motion. 28BYJ-48 has 4096 half-steps per revolution with ULN2003 driver."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Raspberry Pi","quantity":1},{"name":"L298N Motor Driver","quantity":1},{"name":"DC Motor (5V)","quantity":1},{"name":"28BYJ-48 Stepper Motor","quantity":1},{"name":"ULN2003 Driver Board","quantity":1},{"name":"External 12V Power Supply","quantity":1}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"L298N ENA","to":"GPIO18 (PWM)"},{"from":"L298N IN1","to":"GPIO23"},{"from":"L298N IN2","to":"GPIO24"},{"from":"L298N 12V","to":"External 12V"},{"from":"L298N GND","to":"Common GND"},{"from":"ULN2003 IN1-IN4","to":"GPIO17, 27, 22, 5"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Wire L298N: ENA→GPIO18, IN1→GPIO23, IN2→GPIO24.","Wire stepper via ULN2003: IN1–IN4 → GPIO17, 27, 22, 5.","Power L298N from external 12V; share common GND with Pi.","Run motor.py — DC motor runs at 75% speed for 3s.","Stepper rotates 512 steps (~1 revolution).","Adjust delay in step() to change stepper speed."]}'),
  (v_exp_id,'code','Python Code',6,'{"language":"python","platform":"Raspberry Pi","code":"import RPi.GPIO as GPIO, time\n\nGPIO.setmode(GPIO.BCM)\nENA,IN1,IN2 = 18,23,24\nGPIO.setup([ENA,IN1,IN2],GPIO.OUT)\npwm = GPIO.PWM(ENA,1000); pwm.start(0)\n\ndef motor_forward(speed): GPIO.output(IN1,GPIO.HIGH); GPIO.output(IN2,GPIO.LOW); pwm.ChangeDutyCycle(speed)\ndef motor_stop(): pwm.ChangeDutyCycle(0)\n\nstep_pins=[17,27,22,5]\nseq=[[1,0,0,1],[1,0,0,0],[1,1,0,0],[0,1,0,0],[0,1,1,0],[0,0,1,0],[0,0,1,1],[0,0,0,1]]\nfor p in step_pins: GPIO.setup(p,GPIO.OUT)\n\ndef step(steps,delay=0.001):\n  for _ in range(steps):\n    for s in seq:\n      for i,p in enumerate(step_pins): GPIO.output(p,GPIO.HIGH if s[i] else GPIO.LOW)\n      time.sleep(delay)\n\nmotor_forward(75); time.sleep(3); motor_stop()\nstep(512)\nGPIO.cleanup()"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"L298N Motor Driver Guide","url":"https://lastminuteengineers.com/l298n-dc-stepper-driver-arduino-tutorial/"}]}');

  insert into simulations (experiment_id,type,title,config) values (v_exp_id,'builtin_js','Motor Control Simulation','{"sim_type":"motor"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','Motor Control Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'L298N is classified as:','[{"id":"a","text":"Sensor"},{"id":"b","text":"H-Bridge Motor Driver"},{"id":"c","text":"Voltage regulator"},{"id":"d","text":"Amplifier"}]','b','L298N is a dual H-bridge motor driver IC.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'PWM frequency used for DC motor control in code:','[{"id":"a","text":"100 Hz"},{"id":"b","text":"500 Hz"},{"id":"c","text":"1000 Hz"},{"id":"d","text":"2000 Hz"}]','c','GPIO.PWM(ENA, 1000) sets 1 kHz PWM frequency.',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'28BYJ-48 total half-steps per revolution:','[{"id":"a","text":"200"},{"id":"b","text":"512"},{"id":"c","text":"1024"},{"id":"d","text":"4096"}]','d','28BYJ-48 has 4096 half-steps per full shaft revolution.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'ChangeDutyCycle(0) means:','[{"id":"a","text":"Full speed"},{"id":"b","text":"Half speed"},{"id":"c","text":"Motor stopped"},{"id":"d","text":"Reverse direction"}]','c','Duty cycle 0% means no power; motor stops.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'Motor Control Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 10: Home Automation with Raspberry Pi (Flask)
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'home-automation-rpi', 'Smartphone Controlled Home Automation with Raspberry Pi',
    'Build a smartphone-controlled home automation system using Raspberry Pi as a WiFi server with Flask.',
    10, 'intermediate', 60, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'home-automation-rpi'; end if;

  insert into experiment_sections (experiment_id,type,title,order_index,content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Run a Flask web server on Raspberry Pi","Control GPIO relay outputs from a smartphone browser"],"outcomes":["Use Flask routing and templates","Control home appliances via HTTP GET requests"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"Raspberry Pi runs Flask on the local WiFi network. Smartphones send HTTP GET requests to toggle GPIO pins connected to relay modules.","sections":[{"heading":"Flask Web Framework","body":"Flask is a lightweight Python web framework. Routes map URLs to Python functions. render_template_string renders HTML inline."},{"heading":"Relay Module","body":"4-channel opto-isolated relay provides electrical isolation between 3.3V GPIO logic and 230V AC loads. Always use opto-isolated relays for AC."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Raspberry Pi 3/4","quantity":1},{"name":"4-Channel Relay Module","quantity":1},{"name":"LEDs (simulate loads)","quantity":4},{"name":"WiFi Network","quantity":1}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"Relay IN1–IN4","to":"GPIO17, 27, 22, 23"},{"from":"Relay VCC","to":"5V"},{"from":"Relay GND","to":"GND"},{"from":"Note","to":"Use opto-isolated relay for 230V AC loads"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Install Flask: pip3 install flask","Connect relay IN1–IN4 to GPIO17, 27, 22, 23.","Run: python3 home_auto.py","Find Pi IP: hostname -I","Open smartphone browser: http://<Pi-IP>:5000","Tap Toggle buttons to switch appliances ON/OFF."]}'),
  (v_exp_id,'code','Python Code',6,'{"language":"python","platform":"Raspberry Pi","code":"from flask import Flask, render_template_string, redirect\nimport RPi.GPIO as GPIO\n\napp = Flask(__name__)\nGPIO.setmode(GPIO.BCM)\ndevices = {\"Light\":17,\"Fan\":27,\"AC\":22,\"TV\":23}\nstate = {k:False for k in devices}\nfor pin in devices.values(): GPIO.setup(pin,GPIO.OUT,initial=GPIO.LOW)\n\nHTML=\"\"\"<h1>Home Automation</h1>\n{% for name,pin in devices.items() %}\n<p>{{name}}: {{state[name]}} <a href=\"/toggle/{{name}}\">Toggle</a></p>\n{% endfor %}\"\"\"\n\n@app.route(\"/\")\ndef index(): return render_template_string(HTML,devices=devices,state=state)\n\n@app.route(\"/toggle/<name>\")\ndef toggle(name):\n    if name in devices:\n        state[name] = not state[name]\n        GPIO.output(devices[name],state[name])\n    return redirect(\"/\")\n\nif __name__==\"__main__\": app.run(host=\"0.0.0.0\",port=5000)"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"Flask Documentation","url":"https://flask.palletsprojects.com"}]}');

  insert into simulations (experiment_id,type,title,config) values (v_exp_id,'builtin_js','Home Automation Simulation','{"sim_type":"home_auto"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','Home Automation Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Flask default port:','[{"id":"a","text":"80"},{"id":"b","text":"3000"},{"id":"c","text":"5000"},{"id":"d","text":"8080"}]','c','Flask development server runs on port 5000 by default.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'host="0.0.0.0" means:','[{"id":"a","text":"Only localhost"},{"id":"b","text":"All network interfaces"},{"id":"c","text":"Only WiFi"},{"id":"d","text":"Only LAN"}]','b','0.0.0.0 binds to all available network interfaces, making the server accessible from the local network.',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Why use a relay module with Raspberry Pi?','[{"id":"a","text":"Increase processing speed"},{"id":"b","text":"Electrical isolation for AC loads"},{"id":"c","text":"Save power"},{"id":"d","text":"Reduce noise"}]','b','Relays provide electrical isolation between low-voltage GPIO (3.3V) and high-voltage AC loads.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'HTTP method when visiting a URL in a browser:','[{"id":"a","text":"POST"},{"id":"b","text":"PUT"},{"id":"c","text":"GET"},{"id":"d","text":"DELETE"}]','c','Browsers issue HTTP GET requests when navigating to a URL.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'Home Automation Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 11: Smart Traffic Light Controller (Advanced/Arduino)
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'smart-traffic-controller', 'Smart Traffic Light Controller',
    'Design an adaptive Smart Traffic Light Controller that adjusts green light duration based on simulated traffic density.',
    11, 'advanced', 75, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'smart-traffic-controller'; end if;

  insert into experiment_sections (experiment_id,type,title,order_index,content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Build adaptive traffic control adjusting green time by density","Use potentiometers to simulate lane traffic density"],"outcomes":["Implement weighted round-robin scheduling","Use analogRead for sensor input"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"Smart traffic systems allocate more green time to lanes with higher vehicle density, reducing average wait time 40–60% over fixed-timing.","sections":[{"heading":"Algorithm","body":"Green phase duration = Base_Time + (Density × Scale_Factor). All red transitions use a 2s yellow phase."},{"heading":"Density Simulation","body":"Potentiometers on A0–A3 return 0–1023 representing traffic density. In production, IR sensors or cameras replace them."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Arduino Mega","quantity":1},{"name":"Red LEDs","quantity":4},{"name":"Yellow LEDs","quantity":4},{"name":"Green LEDs","quantity":4},{"name":"220Ω Resistors","quantity":12},{"name":"Potentiometers 10kΩ","quantity":4},{"name":"Connecting Wires","quantity":30}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"Lane 1 R/Y/G LEDs","to":"Pins 22, 23, 24"},{"from":"Lane 2 R/Y/G LEDs","to":"Pins 25, 26, 27"},{"from":"Lane 3 R/Y/G LEDs","to":"Pins 28, 29, 30"},{"from":"Lane 4 R/Y/G LEDs","to":"Pins 31, 32, 33"},{"from":"Density Pots","to":"A0, A1, A2, A3"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Set up 4 lanes with R/Y/G LEDs on Arduino Mega.","Connect potentiometers to A0–A3.","Upload code and open Serial Monitor.","Rotate pots to different positions — observe green times change.","Lane with highest density gets longest green phase."]}'),
  (v_exp_id,'code','Arduino Code',6,'{"language":"arduino_c","platform":"Arduino Mega","code":"int redPins[]={22,25,28,31}; int yelPins[]={23,26,29,32}; int grnPins[]={24,27,30,33};\nint densityPin[]={A0,A1,A2,A3};\n\nvoid allRed(){for(int i=0;i<4;i++){digitalWrite(redPins[i],HIGH);digitalWrite(yelPins[i],LOW);digitalWrite(grnPins[i],LOW);}}\nvoid setGreen(int lane){allRed();digitalWrite(redPins[lane],LOW);digitalWrite(grnPins[lane],HIGH);}\n\nvoid setup(){for(int i=0;i<4;i++){pinMode(redPins[i],OUTPUT);pinMode(yelPins[i],OUTPUT);pinMode(grnPins[i],OUTPUT);}allRed();Serial.begin(9600);}\n\nvoid loop(){\n  for(int i=0;i<4;i++){\n    int density=analogRead(densityPin[i]);\n    int greenTime=3000+(long)density*7;\n    Serial.print(\"Lane \");Serial.print(i+1);Serial.print(\" Green: \");Serial.print(greenTime);Serial.println(\"ms\");\n    setGreen(i); delay(greenTime);\n    digitalWrite(grnPins[i],LOW); digitalWrite(yelPins[i],HIGH); delay(2000);\n  }\n}"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"Arduino analogRead","url":"https://www.arduino.cc/reference/en/language/functions/analog-io/analogread/"}]}');

  insert into simulations (experiment_id,type,title,config) values (v_exp_id,'builtin_js','Smart Traffic Simulation','{"sim_type":"smart_traffic"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','Smart Traffic Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Smart traffic adjusts green time based on:','[{"id":"a","text":"Time of day"},{"id":"b","text":"Vehicle density"},{"id":"c","text":"Temperature"},{"id":"d","text":"Random factor"}]','b','Green time is proportional to measured vehicle density per lane.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'analogRead() returns a value in range:','[{"id":"a","text":"0–255"},{"id":"b","text":"0–1023"},{"id":"c","text":"0–5"},{"id":"d","text":"0–100"}]','b','Arduino analogRead returns 0–1023 (10-bit ADC).',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Advantage of smart traffic over fixed timing:','[{"id":"a","text":"Lower cost"},{"id":"b","text":"Reduced average waiting time"},{"id":"c","text":"Simpler wiring"},{"id":"d","text":"No advantage"}]','b','Smart systems reduce average waiting time 40–60% by prioritising busy lanes.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Yellow light duration in the smart traffic code:','[{"id":"a","text":"1s"},{"id":"b","text":"2s"},{"id":"c","text":"3s"},{"id":"d","text":"5s"}]','b','delay(2000) = 2 seconds for yellow transition.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'Smart Traffic Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

  -- ============================================================
  -- EXP 12: Smart Health Monitoring System (Raspberry Pi)
  -- ============================================================
  insert into experiments (lab_id, slug, title, description, order_index, difficulty, estimated_duration, published)
  values (v_lab_id, 'health-monitoring-rpi', 'Smart Health Monitoring System',
    'Build a health monitoring system using Raspberry Pi to measure body temperature and heart rate, logging to ThingSpeak IoT cloud.',
    12, 'advanced', 90, true)
  on conflict (lab_id, slug) do nothing returning id into v_exp_id;

  if v_exp_id is null then select id into v_exp_id from experiments where lab_id = v_lab_id and slug = 'health-monitoring-rpi'; end if;

  insert into experiment_sections (experiment_id,type,title,order_index,content) values
  (v_exp_id,'aim','Aim',1,'{"objectives":["Measure body temperature with DS18B20 and heart rate via pulse sensor","Log data to ThingSpeak IoT cloud","Trigger alerts on abnormal readings"],"outcomes":["Integrate multiple sensors on one Pi","Use SPI ADC (MCP3008) for analog inputs","Send data to cloud via HTTP API"]}'),
  (v_exp_id,'theory','Theory',2,'{"introduction":"Raspberry Pi lacks analog inputs, so an MCP3008 SPI ADC is used for the pulse sensor. DS18B20 provides digital temperature via 1-Wire.","sections":[{"heading":"Pulse Sensor","body":"PPG (photoplethysmography) detects blood volume pulse using an LED and photodetector. Peak detection on ADC samples estimates BPM."},{"heading":"ThingSpeak","body":"ThingSpeak is a free IoT cloud platform for logging and visualising sensor data via HTTP GET API calls."},{"heading":"Normal Ranges","body":"Normal body temp: 36.1–37.2°C. Normal BPM: 60–100. Outside these ranges triggers an alert."}]}'),
  (v_exp_id,'components','Components Required',3,'{"items":[{"name":"Raspberry Pi 3/4","quantity":1},{"name":"DS18B20 Temperature Sensor","quantity":1},{"name":"Pulse Sensor SEN-11574","quantity":1},{"name":"MCP3008 ADC","quantity":1},{"name":"4.7kΩ Resistor","quantity":1},{"name":"WiFi Connection","quantity":1}]}'),
  (v_exp_id,'circuit','Circuit Diagram',4,'{"connections":[{"from":"DS18B20 Data","to":"GPIO4 + 4.7kΩ pull-up"},{"from":"MCP3008 CLK/MOSI/MISO/CS","to":"GPIO11, 10, 9, 8 (SPI0)"},{"from":"Pulse Sensor OUT","to":"MCP3008 CH0"}]}'),
  (v_exp_id,'procedure','Procedure',5,'{"steps":["Enable SPI: sudo raspi-config → Interface Options → SPI → Enable.","Enable 1-Wire for DS18B20 (see Exp 8).","Install: pip3 install spidev requests","Wire pulse sensor via MCP3008 SPI ADC.","Create ThingSpeak account, get API key, paste into code.","Run: python3 health_monitor.py","Visit ThingSpeak channel to see real-time charts."]}'),
  (v_exp_id,'code','Python Code',6,'{"language":"python","platform":"Raspberry Pi","code":"import time, requests, spidev, glob\n\ndevice = glob.glob(\"/sys/bus/w1/devices/28*\")[0]\ndef read_temp():\n    with open(device+\"/w1_slave\") as f: raw=f.read()\n    return float(raw.split(\"t=\")[1])/1000\n\nspi=spidev.SpiDev(); spi.open(0,0); spi.max_speed_hz=1350000\ndef read_adc(ch): r=spi.xfer2([1,(8+ch)<<4,0]); return ((r[1]&3)<<8)+r[2]\n\nAPI_KEY=\"YOUR_THINGSPEAK_API_KEY\"\nURL=\"https://api.thingspeak.com/update\"\n\nwhile True:\n    temp=read_temp()\n    bpm_raw=[read_adc(0) for _ in range(100)]\n    bpm=60+((max(bpm_raw)-min(bpm_raw))//10)\n    status=\"NORMAL\"\n    if not(36.1<=temp<=37.2): status=\"TEMP ALERT\"\n    if not(60<=bpm<=100): status=\"BPM ALERT\"\n    print(f\"Temp:{temp:.1f}C BPM:{bpm} [{status}]\")\n    requests.get(URL,params={\"api_key\":API_KEY,\"field1\":temp,\"field2\":bpm})\n    time.sleep(15)"}'),
  (v_exp_id,'references','References',9,'{"items":[{"title":"ThingSpeak API","url":"https://www.mathworks.com/help/thingspeak/"},{"title":"MCP3008 SPI Guide","url":"https://learn.adafruit.com/raspberry-pi-analog-to-digital-converters/mcp3008"}]}');

  insert into simulations (experiment_id,type,title,config) values (v_exp_id,'builtin_js','Health Monitor Simulation','{"sim_type":"health"}');
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'simulation','Simulation',7,jsonb_build_object('simulation_id',(select id from simulations where experiment_id=v_exp_id limit 1)));
  insert into quizzes (experiment_id,type,title) values (v_exp_id,'pretest','Health Monitor Pre-Test') on conflict do nothing;
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Why is MCP3008 needed with Raspberry Pi?','[{"id":"a","text":"GPIO shortage"},{"id":"b","text":"Pi lacks analog input pins"},{"id":"c","text":"Faster processing"},{"id":"d","text":"Cost reduction"}]','b','Raspberry Pi has no built-in ADC; MCP3008 provides 8-channel 10-bit analog inputs via SPI.',1 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'Normal human body temperature range:','[{"id":"a","text":"34–36°C"},{"id":"b","text":"36.1–37.2°C"},{"id":"c","text":"37.5–39°C"},{"id":"d","text":"35–40°C"}]','b','Normal body temperature is 36.1–37.2°C (97–99°F).',2 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'ThingSpeak is used for:','[{"id":"a","text":"GPS tracking"},{"id":"b","text":"IoT cloud data logging and visualisation"},{"id":"c","text":"Motor control"},{"id":"d","text":"Image processing"}]','b','ThingSpeak is a free IoT cloud platform for real-time data logging, visualisation and alerts.',3 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into quiz_questions (quiz_id,question_text,options,correct_answer,explanation,order_number) select id,'PPG (photoplethysmography) detects:','[{"id":"a","text":"Blood pressure"},{"id":"b","text":"Oxygen saturation"},{"id":"c","text":"Blood volume pulse"},{"id":"d","text":"All of these"}]','c','PPG primarily detects blood volume pulse; oxygen saturation (SpO2) requires two wavelengths.',4 from quizzes where experiment_id=v_exp_id and type='pretest';
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'quiz','Pre-Test',8,jsonb_build_object('quiz_id',(select id from quizzes where experiment_id=v_exp_id and type='pretest')));
  insert into feedback_forms (experiment_id,title) values (v_exp_id,'Health Monitor Feedback') on conflict (experiment_id) do nothing;
  insert into feedback_questions (form_id,question_text,question_type,config,order_index) select id,'Rate this experiment.','rating','{"min":1,"max":5}',1 from feedback_forms where experiment_id=v_exp_id;
  insert into feedback_questions (form_id,question_text,question_type,order_index) select id,'Any comments?','text',2 from feedback_forms where experiment_id=v_exp_id;
  insert into experiment_sections (experiment_id,type,title,order_index,content) values (v_exp_id,'feedback','Feedback',10,jsonb_build_object('form_id',(select id from feedback_forms where experiment_id=v_exp_id)));

end;
$$;
