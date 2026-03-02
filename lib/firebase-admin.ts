// Verify Firebase ID tokens via REST API (no firebase-admin dependency)
// This avoids Turbopack bundling issues with firebase-admin on Firebase Hosting

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

interface FirebaseUser {
  localId: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
}

export async function verifyIdToken(idToken: string): Promise<FirebaseUser> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message || 'Invalid token');
  }

  const data = await res.json();
  const user = data.users?.[0];

  if (!user) {
    throw new Error('No user found for token');
  }

  return user;
}
