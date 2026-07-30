import type { Experiment } from '../types';
import {
  HEALTH_MONITORING_RPI_SCRIPT,
  HOME_AUTOMATION_RPI_SCRIPT,
  MOTOR_CONTROL_RPI_SCRIPT,
} from '@/lib/simulator/pico/experiments';

/**
 * THE LAB SHEET — reference/iot_virtual_lab.html — GOVERNS THIS FILE.
 *
 * `title` and `keyComponents` are transcribed from its `experiments` array.
 * `keyComponents` is its bill of materials verbatim, so it names the hardware
 * a student would buy for the bench build, including the items the sheet marks
 * optional and the sketch never touches.
 *
 * That is deliberately NOT the same list as `defaultComponents` below, which is
 * what this simulator draws. The gap worth knowing about: every Raspberry Pi
 * experiment is written for a full Raspberry Pi, and this app emulates a Pico,
 * so the sheet's "Raspberry Pi 3/4" is drawn here as a Pico. The BOM keeps the
 * sheet's wording; the drawing keeps the truth about the emulation.
 *
 * `aim`, `theory`, `procedure` and the four-question quiz the same sheet
 * carries per experiment have no home in the `Experiment` type — they are
 * lab-sheet prose, and they live in the content pipeline instead: the seed
 * (supabase/seeds/003_experiments.sql) writes them as experiment_sections, and
 * supabase/migrations/016_backfill_authored_content.sql rebuilds those sections
 * for experiments 4-12 and all 48 quiz questions from the sheet.
 *
 * WHERE `defaultCode` COMES FROM, AND WHY IT IS NOT ALL FROM ONE PLACE.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THE LAB SHEET GOVERNS. Experiments 1-8 and 11 carry the sketch printed  │
 * │ in reference/iot_virtual_lab.html, character for character — decoded    │
 * │ with scripts/reference-code.mjs rather than retyped, so no `i < 10`     │
 * │ lost a comparison on the way in. Nothing was reformatted, renamed or    │
 * │ "improved": the listing beside the drawing is the listing the student   │
 * │ was handed.                                                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * These replaced sketches that had drifted a long way from it — a
 * non-blocking millis() rewrite of experiment 1 that alerted at 28 °C where
 * the sheet alerts at 30, an experiment 2 that read D2/D3/D4 where the sheet
 * reads D7/D9/D10 and drove no lamp at all, an experiment 6 with no red or
 * green LED in it. ../circuits.ts had already been rewired to the sheet; this
 * is the other half of the same correction, and showreel/timelines.ts and
 * showreel/sensorOverrides.ts are re-derived from these listings in turn.
 *
 * THREE ARE NOT THE SHEET'S OWN LISTING, and each is a considered exception
 * rather than a leftover. All three are Raspberry Pi experiments whose
 * published program is written for a full Pi with a network — CPython,
 * RPi.GPIO, Flask, spidev — and this app emulates a Pico, which is what
 * ../circuits.ts draws:
 *
 *   9  MOTOR_CONTROL_RPI_SCRIPT     The published listing PRINTS NOTHING: it is
 *   10 HOME_AUTOMATION_RPI_SCRIPT   a bare demo and a Flask route table, so a
 *   12 HEALTH_MONITORING_RPI_SCRIPT verbatim transcription would leave the
 *                                   serial monitor on "Waiting for data…"
 *                                   forever on two of twelve panels — while
 *                                   the reference lab's OWN widgets for those
 *                                   experiments do print (its `simLog` calls).
 *                                   12's two SPI shifts are corrupt in the
 *                                   source HTML besides: `(8+ch)<4` and
 *                                   `(r[1]&3)<8` lost a `<` to the syntax
 *                                   highlighter, which turns both into
 *                                   comparisons.
 *
 * The three ports in lib/simulator/pico/experiments.ts keep the sheet's own
 * pin numbers, structure and printed wording, state every departure in their
 * own comments, and are the SAME source ../circuits.ts already followed when
 * it had to move IN1/IN2 to GP19/GP20 and the fourth relay to GP16 — GPIO23
 * and GPIO24 are not brought out on a Pico header. Listing and drawing
 * therefore still have one source each, which is the whole point.
 *
 * `description`, `tips` and `buildSteps` are NOT rendered anywhere in this app
 * — nothing reads them — and several still describe the pre-correction wiring;
 * they are left as found rather than half-fixed.
 */
export const EXPERIMENTS: Experiment[] = [
  {
    id: 1,
    title: 'LED & DHT11 Temperature/Humidity Sensor Interfacing',
    category: 'arduino',
    platform: 'Arduino',
    difficulty: 'Beginner',
    keyComponents: [
      'Arduino Uno',
      'DHT11 Sensor',
      'LED (Red)',
      '220Ω Resistor',
      '10kΩ Pull-up Resistor',
      'Connecting Wires',
      'Breadboard'
    ],
    description: 'Monitor environment temperature and humidity. If the temperature exceeds 28°C, the warning LED will turn ON.',
    tips: [
      'Use the DHT11 temperature slider in the controls panel to simulate temperature changes.',
      'Check the Serial Monitor to see the current temperature and humidity readings log in real-time.',
      'Verify that the LED anode is connected to D13 through a 220Ω resistor to prevent burn-out.'
    ],
    buildSteps: [
      'Place Arduino Uno R3 and Breadboard on the workspace.',
      'Connect Arduino 5V pin to Breadboard bottom red rail (+) with a Red wire.',
      'Connect Arduino GND pin to Breadboard bottom black rail (-) with a Black wire.',
      'Place the Red LED on Breadboard (Anode to hole F6, Cathode to hole F7).',
      'Connect a Blue wire from Arduino digital pin D13 to hole J6 (connecting to LED Anode).',
      'Place a 220Ω Resistor connecting hole J7 (LED Cathode) to the bottom black rail (GND).',
      'Place the DHT11 sensor (VCC to red rail, GND to black rail, DATA to Arduino D2).'
    ],
    defaultCode: `#include <DHT.h>

#define DHTPIN   2
#define DHTTYPE  DHT11
#define LED_PIN  13

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(9600);
  dht.begin();
  pinMode(LED_PIN, OUTPUT);
  Serial.println("DHT11 Test Starting...");
}

void loop() {
  delay(2000);
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t)) {
    Serial.println("Sensor read failed!");
    return;
  }

  Serial.print("Humidity: ");    Serial.print(h);   Serial.println(" %");
  Serial.print("Temperature: "); Serial.print(t);   Serial.println(" °C");

  // LED ON if temperature exceeds threshold
  if (t > 30) {
    digitalWrite(LED_PIN, HIGH);
    Serial.println("ALERT: High Temperature! LED ON");
  } else {
    digitalWrite(LED_PIN, LOW);
  }
}`,
    defaultComponents: [
      { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 40, y: 40, rotation: 0, properties: {} },
      { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 320, y: 40, rotation: 0, properties: {} },
      // 220Ω current-limiting resistor for the LED
      { id: 'resistor_1', type: 'resistor', name: '220Ω Resistor', x: 480, y: 110, rotation: 0, properties: { resistance: 220 } },
      // Red LED — warning indicator
      { id: 'led_1', type: 'led', name: 'Red LED', x: 560, y: 90, rotation: 0, properties: { color: 'red' } },
      // DHT11 Temperature & Humidity sensor
      { id: 'dht_1', type: 'dht11', name: 'DHT11 Sensor', x: 650, y: 60, rotation: 0, properties: { temperature: 24, humidity: 45 } }
    ],
    defaultWires: [
      // --- System Power Setup ---
      // Arduino 5V -> Breadboard Bottom Positive Rail (+)
      { id: 'w1', fromComponentId: 'uno_1', fromPinId: 'arduino-5V', toComponentId: 'breadboard_1', toPinId: 'rail_bot_pos_5', color: 'red' },
      // Arduino GND -> Breadboard Bottom Negative Rail (-)
      { id: 'w2', fromComponentId: 'uno_1', fromPinId: 'arduino-GND1', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_5', color: 'black' },

      // --- DHT11 Sensor Connections ---
      // DHT11 VCC pin -> Breadboard Positive Rail (+)
      { id: 'w3', fromComponentId: 'dht_1', fromPinId: 'vcc', toComponentId: 'breadboard_1', toPinId: 'rail_bot_pos_20', color: 'red' },
      // DHT11 GND pin -> Breadboard Negative Rail (-)
      { id: 'w4', fromComponentId: 'dht_1', fromPinId: 'gnd', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_20', color: 'black' },
      // DHT11 DATA pin -> Arduino Digital Pin 2
      { id: 'w5', fromComponentId: 'dht_1', fromPinId: 'data', toComponentId: 'uno_1', toPinId: 'arduino-D2', color: 'green' },

      // --- LED & Resistor Connections ---
      // Arduino Digital Pin 13 -> Terminal 1 of the Resistor
      { id: 'w6', fromComponentId: 'uno_1', fromPinId: 'arduino-D13', toComponentId: 'resistor_1', toPinId: 'p1', color: 'blue' },
      // Terminal 2 of the Resistor -> LED Anode (row 9)
      { id: 'w7', fromComponentId: 'resistor_1', fromPinId: 'p2', toComponentId: 'led_1', toPinId: 'anode', color: 'blue' },
      // LED Cathode (row 8) -> Breadboard Negative Rail (-)
      { id: 'w8', fromComponentId: 'led_1', fromPinId: 'cathode', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_8', color: 'black' }
    ]
  },
  {
    id: 2,
    title: 'Ultrasonic Sensor & PIR Sensor Interfacing',
    category: 'arduino',
    platform: 'Arduino',
    difficulty: 'Beginner',
    keyComponents: [
      'Arduino Uno',
      'HC-SR04 Ultrasonic Sensor',
      'PIR Sensor (HC-SR501)',
      'LED',
      '220Ω Resistor',
      'Connecting Wires',
      'Breadboard'
    ],
    description: 'Combine motion detection with distance measurements to form an smart security checking circuit.',
    tips: [
      'PIR sensor checks if motion is triggered. Use the toggle button in the controls panel.',
      'HC-SR04 sensor measures distance. Adjust the distance slider (0-400 cm) in the controls panel.',
      'If motion is detected and the object is closer than 50cm, a security warning is logged.'
    ],
    buildSteps: [
      'Place Arduino Uno R3 and components on the workspace canvas.',
      'Connect HC-SR04 VCC (Red wire) to Arduino 5V and GND (Black wire) to Arduino GND.',
      'Connect HC-SR04 TRIG pin to Arduino digital pin D3 (Orange wire).',
      'Connect HC-SR04 ECHO pin to Arduino digital pin D4 (Yellow wire).',
      'Connect PIR sensor VCC (Red wire) to Arduino 5V and GND (Black wire) to Arduino GND.',
      'Connect PIR sensor OUT pin to Arduino digital pin D2 (Green wire).'
    ],
    defaultCode: `#define TRIG_PIN  9
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
}`,
    defaultComponents: [
      { id: 'uno_1', type: 'arduino', name: 'Arduino Uno', x: 40, y: 40, rotation: 0, properties: {} },
      { id: 'ultrasonic_1', type: 'hc_sr04', name: 'HC-SR04 Sensor', x: 350, y: 60, rotation: 0, properties: { distance: 60 } },
      { id: 'pir_1', type: 'pir_sensor', name: 'PIR Sensor', x: 500, y: 150, rotation: 0, properties: { motion: false } }
    ],
    defaultWires: [
      { id: 'w1', fromComponentId: 'uno_1', fromPinId: '5V', toComponentId: 'ultrasonic_1', toPinId: 'vcc', color: 'red' },
      { id: 'w2', fromComponentId: 'uno_1', fromPinId: 'GND_P1', toComponentId: 'ultrasonic_1', toPinId: 'gnd', color: 'black' },
      { id: 'w3', fromComponentId: 'uno_1', fromPinId: 'D3', toComponentId: 'ultrasonic_1', toPinId: 'trig', color: 'orange' },
      { id: 'w4', fromComponentId: 'uno_1', fromPinId: 'D4', toComponentId: 'ultrasonic_1', toPinId: 'echo', color: 'yellow' },
      
      { id: 'w5', fromComponentId: 'uno_1', fromPinId: '5V', toComponentId: 'pir_1', toPinId: 'vcc', color: 'red' },
      { id: 'w6', fromComponentId: 'uno_1', fromPinId: 'GND_P2', toComponentId: 'pir_1', toPinId: 'gnd', color: 'black' },
      { id: 'w7', fromComponentId: 'uno_1', fromPinId: 'D2', toComponentId: 'pir_1', toPinId: 'out', color: 'green' }
    ]
  },
  {
    id: 3,
    title: 'Traffic Light Simulator',
    category: 'arduino',
    platform: 'Arduino',
    difficulty: 'Beginner',
    keyComponents: [
      'Arduino Uno',
      'Red LED',
      'Yellow LED',
      'Green LED',
      '3× 220Ω Resistors',
      'Push Button (optional)',
      'Connecting Wires',
      'Breadboard'
    ],
    description: 'Simulate a traffic light intersection sequences (Red -> Green -> Yellow -> Red) with adjustable cycle delays.',
    tips: [
      'LEDs are connected to digital pins 10 (Red), 11 (Yellow), and 12 (Green).',
      'The simulation animates the LEDs glowing bright based on digital logic states.',
      'Change delay variables in the code editor to speed up or slow down the sequence.'
    ],
    buildSteps: [
      'Place Arduino Uno R3 and Breadboard on the workspace.',
      'Connect Arduino GND to Breadboard bottom black rail (-) with a Black wire.',
      'Place Red, Yellow, and Green LEDs on the breadboard spaced out.',
      'Place three 220Ω Resistors connecting each LED Cathode pin to the black GND rail.',
      'Connect Arduino digital pin D10 to the Red LED Anode pin (Red wire).',
      'Connect Arduino digital pin D11 to the Yellow LED Anode pin (Yellow wire).',
      'Connect Arduino digital pin D12 to the Green LED Anode pin (Green wire).'
    ],
    defaultCode: `#define RED_PIN    2
#define YELLOW_PIN 3
#define GREEN_PIN  4

void setLight(int r, int y, int g) {
  digitalWrite(RED_PIN,    r);
  digitalWrite(YELLOW_PIN, y);
  digitalWrite(GREEN_PIN,  g);
}

void setup() {
  pinMode(RED_PIN,    OUTPUT);
  pinMode(YELLOW_PIN, OUTPUT);
  pinMode(GREEN_PIN,  OUTPUT);
  Serial.begin(9600);
}

void loop() {
  // GREEN phase — 5 seconds
  setLight(LOW, LOW, HIGH);
  Serial.println("GREEN — Go!");
  delay(5000);

  // YELLOW phase — 2 seconds
  setLight(LOW, HIGH, LOW);
  Serial.println("YELLOW — Slow down");
  delay(2000);

  // RED phase — 5 seconds
  setLight(HIGH, LOW, LOW);
  Serial.println("RED — Stop!");
  delay(5000);
}`,
    defaultComponents: [
      { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 40, y: 40, rotation: 0, properties: {} },
      { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 320, y: 40, rotation: 0, properties: {} },
      { id: 'led_red', type: 'led', name: 'Red LED', x: 380, y: 100, rotation: 0, properties: { color: 'red' } },
      { id: 'led_yellow', type: 'led', name: 'Yellow LED', x: 440, y: 100, rotation: 0, properties: { color: 'yellow' } },
      { id: 'led_green', type: 'led', name: 'Green LED', x: 500, y: 100, rotation: 0, properties: { color: 'green' } },
      { id: 'res_red', type: 'resistor', name: '220Ω', x: 380, y: 180, rotation: 90, properties: { resistance: 220 } },
      { id: 'res_yellow', type: 'resistor', name: '220Ω', x: 440, y: 180, rotation: 90, properties: { resistance: 220 } },
      { id: 'res_green', type: 'resistor', name: '220Ω', x: 500, y: 180, rotation: 90, properties: { resistance: 220 } }
    ],
    defaultWires: [
      // --- Step 2: Hardcode the Ground Rail ---
      // Arduino GND pin -> Breadboard Bottom Negative Rail (-)
      { id: 'w1', fromComponentId: 'uno_1', fromPinId: 'arduino-GND1', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_10', color: 'black' },
      // Cathode of Red LED -> Breadboard Bottom Negative Rail (-)
      { id: 'w2', fromComponentId: 'led_red', fromPinId: 'cathode', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_8', color: 'black' },
      // Cathode of Yellow LED -> Breadboard Bottom Negative Rail (-)
      { id: 'w3', fromComponentId: 'led_yellow', fromPinId: 'cathode', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_12', color: 'black' },
      // Cathode of Green LED -> Breadboard Bottom Negative Rail (-)
      { id: 'w4', fromComponentId: 'led_green', fromPinId: 'cathode', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_16', color: 'black' },

      // --- Step 3: Wire the Logic/Signal Paths ---
      // Arduino Digital Pin 10 -> Terminal 1 of the first Resistor (res_red)
      { id: 'w5', fromComponentId: 'uno_1', fromPinId: 'arduino-D10', toComponentId: 'res_red', toPinId: 'p1', color: 'red' },
      // Terminal 2 of the first Resistor -> Red LED Anode
      { id: 'w6', fromComponentId: 'res_red', fromPinId: 'p2', toComponentId: 'led_red', toPinId: 'anode', color: 'red' },

      // Arduino Digital Pin 11 -> Terminal 1 of the second Resistor (res_yellow)
      { id: 'w7', fromComponentId: 'uno_1', fromPinId: 'arduino-D11', toComponentId: 'res_yellow', toPinId: 'p1', color: 'yellow' },
      // Terminal 2 of the second Resistor -> Yellow LED Anode
      { id: 'w8', fromComponentId: 'res_yellow', fromPinId: 'p2', toComponentId: 'led_yellow', toPinId: 'anode', color: 'yellow' },

      // Arduino Digital Pin 12 -> Terminal 1 of the third Resistor (res_green)
      { id: 'w9', fromComponentId: 'uno_1', fromPinId: 'arduino-D12', toComponentId: 'res_green', toPinId: 'p1', color: 'green' },
      // Terminal 2 of the third Resistor -> Green LED Anode
      { id: 'w10', fromComponentId: 'res_green', fromPinId: 'p2', toComponentId: 'led_green', toPinId: 'anode', color: 'green' }
    ]
  },
  {
    id: 4,
    title: 'Water Flow Detection using Arduino',
    category: 'arduino',
    platform: 'Arduino',
    difficulty: 'Intermediate',
    keyComponents: [
      'Arduino Uno',
      'YF-S201 Flow Sensor',
      '16×2 LCD (optional)',
      '10kΩ Resistor (pull-up)',
      'Connecting Wires'
    ],
    description: 'Measures liquid flow velocity and computes total water volume passing through the pipeline.',
    tips: [
      'The flow sensor spins an internal rotor containing a magnet that activates a hall effect sensor.',
      'Adjust the Flow Rate slider in the control panel to simulate faster flow speeds.',
      'The code reads pulses from Pin 2 using virtual interrupts to compute L/hour flow rate.'
    ],
    buildSteps: [
      'Place Arduino Uno R3 and the YF-S201 Water Flow Sensor.',
      'Connect YF-S201 VCC terminal (Red wire) to Arduino 5V.',
      'Connect YF-S201 GND terminal (Black wire) to Arduino GND.',
      'Connect YF-S201 OUT signal terminal (Yellow wire) to Arduino digital pin D2.'
    ],
    defaultCode: `volatile int pulseCount = 0;
float flowRate, totalLitres;
unsigned long lastTime;

void pulseCounter() {
  pulseCount++;
}

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), pulseCounter, FALLING);
  lastTime = millis();
  totalLitres = 0;
}

void loop() {
  if (millis() - lastTime >= 1000) {
    detachInterrupt(digitalPinToInterrupt(2));

    flowRate   = pulseCount / 7.5;
    totalLitres += flowRate / 60;

    Serial.print("Flow Rate: ");    Serial.print(flowRate);   Serial.println(" L/min");
    Serial.print("Total Volume: "); Serial.print(totalLitres); Serial.println(" L");

    pulseCount = 0;
    lastTime   = millis();
    attachInterrupt(digitalPinToInterrupt(2), pulseCounter, FALLING);
  }
}`,
    defaultComponents: [
      { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 50, y: 50, rotation: 0, properties: {} },
      { id: 'flow_1', type: 'yf_s201', name: 'YF-S201 Flow Sensor', x: 380, y: 100, rotation: 0, properties: { flowRate: 5.0 } }
    ],
    defaultWires: [
      { id: 'w1', fromComponentId: 'uno_1', fromPinId: '5V', toComponentId: 'flow_1', toPinId: 'vcc', color: 'red' },
      { id: 'w2', fromComponentId: 'uno_1', fromPinId: 'GND_P1', toComponentId: 'flow_1', toPinId: 'gnd', color: 'black' },
      { id: 'w3', fromComponentId: 'uno_1', fromPinId: 'D2', toComponentId: 'flow_1', toPinId: 'out', color: 'yellow' }
    ]
  },
  {
    id: 5,
    title: 'LED & Push Button Interfacing with Raspberry Pi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Beginner',
    keyComponents: [
      'Raspberry Pi (any model)',
      'LED',
      '220Ω Resistor',
      'Push Button',
      '10kΩ Pull-down Resistor',
      'Connecting Wires',
      'Breadboard'
    ],
    description: 'Toggle the state of a GPIO output pin (LED) by polling a GPIO input pin connected to a tactile push button.',
    tips: [
      'Uses Python programming style structure.',
      'Pin GP0 controls the LED. Pin GP1 reads the Push Button status.',
      'Click the Push Button in the simulation to trigger logic state updates.'
    ],
    buildSteps: [
      'Place Raspberry Pi Pico, Breadboard, LED, and Push Button on the workspace.',
      'Connect RPi Pico GP0 to the LED Anode (+).',
      'Connect LED Cathode (-) to RPi Pico GND.',
      'Connect RPi Pico VBUS (5V) to Push Button Pin 1A.',
      'Connect Push Button Pin 1B to RPi Pico GP1.'
    ],
    defaultCode: `import RPi.GPIO as GPIO
import time

# Pin configuration
LED_PIN    = 17
BUTTON_PIN = 27

GPIO.setmode(GPIO.BCM)
GPIO.setup(LED_PIN,    GPIO.OUT)
GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

print("Press button to toggle LED. Ctrl+C to exit.")

led_state = False

try:
    while True:
        if GPIO.input(BUTTON_PIN) == GPIO.HIGH:
            led_state = not led_state
            GPIO.output(LED_PIN, led_state)
            state_str = "ON" if led_state else "OFF"
            print(f"LED {state_str}")
            time.sleep(0.3)  # debounce
        time.sleep(0.05)

except KeyboardInterrupt:
    print("Cleaning up GPIO...")
    GPIO.cleanup()`,
    defaultComponents: [
      { id: 'rpi_1', type: 'raspberry_pi', name: 'Raspberry Pi Pico', x: 40, y: 50, rotation: 0, properties: {} },
      { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 320, y: 40, rotation: 0, properties: {} },
      { id: 'res_1', type: 'resistor', name: '220Ω Resistor', x: 380, y: 80, rotation: 0, properties: { resistance: 220 } },
      { id: 'led_1', type: 'led', name: 'LED', x: 440, y: 100, rotation: 0, properties: { color: 'blue' } },
      { id: 'button_1', type: 'push_button', name: 'Push Button', x: 520, y: 100, rotation: 0, properties: {} }
    ],
    defaultWires: [
      { id: 'w1', fromComponentId: 'rpi_1', fromPinId: 'GND_1', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_5', color: 'black' },
      { id: 'w2', fromComponentId: 'rpi_1', fromPinId: '3.3V_OUT', toComponentId: 'breadboard_1', toPinId: 'rail_bot_pos_5', color: 'red' },
      
      { id: 'w3', fromComponentId: 'rpi_1', fromPinId: 'GP14', toComponentId: 'button_1', toPinId: 'pin1a', color: 'green' },
      { id: 'w4', fromComponentId: 'breadboard_1', fromPinId: 'rail_bot_pos_10', toComponentId: 'button_1', toPinId: 'pin1b', color: 'red' },
      
      { id: 'w5', fromComponentId: 'rpi_1', fromPinId: 'GP15', toComponentId: 'res_1', toPinId: 'p1', color: 'blue' },
      { id: 'w6', fromComponentId: 'res_1', fromPinId: 'p2', toComponentId: 'led_1', toPinId: 'anode', color: 'blue' },
      { id: 'w7', fromComponentId: 'led_1', fromPinId: 'cathode', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_5', color: 'black' }
    ]
  },
  {
    id: 6,
    title: 'Motion Sensor Alarm using PIR Sensor',
    category: 'arduino',
    // The lab sheet heads this one "Arduino / RPi" — it is written to be built
    // on either board. `platform` is a two-value union here and it drives the
    // code panel's language and filename, so it names the board the sketch
    // below is actually written for.
    platform: 'Arduino',
    difficulty: 'Beginner',
    keyComponents: [
      'Arduino Uno',
      'PIR Sensor HC-SR501',
      'Active Buzzer',
      'Red LED',
      'Green LED',
      '220Ω Resistors',
      'Connecting Wires'
    ],
    description: 'Trigger a security alarm when motion is detected. Sound a piezo buzzer and flash an indicator.',
    tips: [
      'PIR sensor outputs HIGH logic when movement is detected.',
      'Piezo buzzer connects to D3. When activated, sound waves animate.',
      'Simulate motion using the checkbox in the slider panel.'
    ],
    buildSteps: [
      'Place Arduino Uno R3, PIR sensor, and Piezo Buzzer on the workspace.',
      'Connect PIR VCC to Arduino 5V, and GND to Arduino GND.',
      'Connect PIR OUT pin to Arduino digital pin D2 (Green wire).',
      'Connect Buzzer positive (+) terminal to Arduino digital pin D3 (Orange wire).',
      'Connect Buzzer negative (-) terminal to Arduino GND (Black wire).'
    ],
    defaultCode: `#define PIR_PIN    7
#define BUZZER     8
#define RED_LED    12
#define GREEN_LED  11

void setup() {
  Serial.begin(9600);
  pinMode(PIR_PIN,   INPUT);
  pinMode(BUZZER,    OUTPUT);
  pinMode(RED_LED,   OUTPUT);
  pinMode(GREEN_LED, OUTPUT);
  // System ready indication
  digitalWrite(GREEN_LED, HIGH);
  Serial.println("PIR Alarm Ready — Waiting...");
}

void loop() {
  int motion = digitalRead(PIR_PIN);

  if (motion == HIGH) {
    Serial.println("⚠ MOTION DETECTED — ALARM!");
    digitalWrite(GREEN_LED, LOW);
    digitalWrite(RED_LED,   HIGH);

    for (int i = 0; i < 10; i++) {
      digitalWrite(BUZZER, HIGH); delay(200);
      digitalWrite(BUZZER, LOW);  delay(200);
    }
    digitalWrite(RED_LED, LOW);
    digitalWrite(GREEN_LED, HIGH);
  } else {
    Serial.println("No motion — System Idle");
  }
  delay(500);
}`,
    defaultComponents: [
      { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 50, y: 50, rotation: 0, properties: {} },
      { id: 'pir_1', type: 'pir_sensor', name: 'PIR Sensor', x: 380, y: 60, rotation: 0, properties: { motion: false } },
      { id: 'buzzer_1', type: 'buzzer', name: 'Buzzer', x: 500, y: 150, rotation: 0, properties: {} }
    ],
    defaultWires: [
      { id: 'w1', fromComponentId: 'uno_1', fromPinId: 'arduino-5V', toComponentId: 'pir_1', toPinId: 'vcc', color: 'red' },
      { id: 'w2', fromComponentId: 'uno_1', fromPinId: 'arduino-GND1', toComponentId: 'pir_1', toPinId: 'gnd', color: 'black' },
      { id: 'w3', fromComponentId: 'uno_1', fromPinId: 'arduino-D2', toComponentId: 'pir_1', toPinId: 'out', color: 'green' },
      
      { id: 'w4', fromComponentId: 'uno_1', fromPinId: 'arduino-D3', toComponentId: 'buzzer_1', toPinId: 'positive', color: 'orange' },
      { id: 'w5', fromComponentId: 'uno_1', fromPinId: 'arduino-GND2', toComponentId: 'buzzer_1', toPinId: 'negative', color: 'black' }
    ]
  },
  {
    id: 7,
    title: 'DHT11 Temperature & Humidity with Raspberry Pi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Beginner',
    keyComponents: ['Raspberry Pi', 'DHT11 Sensor', '10kΩ Resistor', 'Connecting Wires'],
    description: 'Interface the DHT11 digital humidity and temperature sensor with Raspberry Pi Pico using Python.',
    tips: [
      'We use the MicroPython structure to poll the DHT11 data pin.',
      'Adjust the temperature and humidity sliders in the control panel to see the logs adjust.',
      'If temperature goes above 30°C, a cooling fan warning is printed.'
    ],
    buildSteps: [
      'Place Raspberry Pi Pico and DHT11 Temperature Sensor.',
      'Connect DHT11 VCC pin to RPi Pico 3.3V OUT (Red wire).',
      'Connect DHT11 GND pin to RPi Pico GND (Black wire).',
      'Connect DHT11 DATA pin to RPi Pico GP4 (Green wire).'
    ],
    defaultCode: `import Adafruit_DHT
import time

DHT_SENSOR = Adafruit_DHT.DHT11
DHT_PIN    = 4   # GPIO4

print("DHT11 on Raspberry Pi — Reading sensor...")

while True:
    humidity, temperature = Adafruit_DHT.read_retry(DHT_SENSOR, DHT_PIN)

    if humidity is not None and temperature is not None:
        print(f"Temp={temperature:.1f}°C  Humidity={humidity:.1f}%")

        # Log to CSV file
        with open("dht_log.csv", "a") as f:
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"{ts},{temperature:.1f},{humidity:.1f}\\n")
    else:
        print("Failed to read sensor!")

    time.sleep(2)`,
    defaultComponents: [
      { id: 'rpi_1', type: 'raspberry_pi', name: 'Raspberry Pi Pico', x: 50, y: 50, rotation: 0, properties: {} },
      { id: 'dht_1', type: 'dht11', name: 'DHT11 Sensor', x: 380, y: 60, rotation: 0, properties: { temperature: 22, humidity: 50 } }
    ],
    defaultWires: [
      { id: 'w1', fromComponentId: 'rpi_1', fromPinId: '3.3V_OUT', toComponentId: 'dht_1', toPinId: 'vcc', color: 'red' },
      { id: 'w2', fromComponentId: 'rpi_1', fromPinId: 'GND_1', toComponentId: 'dht_1', toPinId: 'gnd', color: 'black' },
      { id: 'w3', fromComponentId: 'rpi_1', fromPinId: 'GP4', toComponentId: 'dht_1', toPinId: 'data', color: 'green' }
    ]
  },
  {
    id: 8,
    title: 'DS18B20 Temperature Sensor with Raspberry Pi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Intermediate',
    keyComponents: [
      'Raspberry Pi',
      'DS18B20 Sensor (waterproof probe)',
      '4.7kΩ Resistor',
      'Connecting Wires'
    ],
    description: 'Interfacing the 1-Wire DS18B20 waterproof temperature sensor with Raspberry Pi.',
    tips: [
      'The DS18B20 uses the unique 1-wire protocol, allowing multiple probes on a single data wire.',
      'A 4.7kΩ pull-up resistor is required between VCC and DATA pins for signal stability.',
      'Adjust the temperature probe slider in the controls sidebar to alter values.'
    ],
    buildSteps: [
      'Place Raspberry Pi Pico, Breadboard, DS18B20 sensor, and 4.7kΩ Resistor.',
      'Connect DS18B20 VCC pin to RPi Pico 3.3V OUT (Red wire).',
      'Connect DS18B20 GND pin to RPi Pico GND (Black wire).',
      'Connect DS18B20 DQ (Data) pin to RPi Pico GP15 (Green wire).',
      'Connect the 4.7kΩ Resistor bridging VCC and DQ pin (essential pull-up Resistor).'
    ],
    defaultCode: `import os, glob, time

# Enable 1-Wire: add dtoverlay=w1-gpio to /boot/config.txt
os.system('modprobe w1-gpio')
os.system('modprobe w1-therm')

base_dir   = '/sys/bus/w1/devices/'
device_dir = glob.glob(base_dir + '28*')[0]
device_file = device_dir + '/w1_slave'

def read_temp_raw():
    with open(device_file, 'r') as f:
        return f.readlines()

def read_temp():
    lines = read_temp_raw()
    while lines[0].strip()[-3:] != 'YES':
        time.sleep(0.2)
        lines = read_temp_raw()
    eq_pos = lines[1].find('t=')
    temp_c = float(lines[1][eq_pos+2:]) / 1000.0
    return temp_c

while True:
    temp = read_temp()
    print(f"Temperature: {temp:.3f}°C  |  {temp*9/5+32:.3f}°F")
    time.sleep(1)`,
    defaultComponents: [
      { id: 'rpi_1', type: 'raspberry_pi', name: 'Raspberry Pi Pico', x: 50, y: 50, rotation: 0, properties: {} },
      { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 320, y: 40, rotation: 0, properties: {} },
      { id: 'ds18b20_1', type: 'ds18b20', name: 'DS18B20 Sensor', x: 400, y: 100, rotation: 0, properties: { temperature: 25 } },
      { id: 'resistor_1', type: 'resistor', name: '4.7kΩ Resistor', x: 500, y: 150, rotation: 90, properties: { resistance: 4700 } }
    ],
    defaultWires: [
      // DS18B20 Power
      { id: 'w1', fromComponentId: 'rpi_1', fromPinId: '3.3V_OUT', toComponentId: 'ds18b20_1', toPinId: 'vcc', color: 'red' },
      { id: 'w2', fromComponentId: 'rpi_1', fromPinId: 'GND_1', toComponentId: 'ds18b20_1', toPinId: 'gnd', color: 'black' },
      { id: 'w3', fromComponentId: 'rpi_1', fromPinId: 'GP15', toComponentId: 'ds18b20_1', toPinId: 'dq', color: 'green' },
      
      // 4.7k Pullup resistor between VCC and Data pin (correct pin IDs: p1, p2)
      { id: 'w4', fromComponentId: 'ds18b20_1', fromPinId: 'vcc', toComponentId: 'resistor_1', toPinId: 'p1', color: 'red' },
      { id: 'w5', fromComponentId: 'ds18b20_1', fromPinId: 'dq', toComponentId: 'resistor_1', toPinId: 'p2', color: 'green' }
    ]
  },
  {
    id: 9,
    title: 'DC Motor & Stepper Motor Control with Raspberry Pi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Intermediate',
    keyComponents: [
      'Raspberry Pi',
      'L298N Motor Driver',
      'DC Motor (5V)',
      '28BYJ-48 Stepper Motor',
      'ULN2003 Driver Board',
      '12V Power Supply',
      'Connecting Wires'
    ],
    description: 'Use the dual H-Bridge driver to control rotation direction and speed of a DC motor.',
    tips: [
      'The L298N driver board handles the power switching for high current inductive loads (motors).',
      'During simulation run, the motor will spin visually representing speed/direction.',
      'Control inputs GP14-GP15 configure H-Bridge state while GP13 enables Channel A.'
    ],
    buildSteps: [
      'Place RPi Pico, L298N Driver, and DC Motor.',
      'Connect RPi Pico VBUS to L298N 12V terminal, and GND to L298N GND.',
      'Connect L298N OUT1 & OUT2 to the DC Motor terminals.',
      'Connect RPi Pico GP14 to L298N IN1, GP15 to IN2, and GP13 to ENA.'
    ],
    defaultCode: MOTOR_CONTROL_RPI_SCRIPT,
    defaultComponents: [
      { id: 'rpi_1', type: 'raspberry_pi', name: 'Raspberry Pi Pico', x: 40, y: 50, rotation: 0, properties: {} },
      { id: 'l298n_1', type: 'l298n', name: 'L298N Driver', x: 320, y: 50, rotation: 0, properties: {} },
      { id: 'dc_1', type: 'dc_motor', name: 'DC Motor', x: 460, y: 20, rotation: 0, properties: {} }
    ],
    defaultWires: [
      // DC Motor lines
      { id: 'w1', fromComponentId: 'l298n_1', fromPinId: 'out1', toComponentId: 'dc_1', toPinId: 't1', color: 'blue' },
      { id: 'w2', fromComponentId: 'l298n_1', fromPinId: 'out2', toComponentId: 'dc_1', toPinId: 't2', color: 'blue' },
      
      // Control signals RPi -> Driver
      { id: 'w3', fromComponentId: 'rpi_1', fromPinId: 'GP14', toComponentId: 'l298n_1', toPinId: 'in1', color: 'green' },
      { id: 'w4', fromComponentId: 'rpi_1', fromPinId: 'GP15', toComponentId: 'l298n_1', toPinId: 'in2', color: 'yellow' },
      { id: 'w5', fromComponentId: 'rpi_1', fromPinId: 'GP13', toComponentId: 'l298n_1', toPinId: 'enA', color: 'orange' },
      
      // Power rails
      { id: 'w7', fromComponentId: 'rpi_1', fromPinId: 'VBUS', toComponentId: 'l298n_1', toPinId: 'v12', color: 'red' },
      { id: 'w8', fromComponentId: 'rpi_1', fromPinId: 'GND_1', toComponentId: 'l298n_1', toPinId: 'gnd', color: 'black' }
    ]
  },
  {
    id: 10,
    title: 'Smartphone Controlled Home Automation with Raspberry Pi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Intermediate',
    keyComponents: [
      'Raspberry Pi 3/4',
      '4-Channel Relay Module',
      'LEDs (simulate loads)',
      'WiFi Network',
      'Smartphone / PC Browser'
    ],
    description: 'Construct a smart light controller. Power an external bulb through a high-voltage isolation relay.',
    tips: [
      'A relay isolates the micro-controller logic from high-voltage main circuits.',
      'A virtual Lightbulb is placed on the canvas, showing visual glowing feedback when the circuit is closed by the relay.',
      'Set relay logic GP15 to HIGH to actuate the switch (a click sound will emit and light turns ON).'
    ],
    buildSteps: [
      'Place RPi Pico, the 5V Relay Module, and a Lightbulb.',
      'Connect Relay Module VCC pin to RPi Pico VBUS (5V).',
      'Connect Relay Module GND pin to RPi Pico GND.',
      'Connect Relay Module IN (Signal) pin to RPi Pico GP15.',
      'Connect Pico VBUS (5V) to Relay COM (Common).',
      'Connect Relay NO (Normally Open) to Lightbulb Terminal 1, and Lightbulb Terminal 2 to Pico GND.'
    ],
    defaultCode: HOME_AUTOMATION_RPI_SCRIPT,
    defaultComponents: [
      { id: 'rpi_1', type: 'raspberry_pi', name: 'Raspberry Pi Pico', x: 50, y: 50, rotation: 0, properties: {} },
      { id: 'relay_1', type: 'relay', name: 'Relay Module', x: 380, y: 60, rotation: 0, properties: { state: false } },
      { id: 'lightbulb_1', type: 'lightbulb', name: 'Lightbulb', x: 500, y: 80, rotation: 0, properties: { lit: false } }
    ],
    defaultWires: [
      { id: 'w1', fromComponentId: 'rpi_1', fromPinId: 'VBUS', toComponentId: 'relay_1', toPinId: 'vcc', color: 'red' },
      { id: 'w2', fromComponentId: 'rpi_1', fromPinId: 'GND_1', toComponentId: 'relay_1', toPinId: 'gnd', color: 'black' },
      { id: 'w3', fromComponentId: 'rpi_1', fromPinId: 'GP15', toComponentId: 'relay_1', toPinId: 'in', color: 'green' },
      
      // COM connected to 5V (VBUS)
      { id: 'w4', fromComponentId: 'rpi_1', fromPinId: 'VBUS', toComponentId: 'relay_1', toPinId: 'com', color: 'red' },
      
      // NO connected to Lightbulb Terminal 1
      { id: 'w5', fromComponentId: 'relay_1', fromPinId: 'no', toComponentId: 'lightbulb_1', toPinId: 'pin1', color: 'orange' },
      
      // Lightbulb Terminal 2 connected to GND
      { id: 'w6', fromComponentId: 'rpi_1', fromPinId: 'GND_2', toComponentId: 'lightbulb_1', toPinId: 'pin2', color: 'black' }
    ]
  },
  {
    id: 11,
    title: 'Smart Traffic Light Controller',
    category: 'arduino',
    // The lab sheet files this one under platform "Advanced", which is a
    // difficulty and not a board; its own tags and bill of materials say
    // Arduino, and the difficulty is carried below where it belongs.
    platform: 'Arduino',
    difficulty: 'Advanced',
    // The lab sheet's own bill of materials (iot_virtual_lab.html), not the
    // single-lane Uno + HC-SR04 circuit this used to describe: an Arduino
    // Mega, twelve LEDs as three RGYG sets, four density potentiometers, a
    // 16×2 LCD, and four IR sensors the sheet itself marks optional and the
    // sketch below never reads (density comes from the pots instead).
    keyComponents: [
      'Arduino Mega',
      '12× LEDs (3 sets RGYG)',
      '4× Potentiometers',
      '4× IR Sensors (optional)',
      'LCD 16×2',
      'Connecting Wires'
    ],
    description: 'Build a four-lane adaptive traffic controller. Each lane\'s density potentiometer sets how long its green phase runs, so the busiest lane gets the most time before the sequence moves on.',
    tips: [
      'Each density slider stands in for a lane\'s traffic sensor; turning one up lengthens that lane\'s green phase the next time the sequence reaches it.',
      'The controller serves one lane at a time: green for a density-scaled duration, then a fixed 2 s yellow, then on to the next lane.',
      'Twelve LEDs need twelve digital pins plus four analog pins for the pots — sixteen signals, which is why this experiment needs a Mega rather than an Uno.'
    ],
    buildSteps: [
      'Place the Arduino Mega and wire lane 1\'s red/yellow/green LEDs (through 220Ω resistors) to pins 22/23/24, lane 2 to 25/26/27, lane 3 to 28/29/30 and lane 4 to 31/32/33.',
      'Wire all twelve LED cathodes to a shared ground return.',
      'Connect the four density potentiometers\' wipers to A0-A3, with their outer legs across the 5V/GND rails.',
      'Wire the 16x2 LCD in 4-bit mode (RS, E, D4-D7) to six free digital pins, VSS/RW/V0 to ground, VDD and the backlight anode to 5V.',
      'Upload the code and open the Serial Monitor to see each lane\'s computed green time.'
    ],
    defaultCode: `int redPins[]   = {22,25,28,31};
int yelPins[]   = {23,26,29,32};
int grnPins[]   = {24,27,30,33};
int densityPin[]= {A0, A1, A2, A3};

void allRed() {
  for(int i=0;i<4;i++){
    digitalWrite(redPins[i],HIGH);
    digitalWrite(yelPins[i],LOW);
    digitalWrite(grnPins[i],LOW);
  }
}

void setGreen(int lane) {
  allRed();
  digitalWrite(redPins[lane], LOW);
  digitalWrite(grnPins[lane], HIGH);
}

void setup() {
  for(int i=0;i<4;i++){
    pinMode(redPins[i],OUTPUT);
    pinMode(yelPins[i],OUTPUT);
    pinMode(grnPins[i],OUTPUT);
  }
  allRed(); Serial.begin(9600);
}

void loop() {
  for(int i=0;i<4;i++){
    int density  = analogRead(densityPin[i]);
    int greenTime = 3000 + (long)density * 7;
    Serial.print("Lane "); Serial.print(i+1);
    Serial.print(" Green: "); Serial.print(greenTime); Serial.println("ms");
    setGreen(i);  delay(greenTime);
    // Yellow transition
    digitalWrite(grnPins[i], LOW);
    digitalWrite(yelPins[i], HIGH);
    delay(2000);
  }
}`,
    defaultComponents: [
      { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 40, y: 40, rotation: 0, properties: {} },
      { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 320, y: 40, rotation: 0, properties: {} },
      { id: 'ultrasonic_1', type: 'hc_sr04', name: 'HC-SR04 Lane Scanner', x: 400, y: 60, rotation: 0, properties: { distance: 60 } },
      // Virtual 220Ω Resistors in series with each LED
      { id: 'res_red', type: 'resistor', name: '220Ω Resistor', x: 530, y: 60, rotation: 0, properties: { resistance: 220 } },
      { id: 'res_green', type: 'resistor', name: '220Ω Resistor', x: 530, y: 140, rotation: 0, properties: { resistance: 220 } },
      // LEDs
      { id: 'led_red', type: 'led', name: 'Stop Light (Red)', x: 620, y: 40, rotation: 0, properties: { color: 'red' } },
      { id: 'led_green', type: 'led', name: 'Go Light (Green)', x: 620, y: 120, rotation: 0, properties: { color: 'green' } }
    ],
    defaultWires: [
      // --- GND Rail ---
      // Arduino GND -> Breadboard Bottom Negative Rail (-)
      { id: 'w1', fromComponentId: 'uno_1', fromPinId: 'arduino-GND1', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_5', color: 'black' },

      // --- HC-SR04 Ultrasonic Sensor ---
      // Sensor VCC -> Arduino 5V
      { id: 'w2', fromComponentId: 'uno_1', fromPinId: 'arduino-5V', toComponentId: 'ultrasonic_1', toPinId: 'vcc', color: 'red' },
      // Sensor GND -> Arduino GND
      { id: 'w3', fromComponentId: 'ultrasonic_1', fromPinId: 'gnd', toComponentId: 'uno_1', toPinId: 'arduino-GND', color: 'black' },
      // Sensor TRIG -> Arduino Digital Pin 6
      { id: 'w4', fromComponentId: 'uno_1', fromPinId: 'arduino-D6', toComponentId: 'ultrasonic_1', toPinId: 'trig', color: 'orange' },
      // Sensor ECHO -> Arduino Digital Pin 7
      { id: 'w5', fromComponentId: 'uno_1', fromPinId: 'arduino-D7', toComponentId: 'ultrasonic_1', toPinId: 'echo', color: 'yellow' },

      // --- Red LED Circuit: Arduino D4 -> Resistor -> LED Anode, Cathode -> GND Rail ---
      // Arduino Digital Pin 4 -> Resistor Terminal 1
      { id: 'w6', fromComponentId: 'uno_1', fromPinId: 'arduino-D4', toComponentId: 'res_red', toPinId: 'p1', color: 'red' },
      // Resistor Terminal 2 -> Red LED Anode
      { id: 'w7', fromComponentId: 'res_red', fromPinId: 'p2', toComponentId: 'led_red', toPinId: 'anode', color: 'red' },
      // Red LED Cathode -> Breadboard Negative Rail (GND)
      { id: 'w8', fromComponentId: 'led_red', fromPinId: 'cathode', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_10', color: 'black' },

      // --- Green LED Circuit: Arduino D3 -> Resistor -> LED Anode, Cathode -> GND Rail ---
      // Arduino Digital Pin 3 -> Resistor Terminal 1
      { id: 'w9', fromComponentId: 'uno_1', fromPinId: 'arduino-D3', toComponentId: 'res_green', toPinId: 'p1', color: 'green' },
      // Resistor Terminal 2 -> Green LED Anode
      { id: 'w10', fromComponentId: 'res_green', fromPinId: 'p2', toComponentId: 'led_green', toPinId: 'anode', color: 'green' },
      // Green LED Cathode -> Breadboard Negative Rail (GND)
      { id: 'w11', fromComponentId: 'led_green', fromPinId: 'cathode', toComponentId: 'breadboard_1', toPinId: 'rail_bot_neg_15', color: 'black' }
    ]
  },
  {
    id: 12,
    title: 'Smart Health Monitoring System',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Advanced',
    // The lab sheet's own bill of materials, not the LM35-on-an-Uno circuit
    // this used to describe: a Raspberry Pi (this app emulates the Pico), a
    // DS18B20, a pulse sensor read through an MCP3008 SPI ADC because a
    // Raspberry Pi has no analog input pins of its own, and an optional OLED
    // the code below does not use — every reading it takes goes to `print()`.
    keyComponents: [
      'Raspberry Pi 3/4',
      'DS18B20 Temperature Sensor',
      'Pulse Sensor (SEN-11574)',
      'MCP3008 ADC',
      '4.7kΩ Resistor',
      'OLED Display (optional)',
      'WiFi Dongle'
    ],
    description: 'Read body temperature from a DS18B20 and heart rate from a pulse sensor wired through an external ADC — the converter a Raspberry Pi needs because it has no analog pins of its own — and flag readings outside the normal range.',
    tips: [
      'The DS18B20 is a real digital thermometer, not a stand-in: it reports body temperature straight off its 1-Wire bus.',
      'The pulse sensor is analog, so it goes into the MCP3008\'s channel 0 rather than a GPIO pin directly.',
      'Watch the printed status flip to ALERT when temperature drifts outside 36.1-37.2C or BPM outside 60-100.'
    ],
    buildSteps: [
      'Place the Raspberry Pi Pico and breadboard, and wire the DS18B20\'s DATA line to GP4 with a 4.7kOhm pull-up to 3.3V.',
      'Place the MCP3008 and wire CLK/MOSI/MISO/CS to GP11/GP10/GP9/GP8, and VDD/VREF to the 3.3V rail.',
      'Wire the pulse sensor\'s output into the MCP3008\'s channel 0, and its VCC/GND to the rails.',
      'Run the script and watch the DS18B20 temperature and the peak-detected BPM print every loop.'
    ],
    defaultCode: HEALTH_MONITORING_RPI_SCRIPT,
    defaultComponents: [
      { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 50, y: 50, rotation: 0, properties: {} },
      { id: 'pulse_1', type: 'pulse_sensor', name: 'Pulse Sensor', x: 380, y: 60, rotation: 0, properties: { bpm: 72 } },
      { id: 'lm35_1', type: 'lm35', name: 'LM35 Sensor', x: 500, y: 120, rotation: 0, properties: { temperature: 36 } }
    ],
    defaultWires: [
      // Pulse sensor wires
      { id: 'w1', fromComponentId: 'uno_1', fromPinId: '5V', toComponentId: 'pulse_1', toPinId: 'vcc', color: 'red' },
      { id: 'w2', fromComponentId: 'uno_1', fromPinId: 'GND_P1', toComponentId: 'pulse_1', toPinId: 'gnd', color: 'black' },
      { id: 'w3', fromComponentId: 'uno_1', fromPinId: 'A0', toComponentId: 'pulse_1', toPinId: 'sig', color: 'blue' },
      
      // LM35 wires
      { id: 'w4', fromComponentId: 'uno_1', fromPinId: '5V', toComponentId: 'lm35_1', toPinId: 'vcc', color: 'red' },
      { id: 'w5', fromComponentId: 'uno_1', fromPinId: 'GND_P2', toComponentId: 'lm35_1', toPinId: 'gnd', color: 'black' },
      { id: 'w6', fromComponentId: 'uno_1', fromPinId: 'A1', toComponentId: 'lm35_1', toPinId: 'out', color: 'orange' }
    ]
  },
  {
    id: 13,
    title: 'Custom Arduino Uno Sandbox (Blank Workspace)',
    category: 'arduino',
    platform: 'Arduino',
    difficulty: 'Beginner',
    keyComponents: ['Arduino Uno R3', 'Breadboard'],
    description: 'A completely blank canvas sandbox. Add components from the library, route wires, and write your own custom Arduino C++ code.',
    tips: [
      'Select the Component Library tab in the sidebar to add LEDs, resistors, buzzers, and sensors.',
      'Click on any pin/terminal and then click another to route a wire connection.',
      'Select any component to edit its properties (like LED color or resistor resistance) or delete it.'
    ],
    buildSteps: [
      'Drag and place components from the Library list.',
      'Click any pin to start drawing a wire, then click another pin to connect.',
      'Select a placed component to rename it, adjust its values, or delete it.',
      'Write custom setup() and loop() functions in the C++ editor, then run!'
    ],
    defaultCode: `// Arduino Custom Sandbox
int ledPin = 13;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
  Serial.println("Arduino Sandbox Initialized");
}

void loop() {
  // Write your code here
  
}`,
    defaultComponents: [
      { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 50, y: 70, rotation: 0, properties: {} },
      { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 350, y: 70, rotation: 0, properties: {} }
    ],
    defaultWires: []
  },
  {
    id: 14,
    title: 'Custom Raspberry Pi Sandbox (Blank Workspace)',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Beginner',
    keyComponents: ['Raspberry Pi Pico', 'Breadboard'],
    description: 'A blank canvas sandbox for Python. Place microcontrollers, configure sensors/outputs, and write custom MicroPython scripts.',
    tips: [
      'Use the Component Library to add items onto the canvas.',
      'Click on ports to draw signal or power wires (red for power, black for GND).',
      'Select any component to rename or delete it, or adjust its resistance/colors.'
    ],
    buildSteps: [
      'Drag and place components from the Library list.',
      'Click any pin to start drawing a wire, then click another pin to connect.',
      'Select a placed component to rename it, adjust its values, or delete it.',
      'Write custom Python code in the editor, then run!'
    ],
    defaultCode: `# Raspberry Pi Pico Sandbox
import time
print("Pico Sandbox Initialized")

while True:
    time.sleep(1)
`,
    defaultComponents: [
      { id: 'rpi_1', type: 'raspberry_pi', name: 'Raspberry Pi Pico', x: 50, y: 110, rotation: 0, properties: {} },
      { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 350, y: 70, rotation: 0, properties: {} }
    ],
    defaultWires: []
  }
];
