#include <Arduino.h>

void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  Serial.println("VLAB");
}

void loop() {
  digitalWrite(13, HIGH);
  delay(100);
  digitalWrite(13, LOW);
  delay(100);
}
