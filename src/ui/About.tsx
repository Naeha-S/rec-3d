import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { CampusMeta } from '../types';

interface AboutProps {
  open: boolean;
  onClose: () => void;
  meta: CampusMeta;
  buildingCount: number;
  roomCount: number;
}

export function About({ open, onClose, meta, buildingCount, roomCount }: AboutProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md bg-[#fafaf9] p-4 text-zinc-900 border border-zinc-900/18 shadow-[0_12px_32px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-900/10 pb-2.5">
          <div>
            <h2 id="about-modal-title" className="text-sm font-semibold text-zinc-950">
              {meta.name}
            </h2>
            <p className="text-[11px] tabular-nums text-zinc-500">
              Thandalam, Chennai · {meta.origin[1].toFixed(4)}°N, {meta.origin[0].toFixed(4)}°E
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close about dialog"
            className="rounded-[3px] p-1 text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 space-y-3 text-xs text-zinc-700 leading-relaxed">
          <p>
            Interactive 3D campus map covering <strong>{buildingCount} structures</strong> and{' '}
            <strong>{roomCount} indexed rooms, labs, and offices</strong>, with slope-weighted
            pedestrian routing and solar lighting simulation.
          </p>

          <div className="rounded-[4px] border border-zinc-900/10 bg-white p-2.5 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Shortcuts
            </div>
            <div className="grid grid-cols-2 gap-1 text-[11px] text-zinc-700">
              <div><kbd className="font-mono font-medium text-zinc-900">Ctrl/⌘ K</kbd> · Search</div>
              <div><kbd className="font-mono font-medium text-zinc-900">Enter</kbd> · Route</div>
              <div><kbd className="font-mono font-medium text-zinc-900">← / →</kbd> · Tour</div>
              <div><kbd className="font-mono font-medium text-zinc-900">Esc</kbd> · Close</div>
            </div>
          </div>

          <div className="rounded-[4px] border border-zinc-900/10 bg-white p-2.5 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Sources & Attribution
            </div>
            <p className="text-[11px] text-zinc-600">
              Footprints & roads: <strong>© OpenStreetMap contributors (ODbL 1.0)</strong> and{' '}
              <code>REC.kml</code> ({meta.generated}). Elevation: <strong>NASA SRTM1 30 m DEM</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
