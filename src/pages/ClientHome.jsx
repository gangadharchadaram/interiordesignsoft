

import { useEffect, useState } from 'react'

import {

  collection,

  doc,

  onSnapshot,

  query,

  updateDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore'





import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'

import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'
import PasswordManager from '../components/auth/PasswordManager'
import { auth, db, storage } from '../firebase'

import { inr } from './NewProject.jsx'

import { IssueList, RaiseComplaint } from './Issues.jsx'

import Updates, { DelayBanner } from './Updates.jsx'



function Payments({ project }) {

  const [rows, setRows] = useState([])

  const [busy, setBusy] = useState('')

  const [error, setError] = useState('')



  useEffect(() => {

    const user = auth.currentUser

    if (!user) return



    const q = query(

      collection(db, 'payments'),

      where('clientUid', '==', user.uid),

      where('projectId', '==', project.id)

    )



    return onSnapshot(

      q,

      snapshot => {

        setRows(snapshot.docs.map(d => ({

          id: d.id,

          ...d.data()

        })))

      },

      err => {

        console.error('Payment loading failed:', err)

        setError('Unable to load payment details.')

      }

    )

  }, [project.id])



  const upload = async (payment, file) => {

    if (!file) return



    if (!file.type.startsWith('image/')) {

      setError('Please select an image file.')

      return

    }



    setBusy(payment.id)

    setError('')



    try {

      const path =

        `projects/${project.id}/payments/${payment.id}-${file.name}`



      const storageRef = ref(storage, path)



      await uploadBytes(storageRef, file)



      const screenshotUrl = await getDownloadURL(storageRef)



      await updateDoc(doc(db, 'payments', payment.id), {

        screenshotUrl,

        status: 'submitted'

      })

    } catch (err) {

      console.error('Payment screenshot upload failed:', err)

      setError('Upload failed. Please try again.')

    } finally {

      setBusy('')

    }

  }



  const statusLabel = {

    requested: 'Payment due',

    submitted: 'Awaiting verification',

    recorded: 'Payment recorded'

  }



  if (!rows.length) {

    return (

      <div className="client-empty-inline">

        No payment requests have been raised for this project yet.

      </div>

    )

  }



  return (

    <div className="client-payment-list">

      {error && <p className="client-error">{error}</p>}



      {rows.map(p => (

        <div className="client-payment-item" key={p.id}>

          <div className="client-payment-top">

            <div>

              <span className="eyebrow">Payment request</span>

              <strong className="client-payment-amount">

                {inr(p.amount)}

              </strong>

            </div>



            <span className={`client-payment-status ${p.status}`}>

              {statusLabel[p.status] || p.status}

            </span>

          </div>



          {p.status === 'requested' && (

            <label className="client-upload-button">

              {busy === p.id

                ? 'Uploading screenshot...'

                : 'Upload payment screenshot'}



              <input

                hidden

                type="file"

                accept="image/*"

                disabled={Boolean(busy)}

                onChange={e => {

                  const file = e.target.files?.[0]

                  upload(p, file)

                  e.target.value = ''

                }}

              />

            </label>

          )}



          {p.status === 'submitted' && (

            <p className="client-muted">

              Your payment proof has been submitted and is awaiting admin verification.

            </p>

          )}



          {p.status === 'recorded' && (

            <div className="client-invoice-details">

              <p>

                {p.splits?.map(s =>

                  `${s.method}: ${inr(s.amount)}`

                ).join(' · ')}

              </p>



              {p.invoiceNo && (

                <p>Invoice number: <strong>{p.invoiceNo}</strong></p>

              )}



              {p.invoiceUrl && (

                <a

                  className="client-invoice-link"

                  href={p.invoiceUrl}

                  target="_blank"

                  rel="noreferrer"

                >

                  Download Invoice ↗

                </a>

              )}

            </div>

          )}

        </div>

      ))}

    </div>

  )

}



function ClientProposalForm({ project }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [amount, setAmount] = useState('')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const proposal = project.proposal || {}
    setStartDate(proposal.startDate || project.startDate || '')
    setEndDate(proposal.endDate || project.endDate || '')
    setAmount(String(proposal.requestedTotal ?? project.total ?? ''))
    setAdditionalInfo(proposal.additionalInfo || '')
  }, [project])

  async function submitProposal(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    const user = auth.currentUser
    if (!user) {
      setError('Please sign in again to submit your proposal.')
      return
    }

    if (!startDate || !endDate || !Number(amount) || Number(amount) <= 0) {
      setError('Enter valid start date, end date and quotation amount.')
      return
    }

    if (endDate < startDate) {
      setError('The end date must be on or after the start date.')
      return
    }

    if (files.some((file) => !file.type.startsWith('image/') || file.size > 8 * 1024 * 1024)) {
      setError('Choose image files only, each smaller than 8 MB.')
      return
    }

    setBusy(true)
    try {
      const referenceImages = [...(project.proposal?.referenceImages || [])]

      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        const imageRef = ref(
          storage,
          `projects/${project.id}/proposals/${user.uid}/${Date.now()}-${safeName}`
        )
        await uploadBytes(imageRef, file)
        referenceImages.push(await getDownloadURL(imageRef))
      }

      await updateDoc(doc(db, 'projects', project.id), {
        proposal: {
          startDate,
          endDate,
          requestedTotal: Number(amount),
          additionalInfo: additionalInfo.trim(),
          referenceImages,
          status: 'pending_review',
          submittedBy: user.uid,
          submittedAt: serverTimestamp(),
          adminMessage: '',
        },
      })

      setFiles([])
      setSuccess('Your proposal has been submitted for admin review.')
    } catch (err) {
      console.error('Proposal submission failed:', err)
      setError('Could not submit your proposal. Please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="client-proposal-form" onSubmit={submitProposal}>
      <div>
        <span className="eyebrow">Project confirmation</span>
        <h3>
          {project.proposal?.status === 'changes_requested'
            ? 'Revise your proposal'
            : 'Review & submit your proposal'}
        </h3>
        <p className="client-muted">
          Your project will only be finalized after admin review.
        </p>
      </div>

      {project.proposal?.status === 'changes_requested' && project.proposal?.adminMessage && (
        <div className="client-proposal-message">
          <strong>Changes requested by North East Interiors</strong>
          <p>{project.proposal.adminMessage}</p>
        </div>
      )}

      <div className="client-proposal-fields">
        <label>
          Preferred start date *
          <input required type="date" value={startDate}
            onChange={(event) => setStartDate(event.target.value)} />
        </label>

        <label>
          Preferred end date *
          <input required type="date" min={startDate || undefined} value={endDate}
            onChange={(event) => setEndDate(event.target.value)} />
        </label>

        <label>
          Final quotation amount (₹) *
          <input required type="number" min="1" step="1" value={amount}
            onChange={(event) => setAmount(event.target.value)} />
        </label>

        <label className="client-proposal-full">
          Additional information
          <textarea rows={4} maxLength={2000} value={additionalInfo}
            onChange={(event) => setAdditionalInfo(event.target.value)}
            placeholder="Mention design preferences, requirements or questions…" />
        </label>

        <label className="client-proposal-full">
          Reference images (optional — select multiple images, up to 8 MB each)
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              const selectedFiles = Array.from(event.target.files || [])
              setFiles((previous) => {
                const combined = [...previous]
                selectedFiles.forEach((file) => {
                  const alreadyAdded = combined.some((existing) =>
                    existing.name === file.name &&
                    existing.size === file.size &&
                    existing.lastModified === file.lastModified
                  )
                  if (!alreadyAdded) combined.push(file)
                })
                return combined
              })
              event.target.value = ''
            }}
          />
          {files.length > 0 && (
            <span className="client-selected-images">
              {files.length} image(s) selected: {files.map((file) => file.name).join(', ')}
              <button type="button" onClick={() => setFiles([])} disabled={busy}>Clear selection</button>
            </span>
          )}
        </label>
      </div>

      {error && <p className="client-error" role="alert">{error}</p>}
      {success && <p className="client-muted" role="status">{success}</p>}

      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit proposal for review'}
      </button>
    </form>
  )
}


function ClientProject({ p }) {

  const [section, setSection] = useState('overview')

  const [showProposalForm, setShowProposalForm] = useState(false)



  const paid = Number(p.paid || 0)

  const total = Number(p.total || 0)

  const balance = Math.max(total - paid, 0)

  const progress = total > 0

    ? Math.min(Math.round((paid / total) * 100), 100)

    : 0



  const sections = [

    { id: 'overview', label: 'Overview' },

    { id: 'updates', label: 'Site Updates' },

    { id: 'payments', label: 'Payments' },

    { id: 'support', label: 'Complaints & Requests' }

  ]



  return (

    <article className="client-project-card">

      <div className="client-project-hero">

        <div className="client-hero-top">

          <span className="client-project-label">YOUR INTERIOR PROJECT</span>



          <span className={`client-project-status ${p.status}`}>

            <span className="client-status-dot" />

            {p.finalized
              ? 'Finalized'
              : p.proposal?.status === 'pending_review'
                ? 'Proposal under review'
                : p.status === 'quoted'
                  ? 'Quotation pending'
                  : ({ approved: 'Approved', in_progress: 'In progress', completed: 'Completed' }[p.status] || p.status)}

          </span>

        </div>



        <h2>{p.name}</h2>



        <p>

          Welcome, {p.clientName || 'Client'} · Project ID: {p.id.slice(0, 8)}

        </p>

      </div>



      <div className="client-finance-summary">

        <div className="client-finance-main">

          <span>Total Quotation</span>

          <strong>{inr(total)}</strong>

        </div>



        <div>

          <span>Amount Paid</span>

          <strong className="client-paid">{inr(paid)}</strong>

        </div>



        <div>

          <span>Outstanding</span>

          <strong className="client-balance">{inr(balance)}</strong>

        </div>

      </div>



      <div className="client-project-body">

        <DelayBanner project={p} />



        <div className="client-project-tabs">

          {sections.map(s => (

            <button

              type="button"

              key={s.id}

              className={section === s.id ? 'active' : ''}

              onClick={() => setSection(s.id)}

            >

              {s.label}

            </button>

          ))}

        </div>



        <div className="client-section-content">

          {section === 'overview' && (

            <div className="client-overview">

              <div className="client-section-heading">

                <div>

                  <span className="eyebrow">Project summary</span>

                  <h3>Project Overview</h3>

                </div>

              </div>



              <div className="client-overview-grid">

                <div className="client-info-box">

                  <span>Project Area</span>

                  <strong>{p.sft || 0} sq. ft.</strong>

                </div>



                <div className="client-info-box">

                  <span>Rate per sq. ft.</span>

                  <strong>{inr(p.rate || 0)}</strong>

                </div>



                <div className="client-info-box">

                  <span>Project Start</span>

                  <strong>

                    {p.finalized && p.startDate
                      ? new Date(`${p.startDate}T00:00:00`).toLocaleDateString('en-IN')
                      : 'To be confirmed'}

                  </strong>

                </div>



                <div className="client-info-box">

                  <span>Expected Completion</span>

                  <strong>
                    {p.finalized && p.endDate
                      ? new Date(`${p.endDate}T00:00:00`).toLocaleDateString('en-IN')
                      : 'To be confirmed'}
                  </strong>

                </div>

              </div>



              <div className="client-progress-card">

                <div className="client-progress-heading">

                  <div>

                    <span className="eyebrow">Financial progress</span>

                    <h3>Payment Progress</h3>

                  </div>

                  <strong>{progress}%</strong>

                </div>



                <div className="client-progress-track">

                  <div

                    className="client-progress-fill"

                    style={{ width: `${progress}%` }}

                  />

                </div>



                <div className="client-progress-labels">

                  <span>{inr(paid)} received</span>

                  <span>{inr(total)} total</span>

                </div>

              </div>



              <div className="client-reference-section">

                <div className="client-section-heading">

                  <div>

                    <span className="eyebrow">Design gallery</span>

                    <h3>Project References</h3>

                  </div>

                  <span className="client-image-count">

                    {p.designReferences
                      ? Object.values(p.designReferences).reduce((count, images) => count + (Array.isArray(images) ? images.length : 0), 0)
                      : (p.refImages?.length || 0)} images

                  </span>

                </div>



                {p.designReferences && Object.values(p.designReferences).some(
                  (images) => Array.isArray(images) && images.length > 0
                ) ? (
                  <div className="client-reference-rooms">
                    {Object.entries(p.designReferences).map(([roomId, images]) => {
                      if (!Array.isArray(images) || images.length === 0) return null

                      const roomLabels = {
                        tvUnit: 'TV Unit',
                        masterBedroom: 'Master Bedroom',
                        kitchen: 'Kitchen',
                        dining: 'Dining',
                      }
                      const roomName = roomLabels[roomId] || roomId
                        .replace(/[-_]/g, ' ')
                        .replace(/([a-z])([A-Z])/g, '$1 $2')
                        .replace(/\b\w/g, (letter) => letter.toUpperCase())

                      return (
                        <section className="client-reference-room" key={roomId}>
                          <h4 className="client-reference-room-title">{roomName}</h4>
                          <div className="client-reference-grid">
                            {images.map((item, index) => {
                              const url = typeof item === 'string'
                                ? item
                                : item.imageUrl || item.url || item.downloadURL || item.src
                              if (!url) return null
                              return (
                                <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="client-reference-card">
                                  <img src={url} alt={`${roomName} reference ${index + 1}`} loading="lazy" />
                                </a>
                              )
                            })}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                ) : p.refImages?.length ? (
                  <div className="client-reference-grid">
                    {p.refImages.map((url, index) => (
                      <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="client-reference-card">
                        <img src={url} alt={`Project reference ${index + 1}`} loading="lazy" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="client-muted">No project images available yet.</p>
                )}

              </div>



              {!p.finalized &&
                !['approved', 'in_progress', 'completed'].includes(String(p.status || '').toLowerCase()) &&
                !['pending_review', 'approved'].includes(p.proposal?.status) && (
                <div className="client-approval-box">
                  <div>
                    <strong>
                      {p.proposal?.status === 'changes_requested'
                        ? 'Changes requested'
                        : 'Quotation awaiting your approval'}
                    </strong>
                    <p>
                      {p.proposal?.status === 'changes_requested'
                        ? (p.proposal.adminMessage || 'Please revise your proposal.')
                        : 'Please review the project details before submitting your proposal.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowProposalForm((previous) => !previous)}
                  >
                    {showProposalForm
                      ? 'Close form'
                      : p.proposal?.status === 'changes_requested'
                        ? 'Revise proposal'
                        : 'Approve Quotation'}
                  </button>
                </div>
              )}

              {p.proposal?.status === 'pending_review' && !p.finalized && (
                <div className="client-approved-note">
                  <strong>Proposal submitted for review</strong>
                  <p>Your proposed dates and quotation are awaiting admin confirmation.</p>
                </div>
              )}

              {p.finalized && (
                <div className="client-approved-note">
                  ✓ Your project has been finalized.
                </div>
              )}

              {showProposalForm && !p.finalized &&
                !['approved', 'in_progress', 'completed'].includes(String(p.status || '').toLowerCase()) &&
                !['pending_review', 'approved'].includes(p.proposal?.status) && (
                  <ClientProposalForm project={p} />
                )}
            </div>

          )}



          {section === 'updates' && (

            <div className="client-section-panel">

              <span className="eyebrow">Site activity</span>

              <h3>Daily Site Updates</h3>

              <p className="client-muted">

                Follow the work completed at your site, photos and material updates.

              </p>

              <Updates project={p} role="client" />

            </div>

          )}



          {section === 'payments' && (

            <div className="client-section-panel">

              <span className="eyebrow">Financial records</span>

              <h3>Payments & Invoices</h3>

              <p className="client-muted">

                Review payment requests, submit payment proof and access recorded invoices.

              </p>

              <Payments project={p} />

            </div>

          )}



          {section === 'support' && (

            <div className="client-section-panel">

              <span className="eyebrow">Client support</span>

              <h3>Complaints & Requests</h3>

              <p className="client-muted">

                Raise a concern or review the status of your existing requests.

              </p>



              <div className="client-support-form">

                <RaiseComplaint project={p} />

              </div>



              <div className="client-issues">

                <IssueList project={p} role="client" />

              </div>

            </div>

          )}

        </div>

      </div>

    </article>

  )

}



export default function ClientHome() {

  const [rows, setRows] = useState([])

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState('')



  useEffect(() => {

    const user = auth.currentUser



    if (!user) {

      setRows([])

      setLoading(false)

      return

    }



    const q = query(

      collection(db, 'projects'),

      where('clientUid', '==', user.uid)

    )



    const unsubscribe = onSnapshot(

      q,

      snapshot => {

        setRows(snapshot.docs.map(d => ({

          id: d.id,

          ...d.data()

        })))

        setLoading(false)

      },

      err => {

        console.error('Client projects loading failed:', err)

        setError('Unable to load your projects. Please refresh.')

        setLoading(false)

      }

    )



    return unsubscribe

  }, [])



  if (loading) {

    return (

      <main className="client-page">

        <div className="client-empty">

          Loading your project dashboard...

        </div>

      </main>

    )

  }



  if (error) {

    return (

      <main className="client-page">

        <div className="client-empty client-error">{error}</div>

      </main>

    )

  }



  return (

    <main className="client-page">

      <div className="client-page-heading">
        <div>
          <span className="eyebrow">North East Interiors</span>
          <h1>My Projects</h1>
          <p>Track your interior project, payments and site progress.</p>
        </div>

        <div className="client-heading-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="client-project-count">
            <strong>{rows.length}</strong>
            <span>My Projects</span>
          </div>

          <PasswordManager />
          <button
            type="button"
            className="client-signout-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 44,
              padding: '0 16px',
              border: '1px solid #d7e5df',
              borderRadius: 12,
              background: '#ffffff',
              color: '#16483d',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onClick={async () => {
              try {
                await signOut(auth)
              } catch (error) {
                console.error('Client sign out failed:', error)
              }
            }}
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </div>



      {!rows.length ? (

        <div className="client-empty">

          <div className="client-empty-icon">⌂</div>

          <h3>Your project is getting ready</h3>

          <p>

            Your project will appear here once North East Interiors

            creates and links it to your account.

          </p>

        </div>

      ) : (

        <div className="client-project-list">

          {rows.map(p => (

            <ClientProject key={p.id} p={p} />

          ))}

        </div>

      )}

    </main>

  )

}
