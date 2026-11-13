import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'

import {

  ArrowLeft,

  CalendarDays,

  CheckCircle2,

  ChevronRight,

  CircleDollarSign,

  ClipboardList,

  Image as ImageIcon,

  Package,

  ReceiptText,

  TriangleAlert,

  Users,

} from 'lucide-react'

import AdminInventory from '../pages/AdminInventory'

import MaterialRequests from '../components/materials/MaterialRequests'

import Updates from './Updates'

import { IssueList } from "./Issues";

import '../styles/admin.css'

const inr = (value) =>

  '₹' + Number(value || 0).toLocaleString('en-IN')

const formatDate = (value) => {

  if (!value) return '—'

  try {

    const date =

      typeof value?.toDate === 'function'

        ? value.toDate()

        : new Date(value)

    if (Number.isNaN(date.getTime())) return '—'

    return date.toLocaleDateString('en-IN', {

      day: '2-digit',

      month: 'short',

      year: 'numeric',

    })

  } catch {

    return '—'

  }

}

const statusLabel = (status) => {

  switch (status) {

    case 'quoted':

      return 'Quotation'

    case 'approved':

      return 'Approved'

    case 'ongoing':

      return 'In progress'

    case 'completed':

      return 'Completed'

    case 'cancelled':

      return 'Cancelled'

    default:

      return status || 'Unknown'

  }

}

const statusClass = (status) => {

  switch (status) {

    case 'completed':

      return 'pw-status pw-status-success'

    case 'ongoing':

      return 'pw-status pw-status-progress'

    case 'approved':

      return 'pw-status pw-status-approved'

    case 'quoted':

      return 'pw-status pw-status-quoted'

    case 'cancelled':

      return 'pw-status pw-status-danger'

    default:

      return 'pw-status'

  }

}

export default function ProjectWorkspace({

  project,

  user,

  role,

  canWrite = false,

  canReadTeam = false,

  canReadPayments = false,

  onBack,

}) {

  const [activeTab, setActiveTab] = useState('overview')

  const progress = Math.max(

    0,

    Math.min(100, Number(project?.progress || 0))

  )

  const total = Number(project?.total || 0)

  const paid = Number(project?.paid || 0)

  const balance = Math.max(total - paid, 0)

  const tabs = useMemo(() => {

    const base = [

      {

        id: 'overview',

        label: 'Overview',

        icon: ClipboardList,

      },

      {

        id: 'updates',

        label: 'Daily updates',

        icon: CalendarDays,

      },

      {

        id: 'issues',

        label: 'Issues',

        icon: TriangleAlert,

      },

      {

        id: 'inventory',

        label: 'Inventory',

        icon: Package,

      },

    ]

    if (canReadPayments) {

      base.push({

        id: 'payments',

        label: 'Payments',

        icon: ReceiptText,

      })

    }

    return base

  }, [canReadPayments])

  if (!project) {

    return (

      <div className="pw-empty">

        <div className="pw-empty-card">

          <h2>Project not found</h2>

          <p>

            The project could not be loaded. Return to the project list

            and try again.

          </p>

          <button className="pw-primary-btn" onClick={onBack}>

            <ArrowLeft size={17} />

            Back to projects

          </button>

        </div>

      </div>

    )

  }

  return (

    <div className="project-workspace">

      {/* HEADER */}

      <div className="pw-header">

        <div>

          <button

            type="button"

            className="pw-back-btn"

            onClick={onBack}

          >

            <ArrowLeft size={17} />

            Projects

          </button>

          <div className="pw-title-row">

            <div>

              <div className="pw-eyebrow">PROJECT WORKSPACE</div>

              <h1>{project.name || 'Untitled project'}</h1>

              <div className="pw-meta">

                <span>{project.clientName || 'No client name'}</span>

                {project.clientPhone && (

                  <>

                    <span className="pw-dot">•</span>

                    <span>{project.clientPhone}</span>

                  </>

                )}

                <span className="pw-dot">•</span>

                <span>

                  Created {formatDate(project.createdAt)}

                </span>

              </div>

            </div>

            <span className={statusClass(project.status)}>

              {statusLabel(project.status)}

            </span>

          </div>

        </div>

      </div>

      {/* ADMIN TEAM ASSIGNMENT */}
      {canWrite && canReadTeam && ['approved', 'ongoing', 'in_progress'].includes(project.status) && (
        <AssignProjectTeam
          project={project}
          canWrite={canWrite}
          canReadTeam={canReadTeam}
        />
      )}

      {/* SUMMARY */}

      <section className="pw-summary-grid">

        <SummaryCard

          icon={CircleDollarSign}

          label="Project value"

          value={inr(total)}

        />

        <SummaryCard

          icon={CheckCircle2}

          label="Amount received"

          value={inr(paid)}

          secondary={

            total > 0

              ? `${Math.round((paid / total) * 100)}% received`

              : 'No payment recorded'

          }

        />

        <SummaryCard

          icon={ReceiptText}

          label="Balance"

          value={inr(balance)}

          secondary={

            balance > 0 ? 'Payment pending' : 'Fully received'

          }

        />

        <SummaryCard

          icon={Users}

          label="Progress"

          value={`${progress}%`}

          secondary={

            progress >= 100

              ? 'Project completed'

              : 'Work in progress'

          }

        />

      </section>

      {/* PROGRESS */}

      <section className="pw-progress-card">

        <div className="pw-progress-top">

          <div>

            <span className="pw-section-label">

              PROJECT PROGRESS

            </span>

            <h3>

              {progress === 100

                ? 'Project completed'

                : 'Current completion'}

            </h3>

          </div>

          <strong>{progress}%</strong>

        </div>

        <div className="pw-progress-track">

          <div

            className="pw-progress-fill"

            style={{ width: `${progress}%` }}

          />

        </div>

      </section>

      {/* PROJECT NAV */}

      <div className="pw-tabs">

        {tabs.map((tab) => {

          const Icon = tab.icon

          return (

            <button

              key={tab.id}

              type="button"

              className={

                activeTab === tab.id

                  ? 'pw-tab active'

                  : 'pw-tab'

              }

              onClick={() => setActiveTab(tab.id)}

            >

              <Icon size={17} />

              {tab.label}

            </button>

          )

        })}

      </div>

      {/* CONTENT */}

      <main className="pw-content">

        {activeTab === 'overview' && (

          <Overview

            project={project}

            progress={progress}

            role={role}

          />

        )}

        {activeTab === 'updates' && (

          <Updates project={project} role="admin" />

        )}

        {activeTab === 'issues' && (

          <IssueList

            project={project}

            role={role}

          />

        )}

       {activeTab === 'inventory' && (
  role === 'admin' ? (
    <AdminInventory
      role={role}
      user={user}
    />
  ) : (
    <Inventory
      project={project}
      role={role}
    />
  )
)}

        {activeTab === 'payments' && (

          <PaymentsOverview

            project={project}

            role={role}

            canReadPayments={canReadPayments}

          />

        )}

      </main>

    </div>

  )

}

/* -----------------------------------------

   SUMMARY CARD

\----------------------------------------- */

function AssignProjectTeam({ project, canWrite = false, canReadTeam = false }) {
  const [staff, setStaff] = useState([])
  const [supervisorUid, setSupervisorUid] = useState(project.supervisorUid || '')
  const [carpenterUid, setCarpenterUid] = useState(project.carpenterUid || '')
  const [endDate, setEndDate] = useState(project.endDate || '')
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let active = true

    async function loadStaff() {
      setLoadingStaff(true)
      setError('')
      try {
        const snapshot = await getDocs(collection(db, 'users'))
        const rows = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => ['supervisor', 'carpenter'].includes(
            String(item.role || '').toLowerCase()
          ))

        if (active) setStaff(rows)
      } catch (loadError) {
        console.error('Could not load staff for project assignment:', loadError)
        if (active) setError('Could not load team members. Check the users collection and Firestore read permissions.')
      } finally {
        if (active) setLoadingStaff(false)
      }
    }

    loadStaff()
    return () => { active = false }
  }, [])

  useEffect(() => {
    setSupervisorUid(project.supervisorUid || '')
    setCarpenterUid(project.carpenterUid || '')
    setEndDate(project.endDate || '')
  }, [project.id, project.supervisorUid, project.carpenterUid, project.endDate])

  const supervisors = staff.filter((item) => String(item.role || '').toLowerCase() === 'supervisor')
  const carpenters = staff.filter((item) => String(item.role || '').toLowerCase() === 'carpenter')

  const displayName = (item) =>
    item.name || item.displayName || item.fullName || item.email || item.id

  async function saveAssignment() {
    if (!canWrite || !canReadTeam) return
    setError('')
    setSuccess('')

    if (!supervisorUid || !carpenterUid || !endDate) {
      setError('Choose a supervisor, a carpenter and an expected completion date.')
      return
    }

    const supervisor = supervisors.find((item) => item.id === supervisorUid)
    const carpenter = carpenters.find((item) => item.id === carpenterUid)

    if (!supervisor || !carpenter) {
      setError('The selected team member could not be found. Refresh and select again.')
      return
    }

    setSaving(true)
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        supervisorUid,
        supervisorName: displayName(supervisor),
        carpenterUid,
        carpenterName: displayName(carpenter),
        endDate,
        status: 'in_progress',
        assignedAt: serverTimestamp(),
      })
      setSuccess('Team assigned successfully. The project is now in progress.')
    } catch (saveError) {
      console.error('Project team assignment failed:', saveError)
      setError('Could not save the assignment. Verify that you are signed in as admin and that the project update rules allow these fields.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="pw-panel pw-assignment-panel">
      <PanelHeading icon={Users} title="Assign project team" action={project.supervisorUid && project.carpenterUid ? 'Team assigned' : 'Action required'} />
      <p className="pw-muted">
        Assign staff to this approved project. Once saved, the project will appear in their assigned workspaces.
      </p>

      {loadingStaff ? (
        <p className="pw-muted">Loading supervisors and carpenters…</p>
      ) : canWrite && canReadTeam ? (
        <div className="pw-assignment-grid">
          <label className="pw-assignment-field">
            <span>Supervisor</span>
            <select value={supervisorUid} onChange={(event) => setSupervisorUid(event.target.value)}>
              <option value="">Choose supervisor</option>
              {supervisors.map((item) => (
                <option key={item.id} value={item.id}>{displayName(item)}</option>
              ))}
            </select>
            {supervisors.length === 0 && <small>No supervisor accounts found in users.</small>}
          </label>

          <label className="pw-assignment-field">
            <span>Carpenter</span>
            <select value={carpenterUid} onChange={(event) => setCarpenterUid(event.target.value)}>
              <option value="">Choose carpenter</option>
              {carpenters.map((item) => (
                <option key={item.id} value={item.id}>{displayName(item)}</option>
              ))}
            </select>
            {carpenters.length === 0 && <small>No carpenter accounts found in users.</small>}
          </label>

          <label className="pw-assignment-field">
            <span>Expected completion</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>

          <div className="pw-assignment-action">
            <button type="button" className="pw-primary-btn" onClick={saveAssignment} disabled={saving || loadingStaff || supervisors.length === 0 || carpenters.length === 0}>
              {saving ? 'Saving assignment…' : project.supervisorUid && project.carpenterUid ? 'Update assignment' : 'Assign team and start project'}
            </button>
          </div>
        </div>
      ) : (
        <p className="pw-muted">Team assignment requires write access to Projects and read access to Team.</p>
      )}

      {error && <p role="alert" className="pw-assignment-message error">{error}</p>}
      {success && <p role="status" className="pw-assignment-message success">{success}</p>}
    </section>
  )
}

function SummaryCard({

  icon: Icon,

  label,

  value,

  secondary,

}) {

  return (

    <div className="pw-summary-card">

      <div className="pw-summary-icon">

        <Icon size={19} />

      </div>

      <div>

        <span>{label}</span>

        <strong>{value}</strong>

        {secondary && (

          <small>{secondary}</small>

        )}

      </div>

    </div>

  )

}

/* -----------------------------------------

   OVERVIEW

\----------------------------------------- */

function Overview({

  project,

  progress,

  role,

}) {

  const referenceImages = [...new Set([
    ...(Array.isArray(project.refImages) ? project.refImages : []),
    ...(Array.isArray(project.referenceImages) ? project.referenceImages : []),
  ].map((image) => {
    if (typeof image === 'string') return image
    return image?.url || image?.downloadURL || image?.downloadUrl || image?.imageUrl || image?.src || ''
  }).filter((image) => typeof image === 'string' && /^https?:\/\//i.test(image)))]

  return (

    <div className="pw-overview">

      <div className="pw-two-column">

        <section className="pw-panel">

          <PanelHeading

            icon={ClipboardList}

            title="Project details"

          />

          <div className="pw-detail-grid">

            <Detail

              label="Client"

              value={project.clientName}

            />

            <Detail

              label="Client phone"

              value={project.clientPhone}

            />

            <Detail

              label="Client email"

              value={project.clientEmail}

            />

            <Detail

              label="Area"

              value={

                project.sft

                  ? `${Number(project.sft).toLocaleString(

                      'en-IN'

                    )} sq.ft`

                  : '—'

              }

            />

            <Detail

              label="Rate"

              value={

                project.rate

                  ? `${inr(project.rate)} / sq.ft`

                  : '—'

              }

            />

            <Detail

              label="Project value"

              value={inr(project.total)}

            />

            <Detail

              label="Status"

              value={statusLabel(project.status)}

            />

            <Detail

              label="Created"

              value={formatDate(project.createdAt)}

            />

          </div>

        </section>

        <section className="pw-panel">

          <PanelHeading

            icon={Users}

            title="Project team"

          />

          <div className="pw-team-list">

            <TeamRow

              label="Supervisor"

              value={

                project.supervisorName ||

                project.supervisorUid ||

                'Not assigned'

              }

            />

            <TeamRow

              label="Carpenter"

              value={

                project.carpenterName ||

                project.carpenterUid ||

                'Not assigned'

              }

            />

            <TeamRow

              label="Project status"

              value={statusLabel(project.status)}

            />

            <TeamRow

              label="Completion"

              value={`${progress}%`}

            />

          </div>

        </section>

      </div>

      <section className="pw-panel">

        <PanelHeading

          icon={ImageIcon}

          title="Reference images"

          action={

            referenceImages.length

              ? `${referenceImages.length} images`

              : null

          }

        />

        {referenceImages.length === 0 ? (

          <div className="pw-empty-inline">

            <ImageIcon size={20} />

            <div>

              <strong>No reference images</strong>

              <p>

                Reference images uploaded during project

                creation will appear here.

              </p>

            </div>

          </div>

        ) : (

          <div className="pw-image-grid">

            {referenceImages.map((image, index) => (

              <a

                key={`${image}-${index}`}

                href={image}

                target="\_blank"

                rel="noreferrer"

                className="pw-image-card"

              >

                <img

                  src={image}

                  alt={`Project reference ${index + 1}`}

                />

                <span>

                  Reference {index + 1}

                  <ChevronRight size={15} />

                </span>

              </a>

            ))}

          </div>

        )}

      </section>

      <section className="pw-panel">

        <PanelHeading

          icon={ClipboardList}

          title="Project notes"

        />

        <div className="pw-notes">

          {project.notes ||

          project.description ||

          project.requirements ? (

            project.notes ||

            project.description ||

            project.requirements

          ) : (

            <span className="pw-muted">

              No project notes have been added yet.

            </span>

          )}

        </div>

      </section>

    </div>

  )

}

/* -----------------------------------------

   INVENTORY

\----------------------------------------- */

function Inventory({

  project,

  role,

}) {

  return (

    <section className="pw-panel">

      <MaterialRequests

        project={project}

        role={role}

      />

    </section>

  )

}

function InventoryCard({ title, value }) {

  return (

    <div className="pw-inventory-card">

      <span>{title}</span>

      <strong>{value}</strong>

    </div>

  )

}

/* -----------------------------------------

   PAYMENTS

\----------------------------------------- */

function PaymentsOverview({

  project,

  role,

  canReadPayments = false,

}) {

  const total = Number(project.total || 0)

  const paid = Number(project.paid || 0)

  const balance = Math.max(total - paid, 0)

  if (!canReadPayments) {

    return null

  }

  return (

    <section className="pw-panel">

      <PanelHeading

        icon={ReceiptText}

        title="Payment overview"

      />

      <div className="pw-payment-summary">

        <PaymentBox

          label="Quotation"

          value={inr(total)}

        />

        <PaymentBox

          label="Received"

          value={inr(paid)}

        />

        <PaymentBox

          label="Balance"

          value={inr(balance)}

        />

      </div>

      <div className="pw-payment-note">

        <ReceiptText size={18} />

        <div>

          <strong>Payment records</strong>

          <p>

            {role === 'admin'

              ? 'Use the Payments section from the admin navigation to record and manage detailed payment entries.'

              : 'Your payment summary and submitted payment information will appear here.'}

          </p>

        </div>

      </div>

    </section>

  )

}

function PaymentBox({ label, value }) {

  return (

    <div className="pw-payment-box">

      <span>{label}</span>

      <strong>{value}</strong>

    </div>

  )

}

/* -----------------------------------------

   COMMON

\----------------------------------------- */

function PanelHeading({

  icon: Icon,

  title,

  action,

}) {

  return (

    <div className="pw-panel-heading">

      <div>

        <div className="pw-panel-icon">

          <Icon size={18} />

        </div>

        <h2>{title}</h2>

      </div>

      {action && (

        <span className="pw-panel-action">

          {action}

        </span>

      )}

    </div>

  )

}

function Detail({ label, value }) {

  return (

    <div className="pw-detail">

      <span>{label}</span>

      <strong>{value || '—'}</strong>

    </div>

  )

}

function TeamRow({ label, value }) {

  return (

    <div className="pw-team-row">

      <span>{label}</span>

      <strong>{value || '—'}</strong>

    </div>

  )

}
