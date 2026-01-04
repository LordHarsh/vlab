'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronLeft, ChevronRight, Power, Zap } from 'lucide-react'

type PinState = 'high' | 'low'

type SimulationConfig = {
  gpio_pins?: number[]
  instructions?: string[]
  code_example?: string
  learning_points?: string[]
}

type SimulationClientProps = {
  config: SimulationConfig
  category: string
  experimentId: string
}

export function SimulationClient({ config, category, experimentId }: SimulationClientProps) {
  const gpioPins = config.gpio_pins || [17, 18, 27, 22]
  const initialState: Record<number, PinState> = {}
  gpioPins.forEach(pin => {
    initialState[pin] = 'low'
  })

  const [pinStates, setPinStates] = useState<Record<number, PinState>>(initialState)

  const togglePin = (pinNumber: number) => {
    setPinStates(prev => ({
      ...prev,
      [pinNumber]: prev[pinNumber] === 'low' ? 'high' : 'low'
    }))
  }

  const resetAll = () => {
    const resetState: Record<number, PinState> = {}
    gpioPins.forEach(pin => {
      resetState[pin] = 'low'
    })
    setPinStates(resetState)
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
      {config.instructions && config.instructions.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">How to Use This Simulation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {config.instructions.map((instruction, index) => (
              <p key={index}>• {instruction}</p>
            ))}
          </CardContent>
        </Card>
      )}

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
              {gpioPins.map((pinNumber) => (
                <div key={pinNumber} className="flex items-center gap-4">
                  {/* Pin Button */}
                  <button
                    onClick={() => togglePin(pinNumber)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all ${
                      pinStates[pinNumber] === 'high'
                        ? 'bg-yellow-400 border-yellow-500 shadow-lg shadow-yellow-500/50'
                        : 'bg-gray-600 border-gray-700'
                    }`}
                  >
                    <div className="flex flex-col items-start">
                      <span className="text-xs font-semibold text-gray-900">
                        GPIO {pinNumber}
                      </span>
                      <span className={`text-[10px] font-bold ${
                        pinStates[pinNumber] === 'high' ? 'text-orange-900' : 'text-gray-400'
                      }`}>
                        {pinStates[pinNumber] === 'high' ? '3.3V HIGH' : '0V LOW'}
                      </span>
                    </div>
                    <Power className={`h-5 w-5 ${
                      pinStates[pinNumber] === 'high' ? 'text-orange-900' : 'text-gray-400'
                    }`} />
                  </button>

                  {/* Connection Line */}
                  <div className={`h-0.5 w-8 ${
                    pinStates[pinNumber] === 'high' ? 'bg-yellow-400' : 'bg-gray-600'
                  }`} />

                  {/* LED Indicator */}
                  <div className="flex flex-col items-center gap-2">
                    <div className={`h-12 w-12 rounded-full border-4 transition-all ${
                      pinStates[pinNumber] === 'high'
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
              Active Pins: {Object.values(pinStates).filter(s => s === 'high').length} / {gpioPins.length}
            </div>
            <Button onClick={resetAll} variant="outline" size="sm">
              Reset All Pins
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Code Example */}
      {config.code_example && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Code Example</CardTitle>
            <CardDescription>
              This is how you would implement this in actual code
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-950 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
              {config.code_example}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Learning Points */}
      {config.learning_points && config.learning_points.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Key Takeaways</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {config.learning_points.map((point, index) => (
                <li key={index} className="flex gap-3">
                  <span className="text-muted-foreground">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <Button variant="outline" asChild>
          <Link href={`/labs/${category}/${experimentId}/procedure`}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous: Procedure
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/labs/${category}/${experimentId}/posttest`}>
            Next: Posttest
            <ChevronRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
