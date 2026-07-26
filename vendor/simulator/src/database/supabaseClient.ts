import { createClient } from '@supabase/supabase-js';
import type { ComponentInstance, WireConnection } from '../types';

// ─── Environment Variables ───────────────────────────────────────────────────
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[Supabase] Missing environment variables.\n' +
    'Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env.local file.'
  );
}

// ─── Typed Database Schema ───────────────────────────────────────────────────

export interface CanvasState {
  components: ComponentInstance[];
  wires: WireConnection[];
  version: number; // schema version for forward migrations
}

export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Circuit {
  id: string;
  user_id: string;
  title: string;
  canvas_state: CanvasState;
  code_state: string;
  is_public: boolean;
  updated_at: string;
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'>;
        Update: Partial<Omit<Profile, 'id'>>;
      };
      circuits: {
        Row: Circuit;
        Insert: Omit<Circuit, 'id' | 'updated_at'>;
        Update: Partial<Omit<Circuit, 'id' | 'user_id'>>;
      };
    };
  };
};

// ─── Singleton Client ─────────────────────────────────────────────────────────
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
