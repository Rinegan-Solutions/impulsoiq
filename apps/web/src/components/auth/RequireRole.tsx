import { Navigate, Outlet } from 'react-router-dom';
import { roleOf, useAuth, type Role } from '@/lib/auth/useAuth';

export function RequireRole({ allow }: { allow: Role[] }) {
  const { user } = useAuth();
  const role = user ? roleOf(user) : null;
  if (!role || !allow.includes(role)) {
    return <Navigate to="/home" replace />;
  }
  return <Outlet />;
}
