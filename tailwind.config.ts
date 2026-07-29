import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-open-sans)', 'Open Sans', 'system-ui', 'sans-serif'],
        chrome: ['var(--font-raleway)', 'Raleway', 'system-ui', 'sans-serif'],
        display: ['var(--font-roboto-slab)', 'Roboto Slab', 'Georgia', 'serif'],
      },
      colors: {
        /* Institutional palette — see app/globals.css for provenance of each
         * literal. Exposed as Tailwind tokens so components stop hardcoding
         * hexes in arbitrary values, which is the habit that left the reference
         * site with two interchangeable blues. */
        /* Channel-triplet vars + <alpha-value>, so `bg-vlab-600/10` resolves to
         * real CSS. A token holding a literal hex silently drops the opacity
         * modifier instead. */
        vlab: {
          900: 'rgb(var(--vlab-blue-900-c) / <alpha-value>)',
          800: 'rgb(var(--vlab-blue-800-c) / <alpha-value>)',
          700: 'rgb(var(--vlab-blue-700-c) / <alpha-value>)',
          600: 'rgb(var(--vlab-blue-600-c) / <alpha-value>)',
          500: 'rgb(var(--vlab-blue-500-c) / <alpha-value>)',
          300: 'rgb(var(--vlab-blue-300-c) / <alpha-value>)',
          200: 'rgb(var(--vlab-blue-200-c) / <alpha-value>)',
          100: 'rgb(var(--vlab-blue-100-c) / <alpha-value>)',
          50: 'rgb(var(--vlab-blue-50-c) / <alpha-value>)',
          steel: 'rgb(var(--vlab-steel-c) / <alpha-value>)',
          orange: 'rgb(var(--vlab-orange-c) / <alpha-value>)',
          'orange-ink': 'rgb(var(--vlab-orange-ink-c) / <alpha-value>)',
          'orange-50': 'rgb(var(--vlab-orange-50-c) / <alpha-value>)',
          green: 'rgb(var(--vlab-green-c) / <alpha-value>)',
          'green-ink': 'rgb(var(--vlab-green-ink-c) / <alpha-value>)',
          ink: 'rgb(var(--vlab-ink-c) / <alpha-value>)',
          muted: 'rgb(var(--vlab-ink-muted-c) / <alpha-value>)',
          faint: 'rgb(var(--vlab-ink-faint-c) / <alpha-value>)',
          rule: 'rgb(var(--vlab-rule-c) / <alpha-value>)',
          'rule-strong': 'rgb(var(--vlab-rule-strong-c) / <alpha-value>)',
          surface: 'rgb(var(--vlab-surface-c) / <alpha-value>)',
          'surface-alt': 'rgb(var(--vlab-surface-alt-c) / <alpha-value>)',
          footer: 'rgb(var(--vlab-footer-bg-c) / <alpha-value>)',
          sage: 'rgb(var(--vlab-sage-c) / <alpha-value>)',
          cream: 'rgb(var(--vlab-cream-c) / <alpha-value>)',
          taupe: 'rgb(var(--vlab-taupe-c) / <alpha-value>)',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}

export default config
