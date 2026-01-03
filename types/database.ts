export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
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
          name: string
          slug: string
          description: string | null
          icon: string | null
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          icon?: string | null
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          description?: string | null
          icon?: string | null
          display_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      experiments: {
        Row: {
          id: string
          category_id: string
          title: string
          slug: string
          description: string | null
          difficulty: 'beginner' | 'intermediate' | 'advanced'
          estimated_duration: number
          aim: Json | null
          theory: Json | null
          procedure: Json | null
          simulation: Json | null
          published: boolean
          featured: boolean
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          category_id: string
          title: string
          slug: string
          description?: string | null
          difficulty: 'beginner' | 'intermediate' | 'advanced'
          estimated_duration: number
          aim?: Json | null
          theory?: Json | null
          procedure?: Json | null
          simulation?: Json | null
          published?: boolean
          featured?: boolean
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          category_id?: string
          title?: string
          slug?: string
          description?: string | null
          difficulty?: 'beginner' | 'intermediate' | 'advanced'
          estimated_duration?: number
          aim?: Json | null
          theory?: Json | null
          procedure?: Json | null
          simulation?: Json | null
          published?: boolean
          featured?: boolean
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      quizzes: {
        Row: {
          id: string
          experiment_id: string
          type: 'pretest' | 'posttest'
          title: string
          description: string | null
          passing_percentage: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          experiment_id: string
          type: 'pretest' | 'posttest'
          title: string
          description?: string | null
          passing_percentage?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          experiment_id?: string
          type?: 'pretest' | 'posttest'
          title?: string
          description?: string | null
          passing_percentage?: number
          created_at?: string
          updated_at?: string
        }
      }
      quiz_questions: {
        Row: {
          id: string
          quiz_id: string
          question_text: string
          question_type: string
          options: Json
          correct_answer: string
          explanation: string | null
          points: number
          order_number: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          quiz_id: string
          question_text: string
          question_type?: string
          options: Json
          correct_answer: string
          explanation?: string | null
          points?: number
          order_number: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          quiz_id?: string
          question_text?: string
          question_type?: string
          options?: Json
          correct_answer?: string
          explanation?: string | null
          points?: number
          order_number?: number
          created_at?: string
          updated_at?: string
        }
      }
      user_progress: {
        Row: {
          id: string
          user_id: string
          experiment_id: string
          status: 'not_started' | 'in_progress' | 'completed'
          pretest_score: number | null
          posttest_score: number | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          experiment_id: string
          status?: 'not_started' | 'in_progress' | 'completed'
          pretest_score?: number | null
          posttest_score?: number | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          experiment_id?: string
          status?: 'not_started' | 'in_progress' | 'completed'
          pretest_score?: number | null
          posttest_score?: number | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      quiz_submissions: {
        Row: {
          id: string
          user_id: string
          quiz_id: string
          answers: Json
          score: number
          percentage: number
          submitted_at: string
        }
        Insert: {
          id?: string
          user_id: string
          quiz_id: string
          answers: Json
          score: number
          percentage: number
          submitted_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          quiz_id?: string
          answers?: Json
          score?: number
          percentage?: number
          submitted_at?: string
        }
      }
      feedback: {
        Row: {
          id: string
          user_id: string
          experiment_id: string
          rating: number
          comments: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          experiment_id: string
          rating: number
          comments?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          experiment_id?: string
          rating?: number
          comments?: string | null
          created_at?: string
        }
      }
      resources: {
        Row: {
          id: string
          experiment_id: string
          title: string
          type: 'video' | 'pdf' | 'link' | 'image'
          url: string
          description: string | null
          order_number: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          experiment_id: string
          title: string
          type: 'video' | 'pdf' | 'link' | 'image'
          url: string
          description?: string | null
          order_number?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          experiment_id?: string
          title?: string
          type?: 'video' | 'pdf' | 'link' | 'image'
          url?: string
          description?: string | null
          order_number?: number
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
