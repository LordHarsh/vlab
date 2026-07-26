import React from 'react';
import { Cloud, CloudOff, Loader2, CheckCircle2 } from 'lucide-react';

interface SaveIndicatorProps {
  isSaving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
  className?: string;
}

/**
 * SaveIndicator
 *
 * A compact status pill for the simulator toolbar that shows:
 *   - Spinner   → currently saving
 *   - Check     → last saved timestamp
 *   - Cloud Off → save error (with tooltip)
 *
 * Usage:
 *   <SaveIndicator isSaving={isSaving} lastSavedAt={lastSavedAt} error={error} />
 */
export const SaveIndicator: React.FC<SaveIndicatorProps> = ({
  isSaving,
  lastSavedAt,
  error,
  className = '',
}) => {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (isSaving) {
    return (
      <div className={`flex items-center gap-1.5 text-slate-400 text-[10px] font-medium ${className}`}>
        <Loader2 className="w-3 h-3 animate-spin text-[#FF6B35]" />
        <span>Saving…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        title={error}
        className={`flex items-center gap-1.5 text-rose-400 text-[10px] font-medium cursor-help ${className}`}
      >
        <CloudOff className="w-3 h-3" />
        <span>Save failed</span>
      </div>
    );
  }

  if (lastSavedAt) {
    return (
      <div className={`flex items-center gap-1.5 text-emerald-500 text-[10px] font-medium ${className}`}>
        <CheckCircle2 className="w-3 h-3" />
        <span>Saved {formatTime(lastSavedAt)}</span>
      </div>
    );
  }

  // Not yet saved this session
  return (
    <div className={`flex items-center gap-1.5 text-slate-400 text-[10px] font-medium ${className}`}>
      <Cloud className="w-3 h-3" />
      <span>Not saved</span>
    </div>
  );
};
