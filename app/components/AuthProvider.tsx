'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase-client';

interface AuthContextType {
  user: User | null;
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  signOut: async () => {},
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Refresh the __session cookie with a fresh ID token
  const refreshSession = useCallback(async (currentUser: User) => {
    try {
      const idToken = await currentUser.getIdToken(true);
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
    } catch (error) {
      console.error('Failed to refresh session:', error);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Periodically refresh ID token → re-set __session cookie (every 10 min)
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      refreshSession(user);
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, refreshSession]);

  const handleSignOut = useCallback(async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    await firebaseSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ user, signOut: handleSignOut, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
