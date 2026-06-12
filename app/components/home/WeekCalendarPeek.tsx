'use client';

interface CalendarPeekEvent {
  date: string;
  title: string;
  time: string;
}

interface WeekCalendarPeekProps {
  events: CalendarPeekEvent[];
}

function isToday(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
}

function formatDayHeader(dateStr: string): { dayName: string; dateLabel: string } {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    dayName: d.toLocaleDateString('en-US', { weekday: 'long' }),
    dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

export default function WeekCalendarPeek({ events }: WeekCalendarPeekProps) {
  if (events.length === 0) return null;

  const grouped = new Map<string, CalendarPeekEvent[]>();
  for (const evt of events) {
    const arr = grouped.get(evt.date) || [];
    arr.push(evt);
    grouped.set(evt.date, arr);
  }
  const sortedDates = [...grouped.keys()].sort();

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-8">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-1 h-5 rounded-full" style={{ backgroundColor: '#E87722' }} />
        <svg className="w-5 h-5" style={{ color: '#1B3A6B' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <h3 className="font-bold uppercase tracking-wide" style={{ fontSize: 13, color: '#1B3A6B' }}>This Week at SAR</h3>
      </div>

      <div className="space-y-3 max-h-[340px] overflow-y-auto">
        {sortedDates.map(date => {
          const dayEvents = grouped.get(date)!;
          const { dayName, dateLabel } = formatDayHeader(date);
          const today = isToday(date);

          return (
            <div
              key={date}
              className={`rounded-xl px-4 py-3 transition-colors ${today ? 'border-l-[3px]' : 'border-l-[3px] border-l-transparent hover:bg-slate-50'}`}
              style={today ? { backgroundColor: '#FFF7ED', borderLeftColor: '#E87722' } : undefined}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: today ? '#E87722' : '#64748b' }}>{dayName}</span>
                <span className="text-xs text-slate-400">{dateLabel}</span>
                {today && (
                  <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5" style={{ backgroundColor: '#E87722', color: 'white' }}>Today</span>
                )}
              </div>
              <div className="space-y-1">
                {dayEvents.map((evt, idx) => (
                  <div key={idx} className="flex items-baseline gap-3 group">
                    <span className="text-xs text-slate-400 w-16 flex-shrink-0 tabular-nums">{evt.time}</span>
                    <span className="text-sm text-slate-800 font-medium line-clamp-1 group-hover:text-slate-900">{evt.title}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { CalendarPeekEvent };
