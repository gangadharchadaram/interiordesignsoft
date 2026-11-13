
import { useEffect, useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from '../firebase'

export default function ClientProposalForm({ project }) {
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
      setSuccess('Your proposal has been submitted. The admin will review it before finalizing the project.')
    } catch (err) {
      console.error('Proposal submission failed:', err)
      setError('Could not submit your proposal. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const proposal = project.proposal || {}

  if (proposal.status === 'pending_review') {
    return (
      <div className="client-approval-box">
        <div>
          <strong>Proposal submitted for review</strong>
          <p>Your dates and quotation are awaiting admin confirmation.</p>
        </div>
      </div>
    )
  }

  if (proposal.status === 'approved' || project.finalized) {
    return (
      <div className="client-approved-note">
        ✓ Your project proposal has been finalized.
      </div>
    )
  }

  return (
    <form className="client-proposal-form" onSubmit={submitProposal}>
      <div>
        <span className="eyebrow">Project confirmation</span>
        <h3>
          {proposal.status === 'changes_requested'
            ? 'Revise your proposal'
            : 'Review & submit your proposal'}
        </h3>
        <p className="client-muted">
          Your project will only be finalized after admin review.
        </p>
      </div>

      {proposal.status === 'changes_requested' && proposal.adminMessage && (
        <div className="client-proposal-message">
          <strong>Changes requested by North East Interiors</strong>
          <p>{proposal.adminMessage}</p>
        </div>
      )}

      <div className="client-proposal-fields">
        <label>
          Preferred start date *
          <input
            required
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>

        <label>
          Preferred end date *
          <input
            required
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>

        <label>
          Final quotation amount (₹) *
          <input
            required
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label className="client-proposal-full">
          Additional information
          <textarea
            rows={4}
            maxLength={2000}
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder="Mention design preferences, requirements or questions…"
          />
        </label>

        <label className="client-proposal-full">
          Reference images (optional, up to 8 MB each)
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          {files.length > 0 && (
            <small>{files.length} image(s) selected</small>
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
