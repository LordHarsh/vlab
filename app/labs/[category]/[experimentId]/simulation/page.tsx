'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronLeft, ChevronRight, Power, Zap } from 'lucide-react'

type PinState = 'high' | 'low'

export default function SimulationPage() {
  const [gpioPins, setGpioPins] = useState<Record<number, PinState>>({
    17: 'low',
    18: 'low',
    27: 'low',
    22: 'low',
  })

  const togglePin = (pinNumber: number) => {
    setGpioPins(prev => ({
      ...prev,
      [pinNumber]: prev[pinNumber] === 'low' ? 'high' : 'low'
    }))
  }

  const resetAll = () => {
    setGpioPins({
      17: 'low',
      18: 'low',
      27: 'low',
      22: 'low',
    })
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Interactive Simulation</h1>
        <p className="text-muted-foreground">
          Control GPIO pins and observe LED behavior in real-time
        </p>
      </div>

      {/* Instructions */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">How to Use This Simulation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>• Click on GPIO pins to toggle them between HIGH (3.3V) and LOW (0V) states</p>
          <p>• Watch the connected LEDs turn on/off based on pin states</p>
          <p>• HIGH state = LED ON (green), LOW state = LED OFF (gray)</p>
          <p>• Use the Reset button to turn off all pins</p>
        </CardContent>
      </Card>

      {/* Simulation Area */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-5 w-5" />
            GPIO Pin Controller
          </CardTitle>
          <CardDescription>
            Click pins to toggle between HIGH and LOW states
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Raspberry Pi Board Visualization */}
          <div className="bg-gradient-to-br from-green-700 to-green-800 p-8 rounded-lg mb-6">
            <div className="grid grid-cols-2 gap-8">
              {/* GPIO Pins */}
              {Object.entries(gpioPins).map(([pinNumber, state]) => (
                <div key={pinNumber} className="flex items-center gap-4">
                  {/* Pin Button */}
                  <button
                    onClick={() => togglePin(Number(pinNumber))}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all ${
                      state === 'high'
                        ? 'bg-yellow-400 border-yellow-500 shadow-lg shadow-yellow-500/50'
                        : 'bg-gray-600 border-gray-700'
                    }`}
                  >
                    <div className="flex flex-col items-start">
                      <span className="text-xs font-semibold text-gray-900">
                        GPIO {pinNumber}
                      </span>
                      <span className={`text-[10px] font-bold ${
                        state === 'high' ? 'text-orange-900' : 'text-gray-400'
                      }`}>
                        {state === 'high' ? '3.3V HIGH' : '0V LOW'}
                      </span>
                    </div>
                    <Power className={`h-5 w-5 ${
                      state === 'high' ? 'text-orange-900' : 'text-gray-400'
                    }`} />
                  </button>

                  {/* Connection Line */}
                  <div className={`h-0.5 w-8 ${
                    state === 'high' ? 'bg-yellow-400' : 'bg-gray-600'
                  }`} />

                  {/* LED Indicator */}
                  <div className="flex flex-col items-center gap-2">
                    <div className={`h-12 w-12 rounded-full border-4 transition-all ${
                      state === 'high'
                        ? 'bg-green-400 border-green-500 shadow-lg shadow-green-500/50 animate-pulse'
                        : 'bg-gray-700 border-gray-800'
                    }`} />
                    <span className="text-xs text-white font-medium">
                      LED {pinNumber}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Control Panel */}
          <div className="flex justify-between items-center pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Active Pins: {Object.values(gpioPins).filter(s => s === 'high').length} / {Object.keys(gpioPins).length}
            </div>
            <Button onClick={resetAll} variant="outline" size="sm">
              Reset All Pins
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Code Example */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Python Code Example</CardTitle>
          <CardDescription>
            This is how you would control GPIO pins in actual Python code
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-gray-950 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
{`import RPi.GPIO as GPIO
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
    print("GPIO cleanup done")`}
          </pre>
        </CardContent>
      </Card>

      {/* Learning Points */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Key Takeaways</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-3">
              <span className="text-muted-foreground">•</span>
              <span>GPIO pins can be programmatically controlled to output HIGH (3.3V) or LOW (0V)</span>
            </li>
            <li className="flex gap-3">
              <span className="text-muted-foreground">•</span>
              <span>LEDs turn ON when connected to HIGH state pins and OFF when connected to LOW state</span>
            </li>
            <li className="flex gap-3">
              <span className="text-muted-foreground">•</span>
              <span>Python's RPi.GPIO library provides simple methods to control pin states</span>
            </li>
            <li className="flex gap-3">
              <span className="text-muted-foreground">•</span>
              <span>Always clean up GPIO resources when your program exits to avoid conflicts</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <Button variant="outline" asChild>
          <Link href={`/labs/iot/raspberry-pi-intro/procedure`}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous: Procedure
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/labs/iot/raspberry-pi-intro/posttest`}>
            Next: Posttest
            <ChevronRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
