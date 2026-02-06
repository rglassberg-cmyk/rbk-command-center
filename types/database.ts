export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      emails: {
        Row: {
          id: string
          thread_id: string
          message_id: string
          from_email: string
          from_name: string | null
          to_email: string
          subject: string
          body_text: string
          body_html: string | null
          priority: 'rbk_action' | 'eg_action' | 'invitation' | 'meeting_invite' | 'important_no_action' | 'review' | 'fyi'
          category: string
          summary: string
          action_needed: string | null
          draft_reply: string | null
          assigned_to: 'rbk' | 'emily'
          status: 'pending' | 'in_progress' | 'done' | 'archived'
          labels: string[]
          attachments: Json | null
          is_starred: boolean
          is_unread: boolean
          received_at: string
          processed_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          thread_id: string
          message_id: string
          from_email: string
          from_name?: string | null
          to_email: string
          subject: string
          body_text: string
          body_html?: string | null
          priority: 'rbk_action' | 'eg_action' | 'invitation' | 'meeting_invite' | 'important_no_action' | 'review' | 'fyi'
          category: string
          summary: string
          action_needed?: string | null
          draft_reply?: string | null
          assigned_to: 'rbk' | 'emily'
          status?: 'pending' | 'in_progress' | 'done' | 'archived'
          labels?: string[]
          attachments?: Json | null
          is_starred?: boolean
          is_unread?: boolean
          received_at: string
          processed_at: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          thread_id?: string
          message_id?: string
          from_email?: string
          from_name?: string | null
          to_email?: string
          subject?: string
          body_text?: string
          body_html?: string | null
          priority?: 'rbk_action' | 'eg_action' | 'invitation' | 'meeting_invite' | 'important_no_action' | 'review' | 'fyi'
          category?: string
          summary?: string
          action_needed?: string | null
          draft_reply?: string | null
          assigned_to?: 'rbk' | 'emily'
          status?: 'pending' | 'in_progress' | 'done' | 'archived'
          labels?: string[]
          attachments?: Json | null
          is_starred?: boolean
          is_unread?: boolean
          received_at?: string
          processed_at?: string
          created_at?: string
          updated_at?: string
        }
      }
      tasks: {
        Row: {
          id: string
          email_id: string | null
          title: string
          description: string | null
          priority: 'urgent' | 'high' | 'medium' | 'low'
          status: 'todo' | 'in_progress' | 'done' | 'archived'
          assigned_to: 'rbk' | 'emily'
          due_date: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email_id?: string | null
          title: string
          description?: string | null
          priority?: 'urgent' | 'high' | 'medium' | 'low'
          status?: 'todo' | 'in_progress' | 'done' | 'archived'
          assigned_to: 'rbk' | 'emily'
          due_date?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email_id?: string | null
          title?: string
          description?: string | null
          priority?: 'urgent' | 'high' | 'medium' | 'low'
          status?: 'todo' | 'in_progress' | 'done' | 'archived'
          assigned_to?: 'rbk' | 'emily'
          due_date?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      calendar_events: {
        Row: {
          id: string
          event_id: string
          summary: string
          description: string | null
          location: string | null
          start_time: string
          end_time: string
          is_all_day: boolean
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          summary: string
          description?: string | null
          location?: string | null
          start_time: string
          end_time: string
          is_all_day?: boolean
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          summary?: string
          description?: string | null
          location?: string | null
          start_time?: string
          end_time?: string
          is_all_day?: boolean
          status?: string
          created_at?: string
          updated_at?: string
        }
      }
      daily_briefing: {
        Row: {
          id: string
          date: string
          urgent_count: number
          action_items: Json
          meetings_today: Json
          top_priorities: string[]
          ai_insights: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          date: string
          urgent_count?: number
          action_items?: Json
          meetings_today?: Json
          top_priorities?: string[]
          ai_insights?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          date?: string
          urgent_count?: number
          action_items?: Json
          meetings_today?: Json
          top_priorities?: string[]
          ai_insights?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
