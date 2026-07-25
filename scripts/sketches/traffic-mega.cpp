/*
 * Experiment 11 — Smart Traffic Light Controller (slug smart-traffic-controller).
 *
 * This is the sketch the experiment itself publishes, in its "Arduino Code"
 * section: seed 003_experiments.sql and migration 016_backfill_authored_content
 * both carry it, character for character. It is copied here rather than
 * paraphrased so that what students read and what the emulated board executes
 * cannot drift apart.
 *
 * THE ONLY CHANGE from the published listing is the #include below. The lab
 * publishes a .ino, and the Arduino build system silently turns a .ino into a
 * .cpp by adding `#include <Arduino.h>` and hoisting function prototypes. This
 * script drives cc1plus directly and does no such preprocessing, so the include
 * is written out. The prototypes are unnecessary here because allRed() and
 * setGreen() are already defined above their first use.
 *
 * Lane 1 R/Y/G on pins 22/23/24, lane 2 on 25/26/27, lane 3 on 28/29/30, lane 4
 * on 31/32/33, with the four density potentiometers on A0-A3 — sixteen signals,
 * which is why the experiment specifies a Mega and not an Uno.
 *
 * Build: node scripts/build-avr-hex.mjs --board mega \
 *          --sketch scripts/sketches/traffic-mega.cpp --out public/sim/traffic-mega.hex
 */
#include <Arduino.h>

int redPins[]={22,25,28,31}; int yelPins[]={23,26,29,32}; int grnPins[]={24,27,30,33};
int densityPin[]={A0,A1,A2,A3};

void allRed(){for(int i=0;i<4;i++){digitalWrite(redPins[i],HIGH);digitalWrite(yelPins[i],LOW);digitalWrite(grnPins[i],LOW);}}
void setGreen(int lane){allRed();digitalWrite(redPins[lane],LOW);digitalWrite(grnPins[lane],HIGH);}

void setup(){for(int i=0;i<4;i++){pinMode(redPins[i],OUTPUT);pinMode(yelPins[i],OUTPUT);pinMode(grnPins[i],OUTPUT);}allRed();Serial.begin(9600);}

void loop(){
  for(int i=0;i<4;i++){
    int density=analogRead(densityPin[i]);
    int greenTime=3000+(long)density*7;
    Serial.print("Lane ");Serial.print(i+1);Serial.print(" Green: ");Serial.print(greenTime);Serial.println("ms");
    setGreen(i); delay(greenTime);
    digitalWrite(grnPins[i],LOW); digitalWrite(yelPins[i],HIGH); delay(2000);
  }
}
