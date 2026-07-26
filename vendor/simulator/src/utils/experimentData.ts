import type { Experiment } from '../types';

export const EXPERIMENTS: Experiment[] = [
  {
    id: 1,
    title: 'LED & DHT11 Temp/Humidity Sensor Interfacing',
    category: 'arduino',
    platform: 'Arduino',
    difficulty: 'Beginner',
    keyComponents: ['Arduino Uno', 'LED', 'DHT11', 'Resistor (220Ω)'],
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
    defaultCode: `// Experiment 1: DHT11 Sensor & Non-blocking LED Alert
// This sketch reads temperature and humidity from a DHT11 sensor every 2 seconds.
// If the temperature exceeds 28°C, an LED blinks continuously without blocking the sensor updates.

#include <DHT.h>

// Define hardware pins
#define DHTPIN 2       // DHT11 Data pin connected to Digital Pin 2
#define DHTTYPE DHT11  // Using DHT11 sensor
#define LED_PIN 13     // LED connected to Digital Pin 13

// Initialize DHT sensor
DHT dht(DHTPIN, DHTTYPE);

// Timing variables for non-blocking sensor reads
unsigned long previousSensorMillis = 0;
const long sensorInterval = 2000; // Read every 2 seconds

// Timing variables for non-blocking LED blink
unsigned long previousLedMillis = 0;
const long ledInterval = 500; // Blink every 500ms
int ledState = LOW; // Current state of the LED

// Global variable to store the latest temperature reading
float currentTemp = 0.0;

void setup() {
  // Initialize serial monitor
  Serial.begin(9600);
  Serial.println("DHT11 Sensor & LED System Initialized");
  
  // Initialize the DHT sensor
  dht.begin();
  
  // Configure the LED pin as an output
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  unsigned long currentMillis = millis();

  // 1. Non-blocking Sensor Read
  if (currentMillis - previousSensorMillis >= sensorInterval) {
    previousSensorMillis = currentMillis; // Update the timing variable
    
    currentTemp = dht.readTemperature();
    float h = dht.readHumidity();

    // Print the readings to the Serial Monitor
    Serial.print("Temperature: ");
    Serial.print(currentTemp);
    Serial.print(" *C  |  Humidity: ");
    Serial.print(h);
    Serial.println(" %");
  }

  // 2. Non-blocking LED Blink Logic
  if (currentTemp > 28) {
    // Temperature is HIGH: Blink the LED
    if (currentMillis - previousLedMillis >= ledInterval) {
      previousLedMillis = currentMillis; // Update the timing variable
      
      // Toggle LED state
      if (ledState == LOW) {
        ledState = HIGH;
      } else {
        ledState = LOW;
      }
      digitalWrite(LED_PIN, ledState);
    }
  } else {
    // Temperature is NORMAL: Ensure LED is OFF
    ledState = LOW;
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
    keyComponents: ['Arduino Uno', 'HC-SR04', 'PIR Sensor'],
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
    defaultCode: `// Experiment 2: Ultrasonic & PIR security check
int pirPin = 2;
int trigPin = 3;
int echoPin = 4;

void setup() {
  pinMode(pirPin, INPUT);
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  Serial.begin(9600);
  Serial.println("Security Scanner Online...");
}

void loop() {
  int motion = digitalRead(pirPin); // Reads logic state from PIR OUT
  int dist = distance;              // Reads simulated range

  Serial.print("Motion: ");
  Serial.print(motion);
  Serial.print(" | Range: ");
  Serial.print(dist);
  Serial.println(" cm");

  if (motion == 1 && dist < 50) {
    Serial.println("WARNING: Intruder Detected close by!");
  } else if (motion == 1) {
    Serial.println("Notice: Motion detected at safe distance.");
  }

  delay(1500);
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
    keyComponents: ['Arduino Uno', 'Red/Yellow/Green LEDs', '3x 220Ω Resistors'],
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
    defaultCode: `// Experiment 3: Traffic Light System
int redLED = 10;
int yellowLED = 11;
int greenLED = 12;

void setup() {
  pinMode(redLED, OUTPUT);
  pinMode(yellowLED, OUTPUT);
  pinMode(greenLED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Traffic Lights Starting...");
}

void loop() {
  // Red State
  Serial.println("State: RED - STOP!");
  digitalWrite(redLED, HIGH);
  digitalWrite(yellowLED, LOW);
  digitalWrite(greenLED, LOW);
  delay(3000);

  // Green State
  Serial.println("State: GREEN - GO!");
  digitalWrite(redLED, LOW);
  digitalWrite(yellowLED, LOW);
  digitalWrite(greenLED, HIGH);
  delay(3000);

  // Yellow State
  Serial.println("State: YELLOW - CAUTION!");
  digitalWrite(redLED, LOW);
  digitalWrite(yellowLED, HIGH);
  digitalWrite(greenLED, LOW);
  delay(1000);
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
    keyComponents: ['Arduino Uno', 'YF-S201 Water Flow Sensor'],
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
    defaultCode: `// Experiment 4: Water Flow Detector
int sensorPin = 2;

void setup() {
  pinMode(sensorPin, INPUT);
  Serial.begin(9600);
  Serial.println("Flow Meter Activated.");
}

void loop() {
  // Read flow sensor value in L/min from control panel slider
  float flow = flowRateInput; 

  Serial.print("Current Flow Rate: ");
  Serial.print(flow);
  Serial.println(" L/min");

  if (flow > 8.0) {
    Serial.println("WARNING: High flow rate detected!");
  }

  delay(2000);
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
    title: 'LED & Push Button with Raspberry Pi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Beginner',
    keyComponents: ['Raspberry Pi Pico', 'LED', 'Push Button', '10kΩ Pull-down Resistor'],
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
    defaultCode: `from machine import Pin
import time

# GPIO pins matching the canvas netlist
LED_PIN = 15 
BUTTON_PIN = 14 

led = Pin(LED_PIN, Pin.OUT)
button = Pin(BUTTON_PIN, Pin.IN, Pin.PULL_DOWN)

print("Starting Raspberry Pi GPIO script...")

# The infinite loop keeps the simulation running
while True:
    if button.value() == 1:
        led.value(1)
        print("Button pressed -> LED ON")
    else:
        led.value(0)
        
    # Crucial: Sleep yields execution back to the JS simulation engine
    # to prevent browser UI freezing/crashing.
    time.sleep(0.1)`,
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
    title: 'Motion Sensor Alarm using PIR',
    category: 'arduino',
    platform: 'Arduino',
    difficulty: 'Beginner',
    keyComponents: ['Arduino Uno', 'PIR Sensor', 'Piezo Buzzer'],
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
    defaultCode: `// Experiment 6: Motion Sensor Alarm
int pirPin = 2;
int buzzerPin = 3;

void setup() {
  pinMode(pirPin, INPUT);
  pinMode(buzzerPin, OUTPUT);
  Serial.begin(9600);
  Serial.println("Alarm System Activated");
}

void loop() {
  int motion = digitalRead(pirPin); // reads logic output from PIR sensor

  if (motion == 1) {
    Serial.println("ALERT! Motion detected! Sounding Buzzer!");
    digitalWrite(buzzerPin, HIGH);
    delay(200);
    digitalWrite(buzzerPin, LOW);
    delay(200);
  } else {
    digitalWrite(buzzerPin, LOW);
    delay(1000);
  }
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
    title: 'DHT11 with Raspberry Pi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Beginner',
    keyComponents: ['Raspberry Pi Pico', 'DHT11 Sensor'],
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
    defaultCode: `# Experiment 7: DHT11 and Raspberry Pi Pico
import time
# Assume the engine provides a virtual DHT library
import virtual_dht 

DHT_PIN = 4 # GP4
sensor = virtual_dht.DHT11(DHT_PIN)

print("Initializing DHT11 Sensor on GP4...")

while True:
    try:
        # Trigger a read from the virtual sensor
        sensor.measure()
        
        # Fetch the values
        temp = sensor.temperature()
        hum = sensor.humidity()
        
        # Print to the Serial Monitor using safe formatting
        print(f"Temp: {temp}°C, Humidity: {hum}%")
        
        # Logic check
        if temp > 30:
            print("CRITICAL: Hot room! Turn on AC.")
            
    except Exception as e:
        print(f"Sensor read error: {str(e)}")
        
    # Yield execution back to the JS engine to prevent UI freezing
    time.sleep(2.0)`,
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
    title: 'DS18B20 Temperature Sensor with RPi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Intermediate',
    keyComponents: ['Raspberry Pi Pico', 'DS18B20 Temp Probe', '4.7kΩ Pull-up Resistor'],
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
    defaultCode: `# Experiment 8: RPi with DS18B20
import time
import machine
import onewire
import ds18x20

# Define the pin where the green data wire is connected
DATA_PIN = machine.Pin(15) 

print("[Simulation Started on Raspberry Pi]")
print("Searching for 1-Wire devices...")

try:
    # Initialize the 1-Wire bus and DS18B20 sensor
    ds_sensor = ds18x20.DS18X20(onewire.OneWire(DATA_PIN))
    roms = ds_sensor.scan()
    
    if not roms:
        print("Error: No DS18B20 device found. Check wiring!")
    else:
        print(f"Found DS18B20 device with address: {roms[0]}")
        
        while True:
            ds_sensor.convert_temp()
            time.sleep_ms(750)
            temp = ds_sensor.read_temp(roms[0])
            
            # Use f-strings to force proper string rendering in the UI
            print(f"DS18B20 Temperature: {temp} °C")
            
            if temp > 40:
                print("HIGH TEMP WARNING: Liquid boiling!")
            
            time.sleep(1)
            
except Exception as e:
    print(f"Fatal Error: {str(e)}")`,
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
    title: 'DC & Stepper Motor Control with RPi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Intermediate',
    keyComponents: ['Raspberry Pi Pico', 'L298N Motor Driver', 'DC Motor'],
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
    defaultCode: `from machine import Pin
import time

# Initialize L298N DC Motor Pins (Channel A)
in1 = Pin(14, Pin.OUT)
in2 = Pin(15, Pin.OUT)
ena = Pin(13, Pin.OUT)
ena.value(1) # Enable Channel A

print("[Simulation Started on Raspberry Pi]")
print("Initializing Motor Controller...")

while True:
    print("Spinning DC Motor Clockwise...")
    in1.value(1)
    in2.value(0)
    time.sleep(2)
    
    print("Braking DC Motor...")
    in1.value(0)
    in2.value(0)
    time.sleep(1)
    
    print("Spinning DC Motor Counter-Clockwise...")
    in1.value(0)
    in2.value(1)
    time.sleep(2)`,
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
    title: 'Home Automation with Raspberry Pi',
    category: 'raspberry-pi',
    platform: 'Raspberry Pi',
    difficulty: 'Intermediate',
    keyComponents: ['Raspberry Pi Pico', '5V Relay Module'],
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
    defaultCode: `import asyncio
from machine import Pin

print("[Simulation Started on Raspberry Pi]")

async def run_automation():
    try:
        # Initialize Relay on the correct pin (matching the green wire)
        RELAY_PIN = 15 
        print(f"Initializing Relay on GP{RELAY_PIN}...")
        relay = Pin(RELAY_PIN, Pin.OUT)
        print("Initialization successful. Starting loop...")
        
        while True:
            relay.value(1)
            print("Relay Triggered: [ON] -> Appliance Powered")
            await asyncio.sleep(2) # Non-blocking yield to React UI
            
            relay.value(0)
            print("Relay Triggered: [OFF] -> Appliance Off")
            await asyncio.sleep(2)
            
    except Exception as err:
        # Catch silent hardware mapping crashes
        print("CRITICAL ERROR: " + str(err))

# Execute the non-blocking loop
asyncio.run(run_automation())`,
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
    platform: 'Arduino',
    difficulty: 'Advanced',
    keyComponents: ['Arduino Uno', 'Red/Green LEDs', '2x 220Ω Resistors', 'HC-SR04 Sensor'],
    description: 'Build an adaptive traffic light system. Uses an HC-SR04 ultrasonic sensor to detect vehicle presence and dynamically switch between Red (stop) and Green (go) lights.',
    tips: [
      'The HC-SR04 acts as a vehicle presence detector via the Distance slider.',
      'Adjust the distance slider in the controls panel. If distance < 100cm (vehicle detected), the green light activates.',
      'If no vehicle is detected (distance >= 100cm), the system defaults to the red light.'
    ],
    buildSteps: [
      'Place Arduino Uno R3, Breadboard, HC-SR04 Ultrasonic Sensor, Red LED, Green LED, and two 220Ω Resistors.',
      'Connect Arduino GND to Breadboard bottom black rail (-) with a Black wire.',
      'Connect HC-SR04 VCC to Arduino 5V, GND to Arduino GND.',
      'Connect HC-SR04 TRIG to Arduino pin D6, ECHO to pin D7.',
      'Connect Arduino D4 -> Resistor 1 (p1) -> Resistor 1 (p2) -> Red LED Anode. Red LED Cathode -> GND rail.',
      'Connect Arduino D3 -> Resistor 2 (p1) -> Resistor 2 (p2) -> Green LED Anode. Green LED Cathode -> GND rail.'
    ],
    defaultCode: `// Experiment 11: Smart Traffic Light Controller
// HC-SR04 detects vehicle presence to control Red/Green LEDs

int trigPin = 6;   // HC-SR04 TRIG on Digital Pin 6
int echoPin = 7;   // HC-SR04 ECHO on Digital Pin 7
int redPin = 4;    // Red LED on Digital Pin 4
int greenPin = 3;  // Green LED on Digital Pin 3

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(redPin, OUTPUT);
  pinMode(greenPin, OUTPUT);
  Serial.begin(9600);
  Serial.println("Smart Traffic Controller Active");
}

void loop() {
  int carDist = distance; // reads simulated vehicle range from slider

  Serial.print("Vehicle Distance: ");
  Serial.print(carDist);
  Serial.println(" cm");

  if (carDist > 0 && carDist < 100) {
    // Vehicle detected within 100cm: Turn Green
    Serial.println("Vehicle Detected! GREEN Light ON");
    digitalWrite(redPin, LOW);
    digitalWrite(greenPin, HIGH);
  } else {
    // No vehicle: Default to Red
    Serial.println("No Vehicle: RED Light ON");
    digitalWrite(greenPin, LOW);
    digitalWrite(redPin, HIGH);
  }

  delay(2000);
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
    category: 'arduino',
    platform: 'Arduino',
    difficulty: 'Advanced',
    keyComponents: ['Arduino Uno', 'Pulse Sensor', 'LM35 Temperature Sensor'],
    description: 'Aggregate pulse beats (BPM) and body temperature, pushing readings to a visual ThingSpeak Cloud Widget.',
    tips: [
      'The pulse sensor reads micro-changes in light refraction to determine heartbeat (BPM).',
      'The LM35 outputs analog millivolts proportional to body temperature (10mV/°C).',
      'When running, the ThingSpeak Cloud dashboard panel will plot virtual telemetry charts.'
    ],
    buildSteps: [
      'Place Arduino Uno R3, Pulse Heart Sensor, and LM35 Temperature Sensor.',
      'Connect Pulse Sensor VCC to Arduino 5V, GND to GND, and SIG to Arduino Analog A0.',
      'Connect LM35 VCC to Arduino 5V, GND to GND, and OUT to Arduino Analog A1.'
    ],
    defaultCode: `// Experiment 12: Smart Patient telemetry
int pulsePin = A0;
int tempPin = A1;

void setup() {
  Serial.begin(9600);
  Serial.println("ThingSpeak Patient Telemetry online...");
}

void loop() {
  // Read simulated analog values from connected inputs
  int bpm = analogRead(pulsePin);
  int temp = analogRead(tempPin);

  Serial.print("BPM: ");
  Serial.print(bpm);
  Serial.print(" | Body Temp: ");
  Serial.print(temp);
  Serial.println(" C");

  // Mock pushing to ThingSpeak IoT
  Serial.println("ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!");

  delay(3000);
}`,
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
