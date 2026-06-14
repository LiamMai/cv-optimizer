'use client';

import { useAuth } from '@/hooks/useAuth';

export function AuthInitializer() {
  useAuth();
  return null;
}
