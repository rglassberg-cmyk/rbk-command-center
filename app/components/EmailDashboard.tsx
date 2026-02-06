'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

interface Email {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  summary: string;
  body_text: string;
  action_needed: string | null;
  draft_reply: string | null;
  priority: string;
  status: string;
  assigned_to: string;
  received_at: string;
  is_unread: boolean;
}

interface Stats {
  priority: string;
  count: number;
  unread_count: number;
}

const priorityColors: Record<string, string> = {
  rbk_action: 'bg-red-100 text-red-800 border-red-200',
  eg_action: 'bg-blue-100 text-blue-800 border-blue-200',
  invitation: 'bg-purple-100 text-purple-800 border-purple-200',
  meeting_invite: 'bg-green-100 text-green-800 border-green-200',
  important_no_action: 'bg-orange-100 text-orange-800 border-orange-200',
  review: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  fyi: 'bg-gray-100 text-gray-800 border-gray-200',
};

const priorityLabels: Record<string, string> = {
  rbk_action: 'RBK Action',
  eg_action: 'EG Action',
  invitation: 'Invitation',
  meeting_invite: 'Meeting',
  important_no_action: 'Important',
  review: 'Review',
  fyi: 'FYI',
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-500',
};

export default function EmailDashboard({
  initialEmails,
  initialStats
}: {
  initialEmails: Email[];
  initialStats: Stats[];
}) {
  const [emails, setEmails] = useState<Email[]>(initialEmails);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterAssigned, setFilterAssigned] = useState<string>('all');
  const [updating, setUpdating] = useState<string | null>(null);

  // Filter emails
  const filteredEmails = emails.filter(email => {
    const matchesSearch = searchQuery === '' ||
      email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.summary.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPriority = filterPriority === 'all' || email.priority === filterPriority;
    const matchesStatus = filterStatus === 'all' || email.status === filterStatus;
    const matchesAssigned = filterAssigned === 'all' || email.assigned_to === filterAssigned;

    return matchesSearch && matchesPriority && matchesStatus && matchesAssigned;
  });

  // Update email status
  const updateStatus = async (emailId: string, newStatus: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, status: newStatus }),
      });

      if (res.ok) {
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, status: newStatus } : e
        ));
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
    setUpdating(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                RBK Command Center
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Email Triage Dashboard
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {initialStats.map((stat) => (
            <button
              key={stat.priority}
              onClick={() => setFilterPriority(filterPriority === stat.priority ? 'all' : stat.priority)}
              className={`bg-white rounded-lg border p-3 text-left transition-all ${
                filterPriority === stat.priority ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border mb-1 ${priorityColors[stat.priority]}`}>
                {priorityLabels[stat.priority]}
              </div>
              <p className="text-xl font-bold text-gray-900">{stat.count}</p>
              <p className="text-xs text-gray-500">{stat.unread_count} unread</p>
            </button>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="archived">Archived</option>
            </select>

            {/* Assigned Filter */}
            <select
              value={filterAssigned}
              onChange={(e) => setFilterAssigned(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="all">All Assigned</option>
              <option value="rbk">RBK</option>
              <option value="emily">Emily</option>
            </select>

            {/* Clear Filters */}
            {(filterPriority !== 'all' || filterStatus !== 'all' || filterAssigned !== 'all' || searchQuery) && (
              <button
                onClick={() => {
                  setFilterPriority('all');
                  setFilterStatus('all');
                  setFilterAssigned('all');
                  setSearchQuery('');
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Email List */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">
              Emails ({filteredEmails.length})
            </h2>
          </div>

          {filteredEmails.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500 mb-2">No emails found</p>
              <p className="text-sm text-gray-400">
                {emails.length === 0
                  ? 'Waiting for emails from Apps Script...'
                  : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredEmails.map((email) => (
                <div key={email.id} className="transition-all">
                  {/* Email Row */}
                  <div
                    onClick={() => setExpandedId(expandedId === email.id ? null : email.id)}
                    className={`px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      expandedId === email.id ? 'bg-blue-50' : ''
                    } ${email.status === 'done' || email.status === 'archived' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Header Row */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${priorityColors[email.priority]}`}>
                            {priorityLabels[email.priority]}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColors[email.status]}`}>
                            {email.status}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                          </span>
                          {email.is_unread && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                          )}
                        </div>

                        {/* From */}
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {email.from_name || email.from_email}
                        </p>

                        {/* Subject */}
                        <p className={`text-base font-semibold mb-1 ${
                          email.status === 'done' || email.status === 'archived'
                            ? 'text-gray-500 line-through'
                            : 'text-gray-900'
                        }`}>
                          {email.subject}
                        </p>

                        {/* Summary */}
                        <p className="text-sm text-gray-600">
                          {email.summary}
                        </p>
                      </div>

                      {/* Assigned To & Expand Icon */}
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                          email.assigned_to === 'rbk'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-teal-100 text-teal-800'
                        }`}>
                          {email.assigned_to === 'rbk' ? 'RBK' : 'Emily'}
                        </div>
                        <span className={`text-gray-400 transition-transform ${expandedId === email.id ? 'rotate-180' : ''}`}>
                          ▼
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedId === email.id && (
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                      {/* Action Needed */}
                      {email.action_needed && email.action_needed !== 'No action needed' && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-gray-700 mb-1">Action Needed</h4>
                          <p className="text-sm text-gray-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                            {email.action_needed}
                          </p>
                        </div>
                      )}

                      {/* Draft Reply */}
                      {email.draft_reply && email.draft_reply !== 'No reply needed' && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-gray-700 mb-1">Draft Reply</h4>
                          <div className="text-sm text-gray-800 bg-white border border-gray-200 rounded px-3 py-2 whitespace-pre-wrap">
                            {email.draft_reply}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(email.draft_reply || '');
                            }}
                            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                          >
                            Copy draft
                          </button>
                        </div>
                      )}

                      {/* Email Body Preview */}
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-1">Email Content</h4>
                        <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded px-3 py-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                          {email.body_text?.substring(0, 1000) || 'No content available'}
                          {email.body_text && email.body_text.length > 1000 && '...'}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-wrap">
                        {email.status !== 'in_progress' && email.status !== 'done' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatus(email.id, 'in_progress');
                            }}
                            disabled={updating === email.id}
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            {updating === email.id ? '...' : 'Start Working'}
                          </button>
                        )}
                        {email.status !== 'done' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatus(email.id, 'done');
                            }}
                            disabled={updating === email.id}
                            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {updating === email.id ? '...' : 'Mark Done'}
                          </button>
                        )}
                        {email.status !== 'archived' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatus(email.id, 'archived');
                            }}
                            disabled={updating === email.id}
                            className="px-3 py-1.5 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
                          >
                            {updating === email.id ? '...' : 'Archive'}
                          </button>
                        )}
                        {(email.status === 'done' || email.status === 'archived') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatus(email.id, 'pending');
                            }}
                            disabled={updating === email.id}
                            className="px-3 py-1.5 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 disabled:opacity-50"
                          >
                            {updating === email.id ? '...' : 'Reopen'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
