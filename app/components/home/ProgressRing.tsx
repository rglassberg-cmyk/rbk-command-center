'use client';

interface ProgressRingProps {
  size: number;
  stroke: number;
  progress: number;
  color?: string;
}

export default function ProgressRing({ size, stroke, progress, color = 'oklch(0.58 0.12 235)' }: ProgressRingProps) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(Math.max(progress, 0), 100) / 100) * circumference;
  const showText = size >= 40;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e8edf3"
        strokeWidth={stroke}
      />
      {/* Ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 300ms ease' }}
      />
      {showText && (
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="font-semibold"
          style={{ fontSize: size / 4, fill: '#334155', fontFamily: 'Inter, sans-serif' }}
        >
          {Math.round(progress)}%
        </text>
      )}
    </svg>
  );
}
