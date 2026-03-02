'use client';

import { useState, useEffect, useCallback } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import type { CalendarEvent } from '@/types';

export function useCalendar(initialEvents: CalendarEvent[]) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [scheduleEvents, setScheduleEvents] = useState<CalendarEvent[]>(initialEvents);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [calendarAuthError, setCalendarAuthError] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventFormData, setEventFormData] = useState({
    title: '',
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '10:00',
    location: '',
    description: '',
  });

  // Meeting countdown
  const [upcomingMeeting, setUpcomingMeeting] = useState<{
    title: string;
    minutesUntil: number;
    meetingLink?: string | null;
  } | null>(null);

  const refreshCalendarToken = useCallback(async (): Promise<boolean> => {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
      provider.addScope('https://www.googleapis.com/auth/calendar.events');
      provider.setCustomParameters({ prompt: 'none' });
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken;
      const idToken = await result.user.getIdToken();
      if (!accessToken) return false;
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, accessToken }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const fetchCalendarForDate = useCallback(async (date: Date, isRetry = false) => {
    setLoadingSchedule(true);
    setCalendarAuthError(false);
    try {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const res = await fetch(`/api/calendar/today?date=${dateStr}`);
      if (res.ok) {
        const data = await res.json();
        setScheduleEvents(data.events || []);
        setCalendarAuthError(false);
      } else if (res.status === 401 && !isRetry) {
        const refreshed = await refreshCalendarToken();
        if (refreshed) {
          await fetchCalendarForDate(date, true);
          return;
        } else {
          setCalendarAuthError(true);
          setScheduleEvents([]);
        }
      } else {
        console.error('Calendar API returned error:', res.status);
        setScheduleEvents([]);
      }
    } catch (e) {
      console.error('Failed to fetch calendar:', e);
      setScheduleEvents([]);
    }
    setLoadingSchedule(false);
  }, [refreshCalendarToken]);

  // Fetch calendar on mount
  useEffect(() => {
    fetchCalendarForDate(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check for upcoming meetings every 30 seconds
  useEffect(() => {
    const checkUpcomingMeetings = () => {
      const now = new Date();
      for (const event of scheduleEvents) {
        if (event.isAllDay) continue;
        const startTime = new Date(event.startTime);
        const diffMs = startTime.getTime() - now.getTime();
        const diffMinutes = Math.ceil(diffMs / 60000);
        if (diffMinutes > 0 && diffMinutes <= 5) {
          setUpcomingMeeting({ title: event.title, minutesUntil: diffMinutes, meetingLink: event.meetingLink });
          return;
        }
      }
      setUpcomingMeeting(null);
    };

    checkUpcomingMeetings();
    const interval = setInterval(checkUpcomingMeetings, 30000);
    return () => clearInterval(interval);
  }, [scheduleEvents]);

  const navigateDate = useCallback((direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
    setSelectedDate(newDate);
    fetchCalendarForDate(newDate);
  }, [selectedDate, fetchCalendarForDate]);

  const goToToday = useCallback(() => {
    setSelectedDate(new Date());
    fetchCalendarForDate(new Date());
  }, [fetchCalendarForDate]);

  const deleteCalendarEvent = useCallback(async (eventId: string) => {
    if (!confirm('Delete this calendar event?')) return;
    try {
      const res = await fetch(`/api/calendar/delete?eventId=${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setScheduleEvents(prev => prev.filter(e => e.id !== eventId));
      } else {
        alert('Failed to delete event');
      }
    } catch (e) {
      console.error('Failed to delete event:', e);
      alert('Failed to delete event');
    }
  }, []);

  const createCalendarEvent = useCallback(async () => {
    setCreatingEvent(true);
    try {
      const startDateTime = new Date(`${eventFormData.date}T${eventFormData.startTime}:00`);
      const endDateTime = new Date(`${eventFormData.date}T${eventFormData.endTime}:00`);

      const res = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: eventFormData.title,
          description: eventFormData.description || undefined,
          location: eventFormData.location || undefined,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
        }),
      });

      if (res.ok) {
        alert('Event created successfully!');
        setShowEventModal(false);
        setEventFormData({
          title: '',
          date: new Date().toISOString().split('T')[0],
          startTime: '09:00',
          endTime: '10:00',
          location: '',
          description: '',
        });
        window.location.reload();
      } else {
        const error = await res.json();
        alert(`Failed to create event: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to create event:', error);
      alert('Failed to create event. Please try again.');
    }
    setCreatingEvent(false);
  }, [eventFormData]);

  const openEventModalFromEmail = useCallback((email: { subject: string; from_name: string | null; from_email: string; summary: string }) => {
    setEventFormData({
      title: email.subject,
      date: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '10:00',
      location: '',
      description: `From: ${email.from_name || email.from_email}\n\n${email.summary || ''}`,
    });
    setShowEventModal(true);
  }, []);

  const isDateToday = useCallback((date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }, []);

  return {
    selectedDate,
    scheduleEvents,
    loadingSchedule,
    calendarAuthError,
    upcomingMeeting,
    showEventModal, setShowEventModal,
    creatingEvent,
    eventFormData, setEventFormData,
    navigateDate,
    goToToday,
    deleteCalendarEvent,
    createCalendarEvent,
    openEventModalFromEmail,
    fetchCalendarForDate,
    refreshCalendarToken,
    isDateToday,
  };
}
