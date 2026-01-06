-- Virtual Lab Platform - Seed Data
-- This file contains initial data for development and testing

-- ============================================================================
-- SEED PROFILE (required for foreign key on experiments.created_by)
-- ============================================================================

insert into profiles (clerk_user_id, email, role)
values ('seed_user_id', 'seed@example.com', 'admin')
on conflict (clerk_user_id) do nothing;

-- ============================================================================
-- CATEGORIES
-- ============================================================================

insert into categories (slug, name, description, icon, color, display_order) values
  ('iot', 'Internet of Things', 'Learn about IoT devices, sensors, and connectivity', 'Cpu', '#10b981', 1),
  ('electronics', 'Electronics', 'Explore circuits, components, and electronic systems', 'Zap', '#f59e0b', 2),
  ('computer-science', 'Computer Science', 'Study algorithms, data structures, and programming', 'Code', '#3b82f6', 3);

-- ============================================================================
-- EXPERIMENTS
-- Note: In production, these would be created by instructors via the admin panel
-- For now, we'll use a placeholder clerk_user_id that you'll update
-- ============================================================================

insert into experiments (
  category_id,
  slug,
  title,
  description,
  difficulty,
  estimated_duration,
  aim,
  theory,
  procedure,
  simulation,
  tags,
  prerequisites,
  published,
  featured,
  created_by
) values
  -- IoT Experiments
  (
    (select id from categories where slug = 'iot'),
    'raspberry-pi-intro',
    'Introduction to Raspberry Pi',
    'Learn the basics of Raspberry Pi, its components, and how to set it up for your first project.',
    'beginner',
    45,
    '{
      "objectives": [
        "Understand what Raspberry Pi is and its applications",
        "Identify the key components of a Raspberry Pi board",
        "Set up Raspberry Pi OS and connect peripherals",
        "Learn about GPIO pins and their functions",
        "Write and run a simple Python program on Raspberry Pi"
      ],
      "outcomes": [
        "Successfully boot and configure Raspberry Pi",
        "Navigate the Raspberry Pi OS interface",
        "Understand GPIO pin layout and numbering",
        "Execute basic Python scripts",
        "Prepare for hardware interfacing projects"
      ]
    }'::jsonb,
    '{
      "sections": [
        {
          "title": "What is Raspberry Pi?",
          "content": "Raspberry Pi is a series of small single-board computers developed by the Raspberry Pi Foundation. It is designed to promote teaching of basic computer science in schools and developing countries, but has evolved into a versatile platform for hobbyists, educators, and professionals."
        },
        {
          "title": "Key Components",
          "content": "Understanding the components of your Raspberry Pi is essential for effective use.",
          "components": [
            {
              "name": "GPIO Pins",
              "description": "40-pin header for interfacing with external hardware (LEDs, sensors, motors, etc.)"
            },
            {
              "name": "USB Ports",
              "description": "Connect keyboard, mouse, and other USB devices"
            },
            {
              "name": "HDMI Port",
              "description": "Video output to monitors and TVs"
            },
            {
              "name": "Ethernet Port",
              "description": "Wired network connectivity"
            },
            {
              "name": "SD Card Slot",
              "description": "Storage for the operating system and files"
            },
            {
              "name": "Audio Jack",
              "description": "3.5mm audio output"
            }
          ]
        },
        {
          "title": "Applications",
          "content": "Raspberry Pi can be used for countless projects.",
          "applications": [
            "Home automation and IoT devices",
            "Media centers and streaming servers",
            "Retro gaming consoles",
            "Network-attached storage (NAS)",
            "Learning programming and electronics",
            "Robotics and automation projects"
          ]
        }
      ]
    }'::jsonb,
    '{
      "steps": [
        {
          "title": "Unboxing and Initial Setup",
          "description": "Prepare your Raspberry Pi for first use",
          "instructions": [
            "Carefully remove the Raspberry Pi from its anti-static packaging",
            "Check all components: board, power supply, SD card, HDMI cable",
            "Inspect the board for any physical damage",
            "Place the board on a non-conductive surface"
          ]
        },
        {
          "title": "Installing the Operating System",
          "description": "Set up Raspberry Pi OS on your SD card",
          "instructions": [
            "Download Raspberry Pi Imager from the official website",
            "Insert the SD card into your computer using a card reader",
            "Open Raspberry Pi Imager and select Raspberry Pi OS (32-bit)",
            "Choose your SD card as the storage destination",
            "Click Write and wait for the process to complete",
            "Safely eject the SD card from your computer"
          ]
        },
        {
          "title": "Hardware Connections",
          "description": "Connect all peripherals to your Raspberry Pi",
          "instructions": [
            "Insert the prepared SD card into the SD card slot",
            "Connect the HDMI cable from the Raspberry Pi to your monitor",
            "Connect a USB keyboard and mouse",
            "Connect an Ethernet cable for network access",
            "Finally, connect the power supply to boot up the system"
          ]
        }
      ]
    }'::jsonb,
    $${
      "gpio_pins": [17, 18, 27, 22],
      "instructions": [
        "Connect an LED to GPIO pin 17 through a 330Ω resistor",
        "Connect the LED's cathode (shorter leg) to ground",
        "Run the Python code to control the LED",
        "Observe the LED blinking on and off"
      ],
      "code_example": "import RPi.GPIO as GPIO\nimport time\n\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\n\ntry:\n    while True:\n        GPIO.output(17, GPIO.HIGH)\n        time.sleep(1)\n        GPIO.output(17, GPIO.LOW)\n        time.sleep(1)\nexcept KeyboardInterrupt:\n    GPIO.cleanup()",
      "learning_points": [
        "GPIO pin numbering (BCM vs BOARD)",
        "Setting up output pins",
        "Controlling LED state with HIGH/LOW",
        "Proper cleanup of GPIO resources"
      ]
    }$$::jsonb,
    array['raspberry-pi', 'iot', 'gpio', 'python', 'beginner'],
    array['Basic computer knowledge'],
    true,
    true,
    'seed_user_id'
  ),
  (
    (select id from categories where slug = 'iot'),
    'arduino-basics',
    'Arduino Programming Basics',
    'Get started with Arduino microcontrollers and learn to program digital circuits.',
    'beginner',
    60,
    '{
      "objectives": [
        "Understand Arduino architecture and capabilities",
        "Set up Arduino IDE and development environment",
        "Write and upload your first Arduino sketch",
        "Learn basic digital I/O operations"
      ]
    }'::jsonb,
    null,
    null,
    null,
    array['arduino', 'microcontroller', 'electronics', 'beginner'],
    array['Basic programming knowledge'],
    true,
    false,
    'seed_user_id'
  ),
  (
    (select id from categories where slug = 'iot'),
    'mqtt-protocol',
    'MQTT Protocol for IoT',
    'Learn about MQTT, a lightweight messaging protocol perfect for IoT applications.',
    'intermediate',
    90,
    '{
      "objectives": [
        "Understand publish-subscribe messaging pattern",
        "Set up an MQTT broker",
        "Implement MQTT clients for IoT devices"
      ]
    }'::jsonb,
    null,
    null,
    null,
    array['mqtt', 'iot', 'messaging', 'protocols'],
    array['Basic networking', 'Python or JavaScript'],
    true,
    false,
    'seed_user_id'
  ),

  -- Electronics Experiments
  (
    (select id from categories where slug = 'electronics'),
    'led-circuit',
    'LED Circuit Design',
    'Learn to design and build basic LED circuits with resistors.',
    'beginner',
    30,
    $${
      "objectives": [
        "Understand Ohm's law and its applications",
        "Calculate appropriate resistor values",
        "Build a simple LED circuit"
      ]
    }$$::jsonb,
    null,
    null,
    null,
    array['led', 'circuit', 'resistor', 'beginner'],
    array[]::text[],
    true,
    false,
    'seed_user_id'
  ),
  (
    (select id from categories where slug = 'electronics'),
    'transistor-basics',
    'Transistor Fundamentals',
    'Explore how transistors work as switches and amplifiers.',
    'intermediate',
    75,
    '{
      "objectives": [
        "Understand transistor operation",
        "Use transistors as switches",
        "Build basic amplifier circuits"
      ]
    }'::jsonb,
    null,
    null,
    null,
    array['transistor', 'amplifier', 'electronics'],
    array['Basic circuit knowledge'],
    false,
    false,
    'seed_user_id'
  ),

  -- Computer Science Experiments
  (
    (select id from categories where slug = 'computer-science'),
    'binary-search',
    'Binary Search Algorithm',
    'Master the binary search algorithm and understand its efficiency.',
    'beginner',
    40,
    '{
      "objectives": [
        "Understand binary search logic",
        "Implement binary search in code",
        "Analyze time complexity"
      ]
    }'::jsonb,
    null,
    null,
    null,
    array['algorithms', 'search', 'data-structures'],
    array['Basic programming'],
    true,
    false,
    'seed_user_id'
  ),
  (
    (select id from categories where slug = 'computer-science'),
    'sorting-algorithms',
    'Sorting Algorithms Comparison',
    'Compare different sorting algorithms and their performance characteristics.',
    'intermediate',
    90,
    '{
      "objectives": [
        "Learn bubble sort, merge sort, and quick sort",
        "Compare algorithm efficiency",
        "Choose appropriate sorting methods"
      ]
    }'::jsonb,
    null,
    null,
    null,
    array['algorithms', 'sorting', 'complexity'],
    array['Programming fundamentals', 'Big O notation'],
    true,
    true,
    'seed_user_id'
  ),
  (
    (select id from categories where slug = 'computer-science'),
    'data-structures',
    'Essential Data Structures',
    'Learn about stacks, queues, linked lists, and trees.',
    'intermediate',
    120,
    '{
      "objectives": [
        "Implement common data structures",
        "Understand use cases for each structure",
        "Analyze operations complexity"
      ]
    }'::jsonb,
    null,
    null,
    null,
    array['data-structures', 'algorithms', 'computer-science'],
    array['Programming experience'],
    true,
    false,
    'seed_user_id'
  );

-- ============================================================================
-- SIMULATIONS (for Raspberry Pi experiment)
-- ============================================================================

insert into simulations (experiment_id, title, description, simulation_type, config, code_template)
values (
  (select id from experiments where slug = 'raspberry-pi-intro'),
  'GPIO Pin Controller',
  'Interactive GPIO pin simulation with LED visualization',
  'gpio',
  '{
    "pins": [17, 18, 27, 22],
    "components": [
      {"type": "led", "pin": 17, "label": "LED 1", "color": "green"},
      {"type": "led", "pin": 18, "label": "LED 2", "color": "green"},
      {"type": "led", "pin": 27, "label": "LED 3", "color": "green"},
      {"type": "led", "pin": 22, "label": "LED 4", "color": "green"}
    ],
    "board": "raspberry-pi-4"
  }'::jsonb,
  'import RPi.GPIO as GPIO
import time

# Set up GPIO mode
GPIO.setmode(GPIO.BCM)

# Define pin numbers
LED_PIN = 17

# Set up the pin as output
GPIO.setup(LED_PIN, GPIO.OUT)

try:
    while True:
        # Turn LED ON (HIGH)
        GPIO.output(LED_PIN, GPIO.HIGH)
        print("LED ON")
        time.sleep(1)

        # Turn LED OFF (LOW)
        GPIO.output(LED_PIN, GPIO.LOW)
        print("LED OFF")
        time.sleep(1)

except KeyboardInterrupt:
    # Clean up on exit
    GPIO.cleanup()
    print("GPIO cleanup done")'
);

-- ============================================================================
-- QUIZZES (Pretest and Posttest for Raspberry Pi)
-- ============================================================================

-- Pretest
insert into quizzes (experiment_id, type, title, passing_percentage)
values (
  (select id from experiments where slug = 'raspberry-pi-intro'),
  'pretest',
  'Raspberry Pi Pre-Assessment',
  70
);

-- Pretest Questions
insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
values
  (
    (select id from quizzes where type = 'pretest' and experiment_id = (select id from experiments where slug = 'raspberry-pi-intro')),
    'What does GPIO stand for in Raspberry Pi?',
    '["General Purpose Input Only", "General Purpose Input/Output", "Graphics Processing Input/Output", "General Processing Interface Organizer"]'::jsonb,
    '1',
    'GPIO stands for General Purpose Input/Output, which are pins used to interface with external hardware.',
    1
  ),
  (
    (select id from quizzes where type = 'pretest' and experiment_id = (select id from experiments where slug = 'raspberry-pi-intro')),
    'Which operating system is commonly used on Raspberry Pi?',
    '["Windows 11", "macOS", "Raspberry Pi OS (formerly Raspbian)", "Android"]'::jsonb,
    '2',
    'Raspberry Pi OS (formerly called Raspbian) is the official operating system, though others can be used.',
    2
  ),
  (
    (select id from quizzes where type = 'pretest' and experiment_id = (select id from experiments where slug = 'raspberry-pi-intro')),
    'What type of storage does Raspberry Pi use for its operating system?',
    '["Internal SSD", "Hard Drive", "microSD card", "USB Flash Drive"]'::jsonb,
    '2',
    'Raspberry Pi boots from a microSD card that contains the operating system and files.',
    3
  );

-- Posttest
insert into quizzes (experiment_id, type, title, passing_percentage)
values (
  (select id from experiments where slug = 'raspberry-pi-intro'),
  'posttest',
  'Raspberry Pi Post-Assessment',
  70
);

-- Posttest Questions
insert into quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
values
  (
    (select id from quizzes where type = 'posttest' and experiment_id = (select id from experiments where slug = 'raspberry-pi-intro')),
    'When a GPIO pin is set to HIGH state, what voltage does it output?',
    '["5V", "3.3V", "1.8V", "12V"]'::jsonb,
    '1',
    'Raspberry Pi GPIO pins output 3.3V when set to HIGH state. Using 5V can damage the board.',
    1
  ),
  (
    (select id from quizzes where type = 'posttest' and experiment_id = (select id from experiments where slug = 'raspberry-pi-intro')),
    'What is the purpose of GPIO.cleanup() in Python code?',
    '["To delete Python files", "To reset the Raspberry Pi", "To release GPIO resources and reset pin states", "To clean the SD card"]'::jsonb,
    '2',
    'GPIO.cleanup() releases GPIO resources and resets pins to their default state, preventing conflicts with future programs.',
    2
  ),
  (
    (select id from quizzes where type = 'posttest' and experiment_id = (select id from experiments where slug = 'raspberry-pi-intro')),
    'Which pin numbering mode uses the Broadcom SOC channel numbers?',
    '["GPIO.BOARD", "GPIO.BCM", "GPIO.PHYSICAL", "GPIO.WPI"]'::jsonb,
    '1',
    'GPIO.BCM uses Broadcom SOC channel numbers (e.g., GPIO17, GPIO18), while GPIO.BOARD uses physical pin numbers.',
    3
  ),
  (
    (select id from quizzes where type = 'posttest' and experiment_id = (select id from experiments where slug = 'raspberry-pi-intro')),
    'What happens if you connect an LED directly to a GPIO pin without a resistor?',
    '["The LED will work perfectly", "Nothing will happen", "The LED or GPIO pin could be damaged due to excessive current", "The Raspberry Pi will shut down"]'::jsonb,
    '2',
    'Without a current-limiting resistor, excessive current can flow through the LED and GPIO pin, potentially damaging both.',
    4
  ),
  (
    (select id from quizzes where type = 'posttest' and experiment_id = (select id from experiments where slug = 'raspberry-pi-intro')),
    'Which command can you use to view the GPIO pin layout in the terminal?',
    '["ls -gpio", "gpio readall", "cat /gpio", "show pins"]'::jsonb,
    '1',
    'The command "gpio readall" displays a detailed table of all GPIO pins, their modes, and current states.',
    5
  );
