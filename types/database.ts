export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      class_feedback_settings: {
        Row: {
          class_id: string
          form_id: string
          id: string
          is_enabled: boolean | null
        }
        Insert: {
          class_id: string
          form_id: string
          id?: string
          is_enabled?: boolean | null
        }
        Update: {
          class_id?: string
          form_id?: string
          id?: string
          is_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "class_feedback_settings_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_feedback_settings_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "feedback_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      class_invites: {
        Row: {
          class_id: string
          created_at: string | null
          created_by: string
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          token: string
          type: string
          use_count: number
        }
        Insert: {
          class_id: string
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          token: string
          type: string
          use_count?: number
        }
        Update: {
          class_id?: string
          created_at?: string | null
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          token?: string
          type?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "class_invites_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_labs: {
        Row: {
          class_id: string
          id: string
          lab_id: string
          order_index: number
          unlock_at: string | null
        }
        Insert: {
          class_id: string
          id?: string
          lab_id: string
          order_index?: number
          unlock_at?: string | null
        }
        Update: {
          class_id?: string
          id?: string
          lab_id?: string
          order_index?: number
          unlock_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_labs_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_labs_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
        ]
      }
      class_quiz_settings: {
        Row: {
          class_id: string
          due_date: string | null
          id: string
          is_graded: boolean
          max_attempts: number | null
          passing_percentage: number | null
          quiz_id: string
          show_answers: string | null
          show_score: boolean | null
          unlock_at: string | null
        }
        Insert: {
          class_id: string
          due_date?: string | null
          id?: string
          is_graded?: boolean
          max_attempts?: number | null
          passing_percentage?: number | null
          quiz_id: string
          show_answers?: string | null
          show_score?: boolean | null
          unlock_at?: string | null
        }
        Update: {
          class_id?: string
          due_date?: string | null
          id?: string
          is_graded?: boolean
          max_attempts?: number | null
          passing_percentage?: number | null
          quiz_id?: string
          show_answers?: string | null
          show_score?: boolean | null
          unlock_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_quiz_settings_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_quiz_settings_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          academic_year: string | null
          created_at: string | null
          description: string | null
          educator_id: string
          id: string
          join_code: string
          join_code_expires_at: string | null
          max_students: number | null
          name: string
          semester: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          academic_year?: string | null
          created_at?: string | null
          description?: string | null
          educator_id: string
          id?: string
          join_code: string
          join_code_expires_at?: string | null
          max_students?: number | null
          name: string
          semester?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          academic_year?: string | null
          created_at?: string | null
          description?: string | null
          educator_id?: string
          id?: string
          join_code?: string
          join_code_expires_at?: string | null
          max_students?: number | null
          name?: string
          semester?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_educator_id_fkey"
            columns: ["educator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          class_id: string
          dropped_at: string | null
          enrolled_at: string | null
          enrolled_via: string | null
          id: string
          status: string
          student_id: string
        }
        Insert: {
          class_id: string
          dropped_at?: string | null
          enrolled_at?: string | null
          enrolled_via?: string | null
          id?: string
          status?: string
          student_id: string
        }
        Update: {
          class_id?: string
          dropped_at?: string | null
          enrolled_at?: string | null
          enrolled_via?: string | null
          id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_sections: {
        Row: {
          content: Json | null
          created_at: string | null
          experiment_id: string
          id: string
          is_required: boolean
          order_index: number
          status: string
          title: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          content?: Json | null
          created_at?: string | null
          experiment_id: string
          id?: string
          is_required?: boolean
          order_index: number
          status?: string
          title?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          content?: Json | null
          created_at?: string | null
          experiment_id?: string
          id?: string
          is_required?: boolean
          order_index?: number
          status?: string
          title?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "experiment_sections_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          created_at: string | null
          description: string | null
          difficulty: string | null
          estimated_duration: number | null
          id: string
          lab_id: string
          order_index: number
          published: boolean
          slug: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          difficulty?: string | null
          estimated_duration?: number | null
          id?: string
          lab_id: string
          order_index?: number
          published?: boolean
          slug: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          difficulty?: string | null
          estimated_duration?: number | null
          id?: string
          lab_id?: string
          order_index?: number
          published?: boolean
          slug?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "experiments_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_forms: {
        Row: {
          created_at: string | null
          description: string | null
          experiment_id: string
          id: string
          is_enabled: boolean
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          experiment_id: string
          id?: string
          is_enabled?: boolean
          title?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          experiment_id?: string
          id?: string
          is_enabled?: boolean
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_forms_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: true
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_questions: {
        Row: {
          archived_at: string | null
          config: Json | null
          created_at: string | null
          form_id: string
          id: string
          is_required: boolean
          options: Json | null
          order_index: number
          question_text: string
          question_type: string
          status: string
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          config?: Json | null
          created_at?: string | null
          form_id: string
          id?: string
          is_required?: boolean
          options?: Json | null
          order_index: number
          question_text: string
          question_type: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          config?: Json | null
          created_at?: string | null
          form_id?: string
          id?: string
          is_required?: boolean
          options?: Json | null
          order_index?: number
          question_text?: string
          question_type?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_questions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "feedback_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_responses: {
        Row: {
          answers: Json
          class_id: string
          experiment_id: string
          form_id: string
          id: string
          student_id: string
          submitted_at: string | null
        }
        Insert: {
          answers: Json
          class_id: string
          experiment_id: string
          form_id: string
          id?: string
          student_id: string
          submitted_at?: string | null
        }
        Update: {
          answers?: Json
          class_id?: string
          experiment_id?: string
          form_id?: string
          id?: string
          student_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_responses_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "feedback_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responses_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_emails: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          id: string
          invite_id: string
          status: string
          student_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          id?: string
          invite_id: string
          status?: string
          student_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          id?: string
          invite_id?: string
          status?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_emails_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "class_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_emails_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      labs: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          difficulty: string | null
          id: string
          published: boolean
          slug: string
          tags: string[] | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty?: string | null
          id?: string
          published?: boolean
          slug: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty?: string | null
          id?: string
          published?: boolean
          slug?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approval_status: string
          avatar_url: string | null
          class_section: string | null
          clerk_user_id: string
          created_at: string | null
          department: string | null
          email: string
          employee_no: string | null
          first_name: string | null
          id: string
          is_admin: boolean
          last_name: string | null
          phone: string | null
          profile_completed: boolean
          registration_no: string | null
          role: string
          updated_at: string | null
          year: number | null
        }
        Insert: {
          approval_status?: string
          avatar_url?: string | null
          class_section?: string | null
          clerk_user_id: string
          created_at?: string | null
          department?: string | null
          email: string
          employee_no?: string | null
          first_name?: string | null
          id?: string
          is_admin?: boolean
          last_name?: string | null
          phone?: string | null
          profile_completed?: boolean
          registration_no?: string | null
          role?: string
          updated_at?: string | null
          year?: number | null
        }
        Update: {
          approval_status?: string
          avatar_url?: string | null
          class_section?: string | null
          clerk_user_id?: string
          created_at?: string | null
          department?: string | null
          email?: string
          employee_no?: string | null
          first_name?: string | null
          id?: string
          is_admin?: boolean
          last_name?: string | null
          phone?: string | null
          profile_completed?: boolean
          registration_no?: string | null
          role?: string
          updated_at?: string | null
          year?: number | null
        }
        Relationships: []
      }
      quiz_questions: {
        Row: {
          archived_at: string | null
          correct_answer: string
          created_at: string | null
          explanation: string | null
          id: string
          options: Json
          order_number: number
          points: number
          question_text: string
          question_type: string
          quiz_id: string
          status: string
          superseded_by: string | null
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          correct_answer: string
          created_at?: string | null
          explanation?: string | null
          id?: string
          options: Json
          order_number: number
          points?: number
          question_text: string
          question_type?: string
          quiz_id: string
          status?: string
          superseded_by?: string | null
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          correct_answer?: string
          created_at?: string | null
          explanation?: string | null
          id?: string
          options?: Json
          order_number?: number
          points?: number
          question_text?: string
          question_type?: string
          quiz_id?: string
          status?: string
          superseded_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_questions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_submissions: {
        Row: {
          answers: Json
          attempt_number: number
          class_id: string
          id: string
          max_score: number
          passed: boolean
          percentage: number
          quiz_id: string
          score: number
          student_id: string
          submitted_at: string | null
          time_taken_seconds: number | null
        }
        Insert: {
          answers: Json
          attempt_number?: number
          class_id: string
          id?: string
          max_score: number
          passed: boolean
          percentage: number
          quiz_id: string
          score: number
          student_id: string
          submitted_at?: string | null
          time_taken_seconds?: number | null
        }
        Update: {
          answers?: Json
          attempt_number?: number
          class_id?: string
          id?: string
          max_score?: number
          passed?: boolean
          percentage?: number
          quiz_id?: string
          score?: number
          student_id?: string
          submitted_at?: string | null
          time_taken_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_submissions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_submissions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          created_at: string | null
          default_max_attempts: number | null
          default_passing_percentage: number | null
          default_show_answers: string
          default_show_score: boolean | null
          description: string | null
          experiment_id: string
          id: string
          randomize_questions: boolean | null
          time_limit_minutes: number | null
          title: string
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_max_attempts?: number | null
          default_passing_percentage?: number | null
          default_show_answers?: string
          default_show_score?: boolean | null
          description?: string | null
          experiment_id: string
          id?: string
          randomize_questions?: boolean | null
          time_limit_minutes?: number | null
          title: string
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_max_attempts?: number | null
          default_passing_percentage?: number | null
          default_show_answers?: string
          default_show_score?: boolean | null
          description?: string | null
          experiment_id?: string
          id?: string
          randomize_questions?: boolean | null
          time_limit_minutes?: number | null
          title?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      simulations: {
        Row: {
          config: Json
          created_at: string | null
          description: string | null
          experiment_id: string
          id: string
          title: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          config: Json
          created_at?: string | null
          description?: string | null
          experiment_id: string
          id?: string
          title?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          description?: string | null
          experiment_id?: string
          id?: string
          title?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "simulations_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      student_progress: {
        Row: {
          class_id: string
          completed_at: string | null
          completed_section_ids: string[]
          experiment_id: string
          id: string
          last_accessed_at: string | null
          last_section_id: string | null
          started_at: string | null
          student_id: string
          total_time_seconds: number
        }
        Insert: {
          class_id: string
          completed_at?: string | null
          completed_section_ids?: string[]
          experiment_id: string
          id?: string
          last_accessed_at?: string | null
          last_section_id?: string | null
          started_at?: string | null
          student_id: string
          total_time_seconds?: number
        }
        Update: {
          class_id?: string
          completed_at?: string | null
          completed_section_ids?: string[]
          experiment_id?: string
          id?: string
          last_accessed_at?: string | null
          last_section_id?: string | null
          started_at?: string | null
          student_id?: string
          total_time_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_progress_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_last_section_id_fkey"
            columns: ["last_section_id"]
            isOneToOne: false
            referencedRelation: "experiment_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_is_admin: { Args: never; Returns: boolean }
      auth_profile_id: { Args: never; Returns: string }
      auth_role: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
