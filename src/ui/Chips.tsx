import type { BuildingCategory } from '../types';

interface ChipsProps {
  activeCategory: BuildingCategory | 'all';
  onSelectCategory: (cat: BuildingCategory | 'all') => void;
  onQuickJump?: (buildingId: string, routeFromGate?: boolean) => void;
}

const CATEGORY_CHIPS: { id: BuildingCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'academic', label: 'Academic' },
  { id: 'admin', label: 'Admin' },
  { id: 'hostel', label: 'Hostels' },
  { id: 'service', label: 'Cafes' },
  { id: 'sports', label: 'Sports' },
];

export function Chips({ activeCategory, onSelectCategory }: ChipsProps) {
  return (
    <div
      role="group"
      aria-label="Filter buildings by category"
      className="no-scrollbar pointer-events-auto flex w-full sm:w-auto items-center gap-0.5 overflow-x-auto rounded-md bg-[#fafaf9]/95 border border-zinc-900/14 p-1 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
    >
      {CATEGORY_CHIPS.map((chip) => {
        const active = activeCategory === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelectCategory(chip.id)}
            className={`shrink-0 rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-zinc-900 text-white'
                : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900'
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
