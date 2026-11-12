export interface DivisionOption {
  id: string;
  name: string;
  count?: number;
}

/**
 * A row of chips: "All divisions" plus one per division. Scrolls sideways on a narrow phone.
 * Renders nothing when there is only one division, because there is nothing to choose.
 */
export default function DivisionFilter({
  options,
  value,
  onChange,
}: {
  options: DivisionOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (options.length < 2) return null;
  const chips: DivisionOption[] = [{ id: 'all', name: 'All divisions' }, ...options];
  return (
    <div className="overflow-x-auto pb-1" role="tablist" aria-label="Division">
      <div className="flex gap-2 w-max">
        {chips.map((o) => {
          const selected = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(o.id)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold min-h-[40px] transition-colors ${
                selected
                  ? 'bg-pitch-700 text-white'
                  : 'bg-pitch-100 text-pitch-700 hover:text-pitch-900'
              }`}
            >
              {o.name}
              {o.count !== undefined ? ` (${o.count})` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
