export const MODULES = [
  'dashboard',
  'projects',
  'new-project',
  'team',
  'payments',
  'roles',
  'vendors',
  'proposals',
]

export function hasPermission(user, moduleKey, action = 'read') {
  // The admin always has full access.
  if (user?.role === 'admin') return true

  const permission = user?.permissions?.[moduleKey]

  // Support the older boolean permission format as well.
  if (typeof permission === 'boolean') {
    return permission && (action === 'read' || action === 'write')
  }

  if (!permission || typeof permission !== 'object') {
    return false
  }

  // Write permission requires Read permission too.
  if (action === 'write') {
    return permission.read === true && permission.write === true
  }

  return permission.read === true
}

export const canRead = (user, moduleKey) => hasPermission(user, moduleKey, 'read')
export const canWrite = (user, moduleKey) => hasPermission(user, moduleKey, 'write')

// A custom-role account uses the module workspace when it has at least one
// configured module grant. The base role still determines record ownership,
// but does not decide which modules appear in the workspace.
export function hasAnyModulePermission(user) {
  return MODULES.some((moduleKey) => canRead(user, moduleKey))
}

// Keep project visibility tied to assignment, independently of module grants.
// Users with no assignment field use the caller's broader workspace query.
export function getProjectAssignmentField(user) {
  const role = user?.role
  if (role === 'carpenter') return 'carpenterUid'
  if (role === 'supervisor') return 'supervisorUid'
  if (role === 'client') return 'clientUid'
  return null
}
