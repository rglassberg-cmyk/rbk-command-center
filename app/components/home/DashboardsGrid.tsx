'use client';

interface Dashboard {
  id: string;
  name: string;
  description: string;
  tone: string;
}

interface DashboardsGridProps {
  dashboards: Dashboard[];
  onOpenDashboard: (dashboardId: string) => void;
}

// SAR brand-inspired accent colors per tone
const TONE_ACCENTS: Record<string, { border: string; iconBg: string; iconText: string }> = {
  slate: { border: '#1B3A6B', iconBg: '#1B3A6B', iconText: '#ffffff' },
  blue: { border: '#1B3A6B', iconBg: '#1B3A6B', iconText: '#ffffff' },
  amber: { border: '#E87722', iconBg: '#E87722', iconText: '#ffffff' },
  violet: { border: '#E91E8C', iconBg: '#E91E8C', iconText: '#ffffff' },
  teal: { border: '#00A5B5', iconBg: '#00A5B5', iconText: '#ffffff' },
  green: { border: '#7AB648', iconBg: '#7AB648', iconText: '#ffffff' },
};

export default function DashboardsGrid({ dashboards, onOpenDashboard }: DashboardsGridProps) {
  if (dashboards.length === 0) return null;

  return (
    <div className="mb-10">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-bold" style={{ fontSize: 20, color: '#1B3A6B' }}>Dashboards</h2>
        <span className="text-slate-400 font-medium" style={{ fontSize: 13 }}>{dashboards.length} available</span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {dashboards.map((dashboard, idx) => {
          const accent = TONE_ACCENTS[dashboard.tone] || TONE_ACCENTS.slate;
          // Rotate brand colors for top border
          const brandColors = ['#E87722', '#00A5B5', '#7AB648', '#1B3A6B', '#E91E8C'];
          const topColor = brandColors[idx % brandColors.length];

          return (
            <div
              key={dashboard.id}
              onClick={() => onOpenDashboard(dashboard.id)}
              className="bg-white rounded-2xl cursor-pointer group border border-slate-100"
              style={{
                borderTop: `3px solid ${topColor}`,
                padding: '18px 20px 20px',
                transition: 'transform 120ms ease, box-shadow 120ms ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
              }}
            >
              {/* Icon + name row */}
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex items-center justify-center rounded-xl font-bold flex-shrink-0"
                  style={{ width: 40, height: 40, fontSize: 16, backgroundColor: accent.iconBg, color: accent.iconText }}
                >
                  {dashboard.name.charAt(0)}
                </span>
                <span className="font-bold truncate" style={{ fontSize: 15, color: '#1e293b' }}>
                  {dashboard.name}
                </span>
              </div>
              {/* Description */}
              <p className="text-slate-500 mt-2.5" style={{ fontSize: 13, lineHeight: 1.5 }}>
                {dashboard.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { Dashboard };
