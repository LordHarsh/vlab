import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import Image from 'next/image'

export default async function TheoryPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Theory</h1>
        <p className="text-muted-foreground">Learn the fundamentals of Raspberry Pi</p>
      </div>

      <div className="space-y-6">
        {/* Introduction */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-xl font-semibold mb-4">Introduction to Raspberry Pi</h3>
            <p className="text-base leading-relaxed mb-4">
              The <strong>Raspberry Pi</strong> is a small, affordable single-board computer developed by the
              Raspberry Pi Foundation. It was originally created to promote the teaching of basic computer
              science in schools and developing countries, but has since gained popularity among hobbyists
              and professionals for a wide variety of projects.
            </p>
            <p className="text-base leading-relaxed">
              Raspberry Pi allows users to learn about <strong>programming</strong>, <strong>electronics</strong>,
              and <strong>computer systems</strong> in a hands-on, practical way.
            </p>
          </CardContent>
        </Card>

        {/* Key Components */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-xl font-semibold mb-4">Key Components</h3>
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">GPIO Pins (General Purpose Input/Output)</h4>
                <p className="text-sm text-muted-foreground">
                  40-pin header that allows you to control and read signals from external devices like LEDs,
                  sensors, motors, and more. Essential for IoT and electronics projects.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">USB Ports</h4>
                <p className="text-sm text-muted-foreground">
                  Multiple USB ports for connecting peripherals such as keyboards, mice, webcams, and external
                  storage devices.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">HDMI Port</h4>
                <p className="text-sm text-muted-foreground">
                  High-definition video output for connecting to monitors or TVs.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Ethernet Port</h4>
                <p className="text-sm text-muted-foreground">
                  Network connection for internet access and IoT applications.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Micro SD Card Slot</h4>
                <p className="text-sm text-muted-foreground">
                  Stores the operating system and all your files. Acts as the hard drive for Raspberry Pi.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Audio Jack</h4>
                <p className="text-sm text-muted-foreground">
                  3.5mm jack for audio output to speakers or headphones.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Applications */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-xl font-semibold mb-4">Applications of Raspberry Pi</h3>
            <ul className="space-y-3 text-base">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <div>
                  <strong>Home Automation:</strong> Control devices like lights, fans, and appliances remotely
                  using sensors and scripts.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <div>
                  <strong>Media Centers:</strong> Turn your Raspberry Pi into a smart media hub using software
                  like Kodi or Plex.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <div>
                  <strong>IoT Systems:</strong> Connect sensors and devices to collect and share data over the
                  internet.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <div>
                  <strong>Robotics:</strong> Control motors and sensors to build intelligent robots for various
                  tasks.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <div>
                  <strong>Web Servers:</strong> Host simple websites or web apps using lightweight server software.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <div>
                  <strong>Educational Tools:</strong> Learn programming, Linux, and basic electronics in a
                  hands-on way.
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex justify-between">
        <Button variant="outline" asChild>
          <Link href={`/labs/${category}/${experimentId}/aim`}>
            Previous: Aim
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/labs/${category}/${experimentId}/pretest`}>
            Next: Pretest
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
