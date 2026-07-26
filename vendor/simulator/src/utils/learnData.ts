export interface LearnTutorial {
  id: number;
  title: string;
  platform: string;
  video_url: string;
  description: string;
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
}

export const learnTutorials: LearnTutorial[] = [
  {
    "id": 1,
    "title": "LED & DHT11 Temperature/Humidity Sensor Interfacing",
    "platform": "Arduino",
    "video_url": "https://www.youtube.com/watch?v=OogldLc9uYc",
    "description": "Learn how to capture real-time atmospheric data using a DHT11 sensor and program conditional threshold triggers to activate an LED indicator.",
    "difficulty": "Beginner"
  },
  {
    "id": 2,
    "title": "Ultrasonic Sensor & PIR Sensor Interfacing",
    "platform": "Arduino",
    "video_url": "https://www.youtube.com/watch?v=SIc6zj06bhQ",
    "description": "Master obstacle avoidance and distance parsing with an HC-SR04 ultrasonic transducer alongside raw passive infrared motion detection pins.",
    "difficulty": "Beginner"
  },
  {
    "id": 3,
    "title": "Traffic Light Simulator",
    "platform": "Arduino",
    "video_url": "https://www.youtube.com/watch?v=4W3QuX5cOK8",
    "description": "Build an automated multi-LED state machine imitating junction traffic patterns using optimized non-blocking timing delays.",
    "difficulty": "Beginner"
  },
  {
    "id": 4,
    "title": "Water Flow Detection using Arduino",
    "platform": "Arduino",
    "video_url": "https://www.youtube.com/watch?v=gHQzjZk2LjA",
    "description": "Calibrate and read digital pulse data streams coming from a YF-S201 Hall-Effect turbine flow meter to compute exact liquid volumetric flow rates.",
    "difficulty": "Intermediate"
  },
  {
    "id": 5,
    "title": "LED & Push Button with Raspberry Pi",
    "platform": "Raspberry Pi",
    "video_url": "https://www.youtube.com/watch?v=3oeRmQxCl-M",
    "description": "Introduction to basic single-board hardware control. Set up low-level GPIO pins in Python using the gpiozero library to intercept button presses and light up an LED.",
    "difficulty": "Beginner"
  },
  {
    "id": 6,
    "title": "Motion Sensor Alarm using PIR",
    "platform": "Arduino / ESP32",
    "video_url": "https://www.youtube.com/watch?v=XLig6qX3k1s",
    "description": "Create a localized perimeter warning security array combining a digital PIR infrared motion module with an active piezo transducer buzzer alert.",
    "difficulty": "Beginner"
  },
  {
    "id": 7,
    "title": "DHT11 with Raspberry Pi",
    "platform": "Raspberry Pi",
    "video_url": "https://www.youtube.com/watch?v=KUr8WgSIsfk",
    "description": "Deploy environmental monitoring loops on Linux architectures by feeding DHT11 sensor metrics straight into Python telemetry scripts to extract temperature and humidity values.",
    "difficulty": "Beginner"
  },
  {
    "id": 8,
    "title": "DS18B20 Temperature Sensor with RPi",
    "platform": "Raspberry Pi",
    "video_url": "https://www.youtube.com/watch?v=aEnS0-Jy2vE",
    "description": "Enable and configure the Dallas 1-Wire kernel protocol layers on Linux to isolate precise thermal tracking data using waterproof DS18B20 probes.",
    "difficulty": "Intermediate"
  },
  {
    "id": 9,
    "title": "DC & Stepper Motor Control with RPi",
    "platform": "Raspberry Pi",
    "video_url": "https://www.youtube.com/watch?v=2bganVdLg5Q",
    "description": "Manage directional DC motor operations safely by routing logic parameters and Python scripts through an isolated L298N H-Bridge hardware motor driver module.",
    "difficulty": "Intermediate"
  },
  {
    "id": 10,
    "title": "Home Automation with Raspberry Pi",
    "platform": "Raspberry Pi",
    "video_url": "https://www.youtube.com/watch?v=Oi_P1yC9dQ8",
    "description": "Spin up a lightweight Flask application backend to control physical mains relays or isolated signals from any standard web browser UI via GPIO.",
    "difficulty": "Intermediate"
  },
  {
    "id": 11,
    "title": "Smart Traffic Light Controller",
    "platform": "Arduino",
    "video_url": "https://www.youtube.com/watch?v=XzkSwZKpBfI",
    "description": "Implement an intelligent adaptive intersection system that monitors relative vehicle density to calculate dynamically changing light durations.",
    "difficulty": "Advanced"
  },
  {
    "id": 12,
    "title": "Smart Health Monitoring System",
    "platform": "IoT / Cloud",
    "video_url": "https://www.youtube.com/watch?v=YG7Oj23IuSI",
    "description": "Log real-time health diagnostic indicators directly to the cloud analytics pipeline using the open-source ThingSpeak web API.",
    "difficulty": "Advanced"
  }
];
