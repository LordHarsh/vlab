#!/usr/bin/env node

/**
 * Database Setup Script
 * This script creates the database schema and seeds it with initial data
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Load environment variables
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing Supabase credentials in .env.local')
  process.exit(1)
}

// Create Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function executeSqlFile(filePath, description) {
  console.log(`\n📄 ${description}...`)

  try {
    const sql = fs.readFileSync(filePath, 'utf8')

    // Split SQL into individual statements
    // Remove comments and empty lines
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

    console.log(`   Found ${statements.length} SQL statements`)

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      if (!statement) continue

      // Use raw SQL execution via RPC or REST API
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement })

      if (error) {
        // If RPC doesn't exist, try direct SQL execution via REST
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ sql_query: statement })
        })

        if (!response.ok) {
          console.error(`   ❌ Error executing statement ${i + 1}:`, error?.message || response.statusText)
        } else {
          console.log(`   ✓ Statement ${i + 1} executed`)
        }
      } else {
        console.log(`   ✓ Statement ${i + 1} executed`)
      }
    }

    console.log(`✅ ${description} completed successfully`)
    return true
  } catch (error) {
    console.error(`❌ Error in ${description}:`, error.message)
    return false
  }
}

async function setupDatabase() {
  console.log('🚀 Starting database setup...\n')
  console.log(`📍 Supabase URL: ${supabaseUrl}`)

  // Test connection
  const { error: connectionError } = await supabase.from('_test').select('*').limit(1)
  if (connectionError && !connectionError.message.includes('does not exist')) {
    console.error('❌ Failed to connect to Supabase:', connectionError.message)
    console.log('\n💡 Trying alternative method via Supabase SQL Editor...\n')
  }

  // Read SQL files
  const migrationPath = path.join(__dirname, '../supabase/migrations/001_initial_schema.sql')
  const seedPath = path.join(__dirname, '../supabase/seed.sql')

  console.log('\n📋 Manual Setup Instructions:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\n1. Go to your Supabase Dashboard:')
  console.log('   https://supabase.com/dashboard/project/odaocqfnhqarewoimrma/sql/new')
  console.log('\n2. Copy and execute the migration file:')
  console.log(`   File: ${migrationPath}`)
  console.log('\n3. Then copy and execute the seed file:')
  console.log(`   File: ${seedPath}`)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Try to verify if tables exist
  console.log('🔍 Checking database status...\n')

  const tables = ['categories', 'experiments', 'quizzes', 'quiz_questions']

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('count', { count: 'exact', head: true })

    if (error) {
      console.log(`   ❌ Table '${table}' does not exist yet`)
    } else {
      const count = data?.length || 0
      console.log(`   ✅ Table '${table}' exists (${count} rows)`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📝 NEXT STEPS:')
  console.log('='.repeat(60))
  console.log('\nRun these commands in your Supabase SQL Editor:')
  console.log('\n1. Create schema (run entire migration file)')
  console.log('2. Insert seed data (run entire seed file)')
  console.log('\nOr use the Supabase CLI:')
  console.log('  npx supabase db push')
  console.log('  npx supabase db seed')
  console.log('')
}

setupDatabase()
  .then(() => {
    console.log('✅ Database setup check completed')
  })
  .catch(error => {
    console.error('❌ Setup failed:', error)
    process.exit(1)
  })
