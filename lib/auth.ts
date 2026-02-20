import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    accessToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
  }
}

// Get allowed emails from environment variable
const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Check if user's email is in the allowed list
      const email = user.email?.toLowerCase();
      if (!email) return false;

      // If no allowed emails configured, deny all
      if (allowedEmails.length === 0) {
        console.error('No ALLOWED_EMAILS configured');
        return false;
      }

      return allowedEmails.includes(email);
    },
    async jwt({ token, account }) {
      // Initial sign in - save tokens
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : undefined,
        };
      }

      // Return token if not expired (with 5 min buffer)
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires - 5 * 60 * 1000) {
        return token;
      }

      // Token expired - try to refresh
      if (token.refreshToken) {
        try {
          const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID!,
              client_secret: process.env.GOOGLE_CLIENT_SECRET!,
              grant_type: 'refresh_token',
              refresh_token: token.refreshToken as string,
            }),
          });

          const refreshedTokens = await response.json();

          if (!response.ok) {
            console.error('Failed to refresh token:', refreshedTokens);
            return { ...token, error: 'RefreshTokenError' };
          }

          return {
            ...token,
            accessToken: refreshedTokens.access_token,
            accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
            // Keep the old refresh token if a new one wasn't provided
            refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
          };
        } catch (error) {
          console.error('Error refreshing token:', error);
          return { ...token, error: 'RefreshTokenError' };
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Add user info and access token to session
      if (session.user) {
        session.user.id = token.sub;
      }
      session.accessToken = token.accessToken;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
