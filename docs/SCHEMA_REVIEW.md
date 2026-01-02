# Database Schema Review & Fixes

## ❌ Critical Issues Found in Original Schema

### 1. **DEFAULT Subquery Error (MIGRATION WILL FAIL)**
**Lines: 375, 429, 477**

```sql
-- ❌ WRONG - PostgreSQL doesn't allow subqueries in DEFAULT
user_id text not null default (select auth.jwt()->>'sub'),

-- ✅ CORRECT - Remove default, set in application code
user_id text not null,
```

**Impact**: Migration fails with `ERROR: cannot use subquery in DEFAULT expression`

**Fix**: User ID will be set explicitly when inserting records from authenticated routes.

---

### 2. **Missing Foreign Key Constraints**

| Table | Column | Issue |
|-------|--------|-------|
| `experiments` | `created_by` | No FK to `profiles(clerk_user_id)` |
| `user_progress` | `user_id` | No FK to `profiles(clerk_user_id)` |
| `quiz_submissions` | `user_id` | No FK to `profiles(clerk_user_id)` |
| `feedback` | `user_id` | No FK to `profiles(clerk_user_id)` |

**Impact**:
- Orphaned records possible
- No referential integrity
- Can't cascade delete user data

**Fix**: Added FK constraints in fixed version.

---

### 3. **Missing RLS Delete Policies**

Tables with INSERT but no DELETE policies:
- ❌ `user_progress` - users stuck with old progress
- ❌ `quiz_submissions` - users can't delete attempts
- ❌ `feedback` - users can't delete feedback

**Impact**: Users can create but never remove their own data.

**Fix**: Added delete policies for users to manage their own data.

---

### 4. **Missing Validation Constraints**

```sql
-- ❌ No validation
estimated_duration int not null,
passing_percentage int default 70,
score int not null,
percentage int not null,

-- ✅ With validation
estimated_duration int not null check (estimated_duration > 0),
passing_percentage int default 70 check (passing_percentage >= 0 and passing_percentage <= 100),
score int not null check (score >= 0),
percentage int not null check (percentage >= 0 and percentage <= 100),
```

**Impact**: Invalid data can be inserted (negative durations, percentages > 100%).

---

### 5. **Missing Indexes for Common Queries**

Added indexes for:
- `experiments.featured` (for homepage)
- `experiments.difficulty` (for filtering)
- `user_progress.completed_at` (for analytics)
- `quiz_submissions.submitted_at` (for reports)
- `quiz_submissions(user_id, quiz_id)` (composite for lookups)
- `categories.display_order` (for sorting)
- `profiles.email` (for lookups)

---

## ✅ What's Correct in Original Schema

1. **✅ RLS Enabled on All Tables** - Good security
2. **✅ Public Access for Learning Content** - Correct for your use case
3. **✅ Role-Based Access Control** - Admin/Instructor/Student roles
4. **✅ JSONB for Flexible Content** - Good for evolving content structure
5. **✅ Cascade Deletes** - Properly cleans up related data
6. **✅ Timestamps & Triggers** - Auto-updating timestamps work correctly
7. **✅ Unique Constraints** - Category slugs, experiment slugs, user progress

---

## 📋 Schema Design Improvements in Fixed Version

### Added Constraints:
- ✅ FK constraint: `experiments.created_by` → `profiles.clerk_user_id`
- ✅ FK constraint: `user_progress.user_id` → `profiles.clerk_user_id`
- ✅ FK constraint: `quiz_submissions.user_id` → `profiles.clerk_user_id`
- ✅ FK constraint: `feedback.user_id` → `profiles.clerk_user_id`
- ✅ Range checks on percentages, scores, durations
- ✅ Positive number checks where appropriate

### Added Indexes:
- ✅ `idx_experiments_featured` (filtered index)
- ✅ `idx_experiments_difficulty`
- ✅ `idx_user_progress_completed_at` (filtered index)
- ✅ `idx_quiz_submissions_submitted_at`
- ✅ `idx_quiz_submissions_user_quiz` (composite)
- ✅ `idx_categories_slug`
- ✅ `idx_categories_display_order`
- ✅ `idx_profiles_email`
- ✅ `idx_simulations_experiment_id`
- ✅ `idx_quizzes_experiment_id`
- ✅ `idx_quizzes_type`
- ✅ `idx_quiz_questions_quiz_id`
- ✅ `idx_quiz_questions_display_order`
- ✅ `idx_feedback_user_id`
- ✅ `idx_feedback_submitted_at`

### Added RLS Policies:
- ✅ Users can delete own `user_progress`
- ✅ Users can delete own `quiz_submissions`
- ✅ Users can delete own `feedback`

---

## 🤔 Potential Future Enhancements

### Tables You Might Need Later:

1. **`achievements` / `badges`**
   ```sql
   create table achievements (
     id uuid primary key,
     name text not null,
     description text,
     icon text,
     criteria jsonb -- Conditions to earn it
   );

   create table user_achievements (
     user_id text references profiles(clerk_user_id),
     achievement_id uuid references achievements(id),
     earned_at timestamp with time zone,
     primary key (user_id, achievement_id)
   );
   ```

2. **`certificates`**
   ```sql
   create table certificates (
     id uuid primary key,
     user_id text references profiles(clerk_user_id),
     experiment_id uuid references experiments(id),
     issued_at timestamp with time zone,
     certificate_url text,
     verification_code text unique
   );
   ```

3. **`experiment_resources`** (for images, PDFs, videos)
   ```sql
   create table experiment_resources (
     id uuid primary key,
     experiment_id uuid references experiments(id),
     title text,
     resource_type text, -- 'image', 'pdf', 'video'
     file_url text,
     display_order int
   );
   ```

4. **`discussion_threads`** (for Q&A)
   ```sql
   create table discussion_threads (
     id uuid primary key,
     experiment_id uuid references experiments(id),
     user_id text references profiles(clerk_user_id),
     title text,
     content text,
     created_at timestamp with time zone
   );
   ```

### Fields You Might Add:

**To `experiments`:**
- `version` int - for content versioning
- `parent_id` uuid - for experiment series
- `learning_objectives` text[] - structured objectives
- `estimated_score` int - expected completion score

**To `user_progress`:**
- `score` int - overall score
- `time_spent` int - seconds spent
- `attempts` int - number of tries
- `last_section_completed` text

**To `simulations`:**
- `max_attempts` int
- `timeout_seconds` int
- `requires_camera` boolean
- `requires_microphone` boolean

**To `quiz_questions`:**
- `points` int - weighted scoring
- `difficulty` text
- `tags` text[]
- `media_url` text - for questions with images

---

## 🚀 Migration Steps

### Option 1: Replace Current Migration (Recommended)

```bash
# Backup current version
mv supabase/migrations/001_initial_schema.sql supabase/migrations/001_initial_schema_OLD.sql

# Use fixed version
mv supabase/migrations/001_initial_schema_FIXED.sql supabase/migrations/001_initial_schema.sql

# Push to Supabase
npx supabase db push
```

### Option 2: Create New Migration

```bash
# Keep current as is, create new migration to fix issues
npx supabase migration new fix_schema_issues

# Then manually apply fixes to the new migration
```

---

## Summary

### Critical Fixes Required:
1. ✅ Remove DEFAULT subquery from user_id columns
2. ✅ Add foreign key constraints
3. ✅ Add delete policies for user data
4. ✅ Add validation constraints
5. ✅ Add missing indexes

### Files Updated:
- ✅ `supabase/migrations/001_initial_schema_FIXED.sql` - Corrected version
- ✅ `docs/SCHEMA_REVIEW.md` - This document

### Next Steps:
1. Review the fixed schema
2. Replace the old migration file
3. Run `npx supabase db push`
4. Test with seed data
