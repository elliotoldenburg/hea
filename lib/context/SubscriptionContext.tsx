import React, { createContext, useContext, ReactNode, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Subscription, SubscriptionStatus } from '@/lib/hooks/useSubscription';

type SubscriptionContextType = {
  subscription: Subscription | null;
  isLoading: boolean;
  isActive: boolean;
  error: Error | null;
  refetch: () => void;
};

const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription: null,
  isLoading: true,
  isActive: false,
  error: null,
  refetch: () => {},
});

export function useSubscriptionContext() {
  return useContext(SubscriptionContext);
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const {
    data: subscription,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['subscription'],
    queryFn: async () => {
      // Check if user is authenticated
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return null;
      }
      
      const { data, error } = await supabase
        .from('stripe_user_subscriptions')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) {
        // Don't throw error for no rows, just return null
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data;
    },
    staleTime: 5 * 60 * 1000, // Consider data stale after 5 minutes
    cacheTime: 10 * 60 * 1000, // Cache for 10 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    enabled: true
  });

  // Listen for auth state changes and refetch subscription data
  useEffect(() => {
    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_IN') {
          refetch();
        }
      }
    );

    return () => {
      authSubscription.unsubscribe();
    };
  }, [refetch]);

  const isActive = 
    subscription?.subscription_status === 'active' || 
    subscription?.subscription_status === 'trialing';

  return (
    <SubscriptionContext.Provider 
      value={{ 
        subscription, 
        isLoading, 
        isActive, 
        error: error as Error | null, 
        refetch 
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}