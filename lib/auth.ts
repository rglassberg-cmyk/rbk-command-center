import { cookies } from 'next/headers';

interface AuthSession {
  user: {
    email: string | null;
    name: string | null;
    image: string | null;
  };
  accessToken?: string;
}

const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email: string): boolean {
  return allowedEmails.includes(email.toLowerCase());
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session');

  if (!sessionCookie?.value) {
    return null;
  }

  try {
    const data = JSON.parse(sessionCookie.value);

    if (!data.user?.email) {
      return null;
    }

    return {
      user: {
        email: data.user.email,
        name: data.user.name || null,
        image: data.user.image || null,
      },
      accessToken: data.accessToken || undefined,
    };
  } catch {
    return null;
  }
}
