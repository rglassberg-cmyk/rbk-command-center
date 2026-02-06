'use client';

import { useState, useEffect } from 'react';
import { format, parseISO, isToday } from 'date-fns';

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  link: string;
}

export default function TodayAgenda() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetchCalendarEvents();
  }, []);

  const fetchCalendarEvents = async () => {
    try {
      const res = await fetch('/api/calendar/today');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch calendar');
      }
      const data = await res.json();
      setEvents(data.events || []);
      setError(null);
    } catch (err) {
      console.error('Calendar fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  };

  const formatEventTime = (startTime: string, endTime: string, isAllDay: boolean) => {
    if (isAllDay) {
      return 'All day';
    }
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    return `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;
  };

  const isCurrentEvent = (startTime: string, endTime: string, isAllDay: boolean) => {
    if (isAllDay) return true;
    const now = new Date();
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    return now >= start && now <= end;
  };

  const isUpcoming = (startTime: string) => {
    const now = new Date();
    const start = parseISO(startTime);
    return start > now;
  };

  if (loading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 text-blue-700">
          <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
          <span>Loading today&apos;s schedule...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="text-red-700">
            <p className="font-medium">Calendar unavailable</p>
            <p className="text-sm">{error}</p>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              fetchCalendarEvents();
            }}
            className="text-sm text-red-600 hover:text-red-800 px-3 py-1 bg-red-100 rounded"
          >
            Retry
          </button>
        </div>
        {error.includes('calendar access') && (
          <p className="text-sm text-red-600 mt-2">
            Sign out and sign back in to grant calendar access.
          </p>
        )}
      </div>
    );
  }

  const today = new Date();
  const dateStr = format(today, 'EEEE, MMMM d');

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2"
        >
          <span className="text-lg font-semibold text-blue-900">
            Today&apos;s Schedule
          </span>
          <span className="text-sm text-blue-600">
            {dateStr}
          </span>
          <span className="text-sm text-blue-500">
            ({events.length} event{events.length !== 1 ? 's' : ''})
          </span>
          <span className={`text-blue-600 transition-transform ${collapsed ? '' : 'rotate-180'}`}>
            ▼
          </span>
        </button>
        <button
          onClick={() => {
            setLoading(true);
            fetchCalendarEvents();
          }}
          className="text-sm text-blue-600 hover:text-blue-800 px-2 py-1"
          title="Refresh calendar"
        >
          ↻
        </button>
      </div>

      {!collapsed && (
        <>
          {events.length === 0 ? (
            <p className="text-blue-600 text-sm">No events scheduled for today.</p>
          ) : (
            <div className="space-y-2">
              {events.map((event) => {
                const isCurrent = isCurrentEvent(event.startTime, event.endTime, event.isAllDay);
                const upcoming = isUpcoming(event.startTime);

                return (
                  <div
                    key={event.id}
                    className={`bg-white rounded border p-3 ${
                      isCurrent && !event.isAllDay
                        ? 'border-blue-400 ring-1 ring-blue-300'
                        : 'border-blue-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-medium ${
                            isCurrent && !event.isAllDay
                              ? 'text-blue-700'
                              : upcoming
                              ? 'text-gray-700'
                              : 'text-gray-500'
                          }`}>
                            {formatEventTime(event.startTime, event.endTime, event.isAllDay)}
                          </span>
                          {isCurrent && !event.isAllDay && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                              Now
                            </span>
                          )}
                        </div>
                        <p className={`font-medium ${
                          isCurrent && !event.isAllDay
                            ? 'text-blue-900'
                            : 'text-gray-900'
                        }`}>
                          {event.title}
                        </p>
                        {event.location && (
                          <p className="text-sm text-gray-500 mt-0.5">
                            {event.location}
                          </p>
                        )}
                      </div>
                      {event.link && (
                        <a
                          href={event.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 text-sm ml-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
