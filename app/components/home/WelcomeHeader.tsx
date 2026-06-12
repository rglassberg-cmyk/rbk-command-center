'use client';

interface WelcomeHeaderProps {
  firstName?: string;
}

function TimeIcon({ hour }: { hour: number }) {
  if (hour >= 5 && hour < 12) {
    return (
      <svg className="w-10 h-10 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="5" fill="currentColor" opacity={0.15} /><circle cx="12" cy="12" r="5" />
        <path strokeLinecap="round" d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    );
  }
  if (hour >= 12 && hour < 17) {
    return (
      <svg className="w-10 h-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h1a4 4 0 010 8h-1M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8zm3-5c0 1 .5 2 1 2s1-1 1-2m2 0c0 1 .5 2 1 2s1-1 1-2" />
      </svg>
    );
  }
  if (hour >= 17 && hour < 21) {
    return (
      <svg className="w-10 h-10 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3m0 0a5 5 0 015 5H7a5 5 0 015-5zM3 17h18M5 21h14" />
      </svg>
    );
  }
  return (
    <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

export default function WelcomeHeader({ firstName = 'there' }: WelcomeHeaderProps) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="mb-10">
      {/* SAR brand accent bar */}
      <div className="h-1 rounded-full mb-8" style={{ background: 'linear-gradient(to right, #E87722, #00A5B5, #7AB648, #1B3A6B, #E91E8C)' }} />

      {/* Hero */}
      <div className="flex items-center gap-4">
        <TimeIcon hour={hour} />
        <div>
          <h1
            className="font-bold text-2xl sm:text-4xl"
            style={{
              fontFamily: 'var(--font-source-serif), Georgia, serif',
              letterSpacing: '-0.5px',
              color: '#1B3A6B',
            }}
          >
            {greeting}, {firstName}.
          </h1>
          <p className="text-slate-500 mt-0.5" style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
            {today}
          </p>
        </div>
      </div>
    </div>
  );
}
