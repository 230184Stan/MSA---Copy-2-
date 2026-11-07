import type { Role } from '@/lib/types';

interface AllowedRolesProps {
  roles: Role[];
  role: Role | null;
}

/**
 * Returns true if the given role is permitted by the allowed-roles list.
 * 'admin' is always allowed through any protected route.
 */
export function hasAccess({ roles, role }: AllowedRolesProps): boolean {
  if (role === 'admin') return true;
  if (role === null) return false;
  return roles.includes(role);
}
