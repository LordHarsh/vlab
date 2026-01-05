#!/usr/bin/env node

/**
 * Database Seeding Script
 * Executes SQL files to set up and populate the database
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing Supabase credentials in .env.local')
  process.exit(1)
}

console.log('🚀 Starting database setup...\n')
console.log(`📍 Supabase URL: ${supabaseUrl}\n`)

// Create Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function executeSql(sql) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ query: sql })
    })

    return { data: await response.json(), error: response.ok ? null : new Error(response.statusText) }
  } catch (error) {
    return { data: null, error }
  }
}

async function checkAndSeed() {
  // Check if categories table exists
  console.log('🔍 Checking if database is already set up...\n')

  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('count', { count: 'exact', head: true })

  if (catError) {
    console.log('⚠️  Tables not found. You need to run the migration first.')
    console.log('\n📋 Go to Supabase SQL Editor and run:')
    console.log('   supabase/migrations/001_initial_schema.sql')
    console.log('\n   Dashboard: https://supabase.com/dashboard/project/odaocqfnhqarewoimrma/sql/new\n')
    return false
  }

  // Check if data already exists
  const { count: categoryCount } = await supabase
    .from('categories')
    .select('*', { count: 'exact', head: true })

  if (categoryCount > 0) {
    console.log(`✅ Database already has ${categoryCount} categories`)
    console.log('   Skipping seed (data already exists)\n')
    return true
  }

  console.log('📦 Database is empty, seeding data...\n')

  // Insert categories
  console.log('  → Inserting categories...')
  const { error: catInsertError } = await supabase
    .from('categories')
    .insert([
      {
        slug: 'iot',
        name: 'Internet of Things',
        description: 'Learn about IoT devices, sensors, and connectivity',
        icon: 'Cpu',
        color: '#10b981',
        display_order: 1
      },
      {
        slug: 'electronics',
        name: 'Electronics',
        description: 'Explore circuits, components, and electronic systems',
        icon: 'Zap',
        color: '#f59e0b',
        display_order: 2
      },
      {
        slug: 'computer-science',
        name: 'Computer Science',
        description: 'Study algorithms, data structures, and programming',
        icon: 'Code',
        color: '#3b82f6',
        display_order: 3
      }
    ])

  if (catInsertError) {
    console.error('    ❌ Error inserting categories:', catInsertError.message)
    return false
  }
  console.log('    ✅ Categories inserted')

  // Get category IDs
  const { data: cats } = await supabase.from('categories').select('id, slug')
  const categoryMap = Object.fromEntries(cats.map(c => [c.slug, c.id]))

  // Insert experiment
  console.log('  → Inserting Raspberry Pi experiment...')
  const { data: expData, error: expError } = await supabase
    .from('experiments')
    .insert({
      category_id: categoryMap['iot'],
      slug: 'raspberry-pi-intro',
      title: 'Introduction to Raspberry Pi',
      description: 'Learn the basics of Raspberry Pi, its components, and how to set it up for your first project.',
      difficulty: 'beginner',
      estimated_duration: 45,
      aim: {
        objectives: [
          'Understand what Raspberry Pi is and its applications',
          'Identify the key components of a Raspberry Pi board',
          'Set up Raspberry Pi OS and connect peripherals',
          'Learn about GPIO pins and their functions',
          'Write and run a simple Python program on Raspberry Pi'
        ],
        outcomes: [
          'Successfully boot and configure Raspberry Pi',
          'Navigate the Raspberry Pi OS interface',
          'Understand GPIO pin layout and numbering',
          'Execute basic Python scripts',
          'Prepare for hardware interfacing projects'
        ]
      },
      theory: {
        sections: [
          {
            title: 'What is Raspberry Pi?',
            content: 'Raspberry Pi is a series of small single-board computers developed by the Raspberry Pi Foundation.'
          }
        ]
      },
      procedure: {
        steps: [
          {
            title: 'Unboxing and Initial Setup',
            description: 'Prepare your Raspberry Pi for first use',
            instructions: [
              'Carefully remove the Raspberry Pi from its packaging',
              'Check all components',
              'Inspect for damage'
            ]
          }
        ]
      },
      simulation: {
        gpio_pins: [17, 18, 27, 22],
        instructions: ['Connect LED to GPIO pin', 'Run the Python code'],
        code_example: 'import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)',
        learning_points: ['GPIO basics', 'LED control']
      },
      tags: ['raspberry-pi', 'iot', 'gpio'],
      prerequisites: ['Basic computer knowledge'],
      published: true,
      featured: true,
      created_by: 'seed_user_id'
    })
    .select()
    .single()

  if (expError) {
    console.error('    ❌ Error inserting experiment:', expError.message)
    return false
  }
  console.log('    ✅ Experiment inserted')

  const experimentId = expData.id

  // Insert quizzes
  console.log('  → Inserting quizzes...')

  const { data: pretestData, error: pretestError } = await supabase
    .from('quizzes')
    .insert({
      experiment_id: experimentId,
      type: 'pretest',
      title: 'Raspberry Pi Pre-Assessment',
      passing_percentage: 70
    })
    .select()
    .single()

  if (pretestError) {
    console.error('    ❌ Error inserting pretest:', pretestError.message)
    return false
  }

  // Insert pretest questions
  await supabase.from('quiz_questions').insert([
    {
      quiz_id: pretestData.id,
      question_text: 'What does GPIO stand for in Raspberry Pi?',
      options: ['General Purpose Input Only', 'General Purpose Input/Output', 'Graphics Processing Input/Output', 'General Processing Interface Organizer'],
      correct_answer: 1,
      explanation: 'GPIO stands for General Purpose Input/Output',
      order_number: 1
    },
    {
      quiz_id: pretestData.id,
      question_text: 'Which operating system is commonly used on Raspberry Pi?',
      options: ['Windows 11', 'macOS', 'Raspberry Pi OS (formerly Raspbian)', 'Android'],
      correct_answer: 2,
      explanation: 'Raspberry Pi OS is the official operating system',
      order_number: 2
    }
  ])

  console.log('    ✅ Pretest quiz created with questions')

  // Insert posttest
  const { data: posttestData } = await supabase
    .from('quizzes')
    .insert({
      experiment_id: experimentId,
      type: 'posttest',
      title: 'Raspberry Pi Post-Assessment',
      passing_percentage: 70
    })
    .select()
    .single()

  await supabase.from('quiz_questions').insert([
    {
      quiz_id: posttestData.id,
      question_text: 'When a GPIO pin is set to HIGH state, what voltage does it output?',
      options: ['5V', '3.3V', '1.8V', '12V'],
      correct_answer: 1,
      explanation: 'Raspberry Pi GPIO pins output 3.3V when set to HIGH',
      order_number: 1
    }
  ])

  console.log('    ✅ Posttest quiz created with questions')

  console.log('\n✅ Database seeded successfully!\n')
  return true
}

// Run the seeding
checkAndSeed()
  .then((success) => {
    if (success) {
      console.log('🎉 All done! Your database is ready.\n')
    } else {
      console.log('\n📝 Manual setup required. See instructions above.\n')
    }
  })
  .catch((error) => {
    console.error('❌ Seeding failed:', error)
    process.exit(1)
  })
