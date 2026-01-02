import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default async function ProcedurePage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params

  const steps = [
    {
      title: 'Unboxing and Initial Setup',
      description: 'Prepare your Raspberry Pi for first use',
      instructions: [
        'Carefully remove the Raspberry Pi from its anti-static packaging',
        'Check all components: board, power supply, SD card, HDMI cable',
        'Inspect the board for any physical damage',
        'Place the board on a non-conductive surface'
      ]
    },
    {
      title: 'Installing the Operating System',
      description: 'Set up Raspberry Pi OS on your SD card',
      instructions: [
        'Download Raspberry Pi Imager from the official website',
        'Insert the SD card into your computer using a card reader',
        'Open Raspberry Pi Imager and select "Raspberry Pi OS (32-bit)"',
        'Choose your SD card as the storage destination',
        'Click "Write" and wait for the process to complete',
        'Safely eject the SD card from your computer'
      ]
    },
    {
      title: 'Hardware Connections',
      description: 'Connect all peripherals to your Raspberry Pi',
      instructions: [
        'Insert the prepared SD card into the SD card slot on the Raspberry Pi',
        'Connect the HDMI cable from the Raspberry Pi to your monitor',
        'Connect a USB keyboard and mouse to the USB ports',
        'Connect an Ethernet cable for network access (or use Wi-Fi later)',
        'Finally, connect the power supply to boot up the system'
      ]
    },
    {
      title: 'First Boot and Configuration',
      description: 'Complete the initial setup wizard',
      instructions: [
        'Wait for the Raspberry Pi to boot up (may take 1-2 minutes)',
        'Follow the on-screen setup wizard',
        'Set your country, language, and timezone',
        'Change the default password for security',
        'Connect to Wi-Fi if not using Ethernet',
        'Allow the system to update if prompted'
      ]
    },
    {
      title: 'Testing GPIO Functionality',
      description: 'Verify that GPIO pins are working correctly',
      instructions: [
        'Open the Terminal application from the menu',
        'Run the command: gpio readall',
        'Observe the GPIO pin layout and current states',
        'Note the different pin numbering schemes (BCM vs Board)',
        'Identify power pins (3.3V, 5V) and ground pins'
      ]
    },
    {
      title: 'Running Your First Program',
      description: 'Test the Raspberry Pi with a simple Python script',
      instructions: [
        'Open Thonny Python IDE from the Programming menu',
        'Create a new file and save it as "hello_pi.py"',
        'Type: print("Hello from Raspberry Pi!")',
        'Click the Run button or press F5',
        'Observe the output in the console window',
        'Congratulations! You\'ve run your first program'
      ]
    }
  ]

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Procedure</h1>
        <p className="text-muted-foreground">
          Follow these step-by-step instructions to set up and test your Raspberry Pi
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-6">
        {steps.map((step, index) => (
          <Card key={index}>
            <CardHeader>
              <div className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 ml-12">
                {step.instructions.map((instruction, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="text-muted-foreground">•</span>
                    <span>{instruction}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Safety Notice */}
      <Card className="mt-6 border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20">
        <CardHeader>
          <CardTitle className="text-base text-orange-900 dark:text-orange-100">
            Safety Precautions
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-orange-800 dark:text-orange-200">
          <ul className="space-y-1">
            <li>• Always disconnect power before making hardware changes</li>
            <li>• Avoid static electricity by grounding yourself</li>
            <li>• Do not connect/disconnect components while powered on</li>
            <li>• Use the official power supply (5V, 3A minimum for Pi 4)</li>
            <li>• Ensure proper ventilation to prevent overheating</li>
          </ul>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <Button variant="outline" asChild>
          <Link href={`/labs/${category}/${experimentId}/pretest`}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous: Pretest
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/labs/${category}/${experimentId}/simulation`}>
            Next: Simulation
            <ChevronRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
