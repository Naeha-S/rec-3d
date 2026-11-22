import { useEffect, useMemo, useRef, useState } from 'react';
import { Search as SearchIcon, X } from 'lucide-react';
import type { Building, RouteResult, SearchHit } from '../types';
import { searchCampus } from '../logic/search';

interface SearchProps {
  buildings: Building[];
  routeOpen: boolean;
  onToggleRouteOpen: (open: boolean) => void;
  routeFromId: string;
  routeToId: string;
  onChangeRouteFrom: (id: string) => void;
  onChangeRouteTo: (id: string) => void;
  onClearRoute: () => void;
  route: RouteResult | null;
  onPickSearchHit: (hit: SearchHit) => void;
}

export function Search({
  buildings,
  routeOpen,
  onToggleRouteOpen,
  routeFromId,
  routeToId,
  onChangeRouteFrom,
  onChangeRouteTo,
  onClearRoute,
  route,
  onPickSearchHit,
}: SearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [highlightedRoom, setHighlightedRoom] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchCampus(buildings, query, 8), [buildings, query]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const commitHit = (hit: SearchHit) => {
    setHighlightedRoom(hit.matchedRoom ?? null);
    setOpen(false);
    inputRef.current?.blur();
    onPickSearchHit(hit);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (hits.length > 0) setActiveIndex((prev) => (prev + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (hits.length > 0) setActiveIndex((prev) => (prev - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      if (hits.length > 0) {
        e.preventDefault();
        commitHit(hits[activeIndex] ?? hits[0]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="pointer-events-auto w-full max-w-[calc(100vw-1.25rem)] sm:w-80 flex flex-col gap-1.5">
      <div className="relative rounded-md bg-[#fafaf9]/95 border border-zinc-900/14 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
          <input
            id="campus-search-input"
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search buildings, labs, offices"
            aria-label="Search campus buildings, HoD cabins, labs, and hostels"
            aria-expanded={open && query.trim().length > 0}
            aria-controls="campus-search-results"
            role="combobox"
            aria-autocomplete="list"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setHighlightedRoom(null);
                inputRef.current?.focus();
              }}
              aria-label="Clear search query"
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex shrink-0 items-center rounded-[3px] border border-zinc-900/12 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
              Ctrl K
            </kbd>
          )}
        </div>

        {highlightedRoom && !open && (
          <div className="flex items-center justify-between border-t border-zinc-900/10 px-2.5 py-1 text-[11px] text-zinc-700 bg-zinc-100/70 rounded-b-md">
            <span className="truncate font-medium">{highlightedRoom}</span>
            <button
              type="button"
              onClick={() => setHighlightedRoom(null)}
              aria-label="Dismiss matched room banner"
              className="ml-2 text-zinc-500 hover:text-zinc-900 text-[11px]"
            >
              Clear
            </button>
          </div>
        )}

        {open && query.trim().length > 0 && (
          <ul
            id="campus-search-results"
            role="listbox"
            className="max-h-64 overflow-y-auto border-t border-zinc-900/10 py-1"
          >
            {hits.length === 0 ? (
              <li className="px-2.5 py-2.5 text-xs text-zinc-500">
                No match for &ldquo;{query}&rdquo;
              </li>
            ) : (
              hits.map((hit, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <li
                    key={`${hit.building.id}-${hit.matchedRoom ?? 'b'}`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => commitHit(hit)}
                      className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isActive ? 'bg-zinc-900 text-white' : 'text-zinc-800 hover:bg-zinc-100'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        {hit.kind === 'room' ? (
                          <>
                            <div className="font-medium truncate">{hit.matchedRoom}</div>
                            <div
                              className={`truncate text-[11px] ${
                                isActive ? 'text-zinc-300' : 'text-zinc-500'
                              }`}
                            >
                              {hit.building.name}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium truncate">{hit.building.name}</div>
                            <div
                              className={`truncate text-[11px] capitalize ${
                                isActive ? 'text-zinc-300' : 'text-zinc-500'
                              }`}
                            >
                              {hit.building.cat} · {hit.building.levels}F
                            </div>
                          </>
                        )}
                      </div>
                      <span
                        className={`shrink-0 text-[10px] tabular-nums ${
                          isActive ? 'text-zinc-300' : 'text-zinc-400'
                        }`}
                      >
                        ↵
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>

      {(routeOpen || route) && (
        <div className="rounded-md bg-[#fafaf9]/95 border border-zinc-900/14 shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-2.5 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
              Directions
            </span>
            <button
              type="button"
              onClick={() => {
                onClearRoute();
                onToggleRouteOpen(false);
              }}
              aria-label="Close walking route planner"
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <label className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[11px] text-zinc-500">From</span>
              <select
                aria-label="Walking route origin"
                value={routeFromId}
                onChange={(e) => onChangeRouteFrom(e.target.value)}
                className="min-w-0 flex-1 rounded-[4px] border border-zinc-900/14 bg-white px-2 py-1 text-xs text-zinc-800"
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[11px] text-zinc-500">To</span>
              <select
                aria-label="Walking route destination"
                value={routeToId}
                onChange={(e) => onChangeRouteTo(e.target.value)}
                className="min-w-0 flex-1 rounded-[4px] border border-zinc-900/14 bg-white px-2 py-1 text-xs text-zinc-800"
              >
                <option value="">Select destination…</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {route && (
            <div
              id="route-result-status"
              aria-live="polite"
              className="mt-2 pt-1.5 border-t border-zinc-900/10"
            >
              {route.ok ? (
                <div className="flex items-center justify-between tabular-nums text-zinc-900">
                  <span className="font-medium">
                    {route.distanceM} m · ~{route.minutes} min walk
                  </span>
                  <span className="text-[10px] text-zinc-400">1.35 m/s</span>
                </div>
              ) : (
                <div role="status" className="text-[11px] text-amber-800">
                  {route.reason ?? 'No walking route available.'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
