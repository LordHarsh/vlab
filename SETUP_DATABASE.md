# Database Setup Instructions

## Quick Setup (5 minutes)

### Step 1: Apply Database Schema

1. **Open Supabase SQL Editor:**
   - Go to: https://supabase.com/dashboard/project/odaocqfnhqarewoimrma/sql/new

2. **Copy the entire migration file:**
   - File location: `supabase/migrations/001_initial_schema.sql`
   - Or run: `cat supabase/migrations/001_initial_schema.sql`

3. **Paste and Run:**
   - Paste the entire SQL into the editor
   - Click "Run" button
   - Wait for "Success" message

### Step 2: Seed Database with Test Data

Run this command from your project root:

```bash
node scripts/seed-db.mjs
```

This will automatically insert:
- ✅ 3 categories (IoT, Electronics, Computer Science)
- ✅ 1 complete experiment (Raspberry Pi Introduction)
- ✅ Pretest quiz with 2 questions
- ✅ Posttest quiz with 1 question

### Step 3: Verify

Your app should now show experiments instead of "No experiments" message.

---

## Alternative: Use Supabase CLI

If you prefer using CLI:

```bash
# Install Supabase CLI
npx supabase init

# Link to your project
npx supabase link --project-ref odaocqfnhqarewoimrma

# Apply migrations
npx supabase db push

# Seed data
node scripts/seed-db.mjs
```

---

## What Gets Created

### Tables:
- `profiles` - User profiles synced from Clerk
- `categories` - Experiment categories
- `experiments` - Lab experiments
- `quizzes` - Pre and post-test quizzes
- `quiz_questions` - Quiz questions
- `quiz_attempts` - Track user quiz submissions
- `simulations` - Interactive simulations
- `user_progress` - Track experiment completion
- `feedback` - User feedback on experiments

### Sample Data:
- Internet of Things category with Raspberry Pi experiment
- Complete experiment content (aim, theory, procedure, simulation)
- Working quizzes to test the flow

---

## Troubleshooting

**If you see "Failed to connect":**
- Verify your Supabase credentials in `.env.local`
- Check project is not paused in Supabase dashboard

**If tables already exist:**
- The seed script will skip if data exists
- You can reset by dropping tables in SQL editor and re-running

**Need more test data?**
- Edit `supabase/seed.sql` to add more experiments
- Run the seed portions manually in SQL editor
