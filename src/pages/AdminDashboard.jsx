import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  collectionGroup,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  FolderKanban,
  LogOut,
  Plus,
  Users,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth, db } from '../firebase'
import { inr } from './NewProject'
import { getProjectAssignmentField, hasPermission } from '../utils/permissions'
import '../styles/AdminDashboard.css'

const money = (value) => {
  const amount = Number(value || 0)
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`
  return inr(amount)
}

const normalize = (value) => String(value || '').toLowerCase().trim()
const isClosed = (project) =>
  ['completed', 'complete', 'cancelled', 'closed'].includes(normalize(project.status))

function timeLabel(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : timestamp ? new Date(timestamp) : null
  if (!date || Number.isNaN(date.getTime())) return 'Recently'
  const diff = Math.max(0, Date.now() - date.getTime())
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

export default function AdminDashboard({ user, role, onNavigate }) {
  const [projects, setProjects] = useState([])
  const [payments, setPayments] = useState([])
  const [users, setUsers] = useState([])
  const [materialRequests, setMaterialRequests] = useState([])
  const [expenses, setExpenses] = useState([])
  const [activeView, setActiveView] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [loadErrors, setLoadErrors] = useState([])


useEffect(() => {
  let mounted = true
  let pending = 4
  const completedInitialLoads = new Set()
  const unsubs = []

  const finishInitialLoad = (key) => {
    if (completedInitialLoads.has(key)) return

    completedInitialLoads.add(key)
    pending -= 1

    if (mounted && pending <= 0) {
      setLoading(false)
    }
  }

  const watch = (name, setter, reference) =>
    onSnapshot(
      reference,
      (snapshot) => {
        if (!mounted) return

        setter(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        )

        setLoadErrors((old) =>
          old.filter((item) => item !== name)
        )

        finishInitialLoad(name)
      },
      (error) => {
        console.error(
          `${name} dashboard listener failed:`,
          error.code,
          error.message
        )

        if (!mounted) return

        setLoadErrors((old) =>
          old.includes(name) ? old : [...old, name]
        )

        finishInitialLoad(name)
      }
    )

  const isAdmin = role === 'admin'
  const finishWithoutRead = (key, setter) => {
    setter([])
    finishInitialLoad(key)
  }
  const projectRef = collection(db, 'projects')
  const assignmentField = getProjectAssignmentField(user || { role })
  const scopedProjectRef = !isAdmin && assignmentField
    ? query(projectRef, where(assignmentField, '==', user?.uid || ''))
    : projectRef

  if (isAdmin || hasPermission(user, 'projects', 'read')) {
    unsubs.push(watch('Projects', setProjects, scopedProjectRef))
  } else finishWithoutRead('Projects', setProjects)

  if (isAdmin || hasPermission(user, 'payments', 'read')) {
    unsubs.push(watch('Payments', setPayments, collection(db, 'payments')))
  } else finishWithoutRead('Payments', setPayments)

  if (isAdmin || hasPermission(user, 'team', 'read')) {
    unsubs.push(watch('Users', setUsers, collection(db, 'users')))
  } else finishWithoutRead('Users', setUsers)

  if (isAdmin) {
    const materialRequestRef = collectionGroup(db, 'materialRequests')
    unsubs.push(
      onSnapshot(
      materialRequestRef,
      (snapshot) => {
        if (!mounted) return

        setMaterialRequests(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        )

        setLoadErrors((old) =>
          old.filter((item) => item !== 'Material requests')
        )

        finishInitialLoad('Material requests')
      },
      (error) => {
        console.error(
          'Material requests dashboard listener failed:',
          error.code,
          error.message
        )

        if (!mounted) return

        setLoadErrors((old) =>
          old.includes('Material requests')
            ? old
            : [...old, 'Material requests']
        )

        finishInitialLoad('Material requests')
      }
      )
    )
  } else finishWithoutRead('Material requests', setMaterialRequests)

  return () => {
    mounted = false
    unsubs.forEach((unsubscribe) => unsubscribe())
  }
}, [role, user, user?.uid])


  const stats = useMemo(() => {
    const totalValue = projects.reduce((sum, p) => sum + Number(p.total || p.quotationTotal || p.quotedAmount || 0), 0)
    const received = projects.reduce((sum, p) => sum + Number(p.paid || p.amountPaid || 0), 0)
    const inventorySpent = materialRequests
  .filter((request) =>
    ['approved', 'purchased', 'received', 'paid'].includes(
      normalize(request.status)
    )
  )
  .reduce(
    (sum, request) =>
      sum + Number(
        request.actualCost ||
        request.amount ||
        request.total ||
        0
      ),
    0
  )
    const explicitSpent = projects.reduce((sum, p) => sum + Number(p.actualSpend || p.spent || 0), 0)
    const spent = inventorySpent || explicitSpent
    const profit = projects.reduce((sum, p) => sum + Number(p.profit || 0), 0)
    const loss = projects.reduce((sum, p) => sum + Number(p.loss || 0), 0)
    return {
      totalProjects: projects.length,
      ongoingProjects: projects.filter((p) => !isClosed(p)).length,
      inventorySpent: spent,
      pendingRequests: materialRequests.filter((r) => ['pending', 'requested', 'submitted', 'awaiting review'].includes(normalize(r.status))).length,
      profit,
      loss,
      totalEmployees: users.filter((u) => ['supervisor', 'carpenter'].includes(normalize(u.role))).length,
      totalValue,
      received,
    }
  }, [projects, materialRequests, users])

  const displayName = user?.displayName || user?.name || user?.email?.split('@')[0] || 'Admin'
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'

  const cards = [
    { key: 'total', label: 'Total projects', value: stats.totalProjects, tone: '', icon: FolderKanban },
    { key: 'ongoing', label: 'Ongoing projects', value: stats.ongoingProjects, tone: 'mint', icon: BriefcaseBusiness },
    { key: 'spent', label: 'Inventory spent', value: money(stats.inventorySpent), tone: '', icon: CircleDollarSign },
    { key: 'requests', label: 'Inventory requests', value: `${stats.pendingRequests} pending`, tone: 'peach', icon: Boxes },
    { key: 'profit', label: 'Profit', value: money(stats.profit), tone: 'mint', icon: CircleDollarSign },
    { key: 'loss', label: 'Loss', value: money(stats.loss), tone: 'peach', icon: CircleDollarSign },
    { key: 'employees', label: 'Total employees', value: stats.totalEmployees, tone: '', icon: Users },
  ]

  const titleForView = {
    total: 'Total projects',
    ongoing: 'Ongoing projects',
    spent: 'Inventory spend',
    requests: 'Inventory requests',
    profit: 'Profit',
    loss: 'Loss',
    employees: 'Employees',
  }

  const viewRows = useMemo(() => {
    if (activeView === 'employees') return users.filter((u) => ['supervisor', 'carpenter'].includes(normalize(u.role)))
    if (activeView === 'requests') return materialRequests
if (activeView === 'spent') {
  return materialRequests.filter((request) =>
    Number(
      request.actualCost ||
      request.amount ||
      request.total ||
      0
    ) > 0
  )
}    if (activeView === 'profit' || activeView === 'loss') return projects.filter((p) => Number(p[activeView] || 0) > 0)
    if (activeView === 'ongoing') return projects.filter((p) => !isClosed(p))
    return projects
  }, [activeView, users, materialRequests, expenses, projects])

  const goTo = (key) => {
    if (key === 'new-project') {
      onNavigate?.('new-project')
      return
    }
    setActiveView(key)
  }

  const handleSignOut = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Admin sign out failed:', error)
    }
  }

  if (loading) {
    return <section className="admin-page"><div className="dwello-loading"><span className="dwello-mark">N</span><p>Loading your dashboard…</p></div></section>
  }

  return (
    <section className="admin-page dwello-dashboard">




      {loadErrors.length > 0 && (
        <div className="dwello-data-warning">
          Some dashboard data could not be loaded: {loadErrors.join(', ')}. Check Firestore permissions and collection names.
        </div>
      )}

      {activeView === 'dashboard' ? (
        <>

          <div className="dwello-stats-grid">
            {cards.map(({ key, label, value, tone, icon: Icon }) => (
              <button type="button" key={key} className={`dwello-stat-card ${tone}`} onClick={() => goTo(key)}>
                <span>{label}</span>
                <strong>{value}</strong>
              </button>
            ))}
          </div>
          <p className="dwello-hint">Tap any card to open its list</p>
        </>
      ) : (
        <>
          <div className="dwello-list-heading">
            <button type="button" className="dwello-back" onClick={() => setActiveView('dashboard')} aria-label="Back to dashboard"><ArrowLeft size={25} /></button>
            <h1>{titleForView[activeView] || activeView}</h1>
          </div>
          {activeView === 'projects' || activeView === 'team' || activeView === 'payments' ? (
            <div className="dwello-list-panel"><p>Open this section from the main navigation.</p></div>
          ) : (
            <div className="dwello-list-panel">
              {activeView === 'total' || activeView === 'ongoing' ? (
                <>
                  <div className="dwello-table-row dwello-table-head"><span>Project</span><span>%</span><span>Recd</span><span>Spent</span></div>
                  {viewRows.length === 0 ? <p className="dwello-empty">No projects found.</p> : viewRows.map((p) => (
                    <button type="button" className="dwello-table-row dwello-project-row" key={p.id} onClick={() => onNavigate?.('projects')}>
                      <strong>{p.name || p.clientName || 'Untitled project'}</strong>
                      <span>{Math.max(0, Math.min(100, Number(p.progress || 0)))}%</span>
                      <span>{money(p.paid || p.amountPaid || 0)}</span>
                      <span>{money(p.actualSpend || p.spent || 0)}</span>
                    </button>
                  ))}
                </>
              ) : activeView === 'employees' ? (
                viewRows.length === 0 ? <p className="dwello-empty">No employees found.</p> : viewRows.map((employee) => (
                  <div className="dwello-person-row" key={employee.id}>
                    <span className="dwello-avatar">{(employee.name || employee.displayName || employee.email || 'U').slice(0, 2).toUpperCase()}</span>
                    <div><strong>{employee.name || employee.displayName || employee.email || 'Unnamed employee'}</strong><small>{employee.role || 'Team member'}</small></div>
                    <span className="dwello-role-pill">{employee.role || 'Staff'}</span>
                  </div>
                ))
              ) : activeView === 'requests' ? (
                viewRows.length === 0 ? <p className="dwello-empty">No inventory requests found.</p> : viewRows.map((r) => (
                  <div className="dwello-request-row" key={r.id}>
                    <div><strong>{r.materialName || r.material || r.name || 'Material request'}{r.quantity ? ` · ${r.quantity}` : ''}</strong><small>{r.projectName || r.projectTitle || 'Project'} · {r.requestedByName || r.createdByName || 'Team member'} · {timeLabel(r.createdAt)}</small></div>
                    <span className={`dwello-status-pill ${normalize(r.priority) === 'urgent' ? 'urgent' : ''}`}>{r.priority || r.status || 'Normal'}</span>
                  </div>
                ))
              ) : activeView === 'spent' ? (
                viewRows.length === 0 ? <p className="dwello-empty">No inventory spend records found.</p> : viewRows.map((e) => (
                  <div className="dwello-table-row dwello-spend-row" key={e.id}><strong>{e.projectName || e.projectTitle || 'Project'}</strong><span>{e.vendorName || e.vendor || e.description || 'Vendor'}</span><span>{money(e.amount || e.total || e.spent || 0)}</span></div>
                ))
              ) : (
                viewRows.length === 0 ? <p className="dwello-empty">No {activeView} records found. Add `profit` or `loss` amounts to project documents to show these totals.</p> : viewRows.map((p) => (
                  <div className="dwello-table-row dwello-spend-row" key={p.id}><strong>{p.name || p.clientName || 'Project'}</strong><span>{p.status || 'Active'}</span><span>{money(p[activeView] || 0)}</span></div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
