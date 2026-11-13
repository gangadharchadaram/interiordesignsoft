
import { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'

import { auth, db } from '../firebase'

const LABEL = {
  material: 'Material request',
  blocked: 'Work blocked',
  complaint: 'Complaint'
}

const base = (p, role) => {
  const uid = auth.currentUser?.uid

  if (!uid) {
    throw new Error('Please log in again to continue.')
  }

  return {
    projectId: p.id,
    projectName: p.name,
    supervisorUid: p.supervisorUid || '',
    clientUid: p.clientUid || '',
    raisedBy: uid,
    raisedRole: role,
    status: 'open',
    createdAt: serverTimestamp()
  }
}

function formatDate(timestamp) {
  if (!timestamp?.seconds) return 'Just now'

  return new Date(timestamp.seconds * 1000).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function IssueList({ project, role }) {
  const [rows, setRows] = useState([])
  const [reply, setReply] = useState({})
  const [busy, setBusy] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!uid) return

    const conditions = [
      where('projectId', '==', project.id)
    ]

    if (role === 'supervisor') {
      conditions.push(where('supervisorUid', '==', uid))
    }

    if (role === 'carpenter') {
      conditions.push(where('raisedBy', '==', uid))
    }

    if (role === 'client') {
      conditions.push(
        where('clientUid', '==', project.clientUid),
        where('kind', '==', 'complaint')
      )
    }

    const unsubscribe = onSnapshot(
      query(collection(db, 'issues'), ...conditions),
      snapshot => {
        const data = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data()
        }))

        data.sort(
          (a, b) =>
            (b.createdAt?.seconds || 0) -
            (a.createdAt?.seconds || 0)
        )

        setRows(data)
        setError('')
      },
      err => {
        console.error('Issue listener failed:', err)
        setError('Unable to load updates. Please check your access or try again.')
      }
    )

    return unsubscribe
  }, [project.id, project.clientUid, role])

  const resolve = async issue => {
    if (busy[issue.id]) return

    setBusy(previous => ({ ...previous, [issue.id]: true }))
    setError('')

    try {
      const resolution = reply[issue.id]?.trim() || 'Resolved'

      await updateDoc(doc(db, 'issues', issue.id), {
        status: 'resolved',
        resolution,
        resolvedAt: serverTimestamp(),
        resolvedBy: auth.currentUser?.uid || ''
      })

      setReply(previous => ({
        ...previous,
        [issue.id]: ''
      }))
    } catch (err) {
      console.error('Issue resolution failed:', err)
      setError(err?.message || 'Could not update the issue.')
    } finally {
      setBusy(previous => ({ ...previous, [issue.id]: false }))
    }
  }

  if (error) {
    return <div className="issue-message error">{error}</div>
  }

  if (!rows.length) {
    return (
      <div className="issue-empty">
        <div className="issue-empty-icon">✓</div>
        <strong>Nothing raised yet</strong>
        <p>New requests and updates will appear here.</p>
      </div>
    )
  }

  return (
    <div className="issue-list">
      {rows.map(issue => {
        const resolved = issue.status === 'resolved'

        return (
          <article className="issue-card" key={issue.id}>
            <div className="issue-card-top">
              <div className="issue-type">
                <span className={`issue-type-icon ${issue.kind || ''}`}>
                  {issue.kind === 'material'
                    ? '▣'
                    : issue.kind === 'blocked'
                      ? '!'
                      : '✦'}
                </span>

                <div>
                  <strong>
                    {LABEL[issue.kind] || 'Project update'}
                  </strong>
                  <small>{formatDate(issue.createdAt)}</small>
                </div>
              </div>

              <span className={`issue-status ${resolved ? 'resolved' : 'open'}`}>
                {resolved ? 'Resolved' : 'Open'}
              </span>
            </div>

            {issue.reason && (
              <span className="issue-reason">{issue.reason}</span>
            )}

            <p className="issue-description">
              {issue.text || 'No additional details provided.'}
            </p>

            {issue.resolution && (
              <div className="issue-response">
                <strong>Supervisor response</strong>
                <p>{issue.resolution}</p>
              </div>
            )}

            {role === 'supervisor' && !resolved && (
              <div className="issue-resolve">
                <label htmlFor={`reply-${issue.id}`}>
                  Resolution note
                </label>

                <textarea
                  id={`reply-${issue.id}`}
                  rows="2"
                  placeholder="Describe the action taken at the site..."
                  value={reply[issue.id] || ''}
                  onChange={e =>
                    setReply(previous => ({
                      ...previous,
                      [issue.id]: e.target.value
                    }))
                  }
                  disabled={busy[issue.id]}
                />

                <button
                  type="button"
                  className="btn issue-resolve-button"
                  disabled={busy[issue.id]}
                  onClick={() => resolve(issue)}
                >
                  {busy[issue.id] ? 'Updating…' : 'Mark as resolved'}
                </button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

export function RaiseComplaint({ project }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const send = async e => {
    e.preventDefault()

    if (!text.trim()) {
      setErr('Please describe your concern.')
      return
    }

    setBusy(true)
    setErr('')
    setMsg('')

    try {
      await addDoc(collection(db, 'issues'), {
        ...base(project, 'client'),
        kind: 'complaint',
        text: text.trim()
      })

      setText('')
      setMsg('Your complaint has been submitted successfully.')
    } catch (error) {
      console.error('Complaint submission failed:', error)
      setErr(error?.message || 'Unable to submit your complaint.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="issue-form" onSubmit={send}>
      <div className="issue-form-heading">
        <span className="issue-form-icon">✦</span>
        <div>
          <h3>Raise a complaint</h3>
          <p>Tell us about a delay, quality concern, or site issue.</p>
        </div>
      </div>

      <label htmlFor="client-complaint">
        Describe your concern
      </label>

      <textarea
        id="client-complaint"
        rows="4"
        required
        maxLength={1000}
        placeholder="Explain what happened or what needs attention..."
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={busy}
      />

      <div className="issue-form-footer">
        <small>{text.length}/1000 characters</small>

        <button
          className="btn"
          type="submit"
          disabled={busy || !text.trim()}
        >
          {busy ? 'Submitting…' : 'Submit complaint'}
        </button>
      </div>

      {err && <div className="issue-message error">{err}</div>}
      {msg && <div className="issue-message success">{msg}</div>}
    </form>
  )
}

export function CarpenterForms({ project }) {
  const [text, setText] = useState('')
  const [lang, setLang] = useState('en-IN')
  const [listening, setListening] = useState(false)
  const [reason, setReason] = useState('Material not available')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [recognition, setRecognition] = useState(null)

  useEffect(() => {
    return () => {
      recognition?.stop()
    }
  }, [recognition])

  const listen = () => {
    const SpeechAPI =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition

    if (!SpeechAPI) {
      setErr('Voice input is not supported in this browser. Please type your request.')
      return
    }

    setErr('')
    setMsg('')

    const speech = new SpeechAPI()
    speech.lang = lang
    speech.continuous = false
    speech.interimResults = false
    speech.maxAlternatives = 1

    speech.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript || ''

      setText(previous =>
        `${previous} ${transcript}`.trim()
      )
    }

    speech.onerror = event => {
      console.error('Speech recognition error:', event.error)
      setErr('Could not capture your voice. Please try again or type your request.')
    }

    speech.onend = () => {
      setListening(false)
      setRecognition(null)
    }

    setRecognition(speech)
    setListening(true)

    try {
      speech.start()
    } catch (error) {
      console.error('Speech start failed:', error)
      setListening(false)
      setRecognition(null)
      setErr('Voice input could not start. Please try again.')
    }
  }

  const stopListening = () => {
    recognition?.stop()
    setListening(false)
  }

  const material = async e => {
    e.preventDefault()

    if (!text.trim()) {
      setErr('Please enter the material you need.')
      return
    }

    setBusy(true)
    setErr('')
    setMsg('')

    try {
      await addDoc(collection(db, 'issues'), {
        ...base(project, 'carpenter'),
        kind: 'material',
        text: text.trim()
      })

      setText('')
      setMsg('Material request sent to your supervisor.')
    } catch (error) {
      console.error('Material request failed:', error)
      setErr(error?.message || 'Unable to submit material request.')
    } finally {
      setBusy(false)
    }
  }

  const block = async () => {
    setBusy(true)
    setErr('')
    setMsg('')

    try {
      await addDoc(collection(db, 'issues'), {
        ...base(project, 'carpenter'),
        kind: 'blocked',
        reason,
        text: note.trim() || reason
      })

      setNote('')
      setMsg('Work-blocked report submitted to your supervisor.')
    } catch (error) {
      console.error('Work-blocked report failed:', error)
      setErr(error?.message || 'Unable to submit work-blocked report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="carpenter-report-grid">

      <form className="issue-form carpenter-form" onSubmit={material}>
        <div className="issue-form-heading">
          <span className="issue-form-icon material-icon">▣</span>
          <div>
            <h3>Request material</h3>
            <p>Tell your supervisor what is required at the site.</p>
          </div>
        </div>

        <label htmlFor="material-request">
          Material required
        </label>

        <textarea
          id="material-request"
          rows="3"
          required
          maxLength={1000}
          placeholder="Example: 2 boxes of wall tiles, plywood, hinges..."
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={busy}
        />

        <div className="carpenter-voice-row">
          <select
            value={lang}
            onChange={e => setLang(e.target.value)}
            aria-label="Voice input language"
            disabled={busy || listening}
          >
            <option value="en-IN">English</option>
            <option value="hi-IN">Hindi</option>
            <option value="as-IN">Assamese</option>
            <option value="te-IN">Telugu</option>
          </select>

          <button
            type="button"
            className="btn alt carpenter-speak"
            onClick={listening ? stopListening : listen}
            disabled={busy}
          >
            {listening ? 'Stop listening' : '🎙 Speak'}
          </button>
        </div>

        {listening && (
          <p className="issue-listening">
            Listening… Speak clearly into your device.
          </p>
        )}

        <button
          className="btn carpenter-submit"
          type="submit"
          disabled={busy || !text.trim()}
        >
          {busy ? 'Sending…' : 'Send material request'}
        </button>
      </form>

      <div className="issue-form carpenter-form carpenter-block-form">
        <div className="issue-form-heading">
          <span className="issue-form-icon blocked-icon">!</span>
          <div>
            <h3>Work blocked</h3>
            <p>Report an issue preventing work from continuing.</p>
          </div>
        </div>

        <label htmlFor="block-reason">
          Reason
        </label>

        <select
          id="block-reason"
          value={reason}
          onChange={e => setReason(e.target.value)}
          disabled={busy}
        >
          <option>Material not available</option>
          <option>Measurement issue</option>
          <option>Site access issue</option>
          <option>Other</option>
        </select>

        <label htmlFor="block-note">
          Additional details (optional)
        </label>

        <textarea
          id="block-note"
          rows="3"
          placeholder="Add details to help your supervisor..."
          value={note}
          onChange={e => setNote(e.target.value)}
          disabled={busy}
        />

        <button
          type="button"
          className="btn red carpenter-submit"
          onClick={block}
          disabled={busy}
        >
          {busy ? 'Submitting…' : 'Report blocked work'}
        </button>
      </div>

      {err && (
        <div className="issue-message error carpenter-feedback">
          {err}
        </div>
      )}

      {msg && (
        <div className="issue-message success carpenter-feedback">
          {msg}
        </div>
      )}

    </div>
  )
}
