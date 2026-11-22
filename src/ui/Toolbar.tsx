import { Compass, Info } from 'lucide-react';
import type { QualityMode } from '../types';

interface ToolbarProps {
  tourActive: boolean;
  onToggleTour: () => void;
  routeOpen: boolean;
  onToggleRoute: () => void;
  onResetOverview: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
  quality: QualityMode;
  effectiveQuality: 'low' | 'medium' | 'high';
  onCycleQuality: () => void;
  onOpenAbout: () => void;
  northDeg: number;
}

export function Toolbar({
  tourActive,
  onToggleTour,
  routeOpen,
  onToggleRoute,
  onResetOverview,
  showLabels,
  onToggleLabels,
  quality,
  effectiveQuality,
  onCycleQuality,
  onOpenAbout,
  northDeg,
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Campus map tools"
      className="pointer-events-auto inline-flex items-center divide-x divide-zinc-900/10 rounded-md bg-[#fafaf9]/95 border border-zinc-900/14 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden max-w-[calc(100vw-1.25rem)]"
    >
      <button
        type="button"
        onClick={onToggleTour}
        aria-pressed={tourActive}
        aria-label="Start or exit guided campus tour"
        className={`px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
          tourActive ? 'bg-zinc-900 text-white' : 'text-zinc-800 hover:bg-zinc-200/60'
        }`}
      >
        Tour
      </button>

      <button
        type="button"
        onClick={onToggleRoute}
        aria-pressed={routeOpen}
        aria-label="Toggle walking directions"
        className={`px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
          routeOpen ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-200/60'
        }`}
      >
        Directions
      </button>

      <button
        type="button"
        onClick={onResetOverview}
        aria-label="Reset aerial overview aligned to campus north"
        title={`Reset aerial view (${northDeg}°)`}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200/60"
      >
        <Compass
          className="h-3.5 w-3.5 text-zinc-600"
          style={{ transform: `rotate(${northDeg}deg)` }}
        />
        <span className="hidden md:inline">Reset</span>
      </button>

      <button
        type="button"
        onClick={onToggleLabels}
        aria-pressed={showLabels}
        aria-label="Toggle 3D building labels"
        className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
          showLabels ? 'bg-zinc-200/80 text-zinc-900' : 'text-zinc-500 hover:bg-zinc-200/60'
        }`}
      >
        Labels
      </button>

      <button
        type="button"
        onClick={onCycleQuality}
        aria-label={`Graphics quality: ${quality} (${effectiveQuality}). Click to cycle`}
        title={`Quality: ${quality.toUpperCase()} (${effectiveQuality})`}
        className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-600 hover:bg-zinc-200/60"
      >
        {quality}
      </button>

      <button
        type="button"
        onClick={onOpenAbout}
        aria-label="About REC Campus in 3D and OpenStreetMap attribution"
        title="About & attribution"
        className="px-2 py-1.5 text-zinc-600 hover:bg-zinc-200/60"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
