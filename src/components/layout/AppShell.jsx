import { useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Plus,
  UsersRound,
  WalletCards,
  Package,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react'
import './AppShell.css'

const ADMIN_NAV = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    key: 'projects',
    label: 'Projects',
    icon: FolderKanban,
  },
  {
    key: 'new-project',
    label: 'New project',
    icon: Plus,
  },
  {
    key: 'team',
    label: 'Team',
    icon: UsersRound,
  },
  {
    key: 'payments',
    label: 'Payments',
    icon: WalletCards,
  },
  {
    key: 'materials',
    label: 'Materials',
    icon: Package,
  },
]

const SUPERVISOR_NAV = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    key: 'projects',
    label: 'My projects',
    icon: FolderKanban,
  },
  {
    key: 'daily-update',
    label: 'Daily update',
    icon: Plus,
  },
  {
    key: 'materials',
    label: 'Materials',
    icon: Package,
  },
  {
    key: 'issues',
    label: 'Issues',
    icon: WalletCards,
  },
]

const CARPENTER_NAV = [
  {
    key: 'work',
    label: "Today's work",
    icon: LayoutDashboard,
  },
  {
    key: 'projects',
    label: 'My projects',
    icon: FolderKanban,
  },
  {
    key: 'materials',
    label: 'Materials',
    icon: Package,
  },
]

const CLIENT_NAV = [
  {
    key: 'home',
    label: 'My project',
    icon: LayoutDashboard,
  },
  {
    key: 'updates',
    label: 'Updates',
    icon: FolderKanban,
  },
  {
    key: 'payments',
    label: 'Payments',
    icon: WalletCards,
  },
]

function getNavigation(role) {
  switch (role) {
    case 'supervisor':
      return SUPERVISOR_NAV

    case 'carpenter':
      return CARPENTER_NAV

    case 'client':
      return CLIENT_NAV

    default:
      return ADMIN_NAV
  }
}

function getRoleLabel(role) {
  switch (role) {
    case 'supervisor':
      return 'Supervisor'

    case 'carpenter':
      return 'Carpenter'

    case 'client':
      return 'Client'

    default:
      return 'Admin'
  }
}

export default function AppShell({
  role = 'admin',
  userName = '',
  active = 'dashboard',
  onNavigate,
  onSignOut,
  children,
  title,
  subtitle,
  backAction,
  rightAction,
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const navigation = getNavigation(role)
  const roleLabel = getRoleLabel(role)

  const navigate = (key) => {
    setMobileOpen(false)

    if (typeof onNavigate === 'function') {
      onNavigate(key)
    }
  }

  return (
    <div className="nes-app">
      <header className="nes-header">
        <div className="nes-header-inner">

          {/* Brand */}
          <div className="nes-brand">
            <div className="nes-logo">
              NE
            </div>

            <div className="nes-brand-copy">
              <div className="nes-brand-name">
                North East Interiors
              </div>

              <div className="nes-brand-meta">
                {roleLabel}
                <span>·</span>
                Workspace
              </div>
            </div>
          </div>

          {/* Desktop sign out */}
          <button
            type="button"
            className="nes-signout nes-signout-desktop"
            onClick={onSignOut}
          >
            <LogOut size={17} />
            <span>Sign out</span>
          </button>

          {/* Mobile menu */}
          <button
            type="button"
            className="nes-mobile-menu"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label="Open navigation"
          >
            {mobileOpen ? (
              <X size={21} />
            ) : (
              <Menu size={21} />
            )}
          </button>
        </div>

        {/* Navigation */}
        <div
          className={`nes-navigation-wrap ${
            mobileOpen ? 'nes-navigation-open' : ''
          }`}
        >
          <nav className="nes-navigation">

            {navigation.map((item) => {
              const Icon = item.icon
              const isActive = active === item.key

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`nes-nav-item ${
                    isActive ? 'nes-nav-active' : ''
                  }`}
                  onClick={() => navigate(item.key)}
                >
                  <Icon size={18} strokeWidth={2} />
                  <span>{item.label}</span>
                </button>
              )
            })}

            {/* Mobile sign out */}
            <button
              type="button"
              className="nes-mobile-signout"
              onClick={onSignOut}
            >
              <LogOut size={18} />
              <span>Sign out</span>
            </button>

          </nav>
        </div>
      </header>

      <main className="nes-main">

        {(title || subtitle || backAction || rightAction) && (
          <div className="nes-page-heading">

            <div className="nes-heading-left">

              {backAction && (
                <button
                  type="button"
                  className="nes-back-button"
                  onClick={backAction}
                >
                  ←
                </button>
              )}

              <div>
                {title && (
                  <h1 className="nes-page-title">
                    {title}
                  </h1>
                )}

                {subtitle && (
                  <p className="nes-page-subtitle">
                    {subtitle}
                  </p>
                )}
              </div>

            </div>

            {rightAction && (
              <div className="nes-heading-action">
                {rightAction}
              </div>
            )}

          </div>
        )}

        <div className="nes-page-content">
          {children}
        </div>

      </main>
    </div>
  )
}