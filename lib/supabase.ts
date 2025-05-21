import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Create storage adapter based on platform
const createStorageAdapter = () => {
  if (Platform.OS === 'web') {
    return {
      getItem: async (key: string) => {
        try {
          const value = localStorage.getItem(key);
          return value;
        } catch (error) {
          console.error('Error reading from localStorage:', error);
          return null;
        }
      },
      setItem: async (key: string, value: string) => {
        try {
          localStorage.setItem(key, value);
          return null;
        } catch (error) {
          console.error('Error writing to localStorage:', error);
          return null;
        }
      },
      removeItem: async (key: string) => {
        try {
          localStorage.removeItem(key);
          return null;
        } catch (error) {
          console.error('Error removing from localStorage:', error);
          return null;
        }
      },
    };
  }

  return AsyncStorage;
};

// Initialize WebBrowser for mobile platforms
if (Platform.OS !== 'web') {
  WebBrowser.maybeCompleteAuthSession();
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: Platform.OS === 'web',
    storage: createStorageAdapter(),
    flowType: 'pkce',
    // Add Google OAuth provider
    redirectTo: 
      Platform.OS === 'web' 
        ? window.location.origin 
        : `${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/callback`,
  },
  debug: false, // Root-level: disables GoTrueClient debug logs
  logger: {     // Suppress all log levels
    log: () => {},
    warn: () => {},
    error: () => {},
  },
  realtime: {
    params: { enableLogging: false } // Disables Realtime debug logs
  }
});

// Add session recovery helper
export const recoverSession = async () => {
  try {
    // First try to get the current session without throwing errors
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Session retrieval error:', sessionError.message);
      return null;
    }

    // If we don't have a session at all, return null immediately
    if (!session) {
      return null;
    }

    // If we have a valid session with refresh token, try to refresh it
    if (session?.refresh_token) {
      try {
        // Only try to refresh if we have a valid session
        const { data: { session: refreshedSession }, error: refreshError } = 
          await supabase.auth.refreshSession();

        if (refreshError) {
          console.error('Session refresh error:', refreshError.message);
          // If refresh fails, try to sign out to clear invalid session
          await supabase.auth.signOut({ scope: 'local' });
          return null;
        }

        return refreshedSession;
      } catch (err) {
        console.error('Session refresh failed:', err);
        // If refresh fails, try to sign out to clear invalid session
        await supabase.auth.signOut({ scope: 'local' });
        return null;
      }
    }

    // If we have a session but no refresh token, try to sign out and return null
    await supabase.auth.signOut({ scope: 'local' });
    return null;
  } catch (err) {
    console.error('Session recovery failed:', err);
    // Clear any invalid session data
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (clearErr) {
      console.error('Failed to clear invalid session:', clearErr);
    }
    return null;
  }
};

// Google sign in function
export const signInWithGoogle = async () => {
  try {
    if (Platform.OS === 'web') {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      
      if (error) throw error;
      return data;
    } else {
      // For mobile platforms
      const redirectUrl = AuthSession.makeRedirectUri({ path: 'auth/callback' });
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
        },
      });
      
      if (error) throw error;
      
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUrl
        );
        
        if (result.type === 'success') {
          const { url } = result;
          if (url) {
            // Extract the code from the URL
            const params = new URLSearchParams(url.split('#')[0].split('?')[1]);
            const code = params.get('code');
            
            if (code) {
              // Exchange the code for a session
              const { data, error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) throw error;
              return data;
            }
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error signing in with Google:', error);
    throw error;
  }
};