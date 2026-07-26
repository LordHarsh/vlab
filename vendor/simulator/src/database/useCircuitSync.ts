import { useState, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';
import type { CanvasState, Circuit } from './supabaseClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SaveResult {
  success: boolean;
  error?: string;
  circuit?: Circuit;
}

interface LoadResult {
  success: boolean;
  error?: string;
  canvasState?: CanvasState;
  codeState?: string;
  circuit?: Circuit;
}

interface SyncState {
  isSaving: boolean;
  isLoading: boolean;
  lastSavedAt: Date | null;
  error: string | null;
}

interface UseCircuitSyncReturn extends SyncState {
  saveCircuit: (circuitId: string, canvasState: CanvasState, codeState: string) => Promise<SaveResult>;
  loadCircuit: (circuitId: string) => Promise<LoadResult>;
  createCircuit: (title: string, platform?: 'Arduino' | 'Raspberry Pi') => Promise<{ success: boolean; circuitId?: string; error?: string }>;
  listUserCircuits: () => Promise<{ success: boolean; circuits?: Circuit[]; error?: string }>;
  deleteCircuit: (circuitId: string) => Promise<{ success: boolean; error?: string }>;
  renameCircuit: (circuitId: string, title: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useCircuitSync
 *
 * A React hook that provides full CRUD synchronization between the
 * local circuit simulator state and the Supabase `circuits` table.
 *
 * Usage:
 *   const { saveCircuit, loadCircuit, isSaving, isLoading, lastSavedAt, error } = useCircuitSync();
 */
export function useCircuitSync(): UseCircuitSyncReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce ref to avoid save storms on rapid canvas changes
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // ── Get current authenticated user ──────────────────────────────────────────
  const getCurrentUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Not authenticated. Please log in.');
    return user;
  };

  // ── saveCircuit ──────────────────────────────────────────────────────────────
  /**
   * Persists the current canvas and code state to Supabase via UPSERT.
   * Uses debouncing internally — safe to call on every keystroke/drag.
   *
   * @param circuitId  - The UUID of the circuit row (must already exist)
   * @param canvasState - { components: [], wires: [] } from the simulator
   * @param codeState  - The raw code editor string
   */
  const saveCircuit = useCallback(async (
    circuitId: string,
    canvasState: CanvasState,
    codeState: string,
  ): Promise<SaveResult> => {
    // Clear any pending debounced save
    if (saveTimeoutRef.current) {
      saveTimeoutRef.current = null;
    }

    setIsSaving(true);
    setError(null);

    try {
      const user = await getCurrentUser();

      const payload = {
        id: circuitId,
        user_id: user.id,
        canvas_state: {
          ...canvasState,
          version: canvasState.version ?? 1,
        },
        code_state: codeState,
        updated_at: new Date().toISOString(),
      };

      const { data, error: dbError } = await supabase
        .from('circuits')
        .upsert(payload, {
          onConflict: 'id',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      setLastSavedAt(new Date());
      return { success: true, circuit: data as Circuit };
    } catch (err: any) {
      const message = err?.message ?? 'Unknown error saving circuit.';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsSaving(false);
    }
  }, []);

  // ── loadCircuit ──────────────────────────────────────────────────────────────
  /**
   * Fetches a circuit row by UUID and returns canvas_state + code_state
   * ready to hydrate the simulation engine.
   *
   * @param circuitId - The UUID of the circuit to load
   */
  const loadCircuit = useCallback(async (circuitId: string): Promise<LoadResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: dbError } = await supabase
        .from('circuits')
        .select('*')
        .eq('id', circuitId)
        .single();

      if (dbError) throw dbError;
      if (!data) throw new Error('Circuit not found.');

      const circuit = data as Circuit;

      return {
        success: true,
        circuit,
        canvasState: circuit.canvas_state,
        codeState: circuit.code_state,
      };
    } catch (err: any) {
      const message = err?.message ?? 'Unknown error loading circuit.';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── createCircuit ────────────────────────────────────────────────────────────
  /**
   * Creates a new empty circuit row for the current user.
   * Returns the new circuit's UUID to use with saveCircuit/loadCircuit.
   */
  const createCircuit = useCallback(async (title: string = 'Untitled Circuit', platform: 'Arduino' | 'Raspberry Pi' = 'Arduino') => {
    try {
      const user = await getCurrentUser();

      const defaultComponents = platform === 'Arduino'
        ? [
            { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 50, y: 70, rotation: 0, properties: {} },
            { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 350, y: 70, rotation: 0, properties: {} }
          ]
        : [
            { id: 'rpi_1', type: 'raspberry_pi', name: 'Raspberry Pi Pico', x: 50, y: 110, rotation: 0, properties: {} },
            { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 350, y: 70, rotation: 0, properties: {} }
          ];

      const defaultCanvas: CanvasState = {
        components: defaultComponents,
        wires: [],
        version: 1,
      };

      const defaultCode = platform === 'Arduino'
        ? `// Arduino DSULab Design\nvoid setup() {\n  Serial.begin(9600);\n  Serial.println("DSULab Ready!");\n}\n\nvoid loop() {\n  \n}`
        : `# Raspberry Pi Pico Design\nimport time\nprint("Pico Design Ready!")\n\nwhile True:\n    time.sleep(1)\n`;

      const { data, error: dbError } = await supabase
        .from('circuits')
        .insert({
          user_id: user.id,
          title,
          canvas_state: defaultCanvas,
          code_state: defaultCode,
          is_public: false,
        })
        .select('id')
        .single();

      if (dbError) throw dbError;

      return { success: true, circuitId: data.id as string };
    } catch (err: any) {
      const message = err?.message ?? 'Unknown error creating circuit.';
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  // ── listUserCircuits ─────────────────────────────────────────────────────────
  /**
   * Returns all circuits owned by the currently authenticated user,
   * ordered by most recently updated.
   */
  const listUserCircuits = useCallback(async () => {
    try {
      const user = await getCurrentUser();

      const { data, error: dbError } = await supabase
        .from('circuits')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (dbError) throw dbError;

      return { success: true, circuits: (data ?? []) as Circuit[] };
    } catch (err: any) {
      const message = err?.message ?? 'Unknown error listing circuits.';
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  // ── deleteCircuit ────────────────────────────────────────────────────────────
  const deleteCircuit = useCallback(async (circuitId: string) => {
    try {
      const user = await getCurrentUser();

      const { error: dbError } = await supabase
        .from('circuits')
        .delete()
        .eq('id', circuitId)
        .eq('user_id', user.id); // extra safety guard

      if (dbError) throw dbError;

      return { success: true };
    } catch (err: any) {
      const message = err?.message ?? 'Unknown error deleting circuit.';
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  // ── renameCircuit ────────────────────────────────────────────────────────────
  const renameCircuit = useCallback(async (circuitId: string, title: string) => {
    try {
      const { error: dbError } = await supabase
        .from('circuits')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', circuitId);

      if (dbError) throw dbError;

      return { success: true };
    } catch (err: any) {
      const message = err?.message ?? 'Unknown error renaming circuit.';
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  return {
    // state
    isSaving,
    isLoading,
    lastSavedAt,
    error,
    // actions
    saveCircuit,
    loadCircuit,
    createCircuit,
    listUserCircuits,
    deleteCircuit,
    renameCircuit,
    clearError,
  };
}
