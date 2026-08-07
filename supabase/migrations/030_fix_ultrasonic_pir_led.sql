-- ultrasonic-pir-arduino's lesson content (the Circuit Diagram and Arduino
-- Code sections, independent of the interactive simulator's own circuits.ts/
-- defaultCode) was seeded with a simplified sketch that drops the reference
-- lab sheet's LED entirely: no D13, no threshold, just a distance and a raw
-- PIR reading printed every 500ms. Every other experiment's circuit/code
-- section already matches reference/iot_virtual_lab.html byte for byte
-- (checked all 12 against it); this was the one exception.
--
-- Replaced with the reference's own sketch verbatim: TRIG on D9, ECHO on D10,
-- PIR on D7, an LED on D13 that lights on `pir || dist < 20`, and both
-- readings printed every loop. This also now agrees with what the
-- Components Required section already lists for this experiment (an LED and
-- a 220 ohm resistor), which the old code never referenced.

update public.experiment_sections s
set content = jsonb_build_object(
  'connections', jsonb_build_array(
    jsonb_build_object('from', 'HC-SR04 TRIG', 'to', 'Arduino D9'),
    jsonb_build_object('from', 'HC-SR04 ECHO', 'to', 'Arduino D10'),
    jsonb_build_object('from', 'PIR OUT', 'to', 'Arduino D7'),
    jsonb_build_object('from', 'LED Anode', 'to', 'Arduino D13 (via 220Ω)'),
    jsonb_build_object('from', 'LED Cathode', 'to', 'GND')
  )
)
from public.experiments e
where e.id = s.experiment_id
  and e.slug = 'ultrasonic-pir-arduino'
  and s.type = 'circuit';

update public.experiment_sections s
set content = jsonb_build_object(
  'code', '#define TRIG_PIN  9
#define ECHO_PIN  10
#define PIR_PIN   7
#define LED_PIN   13

void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PIR_PIN,  INPUT);
  pinMode(LED_PIN,  OUTPUT);
}

long readDistance() {
  digitalWrite(TRIG_PIN, LOW);   delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH);
  return duration * 0.034 / 2;
}

void loop() {
  long dist = readDistance();
  int  pir  = digitalRead(PIR_PIN);

  Serial.print("Distance: "); Serial.print(dist); Serial.println(" cm");
  Serial.print("Motion: ");   Serial.println(pir ? "DETECTED" : "None");

  if (pir || dist < 20) {
    digitalWrite(LED_PIN, HIGH);
  } else {
    digitalWrite(LED_PIN, LOW);
  }
  delay(500);
}',
  'language', 'arduino_c',
  'platform', 'Arduino Uno'
)
from public.experiments e
where e.id = s.experiment_id
  and e.slug = 'ultrasonic-pir-arduino'
  and s.type = 'code';

do $$
declare
  n integer;
begin
  select count(*) into n
  from public.experiment_sections s
  join public.experiments e on e.id = s.experiment_id
  where e.slug = 'ultrasonic-pir-arduino'
    and s.type = 'code'
    and s.content->>'code' like '%LED_PIN%';

  if n <> 1 then
    raise exception 'expected exactly 1 corrected ultrasonic-pir code section, found %', n;
  end if;
end $$;
