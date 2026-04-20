import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FlaskConical, BookOpen, BarChart3, ArrowRight } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="bg-white">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="container mx-auto px-4 sm:px-6 py-20 md:py-32">
          <div className="max-w-3xl mx-auto text-center">
            <span className="inline-block mb-4 text-sm font-semibold text-[#ff385c] tracking-wide uppercase">
              Virtual Laboratory Platform
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-[#222222] leading-tight mb-6">
              Learn Electronics &amp; IoT Through{' '}
              <span className="text-[#ff385c]">Interactive Simulations</span>
            </h1>
            <p className="text-lg md:text-xl text-[#6a6a6a] mb-10 max-w-2xl mx-auto leading-relaxed">
              Explore circuits, sensors, and IoT concepts through hands-on
              virtual experiments — no hardware required. Learn at your own
              pace, anywhere.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                variant="outline"
                className="rounded-lg font-semibold border-[#222222] text-[#222222] hover:bg-[#f2f2f2] px-8"
                asChild
              >
                <Link href="/labs">
                  Browse Labs
                </Link>
              </Button>
              <Button
                size="lg"
                className="rounded-lg font-semibold bg-[#ff385c] hover:bg-[#e0334f] text-white px-8"
                asChild
              >
                <Link href="/sign-up">
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Decorative background */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-[#ff385c]/5 blur-3xl" />
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-[#ebebeb] bg-[#f7f7f7]">
        <div className="container mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto text-center">
            <div>
              <p className="text-3xl font-bold text-[#222222]">20+</p>
              <p className="text-sm text-[#6a6a6a] mt-1">Experiments</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-[#222222]">5+</p>
              <p className="text-sm text-[#6a6a6a] mt-1">Lab Topics</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-[#222222]">100%</p>
              <p className="text-sm text-[#6a6a6a] mt-1">Free Access</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 md:py-28">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-[#222222] mb-4">
              Everything you need to learn
            </h2>
            <p className="text-lg text-[#6a6a6a] max-w-xl mx-auto">
              A complete virtual lab environment designed for modern engineering education.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Feature 1 */}
            <div
              className="bg-white rounded-2xl p-8 transition-shadow hover:shadow-[var(--shadow-hover)]"
              style={{
                boxShadow:
                  'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
              }}
            >
              <div className="w-12 h-12 rounded-xl bg-[#fff0f3] flex items-center justify-center mb-5">
                <FlaskConical className="h-6 w-6 text-[#ff385c]" />
              </div>
              <h3 className="text-lg font-semibold text-[#222222] mb-3">
                Interactive Simulations
              </h3>
              <p className="text-[#6a6a6a] text-sm leading-relaxed">
                Interact with real-time circuit and IoT simulations. Adjust
                parameters, observe results instantly, and build genuine
                understanding without touching physical hardware.
              </p>
            </div>

            {/* Feature 2 */}
            <div
              className="bg-white rounded-2xl p-8 transition-shadow hover:shadow-[var(--shadow-hover)]"
              style={{
                boxShadow:
                  'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
              }}
            >
              <div className="w-12 h-12 rounded-xl bg-[#fff0f3] flex items-center justify-center mb-5">
                <BookOpen className="h-6 w-6 text-[#ff385c]" />
              </div>
              <h3 className="text-lg font-semibold text-[#222222] mb-3">
                Guided Experiments
              </h3>
              <p className="text-[#6a6a6a] text-sm leading-relaxed">
                Step-by-step experiment walkthroughs with theory, procedure,
                pre-test and post-test quizzes. Every experiment follows
                a structured learning path designed by educators.
              </p>
            </div>

            {/* Feature 3 */}
            <div
              className="bg-white rounded-2xl p-8 transition-shadow hover:shadow-[var(--shadow-hover)]"
              style={{
                boxShadow:
                  'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
              }}
            >
              <div className="w-12 h-12 rounded-xl bg-[#fff0f3] flex items-center justify-center mb-5">
                <BarChart3 className="h-6 w-6 text-[#ff385c]" />
              </div>
              <h3 className="text-lg font-semibold text-[#222222] mb-3">
                Track Progress
              </h3>
              <p className="text-[#6a6a6a] text-sm leading-relaxed">
                See your progress across all experiments, quiz scores, and
                completion status at a glance. Educators can monitor class
                performance in real-time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-[#f2f2f2]">
        <div className="container mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-[#222222] mb-4">
            Ready to start learning?
          </h2>
          <p className="text-lg text-[#6a6a6a] mb-8 max-w-xl mx-auto">
            Create a free account and dive into your first experiment in minutes.
          </p>
          <Button
            size="lg"
            className="rounded-lg font-semibold bg-[#ff385c] hover:bg-[#e0334f] text-white px-10"
            asChild
          >
            <Link href="/sign-up">
              Get Started — it&apos;s free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
