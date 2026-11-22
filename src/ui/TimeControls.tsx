import { Play, Pause, Sunrise, Sun, Sunset, Moon } from 'lucide-react';
import { formatHourLabel } from '../logic/solar';

interface TimeControlsProps {
  hour: number;
  onChangeHour: (h: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}

const PRESETS = [
  { id: 'dawn', title: 'Dawn (06:20)', hour: 6.35, Icon: Sunrise },
  { id: 'noon', title: 'Noon (12:30)', hour: 12.5, Icon: Sun },
  { id: 'dusk', title: 'Dusk (17:25)', hour: 17.4, Icon: Sunset },
  { id: 'night', title: 'Night (21:00)', hour: 21.0, Icon: Moon },
] as const;

export function TimeControls({
  hour,
  onChangeHour,
  playing,
  onTogglePlay,
}: TimeControlsProps) {
  return (
    <div className="pointer-events-auto flex w-full sm:w-auto items-center gap-2.5 rounded-md bg-[#fafaf9]/95 border border-zinc-900/14 px-2.5 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause solar time animation' : 'Play solar time animation'}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-zinc-900 text-white hover:bg-zinc-700 transition-colors"
      >
        {playing ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5 ml-0.5" />}
      </button>

      <span className="w-11 shrink-0 text-xs font-semibold tabular-nums text-zinc-900">
        {formatHourLabel(hour)}
      </span>

      <input
        type="range"
        min={5}
        max={23}
        step={0.05}
        value={hour}
        aria-label="Campus solar time of day from 05:00 to 23:00 IST"
        onChange={(e) => onChangeHour(Number(e.target.value))}
        className="arch-slider min-w-20 sm:w-28 flex-1"
      />

      <div className="flex items-center gap-0.5 shrink-0 border-l border-zinc-900/10 pl-2">
        {PRESETS.map(({ id, title, hour: presetHour, Icon }) => {
          const active = Math.abs(hour - presetHour) < 0.35;
          return (
            <button
              key={id}
              type="button"
              title={title}
              onClick={() => onChangeHour(presetHour)}
              aria-label={`Set campus sun to ${title} (${formatHourLabel(presetHour)})`}
              className={`rounded-[3px] p-1 transition-colors ${
                active
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
