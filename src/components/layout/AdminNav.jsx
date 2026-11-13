import {
  LayoutDashboard,
  FolderKanban,
  Plus,
  Users,
  WalletCards,
  Package
} from 'lucide-react'


const items = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: FolderKanban
  },
  {
    id: 'new',
    label: 'New project',
    icon: Plus
  },
  {
    id: 'team',
    label: 'Team',
    icon: Users
  },
  {
    id: 'payments',
    label: 'Payments',
    icon: WalletCards
  },
  {
    id: 'materials',
    label: 'Materials',
    icon: Package
  }
]


export default function AdminNav({
  page,
  setPage
}) {

  return (
    <nav className="admin-nav">

      {items.map((item) => {

        const Icon = item.icon

        const active =
          page === item.id

        return (
          <button
            key={item.id}
            type="button"
            className={
              active
                ? 'admin-nav-item active'
                : 'admin-nav-item'
            }
            onClick={() => setPage(item.id)}
          >

            <Icon
              size={17}
              strokeWidth={1.9}
            />

            <span>
              {item.label}
            </span>

          </button>
        )
      })}

    </nav>
  )
}