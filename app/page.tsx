import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import EmailDashboard from './components/EmailDashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getEmails() {
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(100);

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
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  const emails = await getEmails();
  const stats = await getStats();

  return <EmailDashboard initialEmails={emails} initialStats={stats} />;
}
