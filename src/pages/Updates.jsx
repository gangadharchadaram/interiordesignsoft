
import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import { ChevronDown, ChevronUp } from 'lucide-react'

import '../styles/admin.css'

export const today = () =>
  new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  })

function formatDate(value) {
  if (!value) return 'Date unavailable'

  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function ReportField({ label, value }) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null
  }

  return (
    <div className="update-content">
      <span className="update-content-label">{label}</span>
      <p style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</p>
    </div>
  )
}

export default function Updates({ project, role }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    const uid = auth.currentUser?.uid

    if (!uid || !project?.id) {
      setRows([])
      setLoading(false)
      setError('Please sign in again to view site updates.')
      return
    }

    setLoading(true)
    setError('')

    // Queries must match the read permissions in Firestore rules.
    let q

    if (role === 'admin') {
      q = query(
        collection(db, 'updates'),
        where('projectId', '==', project.id)
      )
    } else if (role === 'client') {
      q = query(
        collection(db, 'updates'),
        where('projectId', '==', project.id),
        where('clientUid', '==', uid)
      )
    } else {
      q = query(
        collection(db, 'updates'),
        where('projectId', '==', project.id),
        where('supervisorUid', '==', uid)
      )
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))

        data.sort((a, b) => {
          const dateCompare = String(b.date || '').localeCompare(
            String(a.date || '')
          )

          if (dateCompare !== 0) return dateCompare

          const aTime = a.createdAt?.toMillis?.() || 0
          const bTime = b.createdAt?.toMillis?.() || 0
          return bTime - aTime
        })

        setRows(data)
        setLoading(false)
        setError('')
      },
      (err) => {
        console.error('Site updates listener failed:', err.code, err.message)
        setError(
          'Unable to load site updates. Check Firestore permissions and the client UID saved in each update.'
        )
        setLoading(false)
      }
    )

    return unsubscribe
  }, [project?.id, role])

  if (loading) {
    return <div className="updates-empty">Loading site updates…</div>
  }

  if (error) {
    return <div className="issue-message error">{error}</div>
  }

  if (!rows.length) {
    return (
      <div className="updates-empty">
        <strong>No daily updates yet</strong>
        <p>Work reports, progress, materials and site photographs will appear here.</p>
      </div>
    )
  }


return (
  <section className="updates-timeline">
    {rows.map((update) => {
      const images = Array.isArray(update.images)
        ? update.images
        : Array.isArray(update.imageUrls)
          ? update.imageUrls
          : []

      const isExpanded = expandedId === update.id

      return (
        <article
          className={`update-card ${isExpanded ? 'is-expanded' : ''}`}
          key={update.id}
        >
          <button
            type="button"
            className="update-card-summary"
            onClick={() =>
              setExpandedId(isExpanded ? null : update.id)
            }
            aria-expanded={isExpanded}
          >
            <div className="update-summary-main">
              <div className="update-summary-heading">
                <strong>{formatDate(update.date)}</strong>
                <span className="update-status updated">
                  {update.status || 'Updated'}
                </span>
              </div>

              <p className="update-summary-work">
                {update.workCompleted || update.note || 'Daily site update'}
              </p>

              <div className="update-summary-meta">
                <span>
                  Progress: {update.progress ?? 0}%
                </span>
                {images.length > 0 && (
                  <span>
                    {images.length} photo{images.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>



           <span className="update-expand-icon">
  {isExpanded
    ? <ChevronUp size={20} />
    : <ChevronDown size={20} />}
</span>
          </button>

          {isExpanded && (
            <div className="update-card-details">
              <ReportField
                label="Work completed"
                value={update.workCompleted || update.note}
              />
              <ReportField label="Next step" value={update.nextStep} />
              <ReportField
                label="Overall project completion"
                value={update.progress != null ? `${update.progress}%` : null}
              />
              <ReportField label="Manpower" value={update.manpower} />
              <ReportField
                label="Materials used"
                value={update.materialsUsed || update.material}
              />
              <ReportField
                label="Materials required"
                value={update.materialsRequired}
              />
              <ReportField label="Issues / blockers" value={update.issues} />
              <ReportField label="Safety notes" value={update.safety} />
              <ReportField label="Additional notes" value={update.notes} />

              {images.length > 0 && (
                <div className="update-gallery-section">
                  <div className="update-gallery-heading">
                    <strong>Site photographs</strong>
                    <span>{images.length} photo{images.length === 1 ? '' : 's'}</span>
                  </div>

                  <div className="update-gallery">
                    {images.map((image, index) => (
                      <a
                        key={`${image}-${index}`}
                        href={image}
                        target="_blank"
                        rel="noreferrer"
                        className="update-image-link"
                      >
                        <img
                          src={image}
                          alt={`Site work ${index + 1}`}
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </article>
      )
    })}
  </section>
)

}

export function DelayBanner({ project }) {
  if (!project?.blockedReason && !project?.delayedDate) return null

  return (
    <div className="project-alerts">
      {project.blockedReason && (
        <div className="project-alert blocked">
          <strong>Work currently blocked</strong>
          <p>{project.blockedReason}</p>
        </div>
      )}

      {project.delayedDate && (
        <div className="project-alert delayed">
          <strong>Site update pending</strong>
          <p>Expected update date: {formatDate(project.delayedDate)}</p>
        </div>
      )}
    </div>
  )
}
