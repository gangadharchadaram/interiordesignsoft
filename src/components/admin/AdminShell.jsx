
import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CreditCard,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  Users,
  ShieldCheck,
  Store,
  ClipboardList,
  AlertTriangle,
  Check,
  X,
} from 'lucide-react'

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
} from 'firebase/firestore'

import { signOut } from 'firebase/auth'
import { auth, db } from '../../firebase'
import PasswordManager from '../auth/PasswordManager'

import Roles from '../../pages/Roles'
import AdminVendors from '../../pages/AdminVendors'
import AdminDashboard from '../../pages/AdminDashboard'
import Projects from '../../pages/Projects'
import NewProject from '../../pages/NewProject'
import Team from '../../pages/Team'
import AdminPayments from '../../pages/AdminPayments'
import ProjectWorkspace from '../../pages/ProjectWorkspace'
import AdminProposals from '../../pages/AdminProposals'
import { hasPermission } from '../../utils/permissions'

import '../../styles/admin.css'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'new-project', label: 'New project', icon: Plus },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'roles', label: 'Roles', icon: ShieldCheck },
  { id: 'vendors', label: 'Vendors', icon: Store },
  { id: 'proposals', label: 'Proposals', icon: ClipboardList },
]

// Admins have full access. For other roles, permissions use the shape:
// { [moduleKey]: { read: boolean, write: boolean } }. Write implies read.
function canAccessModule(user, moduleKey, action = 'read') {
  return hasPermission(user, moduleKey, action)
}

function PermissionDenied() {
  return (
    <section className="admin-permission-denied" role="alert">
      <ShieldCheck size={28} />
      <h2>Access restricted</h2>
      <p>Your assigned role does not have permission to view this section.</p>
    </section>
  )
}

const toMillis = (value) => {
  if (value?.toMillis) return value.toMillis()
  if (value?.toDate) return value.toDate().getTime()

  const parsed = value ? new Date(value).getTime() : Date.now()
  return Number.isFinite(parsed) ? parsed : Date.now()
}

const formatNotificationTime = (timestamp) =>
  new Date(timestamp).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

function mapUpdate(snapshot) {
  // One notification per project per date. This collapses duplicate update
  // documents created for the same project/day into one stable notification.
  const byProjectAndDate = new Map()

  snapshot.docs.forEach((item) => {
    const data = item.data()
    const projectId = data.projectId || item.id
    const dateKey = data.date || ''
    const stableId = `daily-update-${projectId}-${dateKey || item.id}`
    const notification = {
      id: stableId,
      source: 'updates',
      type: 'daily-update',
      title: `${data.projectName || 'Project'} update`,
      message:
        data.workCompleted ||
        data.notes ||
        'A supervisor submitted a daily update.',
      projectId: data.projectId || '',
      timestamp: toMillis(data.createdAt || data.updatedAt || data.date),
    }

    const existing = byProjectAndDate.get(stableId)
    if (!existing || notification.timestamp > existing.timestamp) {
      byProjectAndDate.set(stableId, notification)
    }
  })

  return Array.from(byProjectAndDate.values())
}

function mapIssue(snapshot) {
  return snapshot.docs.map((item) => {
    const data = item.data()
    const kindLabel = data.kind === 'blocked' ? 'Work blocked' :
      data.kind === 'complaint' ? 'Client complaint' :
      data.kind === 'material' ? 'Material request' : 'Site issue'
    const isResolved = data.status === 'resolved'

    return {
      id: `issue-${item.id}-${data.status || 'open'}`,
      source: 'issues',
      type: 'issue',
      title: `${kindLabel} ${isResolved ? 'resolved' : 'reported'} · ${data.projectName || 'Project'}`,
      message:
        [data.text, data.reason, isResolved ? data.resolution : ''].filter(Boolean).join(' · ') ||
        'A new site issue was reported.',
      projectId: data.projectId || '',
      timestamp: toMillis(isResolved
        ? data.resolvedAt || data.updatedAt || data.createdAt
        : data.createdAt || data.updatedAt),
    }
  })
}

function mapMaterialRequest(snapshot) {
  return snapshot.docs.map((item) => {
    const data = item.data()

    return {
      id: `material-${item.ref.path}-${toMillis(data.updatedAt || data.createdAt)}`,
      source: 'materialRequests',
      type: 'material-request',
      title: `${
        data.status === 'approved' || data.procurementStatus === 'approved' ? 'Material approved' :
        data.status === 'rejected' || data.procurementStatus === 'rejected' ? 'Material declined' :
        data.procurementStatus === 'ordered' ? 'Material ordered' :
        'Material requested'
      } · ${data.projectName || 'Project'}`,
      message:
        `${data.itemName || data.materialName || 'Material'}${data.quantity != null ? ` · ${data.quantity} ${data.unit || 'Nos'}` : ''}${data.notes ? ` · ${data.notes}` : ''}`,
      projectId:
        data.projectId ||
        item.ref.parent.parent?.id ||
        '',
      timestamp: toMillis(data.updatedAt || data.createdAt),
    }
  })
}

function mapProjectActivity(snapshot) {
  return snapshot.docs.flatMap((item) => {
    const data = item.data()
    const proposal = data.proposal || {}

    const proposalStatus = String(
      proposal.status || ''
    ).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')

    const hasProposal =
      proposal.finalQuotation != null ||
      proposal.finalQuoteAmount != null ||
      proposal.startDate ||
      proposal.preferredStartDate ||
      proposal.endDate ||
      proposal.preferredEndDate ||
      (Array.isArray(proposal.referenceImages) &&
        proposal.referenceImages.length > 0)

    const pendingStatuses = [
      'submitted',
      'pending_review',
      'proposal_submitted',
      'awaiting_review',
    ]

    if (!hasProposal || !pendingStatuses.includes(proposalStatus)) {
      return []
    }

return [{
  id: `proposal-${item.id}`,
  source: 'projects',
  type: 'proposal',
  title: 'Client proposal awaiting review',
  message: data.name || data.projectName || 'A client submitted a proposal.',
  projectId: item.id,
  timestamp: toMillis(proposal.submittedAt || data.updatedAt),
}]
  })
}

export default function AdminShell({ user, role }) {
  const [active, setActive] = useState(() =>
    NAV_ITEMS.find((item) =>
      canAccessModule(user, item.id, 'read') &&
      (item.id !== 'new-project' || canAccessModule(user, item.id, 'write'))
    )?.id || 'dashboard'
  )
  const [selectedProject, setSelectedProject] = useState(null)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const readStorageKey = `admin-notifications-read:${user?.uid || 'anonymous'}`
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(readStorageKey) || '[]')
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  })
  const [notificationErrors, setNotificationErrors] = useState([])

  const unreadCount = useMemo(
    () =>
      notifications.filter(
        (item) => !readNotificationIds.includes(item.id)
      ).length,
    [notifications, readNotificationIds]
  )

  useEffect(() => {
    try {
      localStorage.setItem(readStorageKey, JSON.stringify(readNotificationIds))
    } catch (error) {
      console.warn('Could not save notification read state:', error)
    }
  }, [readStorageKey, readNotificationIds])

  const navigate = (id, data = null) => {
    // Project workspace inherits the read permission for Projects.
    const permissionModule = id === 'project' ? 'projects' : id
    if (!NAV_ITEMS.some((item) => item.id === permissionModule)) return
    if (!canAccessModule(user, permissionModule, 'read')) return

    // Creating a project is a write operation, not merely a read operation.
    if (id === 'new-project' && !canAccessModule(user, 'new-project', 'write')) {
      return
    }

    if (id === 'project' || id === 'proposals') setSelectedProject(data)
    setActive(id)
    setNotificationOpen(false)

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSignOut = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Sign out failed:', error)
    }
  }

  // Diagnostic: confirm which Firebase project and user are active.
  useEffect(() => {
    let mounted = true

    const checkAdminAccess = async () => {
      const currentUser = auth.currentUser

      console.log('Firebase project:', db.app.options.projectId)
      console.log('Authenticated UID:', currentUser?.uid)

      if (!currentUser) return

      try {
        const userSnap = await getDoc(
          doc(db, 'users', currentUser.uid)
        )

        if (mounted) {
          console.log('User document exists:', userSnap.exists())
          console.log(
            'User document data:',
            userSnap.exists() ? userSnap.data() : null
          )
        }
      } catch (error) {
        console.error(
          'Admin access diagnostic failed:',
          error.code,
          error.message
        )
      }
    }

    checkAdminAccess()

    return () => {
      mounted = false
    }
  }, [])

  // Keep one current notification per stable activity ID and replace each
  // source's list on every snapshot so modified documents cannot accumulate.
  useEffect(() => {
    if (role !== 'admin') {
      setNotifications([])
      setNotificationErrors([])
      return undefined
    }

    let mounted = true
    const unsubscribers = []

    const subscribe = (key, reference, mapper) => {
      const unsubscribe = onSnapshot(
        reference,
        (snapshot) => {
          if (!mounted) return

          const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
          const incoming = mapper(snapshot).filter((item) => item.timestamp >= cutoff)

          setNotifications((previous) => {
            const otherSources = previous.filter(
              (item) => item.source !== key
            )
            const byId = new Map()

            ;[...otherSources, ...incoming].forEach((item) => {
              const existing = byId.get(item.id)
              if (!existing || item.timestamp >= existing.timestamp) {
                byId.set(item.id, item)
              }
            })

            return Array.from(byId.values())
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, 100)
          })

          setNotificationErrors((previous) =>
            previous.filter((item) => item !== key)
          )
        },
        (error) => {
          console.error(
            `${key} notification listener failed:`,
            error.code,
            error.message
          )

          if (mounted) {
            setNotificationErrors((previous) =>
              previous.includes(key) ? previous : [...previous, key]
            )
          }
        }
      )

      unsubscribers.push(unsubscribe)
    }

    subscribe('updates', collection(db, 'updates'), mapUpdate)
    subscribe('issues', collection(db, 'issues'), mapIssue)
    subscribe(
      'materialRequests',
      collectionGroup(db, 'materialRequests'),
      mapMaterialRequest
    )
    subscribe('projects', collection(db, 'projects'), mapProjectActivity)

    return () => {
      mounted = false
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [role])

  const openNotification = async (item) => {
    setReadNotificationIds((previous) =>
      previous.includes(item.id)
        ? previous
        : [...previous, item.id]
    )

    setNotificationOpen(false)

    if (item.type === 'proposal') {
      try {
        const projectSnap = await getDoc(doc(db, 'projects', item.projectId))
        navigate('proposals', projectSnap.exists()
          ? { id: projectSnap.id, ...projectSnap.data() }
          : null)
      } catch (error) {
        console.error('Could not open proposal notification:', error)
        navigate('proposals')
      }
      return
    }

    if (!item.projectId) {
      navigate(
        item.type === 'proposal' ? 'proposals' : 'projects'
      )
      return
    }

    try {
      const projectSnap = await getDoc(
        doc(db, 'projects', item.projectId)
      )

      if (projectSnap.exists()) {
        navigate('project', {
          id: projectSnap.id,
          ...projectSnap.data(),
        })
      } else {
        navigate(
          item.type === 'proposal' ? 'proposals' : 'projects'
        )
      }
    } catch (error) {
      console.error('Could not open notification project:', error)
      navigate(
        item.type === 'proposal' ? 'proposals' : 'projects'
      )
    }
  }

  const renderPage = () => {
    const permissionModule = active === 'project' ? 'projects' : active
    if (!canAccessModule(user, permissionModule, 'read')) {
      return <PermissionDenied />
    }
    if (active === 'new-project' && !canAccessModule(user, 'new-project', 'write')) {
      return <PermissionDenied />
    }

    switch (active) {
      case 'dashboard':
        return (
          <AdminDashboard
            user={user}
            role={role}
            onNavigate={navigate}
          />
        )

      case 'projects':
        return (
          <Projects
            user={user}
            role={role}
            canWrite={canAccessModule(user, 'projects', 'write')}
            onNavigate={navigate}
          />
        )

      case 'roles':
        return <Roles user={user} role={role} canWrite={canAccessModule(user, 'roles', 'write')} canReadTeam={canAccessModule(user, 'team', 'read')} />

      case 'project':
        return (
          <ProjectWorkspace
            project={selectedProject}
            user={user}
            role={role}
            canWrite={canAccessModule(user, 'projects', 'write')}
            canReadTeam={canAccessModule(user, 'team', 'read')}
            canReadPayments={canAccessModule(user, 'payments', 'read')}
            onBack={() => navigate('projects')}
          />
        )

      case 'new-project':
        return <NewProject onDone={() => navigate('projects')} />

      case 'proposals':
        return <AdminProposals user={user} role={role} canWrite={canAccessModule(user, 'proposals', 'write')} reviewProjectId={selectedProject?.id} />

      case 'vendors':
        return <AdminVendors user={user} role={role} canWrite={canAccessModule(user, 'vendors', 'write')} />

      case 'team':
        return <Team user={user} role={role} canWrite={canAccessModule(user, 'team', 'write')} />

      case 'payments':
        return <AdminPayments user={user} role={role} canWrite={canAccessModule(user, 'payments', 'write')} />

      default:
        return (
          <AdminDashboard
            user={user}
            role={role}
            onNavigate={navigate}
          />
        )
    }
  }

  return (
    <div className="admin-workspace">
      <header className="admin-header">
        <div className="admin-brand">
          <div className="admin-brand-mark">NE</div>

          <div>
            <div className="admin-brand-name">
              North East Interiors
            </div>
            <div className="admin-brand-subtitle">
              {`${String(role || 'admin').charAt(0).toUpperCase()}${String(role || 'admin').slice(1)} · Workspace`}
            </div>
          </div>
        </div>

        <div className="admin-header-actions">
          {role === 'admin' && <div className="admin-notification-wrap">
            <button
              type="button"
              className="admin-icon-btn"
              onClick={() =>
                setNotificationOpen((previous) => !previous)
              }
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
              aria-expanded={notificationOpen}
            >
              <Bell size={18} />

              {unreadCount > 0 && (
                <span className="admin-notification-dot">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notificationOpen && (
              <div className="admin-notification-panel">
                <div className="admin-notification-heading">
                  <strong>
                    Notifications
                    {unreadCount > 0 ? ` (${unreadCount})` : ''}
                  </strong>

                  <button
                    type="button"
                    onClick={() => setNotificationOpen(false)}
                    aria-label="Close notifications"
                  >
                    <X size={17} />
                  </button>
                </div>

                {notificationErrors.length > 0 && (
                  <div className="admin-notification-warning">
                    <AlertTriangle size={16} />
                    <span>
                      Some notification sources could not load.
                      Check the browser console and Firestore rules.
                    </span>
                  </div>
                )}

                {notifications.length === 0 ? (
                  <div className="admin-notification-empty">
                    <Bell size={24} />
                    <strong>
                      {notificationErrors.length
                        ? 'Notifications unavailable'
                        : "You're all caught up"}
                    </strong>
                    <p>
                      {notificationErrors.length
                        ? 'Check Firestore permissions for the notification collections.'
                        : 'New project activity will appear here.'}
                    </p>
                  </div>
                ) : (
                  <div className="admin-notification-list">
                    {notifications.slice(0, 30).map((item) => {
                      const isRead = readNotificationIds.includes(item.id)

                      return (
                        <button
                          type="button"
                          key={item.id}
                          className={`admin-notification-item ${
                            isRead ? 'read' : 'unread'
                          }`}
                          onClick={() => openNotification(item)}
                        >
                          <span className="admin-notification-icon">
                            {item.type === 'daily-update' ? (
                              <FolderKanban size={16} />
                            ) : item.type === 'material-request' ? (
                              <Package size={16} />
                            ) : item.type === 'proposal' ? (
                              <ClipboardList size={16} />
                            ) : (
                              <AlertTriangle size={16} />
                            )}
                          </span>

                          <span className="admin-notification-copy">
                            <strong>{item.title}</strong>
                            <p>{item.message}</p>
                            <small>
                              {formatNotificationTime(item.timestamp)}
                            </small>
                          </span>

                          {!isRead && (
                            <span className="admin-notification-unread-dot" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="admin-notification-footer">
                  <button
                    type="button"
                    onClick={() => navigate('projects')}
                  >
                    <FolderKanban size={15} />
                    View all projects
                  </button>

                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setReadNotificationIds((previous) => [
                          ...new Set([
                            ...previous,
                            ...notifications.map((item) => item.id),
                          ]),
                        ])
                      }
                    >
                      <Check size={15} />
                      Mark all read
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>}

          <PasswordManager />
          <button
            type="button"
            className="admin-signout-btn"
            onClick={handleSignOut}
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      <nav className="admin-nav" aria-label="Admin navigation">
        <div className="admin-nav-inner">
          {NAV_ITEMS.filter((item) =>
            canAccessModule(user, item.id, 'read') &&
            (item.id !== 'new-project' || canAccessModule(user, 'new-project', 'write'))
          ).map((item) => {
            const Icon = item.icon

            const isActive =
              active === item.id ||
              (active === 'project' && item.id === 'projects')

            return (
              <button
                key={item.id}
                type="button"
                className={
                  isActive
                    ? 'admin-nav-item active'
                    : 'admin-nav-item'
                }
                onClick={() => navigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <main className="admin-main">
        {renderPage()}
      </main>
    </div>
  )
}
