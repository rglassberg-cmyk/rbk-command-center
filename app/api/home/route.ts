import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveMembership } from '@/lib/impersonate';

// navId is the sidebar nav key used for navigation (/?nav=X)
// Some allowed_modules keys differ from the sidebar nav key (e.g., "recruiting" → nav "lever")
interface DashboardTileMeta {
  name: string;
  description: string;
  tone: string;
  navId?: string; // override the tile id for navigation; defaults to the key
}

const DASHBOARD_META: Record<string, DashboardTileMeta> = {
  admissions: {
    name: 'Admissions & Enrollment',
    description: 'Track new applications, re-enrollment, and the enrollment pipeline.',
    tone: 'blue',
  },
  absences: {
    name: 'Student Absences',
    description: 'Daily attendance, tardies, and YTD absence trends.',
    tone: 'amber',
  },
  lever: {
    name: 'Recruiting',
    description: 'Open roles, active candidates, and pipeline stages from Lever.',
    tone: 'violet',
  },
  recruiting: {
    name: 'Recruiting',
    description: 'Open roles, active candidates, and pipeline stages from Lever.',
    tone: 'violet',
    navId: 'lever', // sidebar uses "lever" as the nav key
  },
  simchas: {
    name: 'Simchas & Shivas',
    description: 'Bar/Bat Mitzvahs, shivas, and community events this week.',
    tone: 'amber',
  },
  faculty_absences: {
    name: 'Faculty Attendance',
    description: 'Staff absences and coverage tracking.',
    tone: 'teal',
  },
  development: {
    name: 'Development',
    description: 'Weekly gifts, donor intelligence, and fundraising reports.',
    tone: 'green',
  },
  projects: {
    name: 'Projects',
    description: 'Cross-departmental project board.',
    tone: 'slate',
  },
};

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check for impersonation — use impersonated identity if present
  const impersonated = await getEffectiveMembership(session);
  const currentEmail = impersonated?.email || session.user.email;
  const workspaceId = impersonated?.workspace_id || session.workspaceId;
  const memberAllowed = impersonated?.allowed_modules ?? session.allowedModules ?? null;

  try {
    // 1. Derive firstName
    let firstName: string;
    if (impersonated?.display_name) {
      firstName = impersonated.display_name.split(/\s+/)[0];
    } else {
      const { data: memberRow } = await supabaseAdmin
        .from('workspace_members')
        .select('display_name')
        .eq('email', currentEmail)
        .eq('workspace_id', workspaceId)
        .limit(1)
        .single();

      if (memberRow?.display_name) {
        firstName = memberRow.display_name.split(/\s+/)[0];
      } else {
        firstName = currentEmail.split('@')[0];
      }
    }

    // 2. Fetch projects assigned to or involving this user
    const { data: projectRows, error: projectsError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('workspace_id', workspaceId)
      .neq('status', 'archived')
      .or(`assignee_email.eq.${currentEmail},team_emails.cs.{${currentEmail}}`)
      .order('created_at', { ascending: false });

    if (projectsError) {
      console.error('Home: projects fetch error:', projectsError);
      return NextResponse.json({ error: 'Failed to load home data' }, { status: 500 });
    }

    const projects = (projectRows || []).map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description ?? null,
      department: p.department,
      priority: p.priority,
      status: p.status,
      progress: p.progress,
      assignee_email: p.assignee_email ?? null,
      team_emails: p.team_emails ?? [],
      due_date: p.due_date ?? null,
      updated_at: p.updated_at ?? null,
      tags: p.tags ?? [],
      isMine: p.assignee_email === currentEmail,
    }));

    // 3. Build dashboards from effective modules
    const effectiveModules = getEffectiveModules(
      session.modules,
      memberAllowed,
    );

    const dashboards: Array<{ id: string; name: string; description: string; tone: string }> = [];
    const addedNavIds = new Set<string>();

    for (const [key, meta] of Object.entries(DASHBOARD_META)) {
      const navId = meta.navId || key;

      // Deduplicate — e.g., "lever" and "recruiting" map to the same tile
      if (addedNavIds.has(navId)) continue;

      // Projects is always included
      if (key === 'projects') {
        dashboards.push({ id: navId, name: meta.name, description: meta.description, tone: meta.tone });
        addedNavIds.add(navId);
        continue;
      }

      // Don't show modules the workspace has explicitly disabled
      if (session.modules && session.modules[navId] === false) continue;

      let include = false;
      if (!effectiveModules) {
        // No module restrictions (owner/assistant with null modules) — include all
        include = true;
      } else if (effectiveModules[key] === true || effectiveModules[navId] === true) {
        include = true;
      } else if (memberAllowed && (memberAllowed[key] === true || memberAllowed[navId] === true)) {
        // Module explicitly allowed for this member (alias or canonical key)
        include = true;
      }

      if (include) {
        dashboards.push({ id: navId, name: meta.name, description: meta.description, tone: meta.tone });
        addedNavIds.add(navId);
      }
    }

    return NextResponse.json({ firstName, projects, dashboards });
  } catch (error) {
    console.error('Home: unexpected error:', error);
    return NextResponse.json({ error: 'Failed to load home data' }, { status: 500 });
  }
}
