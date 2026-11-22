import type { CampusLoadError } from '../data/load';

interface LoaderProps {
  progress: number;
  stage: string;
  error: CampusLoadError | null;
  onRetry: () => void;
}

export function Loader({ error, onRetry }: LoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#f2f2ef] p-4 text-zinc-900"
    >
      {error ? (
        <div
          role="alert"
          className="w-full max-w-sm rounded-md bg-white p-4 border border-zinc-900/15 shadow-sm"
        >
          <h2 className="text-xs font-semibold text-zinc-900 mb-1">
            {error.kind === 'not-found'
              ? 'Campus data not found (404)'
              : error.kind === 'validation'
              ? 'Invalid campus data format'
              : 'Failed to load campus map'}
          </h2>
          <p className="text-[11px] text-zinc-600 leading-relaxed mb-3">{error.message}</p>
          {error.details.length > 0 && (
            <ul className="mb-3 max-h-28 overflow-y-auto rounded-[3px] bg-zinc-100 p-2 font-mono text-[10px] text-zinc-700 space-y-0.5">
              {error.details.slice(0, 6).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="rounded-[4px] bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-zinc-800"
          >
            Retry
          </button>
        </div>
      ) : (
        <div
          aria-label="Loading map"
          className="h-4 w-4 rounded-full border-[1.5px] border-zinc-300 border-t-zinc-800 animate-spin"
        />
      )}
    </div>
  );
}
