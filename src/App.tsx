import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type {
  Building,
  BuildingCategory,
  CampusData,
  QualityMode,
  SearchHit,
} from './types';
import { CampusLoadError, loadCampusData } from './data/load';
import { computeLightingState } from './logic/solar';
import { buildPathGraph, findRoute } from './logic/route';
import { getTourStops } from './logic/tour';
import { getPolygonCentroid, sampleElevation } from './logic/elevation';
import { CampusScene, type FlyRequest } from './scene/CampusScene';
import { Search } from './ui/Search';
import { Toolbar } from './ui/Toolbar';
import { TimeControls } from './ui/TimeControls';
import { Chips } from './ui/Chips';
import { Loader } from './ui/Loader';
import { About } from './ui/About';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export function App() {
  const [campus, setCampus] = useState<CampusData | null>(null);
  const [loadProgress, setLoadProgress] = useState(0.04);
  const [loadStage, setLoadStage] = useState('Initializing viewer…');
  const [loadError, setLoadError] = useState<CampusLoadError | null>(null);

  const [hour, setHour] = useState<number>(() => {
    const params = new URLSearchParams(window.location.search);
    const qh = Number(params.get('hour'));
    return Number.isFinite(qh) && qh >= 5 && qh <= 23 ? qh : 9.5;
  });
  const [playingTime, setPlayingTime] = useState(false);

  const [quality, setQuality] = useState<QualityMode>('auto');
  const [showLabels, setShowLabels] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<BuildingCategory | 'all'>('all');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredBuilding, setHoveredBuilding] = useState<Building | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const [routeOpen, setRouteOpen] = useState(false);
  const [routeFromId, setRouteFromId] = useState('main-gate');
  const [routeToId, setRouteToId] = useState('');

  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null);
  const flySeqRef = useRef(1);

  const reducedMotion = usePrefersReducedMotion();

  const triggerLoad = useCallback(() => {
    setLoadError(null);
    setLoadProgress(0.05);
    loadCampusData((frac, stage) => {
      setLoadProgress(frac);
      setLoadStage(stage);
    })
      .then((data) => {
        setCampus(data);
        setLoadProgress(1);
        const hasGate = data.buildings.some((b) => b.id === 'main-gate');
        if (!hasGate && data.buildings[0]) {
          setRouteFromId(data.buildings[0].id);
        }
      })
      .catch((err) => {
        if (err instanceof CampusLoadError) {
          setLoadError(err);
        } else {
          setLoadError(
            new CampusLoadError(
              'network',
              err instanceof Error ? err.message : 'Unexpected load failure.'
            )
          );
        }
      });
  }, []);

  useEffect(() => {
    triggerLoad();
  }, [triggerLoad]);

  // Effective quality: auto picks medium on touch/low-core phones for 60 fps, high on desktop
  const effectiveQuality = useMemo<'low' | 'medium' | 'high'>(() => {
    if (quality === 'low') return 'low';
    if (quality === 'high') return 'high';
    const isSmallScreen = typeof window !== 'undefined' && window.innerWidth < 768;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
    if (cores <= 2) return 'low';
    return isSmallScreen ? 'medium' : 'high';
  }, [quality]);

  // Solar time-of-day animation loop
  useEffect(() => {
    if (!playingTime || reducedMotion) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setHour((prev) => {
        const next = prev + dt * 1.15;
        return next > 23 ? 5 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playingTime, reducedMotion]);

  const lighting = useMemo(
    () =>
      computeLightingState(
        hour,
        campus?.meta.origin ?? [80.0036, 13.0088],
        campus?.meta.generated ?? '2026-11-22'
      ),
    [hour, campus]
  );

  const pathGraph = useMemo(() => (campus ? buildPathGraph(campus) : null), [campus]);

  const activeRoute = useMemo(() => {
    if (!pathGraph || !routeFromId || !routeToId) return null;
    return findRoute(pathGraph, routeFromId, routeToId);
  }, [pathGraph, routeFromId, routeToId]);

  // Automatically frame the full walking path whenever a valid route is created
  useEffect(() => {
    if (!activeRoute || !activeRoute.ok || activeRoute.points.length < 2) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of activeRoute.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const midX = (minX + maxX) * 0.5;
    const midZ = (minZ + maxZ) * 0.5;
    const span = Math.hypot(maxX - minX, maxZ - minZ);
    setFlyRequest({
      target: [midX, 0, midZ],
      distance: Math.min(480, Math.max(55, span * 1.45)),
      seq: Date.now(),
    });
  }, [activeRoute]);

  const tourStops = useMemo(
    () => (campus ? getTourStops(campus.buildings) : []),
    [campus]
  );

  const flyToBuilding = useCallback(
    (b: Building, customDist?: number, customAzimuth?: number) => {
      if (!campus) return;
      const [cx, cz] = getPolygonCentroid(b.polygon);
      const y = sampleElevation(campus.elevation, cx, cz) + b.height_m * 0.45;
      const defaultDist =
        b.id === 'aadhi-statue'
          ? 36
          : b.id === 'ablock-fountain'
          ? 42
          : b.id === 'maggi-hotspot' || b.id === 'rec-mart' || b.id === 'garden-cafe'
          ? 56
          : 118;
      const defaultAz =
        b.id === 'aadhi-statue'
          ? -152
          : b.id === 'ablock-fountain'
          ? 168
          : undefined;
      flySeqRef.current += 1;
      setFlyRequest({
        seq: flySeqRef.current,
        target: [cx, y, cz],
        distance: customDist ?? defaultDist,
        azimuthDeg: customAzimuth ?? defaultAz,
      });
    },
    [campus]
  );

  const handleSelectBuilding = useCallback(
    (b: Building, withRoute = false) => {
      setSelectedId(b.id);
      flyToBuilding(b);
      if (withRoute && b.id !== routeFromId) {
        setRouteToId(b.id);
        setRouteOpen(true);
      }
    },
    [flyToBuilding, routeFromId]
  );

  const handlePickSearchHit = useCallback(
    (hit: SearchHit) => {
      setTourIndex(null);
      setActiveCategory('all');
      setSelectedId(hit.building.id);
      flyToBuilding(hit.building);
      if (hit.building.id !== 'main-gate') {
        setRouteFromId('main-gate');
        setRouteToId(hit.building.id);
        setRouteOpen(true);
      }
    },
    [flyToBuilding]
  );

  const goToTourStop = useCallback(
    (idx: number) => {
      if (!campus || tourStops.length === 0) return;
      const wrapped = ((idx % tourStops.length) + tourStops.length) % tourStops.length;
      const stop = tourStops[wrapped];
      setTourIndex(wrapped);
      setActiveCategory('all');
      const targetBldg = campus.buildings.find((b) => b.id === stop.buildingId);
      if (targetBldg) {
        setSelectedId(targetBldg.id);
        flyToBuilding(targetBldg, stop.distance ?? 118, stop.azimuthDeg);
        if (targetBldg.id !== 'main-gate') {
          setRouteFromId('main-gate');
          setRouteToId(targetBldg.id);
        } else {
          setRouteToId('');
        }
      }
    },
    [campus, tourStops, flyToBuilding]
  );

  // Tour keyboard controls: Left/Right arrows + Esc exits (PLAN.md §5.1)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tourIndex !== null) {
        setTourIndex(null);
        return;
      }

      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === 'Escape' && selectedId !== null) {
        setSelectedId(null);
      } else if (tourIndex !== null && e.key === 'ArrowRight') {
        e.preventDefault();
        goToTourStop(tourIndex + 1);
      } else if (tourIndex !== null && e.key === 'ArrowLeft') {
        e.preventDefault();
        goToTourStop(tourIndex - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tourIndex, selectedId, goToTourStop]);

  // Programmatic control hook for automated screenshot & tour verification
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__REC_APP__ = {
      setHour,
      startTour: () => goToTourStop(0),
      setTourStop: (i: number) => goToTourStop(i),
      exitTour: () => setTourIndex(null),
      resetOverview: () => {
        setTourIndex(null);
        setSelectedId(null);
        setRouteToId('');
        flySeqRef.current += 1;
        setFlyRequest({
          seq: flySeqRef.current,
          target: [25, 4, 15],
          distance: 365,
          azimuthDeg: -8,
          polarDeg: 47,
        });
      },
      routeTo: (toId: string, fromId = 'main-gate') => {
        setRouteFromId(fromId);
        setRouteToId(toId);
        setRouteOpen(true);
        const b = campus?.buildings.find((item) => item.id === toId);
        if (b) {
          setSelectedId(b.id);
          flyToBuilding(b, 118);
        }
      },
    };
  }, [campus, flyToBuilding, goToTourStop]);

  const handleResetOverview = useCallback(() => {
    setTourIndex(null);
    setSelectedId(null);
    flySeqRef.current += 1;
    setFlyRequest({
      seq: flySeqRef.current,
      target: [25, 4, 15],
      distance: 365,
      azimuthDeg: -(campus?.meta.north_deg ?? 0),
      polarDeg: 48,
    });
  }, [campus]);

  const selectedBuilding = useMemo(
    () => campus?.buildings.find((b) => b.id === selectedId) ?? null,
    [campus, selectedId]
  );

  const currentTourStop = tourIndex !== null ? tourStops[tourIndex] ?? null : null;

  const totalRooms = useMemo(
    () => (campus ? campus.buildings.reduce((acc, b) => acc + b.rooms.length, 0) : 0),
    [campus]
  );

  if (!campus || loadError) {
    return (
      <Loader
        progress={loadProgress}
        stage={loadStage}
        error={loadError}
        onRetry={triggerLoad}
      />
    );
  }

  return (
    <main className="relative h-full w-full overflow-hidden">
      <h1 className="sr-only">
        Rajalakshmi Engineering College 3D Campus Map
      </h1>
      {/* 3D WebGL Campus World */}
      <CampusScene
        campus={campus}
        lighting={lighting}
        quality={quality}
        effectiveQuality={effectiveQuality}
        reducedMotion={reducedMotion}
        showLabels={showLabels}
        selectedId={selectedId}
        hoveredBuilding={hoveredBuilding}
        activeCategory={activeCategory}
        route={activeRoute}
        flyRequest={flyRequest}
        onHover={(b, pos) => {
          setHoveredBuilding(b);
          setHoverPos(pos ?? null);
        }}
        onSelect={(b) => handleSelectBuilding(b, false)}
        onClearSelection={() => {
          if (tourIndex === null) setSelectedId(null);
        }}
      />

      {/* Pointer Hover Tooltip */}
      {hoveredBuilding && hoverPos && hoveredBuilding.id !== selectedId && (
        <div
          role="tooltip"
          style={{
            left: Math.min(window.innerWidth - 220, hoverPos.x + 14),
            top: Math.max(12, hoverPos.y - 12),
          }}
          className="pointer-events-none fixed z-30 max-w-56 rounded-[4px] bg-zinc-900/94 px-2.5 py-1.5 text-xs text-white shadow-sm"
        >
          <div className="font-medium leading-snug">{hoveredBuilding.name}</div>
          <div className="text-[10px] text-zinc-300 capitalize tabular-nums">
            {hoveredBuilding.cat} · {hoveredBuilding.levels}F · {hoveredBuilding.height_m.toFixed(0)} m
          </div>
        </div>
      )}

      {/* Overlay UI Grid — Safe for 360px mobile & desktop */}
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-2.5 sm:p-4">
        {/* Top Row: Search (top-left) + Toolbar (top-right) */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2 max-w-full">
            <Search
              buildings={campus.buildings}
              routeOpen={routeOpen}
              onToggleRouteOpen={setRouteOpen}
              routeFromId={routeFromId}
              routeToId={routeToId}
              onChangeRouteFrom={(id) => {
                setRouteFromId(id);
                setRouteOpen(true);
              }}
              onChangeRouteTo={(id) => {
                setRouteToId(id);
                setRouteOpen(true);
                const target = campus.buildings.find((b) => b.id === id);
                if (target) {
                  setSelectedId(target.id);
                  flyToBuilding(target, 118);
                }
              }}
              onClearRoute={() => setRouteToId('')}
              route={activeRoute}
              onPickSearchHit={handlePickSearchHit}
            />

            {/* Guided Orientation Tour Card */}
            {currentTourStop && (
              <section
                aria-label="Orientation tour stop"
                className="pointer-events-auto w-full max-w-[calc(100vw-1.25rem)] sm:w-80 rounded-md bg-[#fafaf9]/95 p-3 border border-zinc-900/14 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold tabular-nums uppercase tracking-wider text-zinc-500">
                    Stop {String(currentTourStop.index + 1).padStart(2, '0')} /{' '}
                    {String(tourStops.length).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTourIndex(null)}
                    aria-label="Exit guided tour (Escape)"
                    className="rounded p-0.5 text-zinc-400 hover:text-zinc-800"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <h3 className="mt-1 text-sm font-semibold text-zinc-900">
                  {currentTourStop.title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                  {currentTourStop.summary}
                </p>

                <div className="mt-2.5 pt-2 border-t border-zinc-900/10 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => goToTourStop(currentTourStop.index - 1)}
                    aria-label="Previous tour stop"
                    className="inline-flex items-center gap-0.5 rounded-[3px] border border-zinc-900/14 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-100"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Prev</span>
                  </button>

                  <div className="flex items-center gap-1" aria-hidden="true">
                    {tourStops.map((s) => (
                      <span
                        key={s.index}
                        className={`h-1 rounded-full transition-all ${
                          s.index === currentTourStop.index
                            ? 'w-3.5 bg-zinc-900'
                            : 'w-1 bg-zinc-300'
                        }`}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => goToTourStop(currentTourStop.index + 1)}
                    aria-label="Next tour stop"
                    className="inline-flex items-center gap-0.5 rounded-[3px] bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </section>
            )}

            {/* Selected Building Details Card */}
            {selectedBuilding && !currentTourStop && (
              <section
                aria-label="Selected building details"
                className="pointer-events-auto w-full max-w-[calc(100vw-1.25rem)] sm:w-80 rounded-md bg-[#fafaf9]/95 p-3 border border-zinc-900/14 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-zinc-500">
                      <span className="uppercase tracking-wider font-medium text-zinc-600">
                        {selectedBuilding.cat}
                      </span>
                      <span>·</span>
                      <span>
                        {selectedBuilding.levels}F · {selectedBuilding.height_m.toFixed(0)} m
                      </span>
                    </div>
                    <h3 className="mt-0.5 text-sm font-semibold text-zinc-900">
                      {selectedBuilding.name}
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label="Close building details"
                    className="rounded p-0.5 text-zinc-400 hover:text-zinc-800"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {selectedBuilding.rooms.length > 0 && (
                  <div className="mt-2 max-h-26 overflow-y-auto border-t border-zinc-900/10 pt-2">
                    <div className="flex flex-wrap gap-1">
                      {selectedBuilding.rooms.map((room) => (
                        <span
                          key={room}
                          className="rounded-[3px] border border-zinc-900/10 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700"
                        >
                          {room}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedBuilding.id !== 'main-gate' && (
                  <button
                    type="button"
                    onClick={() => {
                      setRouteFromId('main-gate');
                      setRouteToId(selectedBuilding.id);
                      setRouteOpen(true);
                    }}
                    className="mt-2.5 w-full rounded-[4px] bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 transition-colors"
                  >
                    Directions from Main Gate
                  </button>
                )}
              </section>
            )}
          </div>

          <div className="self-end sm:self-auto">
            <Toolbar
              tourActive={tourIndex !== null}
              onToggleTour={() => {
                if (tourIndex !== null) setTourIndex(null);
                else goToTourStop(0);
              }}
              routeOpen={routeOpen}
              onToggleRoute={() => setRouteOpen((v) => !v)}
              onResetOverview={handleResetOverview}
              showLabels={showLabels}
              onToggleLabels={() => setShowLabels((v) => !v)}
              quality={quality}
              effectiveQuality={effectiveQuality}
              onCycleQuality={() =>
                setQuality((prev) =>
                  prev === 'auto' ? 'high' : prev === 'high' ? 'low' : 'auto'
                )
              }
              onOpenAbout={() => setAboutOpen(true)}
              northDeg={campus.meta.north_deg}
            />
          </div>
        </div>

        {/* Bottom Row: TimeControls (bottom-left) + Chips (bottom-right) + ODbL Footer */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-end sm:justify-between">
            <TimeControls
              hour={hour}
              onChangeHour={(h) => {
                setPlayingTime(false);
                setHour(h);
              }}
              playing={playingTime}
              onTogglePlay={() => setPlayingTime((p) => !p)}
            />

            <Chips
              activeCategory={activeCategory}
              onSelectCategory={setActiveCategory}
              onQuickJump={(bId, shouldRoute) => {
                setTourIndex(null);
                setActiveCategory('all');
                const b = campus.buildings.find((item) => item.id === bId);
                if (b) {
                  handleSelectBuilding(b, Boolean(shouldRoute));
                }
              }}
            />
          </div>

          {/* Mandatory ODbL OpenStreetMap Attribution Footer */}
          <footer className="pointer-events-auto flex items-center justify-between text-[10px] text-zinc-700">
            <span className="inline-flex items-center rounded-[3px] bg-[#fafaf9]/90 border border-zinc-900/10 px-1.5 py-0.5">
              <img
                src="./rec-logo.png"
                alt="Rajalakshmi Engineering College"
                className="h-5 w-auto object-contain"
              />
            </span>
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="rounded-[3px] bg-[#fafaf9]/85 border border-zinc-900/10 px-2 py-0.5 text-zinc-700 hover:text-zinc-950 hover:underline"
            >
              © OpenStreetMap contributors, ODbL
            </button>
          </footer>
        </div>
      </div>

      <About
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        meta={campus.meta}
        buildingCount={campus.buildings.length}
        roomCount={totalRooms}
      />
    </main>
  );
}
