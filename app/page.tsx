import { supabase } from '@/lib/supabase';
import { formatDistanceToNow } from 'date-fns';

// Priority badge colors
const priorityColors = {
  rbk_action: 'bg-red-100 text-red-800 border-red-200',
  eg_action: 'bg-blue-100 text-blue-800 border-blue-200',
  invitation: 'bg-purple-100 text-purple-800 border-purple-200',
  meeting_invite: 'bg-green-100 text-green-800 border-green-200',
  important_no_action: 'bg-orange-100 text-orange-800 border-orange-200',
  review: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  fyi: 'bg-gray-100 text-gray-800 border-gray-200',
};

const priorityLabels = {
  rbk_action: 'RBK Action',
  eg_action: 'EG Action',
  invitation: 'Invitation',
  meeting_invite: 'Meeting',
  important_no_action: 'Important',
  review: 'Review',
  fyi: 'FYI',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getEmails() {
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching emails:', error);
    return [];
  }

  return data || [];
}

async function getStats() {
  const { data, error } = await supabase
    .rpc('get_email_stats', { days_back: 7 });

  if (error) {
    console.error('Error fetching stats:', error);
    return [];
  }

  return data || [];
}

export default async function Home() {
  const emails = await getEmails();
  const stats = await getStats();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            RBK Command Center
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Email Triage Dashboard
          </p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
          {stats.map((stat: any) => (
            <div key={stat.priority} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border mb-2 ${priorityColors[stat.priority as keyof typeof priorityColors]}`}>
                {priorityLabels[stat.priority as keyof typeof priorityLabels]}
              </div>
              <p className="text-2xl font-bold text-gray-900">{stat.count}</p>
              <p className="text-xs text-gray-600">{stat.unread_count} unread</p>
            </div>
          ))}
        </div>

        {/* Email List */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">
              Recent Emails ({emails.length})
            </h2>
          </div>

          {emails.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500 mb-2">No emails yet</p>
              <p className="text-sm text-gray-400">
                Waiting for the first email from Apps Script...
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {emails.map((email: any) => (
                <div
                  key={email.id}
                  className="px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Header Row */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${priorityColors[email.priority as keyof typeof priorityColors]}`}>
                          {priorityLabels[email.priority as keyof typeof priorityLabels]}
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
                      <p className="text-base font-semibold text-gray-900 mb-1">
                        {email.subject}
                      </p>

                      {/* Summary */}
                      <p className="text-sm text-gray-600 mb-2">
                        {email.summary}
                      </p>

                      {/* Action Needed */}
                      {email.action_needed && email.action_needed !== 'No action needed' && (
                        <div className="flex items-center gap-2 text-xs text-gray-700 bg-gray-100 rounded px-2 py-1 inline-block">
                          <span className="font-medium">Action:</span>
                          <span>{email.action_needed}</span>
                        </div>
                      )}
                    </div>

                    {/* Assigned To */}
                    <div className="flex-shrink-0">
                      <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                        email.assigned_to === 'rbk'
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-teal-100 text-teal-800'
                      }`}>
                        {email.assigned_to === 'rbk' ? 'RBK' : 'Emily'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Webhook Test Info */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            📡 Webhook Endpoint Ready
          </h3>
          <p className="text-sm text-blue-800 mb-2">
            Your API is ready to receive emails from Apps Script!
          </p>
          <code className="text-xs bg-blue-100 text-blue-900 px-2 py-1 rounded block">
            POST /api/webhook/email
          </code>
        </div>
      </div>
    </div>
  );
}
