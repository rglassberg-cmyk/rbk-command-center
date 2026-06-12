'use client';

import { useState, useEffect, useCallback } from 'react';
import { format, parseISO, isToday } from 'date-fns';
import { apiFetch } from '@/lib/apiFetch';

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  meetingLink?: string | null;
  calendarLink?: string | null;
}

export default function TodayScheduleCard() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [notConnected, setNotConnected] = useState(false);

  const fetchCalendarForDate = useCallback(async (date: Date) => {
    setLoading(true);
    setAuthError(false);
    setNotConnected(false);
    try {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const res = await apiFetch(`/api/calendar/today?date=${dateStr}`);
      const data = await res.json().catch(() => ({}));
      if (data.notConnected) {
        setNotConnected(true);
        setEvents([]);
      } else if (res.ok) {
        setEvents(data.events || []);
      } else if (res.status === 401 && data.authError) {
        setAuthError(true);
        setEvents([]);
      } else {
        setEvents([]);
      }
    } catch {
      setEvents([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCalendarForDate(new Date());
  }, [fetchCalendarForDate]);

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
    setSelectedDate(newDate);
    fetchCalendarForDate(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    setSelectedDate(today);
    fetchCalendarForDate(today);
  };

  const now = new Date();
  const visibleEvents = isToday(selectedDate)
    ? events.filter(event => event.isAllDay || new Date(event.endTime) > now)
    : events;

  const formatTime = (time: string, allDay: boolean) => {
    if (allDay) return 'All day';
    return format(parseISO(time), 'h:mm a');
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 sm:px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: '#00A5B5' }} />
            <svg className="w-5 h-5 flex-shrink-0" style={{ color: '#1B3A6B' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <h3 className="font-bold uppercase tracking-wide truncate" style={{ fontSize: 13, color: '#1B3A6B' }}>
              Today&apos;s Schedule
            </h3>
          </div>
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
            title="Google Calendar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6v6m-11 5L21 3" />
            </svg>
          </a>
        </div>

        {/* Day nav */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateDate('prev')}
            className="text-slate-400 hover:text-slate-600 p-0.5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold" style={{ color: '#1B3A6B' }}>
            {isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEE, MMM d')}
          </span>
          <button
            onClick={() => navigateDate('next')}
            className="text-slate-400 hover:text-slate-600 p-0.5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {!isToday(selectedDate) && (
            <button
              onClick={goToToday}
              className="text-xs text-blue-600 hover:text-blue-800 ml-1 font-medium"
            >
              Back to Today
            </button>
          )}
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {loading ? (
          <div className="space-y-2 animate-pulse pt-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                <div className="h-5 w-14 bg-slate-200 rounded" />
                <div className="flex-1"><div className="h-4 bg-slate-200 rounded w-3/4" /></div>
              </div>
            ))}
          </div>
        ) : notConnected ? (
          <div className="text-center py-6">
            <svg className="w-10 h-10 text-slate-200 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="text-slate-500 text-sm mb-3">Connect your Google Calendar to see your schedule</p>
            <a
              href="/api/auth/gmail-consent"
              className="inline-block bg-teal-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-teal-700 transition-colors"
            >
              Connect Calendar
            </a>
          </div>
        ) : authError ? (
          <div className="text-center py-6">
            <svg className="w-10 h-10 text-slate-200 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-slate-500 text-sm mb-3">Calendar disconnected</p>
            <a
              href="/api/auth/gmail-consent"
              className="inline-block bg-teal-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-teal-700 transition-colors"
            >
              Reconnect
            </a>
          </div>
        ) : visibleEvents.length === 0 ? (
          <p className="text-slate-400 text-sm pt-2">
            No events {isToday(selectedDate) ? 'remaining today' : 'on this day'}
          </p>
        ) : (
          <div className="space-y-1 pt-1">
            {visibleEvents.map((event) => (
              <div key={event.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                <span className="text-white text-xs font-medium px-2 py-0.5 rounded min-w-[60px] text-center" style={{ backgroundColor: '#1B3A6B' }}>
                  {formatTime(event.startTime, event.isAllDay)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 text-sm truncate">{event.title}</p>
                  {event.location && <p className="text-xs text-slate-500 truncate">{event.location}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {event.meetingLink && (
                    <a
                      href={event.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white px-2 py-0.5 rounded text-xs font-medium transition-colors hover:opacity-90"
                      style={{ backgroundColor: '#00A5B5' }}
                    >
                      Join
                    </a>
                  )}
                  {event.calendarLink && (
                    <a
                      href={event.calendarLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-slate-600 text-xs"
                      title="View in Google Calendar"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6v6m-11 5L21 3" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
