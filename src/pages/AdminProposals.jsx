
import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { inr } from './NewProject.jsx'

export default function AdminProposals({ canWrite = false, reviewProjectId = null }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!reviewProjectId) return
    const project = projects.find((item) => item.id === reviewProjectId)
    if (project) {
      setSelected(project)
      setMessage('')
      setError('')
    }
  }, [reviewProjectId, projects])

  useEffect(() => {
    return onSnapshot(
      collection(db, 'projects'),
      (snapshot) => {
        const rows = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))

        setProjects(rows.filter(
          (project) => project.proposal?.status === 'pending_review'
        ))
        setLoading(false)
      },
      (err) => {
        console.error('Proposal loading failed:', err)
        setError('Could not load proposals. Check Firestore permissions.')
        setLoading(false)
      }
    )
  }, [])

  async function reviewProposal(action) {
    if (!canWrite || !selected) return

    if (action === 'request_changes' && !message.trim()) {
      setError('Enter a message explaining the changes requested.')
      return
    }

    setBusy(true)
    setError('')

    try {
      const proposal = selected.proposal

      const updatedProposal = {
        ...proposal,
        status: action === 'finalize' ? 'approved' : 'changes_requested',
        adminMessage: action === 'finalize' ? '' : message.trim(),
        reviewedAt: serverTimestamp(),
      }

      const update = { proposal: updatedProposal }

      if (action === 'finalize') {
        update.startDate = proposal.startDate
        update.endDate = proposal.endDate
        update.total = Number(proposal.requestedTotal)
        update.finalized = true
        update.finalizedAt = serverTimestamp()
        update.status = 'approved'
      }

      await updateDoc(doc(db, 'projects', selected.id), update)

      setSelected(null)
      setMessage('')
    } catch (err) {
      console.error('Proposal review failed:', err)
      setError('Could not save the review. Check Firestore permissions.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <section className="admin-proposals"><p>Loading proposals…</p></section>

  return (
    <section className="admin-proposals">
      <header className="admin-proposals-heading">
        <div>
          <span className="eyebrow">Client confirmations</span>
          <h1>Project Proposals</h1>
          <p>{projects.length} awaiting review</p>
        </div>
      </header>

      {error && <p className="client-error" role="alert">{error}</p>}

      {projects.length === 0 ? (
        <div className="admin-proposals-empty">
          <h3>You're all caught up</h3>
          <p>No client proposals are waiting for review.</p>
        </div>
      ) : (
        <div className="admin-proposals-list">
          {projects.map((project) => (
            <article className="admin-proposal-card" key={project.id}>
              <div>
                <h3>{project.name}</h3>
                <p>{project.clientName || 'Client'} · {project.id.slice(0, 8)}</p>
                <dl>
                  <div><dt>Requested start</dt><dd>{project.proposal.startDate}</dd></div>
                  <div><dt>Requested end</dt><dd>{project.proposal.endDate}</dd></div>
                  <div><dt>Requested quotation</dt><dd>{inr(project.proposal.requestedTotal)}</dd></div>
                </dl>
                {project.proposal.additionalInfo && (
                  <p>{project.proposal.additionalInfo}</p>
                )}
                {(project.proposal.referenceImages || []).map((url, index) => (
                  <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer">
                    View reference {index + 1}
                  </a>
                ))}
              </div>
                {canWrite && <button type="button" className="btn" onClick={() => {
                setSelected(project)
                setMessage('')
                setError('')
              }}>
                Review proposal
                </button>}
            </article>
          ))}
        </div>
      )}

      {selected && (
        <div className="admin-proposal-overlay">
          <section className="admin-proposal-modal">
            <h2>Review {selected.name}</h2>
            <p>Confirm the client's proposed dates and final quotation.</p>
            <p><strong>Start:</strong> {selected.proposal.startDate}</p>
            <p><strong>End:</strong> {selected.proposal.endDate}</p>
            <p><strong>Quotation:</strong> {inr(selected.proposal.requestedTotal)}</p>

            <label>
              Message to client (required when requesting changes)
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Explain what needs to change…"
              />
            </label>

            <div className="admin-proposal-actions">
              <button type="button" disabled={busy} onClick={() => setSelected(null)}>
                Cancel
              </button>
              {canWrite && <button type="button" disabled={busy} onClick={() => reviewProposal('request_changes')}>
                Request changes
              </button>}
              {canWrite && <button type="button" className="btn" disabled={busy} onClick={() => reviewProposal('finalize')}>
                {busy ? 'Saving…' : 'Approve & finalize'}
              </button>}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
