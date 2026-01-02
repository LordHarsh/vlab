# Virtual Lab - Interactive Learning Platform

A modern virtual laboratory platform for interactive experiments and simulations, built with **Next.js 16**, React 19, Supabase, and Clerk.

> **Updated for Next.js 16** - Now with stable Turbopack, proxy.ts, and React Compiler support!

## 🚀 Quick Start

### Option 1: Automated Setup (Recommended)

```bash
# Run the setup script
./QUICK_SETUP.sh
```

### Option 2: Manual Setup

Follow the detailed instructions in [SETUP_GUIDE.md](./SETUP_GUIDE.md)

## 📋 Prerequisites

Before you begin, make sure you have:

- **Node.js 18.17+** installed ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- A **Supabase** account ([Sign up](https://supabase.com))
- A **Clerk** account ([Sign up](https://clerk.com))

## 🛠️ Technology Stack

- **Frontend**: Next.js 16, React 19, TypeScript
  - ⚡ Turbopack (stable) - 5-10x faster Fast Refresh
  - 🚀 React Compiler support
  - 💾 New caching model with PPR
- **Styling**: TailwindCSS 3.4, shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Clerk
- **Simulations**: React Konva, Recharts
- **Forms**: React Hook Form, Zod
- **Deployment**: Vercel

## 📁 Project Structure

```
virtual-lab/
├── app/                      # Next.js app directory
│   ├── api/                 # API routes
│   ├── labs/                # Lab experiments
│   ├── dashboard/           # User dashboard
│   └── admin/               # Admin panel
├── components/              # React components
│   ├── ui/                  # shadcn/ui components
│   ├── experiment/          # Experiment-specific
│   ├── simulations/         # Simulation components
│   ├── shared/              # Shared components
│   └── layout/              # Layout components
├── lib/                     # Utilities
│   ├── supabase/            # Supabase clients
│   ├── actions/             # Server actions
│   └── hooks/               # Custom hooks
├── types/                   # TypeScript types
└── public/                  # Static assets
```

## 🔧 Configuration

### 1. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the SQL schema from `SETUP_GUIDE.md` in the SQL Editor
3. Get your credentials from Project Settings > API
4. Add to `.env.local`

### 2. Set Up Clerk

1. Create an application at [clerk.com](https://clerk.com)
2. Configure sign-in options (Email, Google, etc.)
3. Get your API keys from the dashboard
4. Add to `.env.local`

### 3. Environment Variables

Create `.env.local` with:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 🚀 Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

Visit [http://localhost:3000](http://localhost:3000) to see your app.

## 📚 Documentation

- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Detailed setup instructions
- **[SIMPLIFIED_TECH_STACK.md](./SIMPLIFIED_TECH_STACK.md)** - Tech stack overview
- **[VIRTUAL_LAB_ANALYSIS.md](./VIRTUAL_LAB_ANALYSIS.md)** - Complete platform analysis

## 🎯 Features

### Current
- ✅ User authentication (Clerk)
- ✅ Database setup (Supabase)
- ✅ UI components (shadcn/ui)
- ✅ Responsive design

### Coming Soon
- [ ] Experiment browser
- [ ] Interactive simulations
- [ ] Quiz system
- [ ] Progress tracking
- [ ] Admin dashboard

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

## 💬 Support

If you need help:

1. Check [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed instructions
2. Open an issue on GitHub
3. Contact the team

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/)
- [Supabase](https://supabase.com/)
- [Clerk](https://clerk.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Virtual Labs](https://www.vlab.co.in/) - Inspiration

---

**Happy coding! 🚀**
