// TypeScript types for Supabase database tables
// Generated based on schema in docs/SUPABASE_SCHEMA.md

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          clerk_user_id: string
          email: string
          first_name: string | null
          last_name: string | null
          avatar_url: string | null
          role: 'student' | 'instructor' | 'admin'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          clerk_user_id: string
          email: string
          first_name?: string | null
          last_name?: string | null
          avatar_url?: string | null
          role?: 'student' | 'instructor' | 'admin'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clerk_user_id?: string
          email?: string
          first_name?: string | null
          last_name?: string | null
          avatar_url?: string | null
          role?: 'student' | 'instructor' | 'admin'
          created_at?: string
          updated_at?: string
        }
      }
      categories: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          icon: string | null
          color: string | null
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          description?: string | null
          icon?: string | null
          color?: string | null
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          description?: string | null
          icon?: string | null
          color?: string | null
          display_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      experiments: {
        Row: {
          id: string
          category_id: string
          slug: string
          title: string
          description: string
          difficulty: 'beginner' | 'intermediate' | 'advanced'
          estimated_duration: number
          aim: any | null
          theory: any | null
          procedure: any | null
          tags: string[] | null
          prerequisites: string[] | null
          published: boolean
          featured: boolean
          created_at: string
          updated_at: string
          created_by: string
        }
        Insert: {
          id?: string
          category_id: string
          slug: string
          title: string
          description: string
          difficulty: 'beginner' | 'intermediate' | 'advanced'
          estimated_duration: number
          aim?: any | null
          theory?: any | null
          procedure?: any | null
          tags?: string[] | null
          prerequisites?: string[] | null
          published?: boolean
          featured?: boolean
          created_at?: string
          updated_at?: string
          created_by: string
        }
        Update: {
          id?: string
          category_id?: string
          slug?: string
          title?: string
          description?: string
          difficulty?: 'beginner' | 'intermediate' | 'advanced'
          estimated_duration?: number
          aim?: any | null
          theory?: any | null
          procedure?: any | null
          tags?: string[] | null
          prerequisites?: string[] | null
          published?: boolean
          featured?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string
        }
      }
      simulations: {
        Row: {
          id: string
          experiment_id: string
          title: string
          description: string | null
          simulation_type: string
          config: any
          code_template: string | null
          created_at: string
          updated_at: string
        }
      }
      quizzes: {
        Row: {
          id: string
          experiment_id: string
          quiz_type: 'pretest' | 'posttest'
          title: string
          passing_percentage: number
          created_at: string
          updated_at: string
        }
      }
      quiz_questions: {
        Row: {
          id: string
          quiz_id: string
          question_text: string
          options: string[]
          correct_answer: number
          explanation: string | null
          display_order: number
          created_at: string
        }
      }
      user_progress: {
        Row: {
          id: string
          user_id: string
          experiment_id: string
          current_section: string | null
          completed_sections: string[]
          started_at: string
          last_accessed_at: string
          completed_at: string | null
        }
      }
      quiz_submissions: {
        Row: {
          id: string
          user_id: string
          quiz_id: string
          answers: any
          score: number
          total_questions: number
          percentage: number
          passed: boolean
          started_at: string | null
          submitted_at: string
        }
      }
      feedback: {
        Row: {
          id: string
          user_id: string
          experiment_id: string
          ratings: any
          comments: string | null
          is_anonymous: boolean
          submitted_at: string
        }
      }
    }
  }
}
