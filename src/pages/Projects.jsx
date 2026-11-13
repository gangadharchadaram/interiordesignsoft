import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  query,
  where,
  onSnapshot,
    doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'

import {
  Plus,
  Search,
  SlidersHorizontal,
  ArrowRight,
  MoreVertical,
  FolderKanban,
  AlertCircle,
  CheckCircle2,
  Clock3,
    Eye,
  Pencil,
  Trash2,
  X,
  ExternalLink,
  Check,
  CalendarDays,
} from 'lucide-react'




import { db } from '../firebase'
import { inr } from './NewProject'
import { getProjectAssignmentField } from '../utils/permissions'


/* =========================================================
   HELPERS
========================================================= */

function getProgress(project) {
  const value =
    project?.progress ??
    project?.completion ??
    project?.completionPercent ??
    0

  return Math.max(
    0,
    Math.min(
      100,
      Number(value) || 0
    )
  )
}


function getStatus(project) {
  const raw =
    String(project?.status || '')
      .toLowerCase()
      .trim()

  const progress =
    getProgress(project)

  if (
    raw === 'completed' ||
    raw === 'complete' ||
    progress >= 100
  ) {
    return {
      label: 'Completed',
      type: 'completed',
    }
  }

  if (
    raw === 'delayed' ||
    project?.delayedDate ||
    project?.blockedReason
  ) {
    return {
      label: 'Delayed',
      type: 'delayed',
    }
  }

  if (
    raw === 'quoted'
  ) {
    return {
      label: 'Quoted',
      type: 'quoted',
    }
  }

  if (
    raw === 'approved'
  ) {
    return {
      label: 'Approved',
      type: 'approved',
    }
  }

  return {
    label: 'On track',
    type: 'active',
  }
}


function formatDate(timestamp) {
  if (!timestamp) {
    return ''
  }

  try {
    const date =
      timestamp?.toDate
        ? timestamp.toDate()
        : new Date(timestamp)

    if (Number.isNaN(date.getTime())) {
      return ''
    }

    return date.toLocaleDateString(
      'en-IN',
      {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }
    )
  } catch {
    return ''
  }
}


/* =========================================================
   PROJECTS
========================================================= */

export default function Projects({
  user,
  role,
  onNavigate,
  pendingProposals = [],
  reviewProjectId = null,
  canWrite: canWriteProp,
}) {

  const [projects, setProjects] = useState([])

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState('')

  const [search, setSearch] =
    useState('')

  const [filter, setFilter] =
    useState('all')

  const [menuOpen, setMenuOpen] =
    useState(null)

    const [viewProject, setViewProject] = useState(null)
const [editProject, setEditProject] = useState(null)
const [saving, setSaving] = useState(false)
const [actionError, setActionError] = useState('')
const [acceptingProposal, setAcceptingProposal] = useState(false)
const [proposalActionError, setProposalActionError] = useState('')
const [proposalFinalAmount, setProposalFinalAmount] = useState('')

const canWriteAccess = canWriteProp ??
  String(role || user?.role || '').toLowerCase() === 'admin'

const [editForm, setEditForm] = useState({
  name: '',
  clientName: '',
  siteAddress: '',
  sft: '',
  rate: '',
  total: '',
  status: 'quoted',
})

const getProposal = (project) => {
  return project?.proposal || project?.clientProposal || project?.proposalDetails || {}
}

const collectImageUrls = (value) => {
  const output = []
  const visit = (item) => {
    if (!item) return
    if (typeof item === 'string') {
      if (/^https?:\/\//i.test(item)) output.push(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item === 'object') {
      const directUrl = item.url || item.downloadURL || item.downloadUrl || item.imageUrl || item.imageURL || item.src || item.fullPathUrl
      if (typeof directUrl === 'string' && /^https?:\/\//i.test(directUrl)) {
        output.push(directUrl)
        return
      }
      Object.values(item).forEach(visit)
    }
  }
  visit(value)
  return [...new Set(output)]
}

const isPendingProposal = (project) => {
  const proposal = getProposal(project)
  const status = String(
    proposal.status || project.proposalStatus || project.clientProposalStatus || ''
  ).toLowerCase().replace(/[ -]+/g, '_')

  if (['accepted', 'approved', 'finalized', 'rejected', 'changes_requested'].includes(status)) {
    return false
  }

  const hasSubmissionData = Boolean(
    proposal.startDate || proposal.preferredStartDate ||
    proposal.endDate || proposal.preferredEndDate ||
    proposal.finalQuoteAmount != null || proposal.finalQuotationAmount != null ||
    proposal.quotationAmount != null || proposal.requestedTotal != null ||
    proposal.referenceImages?.length || proposal.additionalInfo
  )

  return ['pending_review', 'submitted', 'submitted_for_review', 'pending'].includes(status)
    || (!status && hasSubmissionData)
}

const handleAcceptProposal = async (project) => {
  if (!canWriteAccess || !project || acceptingProposal) return

  const proposal = getProposal(project)
  const startDate = proposal.startDate || proposal.preferredStartDate || proposal.projectStartDate || ''
  const endDate = proposal.endDate || proposal.preferredEndDate || proposal.projectEndDate || ''
  const submittedQuote = Number(
    proposal.finalQuotation ??
    proposal.finalQuote ??
    proposal.finalQuoteAmount ??
    proposal.finalQuotationAmount ??
    proposal.quotationAmount ??
    proposal.requestedTotal ??
    proposal.quoteAmount ??
    proposal.total ??
    0
  )
  const quote = Number(proposalFinalAmount !== '' ? proposalFinalAmount : submittedQuote)
  const rawReferenceImages =
    proposal.referenceImages ??
    proposal.referenceImageUrls ??
    proposal.referenceImageURLs ??
    proposal.uploadedImages ??
    proposal.images ??
    proposal.designReferences ??
    []
  const referenceImages = collectImageUrls(rawReferenceImages)
  const existingProjectImages = [...new Set([
    ...collectImageUrls(project.refImages || []),
    ...collectImageUrls(project.referenceImages || []),
  ])]
  const allProjectImages = [...new Set([...existingProjectImages, ...referenceImages])]
  const currentInstallments = Array.isArray(project.installments) ? project.installments : []
  const midpointAmount = Math.round(quote * 0.5)
  const advanceAmount = Number(currentInstallments.find((item) => item.type === 'advance' || /advance/i.test(item.label || ''))?.amount || 0)
  if (currentInstallments.length && advanceAmount + midpointAmount > quote) {
    setProposalActionError('The existing advance is too high for this final quotation. Reduce the advance or revise the quotation before approving.')
    return
  }
  const approvedInstallments = currentInstallments.map((item, index) => {
    const type = item.type || (/advance/i.test(item.label || '') ? 'advance' : /50%|work completed|middle/i.test(item.label || '') ? 'midpoint' : index === currentInstallments.length - 1 ? 'final' : '')
    const amount = type === 'advance' ? Number(item.amount || 0) : type === 'midpoint' ? midpointAmount : type === 'final' ? Math.max(0, quote - advanceAmount - midpointAmount) : Number(item.amount || 0)
    return { ...item, amount }
  })

  if (!Number.isFinite(quote) || quote <= 0) {
    setProposalActionError('Enter a valid final quotation amount greater than zero.')
    return
  }

  setAcceptingProposal(true)
  setProposalActionError('')

  try {
    const updates = {
      status: 'approved',
      'proposal.status': 'accepted',
      'proposal.reviewedAt': serverTimestamp(),
      'proposal.reviewedBy': user?.uid || '',
      'proposal.finalApprovedAmount': quote,
      // Keep the client's reference images on the project itself so they
      // remain available in project details after the proposal is accepted.
      referenceImages,
      refImages: allProjectImages,
      ...(currentInstallments.length ? { installments: approvedInstallments } : {}),
      total: quote,
      quotationTotal: quote,
      quotedAmount: quote,
      updatedAt: serverTimestamp(),
    }

    if (startDate) updates.startDate = startDate
    if (endDate) updates.endDate = endDate

    await updateDoc(doc(db, 'projects', project.id), updates)
    setViewProject((current) => current?.id === project.id
      ? {
          ...current,
          ...updates,
          status: 'approved',
          proposal: { ...proposal, status: 'accepted', finalApprovedAmount: quote },
          referenceImages,
          refImages: allProjectImages,
          ...(currentInstallments.length ? { installments: approvedInstallments } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          total: quote,
          quotationTotal: quote,
          quotedAmount: quote,
        }
      : current)
  } catch (error) {
    console.error('Accept proposal failed:', error.code, error.message)
    setProposalActionError('Could not approve this proposal. Check Firestore rules and try again.')
  } finally {
    setAcceptingProposal(false)
  }
}

const handleEdit = (project) => {
  setMenuOpen(null)
  setActionError('')
  setEditProject(project)

  setEditForm({
    name: project.name || '',
    clientName: project.clientName || '',
    siteAddress: project.siteAddress || project.address || '',
    sft: project.sft ?? '',
    rate: project.rate ?? '',
    total: project.total ?? '',
    status: project.status || 'quoted',
  })
}

const handleSaveEdit = async (event) => {
  event.preventDefault()

  if (!canWriteAccess || !editProject) return

  setSaving(true)
  setActionError('')

  try {
    await updateDoc(doc(db, 'projects', editProject.id), {
      name: editForm.name.trim(),
      clientName: editForm.clientName.trim(),
      siteAddress: editForm.siteAddress.trim(),
      sft: Number(editForm.sft || 0),
      rate: Number(editForm.rate || 0),
      total: Number(
        editForm.total ||
        Number(editForm.sft || 0) * Number(editForm.rate || 0)
      ),
      status: editForm.status,
      updatedAt: serverTimestamp(),
    })

    setEditProject(null)
  } catch (error) {
    console.error('Update project failed:', error)
    setActionError(
      'Unable to update the project. Check Firestore permissions.'
    )
  } finally {
    setSaving(false)
  }
}

const [deleteProject, setDeleteProject] = useState(null)
const [deleting, setDeleting] = useState(false)

const handleDelete = async () => {
  if (!canWriteAccess || !deleteProject || deleting) return

  setDeleting(true)
  setActionError('')

  try {
    await deleteDoc(doc(db, 'projects', deleteProject.id))

    if (viewProject?.id === deleteProject.id) {
      setViewProject(null)
    }

    setDeleteProject(null)
  } catch (error) {
    console.error('Delete project failed:', error)
    setActionError(
      'Unable to delete this project. Please check permissions and try again.'
    )
  } finally {
    setDeleting(false)
  }
}


  /* =======================================================
     FIRESTORE
  ======================================================= */

  useEffect(() => {

    setLoading(true)
    setError('')

    const projectsRef = collection(db, 'projects')
    const assignmentField = getProjectAssignmentField(user || { role })
    const projectsQuery = assignmentField && user?.uid
      ? query(projectsRef, where(assignmentField, '==', user.uid))
      : projectsRef

    const unsubscribe =
      onSnapshot(
        projectsQuery,

        (snapshot) => {

          const rows =
            snapshot.docs.map(
              (item) => ({
                id: item.id,
                ...item.data(),
              })
            )

          rows.sort(
            (a, b) => {

              const aTime =
                a.createdAt?.seconds ||
                0

              const bTime =
                b.createdAt?.seconds ||
                0

              return bTime - aTime
            }
          )

          setProjects(rows)
          setLoading(false)
        },

        (snapshotError) => {

          console.error(
            'Projects listener failed:',
            snapshotError
          )

          setError(
            'Unable to load projects. Please try again.'
          )

          setLoading(false)
        }
      )

    return () => unsubscribe()

  }, [role, user?.role, user?.uid])

  // Open the project details automatically when the admin clicks a proposal notification.
  useEffect(() => {
    if (!reviewProjectId || projects.length === 0) return
    const project = projects.find((item) => item.id === reviewProjectId)
    if (project) {
      setViewProject(project)
      setProposalActionError('')
    }
  }, [reviewProjectId, projects])

  // Prefill the editable approval amount from the client's submitted quotation.
  useEffect(() => {
    if (!viewProject) {
      setProposalFinalAmount('')
      return
    }

    const proposal = getProposal(viewProject)
    const submittedQuote =
      proposal.finalQuotation ??
      proposal.finalQuote ??
      proposal.finalQuoteAmount ??
      proposal.finalQuotationAmount ??
      proposal.quotationAmount ??
      proposal.requestedTotal ??
      proposal.quoteAmount ??
      proposal.total ??
      viewProject.total ??
      ''

    setProposalFinalAmount(submittedQuote === '' ? '' : String(submittedQuote))
  }, [viewProject?.id, viewProject?.proposal, viewProject?.clientProposal, viewProject?.clientProposalStatus])


  /* =======================================================
     FILTER
  ======================================================= */

  const filteredProjects =
    useMemo(() => {

      const cleanSearch =
        search
          .trim()
          .toLowerCase()


      return projects.filter(
        (project) => {

          const status =
            getStatus(project)

          const matchesSearch =
            !cleanSearch ||
            String(
              project.name || ''
            )
              .toLowerCase()
              .includes(cleanSearch) ||
            String(
              project.clientName || ''
            )
              .toLowerCase()
              .includes(cleanSearch)


          let matchesFilter = true


          if (
            filter === 'active'
          ) {
            matchesFilter =
              status.type ===
                'active' ||
              status.type ===
                'approved'
          }


          if (
            filter === 'delayed'
          ) {
            matchesFilter =
              status.type ===
              'delayed'
          }


          if (
            filter === 'completed'
          ) {
            matchesFilter =
              status.type ===
              'completed'
          }


          if (
            filter === 'quoted'
          ) {
            matchesFilter =
              status.type ===
              'quoted'
          }


          return (
            matchesSearch &&
            matchesFilter
          )
        }
      )

    }, [
      projects,
      search,
      filter,
    ])


  /* =======================================================
     COUNTS
  ======================================================= */

  const counts =
    useMemo(() => {

      return {
        all: projects.length,

        active:
          projects.filter(
            (project) => {

              const status =
                getStatus(project)

              return (
                status.type ===
                  'active' ||
                status.type ===
                  'approved'
              )
            }
          ).length,

        delayed:
          projects.filter(
            (project) =>
              getStatus(project)
                .type ===
              'delayed'
          ).length,

        completed:
          projects.filter(
            (project) =>
              getStatus(project)
                .type ===
              'completed'
          ).length,

        quoted:
          projects.filter(
            (project) =>
              getStatus(project)
                .type ===
              'quoted'
          ).length,
      }

    }, [projects])


  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {

    return (
      <section className="admin-page">

        <div className="projects-loading">

          <div className="projects-loading-mark">
            NE
          </div>

          <span>
            Loading projects…
          </span>

        </div>

      </section>
    )
  }


  /* =======================================================
     ERROR
  ======================================================= */

  if (error) {

    return (
      <section className="admin-page">

        <div className="admin-page-heading">

          <div>

            <span className="admin-eyebrow">
              PROJECT MANAGEMENT
            </span>

            <h1>
              Projects
            </h1>

          </div>

        </div>


        <div className="projects-error">

          <AlertCircle size={20} />

          <span>
            {error}
          </span>

        </div>

      </section>
    )
  }


  /* =======================================================
     UI
  ======================================================= */

  return (
    <section className="admin-page">

      {/* ===================================================
          HEADER
      =================================================== */}

      <div className="projects-heading">

        <div>

          <span className="admin-eyebrow">
            PROJECT MANAGEMENT
          </span>

          <h1>
            Projects
          </h1>

          <p>
            Manage your interior projects,
            progress and client activity.
          </p>
          {pendingProposals.length > 0 && (
            <button
              type="button"
              className="projects-pending-proposals"
              onClick={() => setViewProject(pendingProposals[0])}
            >
              <AlertCircle size={16} />
              {pendingProposals.length} client {pendingProposals.length === 1 ? 'proposal needs' : 'proposals need'} review
              <ArrowRight size={15} />
            </button>
          )}

        </div>


        <button
          type="button"
          className="projects-new-button"
          onClick={() =>
            onNavigate?.(
              'new-project'
            )
          }
        >
          <Plus size={18} />

          <span>
            New project
          </span>
        </button>

      </div>


      {/* ===================================================
          SEARCH + FILTER
      =================================================== */}

      <div className="projects-toolbar">

        <div className="projects-search">

          <Search
            size={18}
          />

          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="Search projects or clients..."
          />

          {search && (
            <button
              type="button"
              onClick={() =>
                setSearch('')
              }
            >
              ×
            </button>
          )}

        </div>


        <div className="projects-filter">

          <SlidersHorizontal
            size={17}
          />

          <select
            value={filter}
            onChange={(event) =>
              setFilter(
                event.target.value
              )
            }
          >
            <option value="all">
              All projects ({counts.all})
            </option>

            <option value="active">
              Active ({counts.active})
            </option>

            <option value="quoted">
              Quoted ({counts.quoted})
            </option>

            <option value="delayed">
              Delayed ({counts.delayed})
            </option>

            <option value="completed">
              Completed ({counts.completed})
            </option>
          </select>

        </div>

      </div>


      {/* ===================================================
          PROJECT LIST
      =================================================== */}

      {filteredProjects.length === 0 ? (

        <div className="projects-empty">

          <div className="projects-empty-icon">
            <FolderKanban
              size={24}
            />
          </div>

          <h2>
            {projects.length === 0
              ? 'No projects yet'
              : 'No matching projects'}
          </h2>

          <p>
            {projects.length === 0
              ? 'Create your first project to start tracking your interior work.'
              : 'Try changing your search or filter.'}
          </p>

          {projects.length === 0 && (
            <button
              type="button"
              onClick={() =>
                onNavigate?.(
                  'new-project'
                )
              }
            >
              <Plus size={17} />
              Create project
            </button>
          )}

        </div>

      ) : (

        <div className="projects-list">

          {filteredProjects.map(
            (project) => {

              const progress =
                getProgress(
                  project
                )

              const status =
                getStatus(
                  project
                )

              const paid =
                Number(
                  project.paid || 0
                )

              const total =
                Number(
                  project.total || 0
                )

              return (
                <article
                  className="project-list-card"
                  key={project.id}
                >

                  {/* ======================================
                      CARD TOP
                  ====================================== */}

                  <div className="project-card-top">

                    <button
                      type="button"
                      className="project-card-main-button"
                      onClick={() =>
                        onNavigate?.(
                          'project',
                          project
                        )
                      }
                    >

                      <div className="project-title-row">

                        <h2>
                          {project.name ||
                            'Untitled project'}
                        </h2>

                        <StatusBadge
                          status={status}
                        />
                        {isPendingProposal(project) && (
                          <span className="project-proposal-pending-badge">Proposal pending</span>
                        )}

                      </div>


                      <p className="project-client">

                        {project.clientName ||
                          'Client not assigned'}

                        {project.sft && (
                          <>
                            {' · '}
                            {Number(
                              project.sft
                            ).toLocaleString(
                              'en-IN'
                            )}{' '}
                            sqft
                          </>
                        )}

                      </p>

                    </button>


                    {/* MENU */}

                    <div className="project-menu-wrap">

                      <button
                        type="button"
                        className="project-menu-button"
                        onClick={() =>
                          setMenuOpen(
                            menuOpen ===
                              project.id
                              ? null
                              : project.id
                          )
                        }
                        aria-label="Project options"
                      >
                        <MoreVertical
                          size={19}
                        />
                      </button>


{menuOpen === project.id && (
  <div className="project-menu">
    <button
      type="button"
      onClick={() => {
        setViewProject(project)
      }}
    >
      <Eye size={15} />
      View details
    </button>

    <button
      type="button"
      onClick={() => {
        setMenuOpen(null)
        onNavigate?.('project', project)
      }}
    >
      <ExternalLink size={15} />
      Open project
    </button>



    {canWriteAccess && (
      <>
        <button
          type="button"
          onClick={() => handleEdit(project)}
        >
          <Pencil size={15} />
          Edit project
        </button>

        <button
  type="button"
  className="danger"
  onClick={() => {
    setMenuOpen(null)
    setDeleteProject(project)
  }}
>
  <Trash2 size={15} />
  Delete project
</button>
      </>
    )}
  </div>
)}

                    </div>

                  </div>


                  {/* ======================================
                      PROGRESS
                  ====================================== */}

                  <button
                    type="button"
                    className="project-progress-area"
                    onClick={() =>
                      onNavigate?.(
                        'project',
                        project
                      )
                    }
                  >

                    <div className="project-progress-track">

                      <span
                        style={{
                          width:
                            `${progress}%`,
                        }}
                      />

                    </div>


                    <div className="project-progress-info">

                      <span>
                        {progress}%
                        complete
                      </span>

                      <span>
                        {status.label}
                      </span>

                    </div>

                  </button>


                  {/* ======================================
                      FINANCIAL SUMMARY
                  ====================================== */}

                  <div className="project-financials">

                    <div>

                      <span>
                        Received
                      </span>

                      <strong>
                        {inr(paid)}
                      </strong>

                    </div>


                    <div>

                      <span>
                        Project value
                      </span>

                      <strong>
                        {inr(total)}
                      </strong>

                    </div>


                    <div>

                      <span>
                        Balance
                      </span>

                      <strong>
                        {inr(
                          Math.max(
                            total - paid,
                            0
                          )
                        )}
                      </strong>

                    </div>


                    <ArrowRight
                      size={18}
                      className="project-card-arrow"
                    />

                  </div>


                  {/* ======================================
                      FOOTER
                  ====================================== */}

                  {project.createdAt && (
                    <div className="project-card-footer">

                      <span>
                        Created{' '}
                        {formatDate(
                          project.createdAt
                        )}
                      </span>

                      {project.supervisorName && (
                        <span>
                          Supervisor:{' '}
                          {project.supervisorName}
                        </span>
                      )}

                    </div>
                  )}

                </article>
              )
            }
          )}

        </div>

      )}
   {viewProject && (
  <div
    className="projects-modal-backdrop"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        setViewProject(null)
      }
    }}
  >
    <section className="projects-modal">
      <div className="projects-modal-heading">
        <div>
          <span className="admin-eyebrow">PROJECT OVERVIEW</span>
          <h2>{viewProject.name}</h2>
          <p>{viewProject.clientName || 'No customer assigned'}</p>
        </div>

        <button
          type="button"
          className="projects-modal-close"
          onClick={() => setViewProject(null)}
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>

      {canWriteAccess && isPendingProposal(viewProject) && (() => {
        const proposal = getProposal(viewProject)
        const startDate = proposal.preferredStartDate || proposal.startDate || proposal.projectStartDate || proposal.requestedStartDate
        const endDate = proposal.preferredEndDate || proposal.endDate || proposal.projectEndDate || proposal.requestedEndDate
        const quote = proposal.finalQuotation ?? proposal.finalQuote ?? proposal.finalQuoteAmount ?? proposal.finalQuotationAmount ?? proposal.quotationAmount ?? proposal.requestedTotal ?? proposal.quoteAmount ?? proposal.total
        const information = proposal.additionalInfo ?? proposal.additionalInformation ?? proposal.notes ?? ''
        const rawImages = proposal.referenceImages ?? proposal.referenceImageUrls ?? proposal.referenceImageURLs ?? proposal.uploadedImages ?? proposal.images ?? []
        const images = collectImageUrls(rawImages)
        return (
          <section className="projects-proposal-review">
            <div className="projects-proposal-review-title">
              <div>
                <span className="admin-eyebrow">CLIENT SUBMISSION</span>
                <h3>Proposal awaiting review</h3>
              </div>
              <span className="projects-proposal-status">Pending review</span>
            </div>
            <div className="projects-proposal-details">
              <div><CalendarDays size={15} /><span>Preferred start</span><strong>{startDate || 'Not provided'}</strong></div>
              <div><CalendarDays size={15} /><span>Preferred end</span><strong>{endDate || 'Not provided'}</strong></div>
              <div><span>Final quotation</span><strong>{quote !== undefined && quote !== null && quote !== '' ? inr(Number(quote)) : 'Not provided'}</strong></div>
            </div>
            <label className="projects-final-quote-field">
              Final approved quotation amount (₹)
              <input
                type="number"
                min="1"
                step="1"
                required
                value={proposalFinalAmount}
                onChange={(event) => setProposalFinalAmount(event.target.value)}
                placeholder="Enter final approved amount"
              />
              <small>Client requested: {quote !== undefined && quote !== null && quote !== '' ? inr(Number(quote)) : 'Not provided'}. You can adjust the amount before final approval.</small>
            </label>
            <div className="projects-proposal-notes">
              <strong>Additional information</strong>
              <p>{information || 'No additional information provided.'}</p>
            </div>
            <div className="projects-proposal-images">
              <strong>Reference images ({images.length})</strong>
              {images.length > 0 ? (
                <div>{images.map((image, index) => {
                  const url = typeof image === 'string'
                    ? image
                    : image?.url || image?.downloadURL || image?.downloadUrl || image?.imageUrl || image?.src
                  return url ? (
                    <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`Client reference ${index + 1}`} loading="lazy" />
                    </a>
                  ) : null
                })}</div>
              ) : (
                <p className="projects-proposal-hint">No reference images uploaded.</p>
              )}
            </div>
            {proposalActionError && <p className="projects-form-error">{proposalActionError}</p>}
            <button type="button" className="projects-accept-proposal-button" onClick={() => handleAcceptProposal(viewProject)} disabled={acceptingProposal}>
              <Check size={16} />
              {acceptingProposal ? 'Approving proposal…' : 'Approve proposal & finalize project'}
            </button>
            <p className="projects-proposal-hint">Approving confirms the submitted dates and quotation, and marks the project as approved.</p>
          </section>
        )
      })()}

      {(() => {
        const proposal = getProposal(viewProject)
        const rawImages =
          (Array.isArray(viewProject.referenceImages) && viewProject.referenceImages.length
            ? viewProject.referenceImages
            : null) ??
          (Array.isArray(proposal.referenceImages) && proposal.referenceImages.length
            ? proposal.referenceImages
            : null) ??
          proposal.referenceImageUrls ??
          proposal.referenceImageURLs ??
          proposal.uploadedImages ??
          proposal.images ??
          proposal.designReferences ??
          []
        const images = collectImageUrls(rawImages)
        const isAccepted = ['approved', 'accepted', 'finalized'].includes(
          String(proposal.status || viewProject.status || '').toLowerCase()
        )

        if (!images.length || (!isAccepted && isPendingProposal(viewProject))) return null

        return (
          <section className="projects-approved-reference-images">
            <div className="projects-approved-reference-heading">
              <div>
                <span className="admin-eyebrow">CLIENT REFERENCES</span>
                <h3>Project reference images</h3>
              </div>
              <span>{images.length} image{images.length === 1 ? '' : 's'}</span>
            </div>
            <div className="projects-approved-reference-grid">
              {images.map((image, index) => {
                const url = typeof image === 'string'
                  ? image
                  : image?.url || image?.downloadURL || image?.downloadUrl || image?.imageUrl || image?.src
                if (!url) return null
                const label = typeof image === 'object'
                  ? image.label || image.name || image.roomName || `Reference ${index + 1}`
                  : `Reference ${index + 1}`
                return (
                  <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={label} loading="lazy" />
                    <span>{label}</span>
                  </a>
                )
              })}
            </div>
          </section>
        )
      })()}

      <div className="projects-overview-grid">
        <div>
          <span>Progress</span>
          <strong>{getProgress(viewProject)}%</strong>
        </div>

        <div>
          <span>Status</span>
          <strong>{getStatus(viewProject).label}</strong>
        </div>

        <div>
          <span>Site address</span>
          <strong>
            {viewProject.siteAddress || viewProject.address || '—'}
          </strong>
        </div>

        <div>
          <span>Total area</span>
          <strong>
            {viewProject.sft
              ? `${Number(viewProject.sft).toLocaleString('en-IN')} sqft`
              : '—'}
          </strong>
        </div>

        <div>
          <span>Rate / sqft</span>
          <strong>{inr(Number(viewProject.rate || 0))}</strong>
        </div>

        <div>
          <span>Project value</span>
          <strong>{inr(Number(viewProject.total || 0))}</strong>
        </div>

        <div>
          <span>Received</span>
          <strong>{inr(Number(viewProject.paid || 0))}</strong>
        </div>

        <div>
          <span>Balance</span>
          <strong>
            {inr(
              Math.max(
                Number(viewProject.total || 0) -
                  Number(viewProject.paid || 0),
                0
              )
            )}
          </strong>
        </div>
      </div>

      <div className="projects-modal-actions">
        {canWriteAccess && (
          <button
            type="button"
            className="projects-edit-button"
            onClick={() => handleEdit(viewProject)}
          >
            <Pencil size={16} />
            Edit
          </button>
        )}

        <button
          type="button"
          className="projects-open-button"
          onClick={() => {
            const project = viewProject
            setViewProject(null)
            onNavigate?.('project', project)
          }}
        >
          <ExternalLink size={16} />
          Open workspace
        </button>
      </div>
    </section>
  </div>
)}

{editProject && (
  <div className="projects-modal-backdrop">
    <form
      className="projects-modal projects-edit-modal"
      onSubmit={handleSaveEdit}
    >
      <div className="projects-modal-heading">
        <div>
          <span className="admin-eyebrow">PROJECT MANAGEMENT</span>
          <h2>Edit project</h2>
        </div>

        <button
          type="button"
          className="projects-modal-close"
          onClick={() => setEditProject(null)}
          disabled={saving}
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>

      <label>
        Project name *
        <input
          required
          value={editForm.name}
          onChange={(e) =>
            setEditForm({ ...editForm, name: e.target.value })
          }
        />
      </label>

      <label>
        Customer name
        <input
          value={editForm.clientName}
          onChange={(e) =>
            setEditForm({ ...editForm, clientName: e.target.value })
          }
        />
      </label>

      <label>
        Site address
        <input
          value={editForm.siteAddress}
          onChange={(e) =>
            setEditForm({ ...editForm, siteAddress: e.target.value })
          }
        />
      </label>

      <div className="projects-edit-two-col">
        <label>
          Total sqft
          <input
            type="number"
            min="0"
            value={editForm.sft}
            onChange={(e) =>
              setEditForm({ ...editForm, sft: e.target.value })
            }
          />
        </label>

        <label>
          Rate / sqft
          <input
            type="number"
            min="0"
            value={editForm.rate}
            onChange={(e) =>
              setEditForm({ ...editForm, rate: e.target.value })
            }
          />
        </label>
      </div>

      <label>
        Project amount
        <input
          type="number"
          min="0"
          value={editForm.total}
          onChange={(e) =>
            setEditForm({ ...editForm, total: e.target.value })
          }
        />
      </label>

      <label>
        Status
        <select
          value={editForm.status}
          onChange={(e) =>
            setEditForm({ ...editForm, status: e.target.value })
          }
        >
          <option value="quoted">Quoted</option>
          <option value="approved">Approved</option>
          <option value="active">Active</option>
          <option value="delayed">Delayed</option>
          <option value="completed">Completed</option>
        </select>
      </label>

      {actionError && (
        <p className="projects-form-error">{actionError}</p>
      )}

      <div className="projects-modal-actions">
        <button
          type="button"
          className="projects-edit-button"
          onClick={() => setEditProject(null)}
          disabled={saving}
        >
          Cancel
        </button>

        <button
          type="submit"
          className="projects-open-button"
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  </div>
)}

{deleteProject && (
  <div
    className="delete-modal-backdrop"
    onMouseDown={(event) => {
      if (
        event.target === event.currentTarget &&
        !deleting
      ) {
        setDeleteProject(null)
      }
    }}
  >
    <div
      className="delete-modal"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      aria-describedby="delete-modal-description"
    >
      <div className="delete-modal-icon">
        <Trash2 size={25} />
      </div>

      <h2 id="delete-modal-title">
        Delete this project?
      </h2>

      <p id="delete-modal-description">
        Are you sure you want to delete{' '}
        <strong>
          "{deleteProject.name || 'Untitled project'}"
        </strong>
        ?
      </p>

      <p className="delete-modal-warning">
        This action cannot be undone. Related payment records,
        project updates, and nested documents may remain unless
        you delete them separately.
      </p>

      {actionError && (
        <p className="delete-modal-error">
          {actionError}
        </p>
      )}

      <div className="delete-modal-actions">
        <button
          type="button"
          className="delete-cancel-btn"
          onClick={() => setDeleteProject(null)}
          disabled={deleting}
        >
          Cancel
        </button>

        <button
          type="button"
          className="delete-confirm-btn"
          onClick={handleDelete}
          disabled={deleting}
        >
          <Trash2 size={16} />
          {deleting ? 'Deleting…' : 'Delete project'}
        </button>
      </div>
    </div>
  </div>
)}

    </section>
  )
}


/* =========================================================
   STATUS BADGE
========================================================= */

function StatusBadge({
  status,
}) {

  const Icon =
    status.type === 'completed'
      ? CheckCircle2
      : status.type === 'delayed'
        ? Clock3
        : status.type === 'quoted'
          ? FolderKanban
          : CheckCircle2

  return (
    <span
      className={`project-status-badge ${status.type}`}
    >

      <Icon size={13} />

      {status.label}

    </span>
  )
}
