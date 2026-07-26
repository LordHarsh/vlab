import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../database/supabaseClient';
import type { User, Session, AuthError } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
}

interface UseAuthReturn extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null; needsVerification: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useAuth
 *
 * Wraps Supabase Auth into a clean React hook. Handles session restoration
 * on page load and subscribes to auth state changes (login, logout, token refresh).
 *
 * Usage:
 *   const { user, signIn, signUp, signOut, isLoading } = useAuth();
 */
export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Restore session on mount ────────────────────────────────────────────────
  useEffect(() => {
    // Get existing session (from localStorage via Supabase SDK)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // Subscribe to auth changes (login, logout, token refresh, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setIsLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── signIn ──────────────────────────────────────────────────────────────────
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: formatAuthError(error) };
    return { error: null };
  }, []);

  // ── signUp ──────────────────────────────────────────────────────────────────
  const signUp = useCallback(async (email: string, password: string, username: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username }, // passed into raw_user_meta_data, picked up by handle_new_user trigger
      },
    });

    if (error) return { error: formatAuthError(error), needsVerification: false };

    // Supabase sends a confirmation email by default.
    // If "Confirm email" is disabled in the Supabase dashboard, the user is
    // logged in immediately; otherwise they need to verify their email first.
    return { error: null, needsVerification: true };
  }, []);

  // ── signOut ─────────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  // ── resetPassword ────────────────────────────────────────────────────────────
  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { error: formatAuthError(error) };
    return { error: null };
  }, []);

  return { user, session, isLoading, signIn, signUp, signOut, resetPassword };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAuthError(error: AuthError): string {
  // Map common Supabase error codes to user-friendly messages
  const msg = error.message.toLowerCase();
  if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (msg.includes('email not confirmed')) {
    return 'Please verify your email before logging in. Check your inbox.';
  }
  if (msg.includes('user already registered') || msg.includes('already been registered')) {
    return 'An account with this email already exists. Try logging in.';
  }
  if (msg.includes('password should be at least')) {
    return 'Password must be at least 6 characters long.';
  }
  if (msg.includes('rate limit')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return error.message;
}
