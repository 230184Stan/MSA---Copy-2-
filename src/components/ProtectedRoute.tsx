import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { hasAccess } from '@/lib/permissions';
import { Loader2 } from 'lucide-react';

interface Props {
  children: ReactNode;
  roles: Role[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-pitch-600" aria-hidden />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/signin" replace />;
  }

  if (!hasAccess({ roles, role: profile?.role ?? null })) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
