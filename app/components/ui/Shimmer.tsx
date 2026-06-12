'use client';

// Loading skeletons. Uses Tailwind's built-in `animate-pulse` (opacity
// toggle) rather than a custom background-position gradient animation —
// the gradient approach was crashing iOS Safari when many ShimmerBlocks
// rendered at once (table rows + stat cards composed on the same view).
//
// All Shimmer* helpers are layout-only with no window/document access
// and are safe to render during SSR.

interface ShimmerBlockProps {
  height?: number | string;
  width?: number | string;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
  className?: string;
}

const RADIUS = { sm: '4px', md: '8px', lg: '12px', full: '9999px' } as const;

export function ShimmerBlock({
  height = 16,
  width = '100%',
  rounded = 'md',
  className = '',
}: ShimmerBlockProps) {
  return (
    <div
      className={`bg-slate-200 animate-pulse ${className}`}
      style={{ height, width, borderRadius: RADIUS[rounded] }}
    />
  );
}

export function ShimmerStatCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
          <ShimmerBlock height={12} width="40%" rounded="sm" />
          <div className="mt-2.5">
            <ShimmerBlock height={28} width="60%" rounded="md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ShimmerTableRows({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid gap-3 py-3 border-b border-slate-100"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <ShimmerBlock key={j} height={14} width={j === 0 ? '80%' : '50%'} rounded="sm" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ShimmerCards({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
          <ShimmerBlock height={14} width="50%" rounded="sm" />
          <div className="mt-2">
            <ShimmerBlock height={12} width="30%" rounded="sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
