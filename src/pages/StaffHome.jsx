import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Package,
  RefreshCw,
  Save,
  Users,
  X,
} from 'lucide-react'

import MaterialRequests from '../components/materials/MaterialRequests'
import PasswordManager from '../components/auth/PasswordManager'

import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

import {
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage'

import { auth, db, storage } from '../firebase'

import '../styles/staff.css'

/* =========================================================
   HELPERS
========================================================= */

const todayIndia = () =>
  new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  })

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


const getProjectUnits = (project) => {
  if (Array.isArray(project?.units) && project.units.length) return project.units
  const references = project?.designReferences && typeof project.designReferences === 'object'
    ? Object.keys(project.designReferences)
    : []
  if (references.length) {
    const labels = { tvUnit: 'TV unit', masterBedroom: 'Master bedroom', kitchen: 'Kitchen', dining: 'Dining' }
    const weight = 100 / references.length
    return references.map((id, index) => ({ id, label: labels[id] || id.replace(/[-_]/g, ' '), weight: index === references.length - 1 ? 100 - weight * (references.length - 1) : weight, progress: Number(project?.unitProgress?.[id] ?? 0) }))
  }
  return [{ id: 'general', label: 'General work', weight: 100, progress: Number(project?.progress || 0) }]
}

const calculateWeightedProgress = (units, values = {}) => {
  const totalWeight = units.reduce((sum, unit) => sum + Math.max(0, Number(unit.weight || 0)), 0)
  if (!totalWeight) return 0
  const weighted = units.reduce((sum, unit) => {
    const value = values[unit.id] ?? unit.progress ?? 0
    return sum + Math.max(0, Math.min(100, Number(value || 0))) * Math.max(0, Number(unit.weight || 0))
  }, 0)
  return Math.round(weighted / totalWeight)
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

/* =========================================================
   SPEECH INPUT
========================================================= */

function useSpeechInput() {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)

  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window ||
      'webkitSpeechRecognition' in window)

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore
      }
    }
  }, [])

  const start = ({
    onResult,
    onEnd,
  }) => {
    if (!supported) {
      alert(
        'Voice input is not supported in this browser. Please use Chrome.'
      )
      return
    }

    try {
      const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition

      const recognition = new SpeechRecognition()

      recognition.lang = 'en-IN'
      recognition.interimResults = false
      recognition.continuous = false

      recognition.onstart = () => {
        setListening(true)
      }

      recognition.onresult = (event) => {
        const transcript =
          event.results?.[0]?.[0]?.transcript || ''

        onResult?.(transcript)
      }

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event)
      }

      recognition.onend = () => {
        setListening(false)
        recognitionRef.current = null
        onEnd?.()
      }

      recognitionRef.current = recognition
      recognition.start()
    } catch (error) {
      console.error('Could not start speech recognition:', error)
      setListening(false)
    }
  }

  const stop = () => {
    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore
    }

    setListening(false)
  }

  return {
    supported,
    listening,
    start,
    stop,
  }
}

/* =========================================================
   INITIAL FORM
========================================================= */

const emptyUpdate = {
  date: todayIndia(),
  workCompleted: '',
  nextStep: '',
  progress: 0,
  manpower: '',
  materialsUsed: '',
  materialsRequired: '',
  issues: '',
  safety: '',
  notes: '',
}

/* ---------------------------------------------------------
   VOICE FIELD
   Keep this component at module scope so typing does not
   unmount/remount the input on every parent render.
--------------------------------------------------------- */
function VoiceField({
  field,
  value,
  multiline = false,
  placeholder,
  label,
  required = false,
  onChange,
  onVoiceResult,
}) {
  const speech = useSpeechInput()

  const startVoice = () => {
    if (speech.listening) {
      speech.stop()
      return
    }

    speech.start({
      onResult: (transcript) => onVoiceResult?.(field, transcript),
    })
  }

  return (
    <div className="staff-field">
      <div className="staff-field-label-row">
        <label>
          {label}
          {required && <span className="staff-required">*</span>}
        </label>
        <button
          type="button"
          className={speech.listening ? 'staff-mic-btn listening' : 'staff-mic-btn'}
          onClick={startVoice}
          title={speech.listening ? 'Stop voice input' : 'Speak'}
        >
          {speech.listening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(field, event.target.value)}
          placeholder={placeholder}
          rows={4}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(field, event.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}

/* =========================================================
   MAIN
========================================================= */

export default function StaffHome({
  user,
  role,
}) {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] =
    useState(null)

  const [updates, setUpdates] = useState([])

  const handleSignOut = async () => {
  try {
    await signOut(auth)
  } catch (error) {
    console.error('Sign out failed:', error)
  }
}

  const [loadingProjects, setLoadingProjects] =
    useState(true)

  const [loadingUpdates, setLoadingUpdates] =
    useState(false)

  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')

  const [success, setSuccess] = useState('')

  const [form, setForm] = useState(emptyUpdate)
  const [formStep, setFormStep] = useState(0)
  const [unitProgress, setUnitProgress] = useState({})

  const [photos, setPhotos] = useState([])

  const [photoPreviews, setPhotoPreviews] =
    useState([])

  const [showHistory, setShowHistory] =
    useState(true)

  const uid = user?.uid || auth.currentUser?.uid

  /* -------------------------------------------------------
     LOAD ASSIGNED PROJECTS
  ------------------------------------------------------- */

  useEffect(() => {
    if (!uid) {
      setProjects([])
      setLoadingProjects(false)
      return
    }

    setLoadingProjects(true)
    setError('')

    const field =
      role === 'supervisor'
        ? 'supervisorUid'
        : 'carpenterUid'

    const q = query(
      collection(db, 'projects'),
      where(field, '==', uid)
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))

        rows.sort((a, b) => {
          const aTime =
            a.createdAt?.toMillis?.() || 0

          const bTime =
            b.createdAt?.toMillis?.() || 0

          return bTime - aTime
        })

        setProjects(rows)
        setLoadingProjects(false)

        if (
          selectedProject &&
          !rows.some(
            (project) =>
              project.id === selectedProject.id
          )
        ) {
          setSelectedProject(null)
        }
      },
      (listenerError) => {
        console.error(
          'Staff project listener failed:',
          listenerError
        )

        setError(
          'Unable to load your assigned projects.'
        )

        setLoadingProjects(false)
      }
    )

    return unsubscribe
  }, [uid, role])

  /* -------------------------------------------------------
     LOAD PROJECT UPDATES
  ------------------------------------------------------- */


useEffect(() => {
  const projectId = selectedProject?.id;

  if (!projectId || !uid) {
    setUpdates([]);
    setLoadingUpdates(false);
    return;
  }

  setLoadingUpdates(true);

  // Supervisors see all reports assigned to their project supervision;
  // carpenters see only the reports they personally submitted.
  const reportOwnerField = role === 'supervisor'
    ? 'supervisorUid'
    : 'submittedByUid';

  const q = query(
    collection(db, 'updates'),
    where('projectId', '==', projectId),
    where(reportOwnerField, '==', uid),
    orderBy('date', 'desc')
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      setUpdates(rows);
      setLoadingUpdates(false);
    },
    (listenerError) => {
      console.error('Staff updates listener failed:', {
        code: listenerError.code,
        message: listenerError.message,
      });

      setUpdates([]);
      setLoadingUpdates(false);
      setError(
        'Unable to load daily updates. Check your Firestore rules and update records.'
      );
    }
  );

  return unsubscribe;
}, [selectedProject?.id, uid, role]);


  /* -------------------------------------------------------
     SELECT PROJECT
  ------------------------------------------------------- */

  const openProject = (project) => {
    setSelectedProject(project)
    setFormStep(0)

    const units = getProjectUnits(project)
    const initialUnitProgress = Object.fromEntries(units.map((unit) => [unit.id, Number(project?.unitProgress?.[unit.id] ?? unit.progress ?? 0)]))
    setUnitProgress(initialUnitProgress)
    setForm({
      ...emptyUpdate,
      date: todayIndia(),
      progress: calculateWeightedProgress(units, initialUnitProgress),
    })

    setPhotos([])
    setPhotoPreviews([])
    setSuccess('')
    setError('')
  }

  const closeProject = () => {
    setSelectedProject(null)
    setFormStep(0)
    setUnitProgress({})
    setUpdates([])
    setPhotos([])
    setPhotoPreviews([])
    setError('')
    setSuccess('')
  }

  /* -------------------------------------------------------
     FORM
  ------------------------------------------------------- */

  const updateField = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  /* -------------------------------------------------------
     PHOTOS
     IMPORTANT:
     This APPENDS instead of replacing.
  ------------------------------------------------------- */

  const addPhotos = (event) => {
    const selected = Array.from(
      event.target.files || []
    )

    if (!selected.length) return

    const valid = selected.filter((file) =>
      file.type.startsWith('image/')
    )

    setPhotos((previous) => [
      ...previous,
      ...valid,
    ])

    const previews = valid.map((file) => ({
      id:
        `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      url: URL.createObjectURL(file),
      name: file.name,
    }))

    setPhotoPreviews((previous) => [
      ...previous,
      ...previews,
    ])

    event.target.value = ''
  }

  const removePhoto = (index) => {
    setPhotos((previous) =>
      previous.filter((_, i) => i !== index)
    )

    setPhotoPreviews((previous) => {
      const item = previous[index]

      if (item?.url) {
        URL.revokeObjectURL(item.url)
      }

      return previous.filter((_, i) => i !== index)
    })
  }

  /* -------------------------------------------------------
     SAVE UPDATE
  ------------------------------------------------------- */

  const saveUpdate = async (event) => {
    event.preventDefault()

    if (!selectedProject) return

    if (!['supervisor', 'carpenter'].includes(role)) {
      setError('Only assigned staff can submit daily site reports.')
      return
    }

    const currentUid =
      auth.currentUser?.uid || uid

    if (!currentUid) {
      setError('Your session has expired. Please sign in again.')
      return
    }

    if (!form.date) {
      setError('Please select the update date.')
      return
    }

    if (!form.workCompleted.trim()) {
      setError('Please enter the work completed.')
      return
    }

    const projectUnits = getProjectUnits(selectedProject)
    const progress = calculateWeightedProgress(projectUnits, unitProgress)
    const updatedUnits = projectUnits.map((unit) => ({ ...unit, progress: Math.max(0, Math.min(100, Number(unitProgress[unit.id] ?? unit.progress ?? 0))) }))
    const savedUnitProgress = Object.fromEntries(updatedUnits.map((unit) => [unit.id, unit.progress]))

    const manpower = Math.max(
      0,
      Number(form.manpower || 0)
    )

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      /* ---------------------------------------------
         UPLOAD ALL PHOTOS
      --------------------------------------------- */

      const imageUrls = []

      for (let index = 0; index < photos.length; index += 1) {
        const file = photos[index]

        const safeName = file.name
          .replace(/[^a-zA-Z0-9._-]/g, '_')

        const uniqueName =
          `${Date.now()}-${index}-${Math.random()
            .toString(36)
            .slice(2)}-${safeName}`

        const imageRef = ref(
          storage,
          `projects/${selectedProject.id}/updates/${form.date}/${uniqueName}`
        )

        await uploadBytes(imageRef, file)

        const url = await getDownloadURL(imageRef)

        imageUrls.push(url)
      }

      /* ---------------------------------------------
         CREATE UPDATE
      --------------------------------------------- */

      const updateRef = doc(
        collection(db, 'updates')
      )

      const isCarpenterReport = role === 'carpenter'
      const assignedSupervisorUid = selectedProject.supervisorUid || ''

      const updateData = {
        projectId: selectedProject.id,

        projectName: selectedProject.name || selectedProject.projectName || '',

        clientUid: selectedProject.clientUid || '',

        // Keep reports linked to the assigned supervisor so that supervisor
        // can review carpenter submissions. The submitter remains explicit.
        supervisorUid: isCarpenterReport ? assignedSupervisorUid : currentUid,
        submittedByUid: currentUid,
        submittedByRole: role,
        submittedByName: user?.displayName || user?.email || '',
        reportType: isCarpenterReport ? 'carpenter' : 'supervisor',
        approvalStatus: isCarpenterReport ? 'pending' : 'approved',

        date: form.date,

        status: isCarpenterReport
          ? 'pending-review'
          : (progress >= 100 ? 'completed' : 'in-progress'),

        workCompleted:
          form.workCompleted.trim(),

        nextStep:
          form.nextStep.trim(),

        progress,

        manpower,

        materialsUsed:
          form.materialsUsed.trim(),

        materialsRequired:
          form.materialsRequired.trim(),

        issues:
          form.issues.trim(),

        safety:
          form.safety.trim(),

        notes:
          form.notes.trim(),

        images: imageUrls,

        imageCount: imageUrls.length,

        createdAt: serverTimestamp(),

        updatedAt: serverTimestamp(),
      }

      /* ---------------------------------------------
         BATCH
         1. Save daily update
         2. Sync project progress
      --------------------------------------------- */

      const batch = writeBatch(db)

      batch.set(updateRef, updateData)

      // Carpenter reports are submitted for review and must not overwrite
      // the official project progress. Only supervisors sync project progress.
      if (!isCarpenterReport) {
        batch.update(
          doc(db, 'projects', selectedProject.id),
          {
            progress,
            units: updatedUnits,
            unitProgress: savedUnitProgress,
            updatedAt: serverTimestamp(),
            lastUpdateDate: form.date,
            lastUpdateId: updateRef.id,
          }
        )
      }

      await batch.commit()

      setSuccess(
        isCarpenterReport
          ? 'Daily report submitted for supervisor review.'
          : 'Official daily update saved successfully.'
      )

      setForm({
        ...emptyUpdate,
        date: form.date,
        progress,
      })
      setUnitProgress(savedUnitProgress)
      if (!isCarpenterReport) {
        setSelectedProject((previous) => previous ? ({ ...previous, progress, units: updatedUnits, unitProgress: savedUnitProgress }) : previous)
      }

      setPhotos([])

      setPhotoPreviews([])

      setShowHistory(true)
    } catch (saveError) {
      console.error(
        'Daily update save failed:',
        saveError
      )

      setError(
        saveError?.message ||
          'Unable to save the daily update.'
      )
    } finally {
      setSaving(false)
    }
  }

  /* -------------------------------------------------------
     TODAY UPDATE
  ------------------------------------------------------- */

  const todayUpdate = useMemo(() => {
    const today = todayIndia()

    return (
      updates.find(
        (item) => item.date === today
      ) || null
    )
  }, [updates])

  /* =======================================================
     LOADING PROJECTS
  ======================================================= */

  if (loadingProjects) {
    return (
      <div className="staff-loading">
        <Loader2
          size={24}
          className="staff-spinner"
        />

        <span>
          Loading your projects...
        </span>
      </div>
    )
  }

  /* =======================================================
     PROJECT LIST
  ======================================================= */

  if (!selectedProject) {
    return (
      <div className="staff-page">

        <div className="staff-top">
          <div>
            <span className="staff-eyebrow">
              {role === 'supervisor'
                ? 'SUPERVISOR WORKSPACE'
                : 'CARPENTER WORKSPACE'}
            </span>

            <h1>
              My projects
            </h1>

            <p>
              {role === 'supervisor'
                ? 'Manage project progress and submit daily site updates.'
                : 'View your assigned projects and site work.'}
            </p>
          </div>

          <div className="staff-top-actions">
            <PasswordManager />
            <button
              type="button"
              className="staff-refresh"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={16} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              className="staff-signout-btn"
              onClick={handleSignOut}
              aria-label="Sign out"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="staff-alert error">
            <AlertTriangle size={17} />
            {error}
          </div>
        )}

        {projects.length === 0 ? (
          <div className="staff-empty">
            <div className="staff-empty-icon">
              <CalendarDays size={25} />
            </div>

            <h2>
              No projects assigned
            </h2>

            <p>
              You don't currently have any projects
              assigned to your account.
            </p>
          </div>
        ) : (
          <div className="staff-project-grid">
            {projects.map((project) => {
              const progress = Math.max(
                0,
                Math.min(
                  100,
                  Number(project.progress || 0)
                )
              )

              return (
                <button
                  key={project.id}
                  type="button"
                  className="staff-project-card"
                  onClick={() =>
                    openProject(project)
                  }
                >
                  <div className="staff-project-card-top">
                    <div>
                      <span className="staff-project-label">
                        PROJECT
                      </span>

                      <h2>
                        {project.name ||
                          'Untitled project'}
                      </h2>
                    </div>

                    <ChevronRight
                      size={19}
                    />
                  </div>

                  <div className="staff-project-client">
                    {project.clientName ||
                      'Client not assigned'}
                  </div>

                  <div className="staff-project-progress">
                    <div className="staff-project-progress-top">
                      <span>
                        Progress
                      </span>

                      <strong>
                        {progress}%
                      </strong>
                    </div>

                    <div className="staff-project-track">
                      <div
                        style={{
                          width: `${progress}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="staff-project-footer">
                    <span>
                      {statusLabel(
                        project.status
                      )}
                    </span>

                    <span>
                      {project.lastUpdateDate
                        ? `Updated ${formatDate(
                            project.lastUpdateDate
                          )}`
                        : 'No update yet'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  /* =======================================================
     PROJECT WORKSPACE
  ======================================================= */

  return (
    <div className="staff-page">

      {/* HEADER */}

      <div className="staff-project-header">

        <div className="staff-project-toolbar">
          <button
            type="button"
            className="staff-back"
            onClick={closeProject}
          >
            <ArrowLeft size={17} />
            My projects
          </button>
          <PasswordManager />
          <button
            type="button"
            className="staff-signout-btn"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>

        <div className="staff-project-heading">

          <div>
            <span className="staff-eyebrow">
              PROJECT
            </span>

            <h1>
              {selectedProject.name ||
                'Untitled project'}
            </h1>

            <p>
              {selectedProject.clientName ||
                'Client not assigned'}
            </p>
          </div>

          <div className="staff-current-progress">
            <span>
              Progress
            </span>

            <strong>
              {Number(
                selectedProject.progress || 0
              )}
              %
            </strong>
          </div>
        </div>
      </div>

      {/* ALERTS */}

      {error && (
        <div className="staff-alert error">
          <AlertTriangle size={17} />
          <span>{error}</span>

          <button
            type="button"
            onClick={() => setError('')}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {success && (
        <div className="staff-alert success">
          <CheckCircle2 size={17} />
          <span>{success}</span>

          <button
            type="button"
            onClick={() => setSuccess('')}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* PROJECT SNAPSHOT */}

      <section className="staff-snapshot">

        <div>
          <CalendarDays size={17} />

          <span>
            Today
          </span>

          <strong>
            {todayIndia()}
          </strong>
        </div>

        <div>
          <Users size={17} />

          <span>
            Area
          </span>

          <strong>
            {selectedProject.sft
              ? `${Number(
                  selectedProject.sft
                ).toLocaleString('en-IN')} sq.ft`
              : '—'}
          </strong>
        </div>

        <div>
          <CheckCircle2 size={17} />

          <span>
            Status
          </span>

          <strong>
            {statusLabel(
              selectedProject.status
            )}
          </strong>
        </div>

      </section>

      {/* TODAY STATUS */}

      {todayUpdate && (
        <section className="staff-today-card">
          <div className="staff-today-icon">
            <CheckCircle2 size={20} />
          </div>

          <div>
            <span>
              TODAY'S UPDATE
            </span>

            <strong>
              {role === 'carpenter' ? 'Daily report already submitted' : 'Daily update already submitted'}
            </strong>

            <p>
              {todayUpdate.workCompleted ||
                todayUpdate.notes ||
                'Update submitted.'}
            </p>
          </div>

          <strong className="staff-today-progress">
            {Number(
              todayUpdate.progress || 0
            )}
            %
          </strong>
        </section>
      )}

      {/* UPDATE FORM */}

      {(['supervisor', 'carpenter'].includes(role)) && (
        <form
          className="staff-update-form"
          onSubmit={saveUpdate}
        >

          <div className="staff-section-heading">
            <div>
              <span>{role === 'carpenter' ? 'CARPENTER DAILY REPORT' : 'DAILY SITE UPDATE'}</span>
              <h2>{role === 'carpenter' ? "Report today's work" : "Record today's progress"}</h2>
              {role === 'carpenter' && <p className="staff-step-caption">Your report will be sent to the assigned supervisor for review. It will not change official project progress until approved.</p>}
              <p className="staff-step-caption">Section {formStep + 1} of 5 · Complete each section, then continue.</p>
            </div>
            <span className="staff-required-note">* Required</span>
          </div>

          <nav className="staff-form-stepper" aria-label="Daily update sections">
            {[
              { label: 'Daily work', short: '01' },
              { label: 'Progress', short: '02' },
              { label: 'Materials', short: '03' },
              { label: 'Site notes', short: '04' },
              { label: 'Photos', short: '05' },
            ].map((item, index) => (
              <button
                type="button"
                key={item.label}
                className={`staff-step-tab ${formStep === index ? 'active' : ''} ${formStep > index ? 'complete' : ''}`}
                aria-current={formStep === index ? 'step' : undefined}
                onClick={() => setFormStep(index)}
              >
                <span className="staff-step-number">{formStep > index ? '✓' : item.short}</span>
                <span className="staff-step-label">{item.label}</span>
              </button>
            ))}
          </nav>

          {formStep === 0 && (
            <div className="staff-form-step-content">
          {/* DATE */}

          <div className="staff-form-grid">
            <div className="staff-field">
              <label>
                Update date
                <span className="staff-required">
                  *
                </span>
              </label>

              <input
                type="date"
                value={form.date}
                onChange={(event) =>
                  updateField(
                    'date',
                    event.target.value
                  )
                }
              />
            </div>

            <div className="staff-field">
              <label>
                Manpower
              </label>

              <div className="staff-number-wrap">
                <Users size={16} />

                <input
                  type="number"
                  min="0"
                  value={form.manpower}
                  onChange={(event) =>
                    updateField(
                      'manpower',
                      event.target.value
                    )
                  }
                  placeholder="Number of workers"
                />
              </div>
            </div>
          </div>

          {/* WORK */}

          <div className="staff-form-card">
            <div className="staff-form-card-heading">
              <div>
                <span>
                  WORK
                </span>

                <h3>
                  What happened today?
                </h3>
              </div>
            </div>

            <VoiceField
              onChange={updateField}
              onVoiceResult={(field, transcript) => setForm((previous) => ({ ...previous, [field]: previous[field] ? `${previous[field]} ${transcript}` : transcript }))}
              field="workCompleted"
              value={form.workCompleted}
              label="Work completed"
              placeholder="Example: Kitchen carcass installation completed..."
              multiline
              required
            />

            <VoiceField
              onChange={updateField}
              onVoiceResult={(field, transcript) => setForm((previous) => ({ ...previous, [field]: previous[field] ? `${previous[field]} ${transcript}` : transcript }))}
              field="nextStep"
              value={form.nextStep}
              label="Next step"
              placeholder="Example: Start laminate work tomorrow..."
              multiline
            />
          </div>

            </div>
          )}

          {formStep === 1 && (
            <div className="staff-form-step-content">
          {/* UNIT-BASED PROGRESS */}
          <div className="staff-form-card">
            <div className="staff-progress-heading">
              <div>
                <span>COMPLETION BY UNIT</span>
                <h3>Update each unit's completion</h3>
                <p className="staff-muted">Overall progress is calculated automatically using the project weights.</p>
              </div>
              <strong>{calculateWeightedProgress(getProjectUnits(selectedProject), unitProgress)}%</strong>
            </div>
            <div className="staff-unit-progress-list">
              {getProjectUnits(selectedProject).map((unit) => {
                const value = Math.max(0, Math.min(100, Number(unitProgress[unit.id] ?? unit.progress ?? 0)))
                return (
                  <div className="staff-unit-progress-item" key={unit.id} style={{padding:'14px 0',borderBottom:'1px solid #e6ece8'}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:8}}>
                      <strong>{unit.label}</strong>
                      <span>{value}% · Weight {Number(unit.weight || 0)}%</span>
                    </div>
                    <input className="staff-range" aria-label={`${unit.label} completion`} type="range" min="0" max="100" step="5" value={value} onChange={(event) => {
                      const next = { ...unitProgress, [unit.id]: Number(event.target.value) }
                      setUnitProgress(next)
                      setForm((previous) => ({ ...previous, progress: calculateWeightedProgress(getProjectUnits(selectedProject), next) }))
                    }} />
                    <div className="staff-range-labels"><span>0%</span><span>50%</span><span>100%</span></div>
                  </div>
                )
              })}
            </div>
            <p className="staff-muted" style={{marginTop:12}}>Calculated project completion: <strong>{calculateWeightedProgress(getProjectUnits(selectedProject), unitProgress)}%</strong></p>
          </div>

            </div>
          )}

          {formStep === 2 && (
            <div className="staff-form-step-content">
          {/* MATERIALS */}

          <div className="staff-form-card">

            <div className="staff-form-card-heading">
              <div>
                <span>
                  MATERIALS
                </span>

                <h3>
                  Material status
                </h3>
              </div>

              <Package size={20} />
            </div>

            <VoiceField
              onChange={updateField}
              onVoiceResult={(field, transcript) => setForm((previous) => ({ ...previous, [field]: previous[field] ? `${previous[field]} ${transcript}` : transcript }))}
              field="materialsUsed"
              value={form.materialsUsed}
              label="Materials used today"
              placeholder="Example: 18mm plywood, laminate, hinges..."
              multiline
            />

            <VoiceField
              onChange={updateField}
              onVoiceResult={(field, transcript) => setForm((previous) => ({ ...previous, [field]: previous[field] ? `${previous[field]} ${transcript}` : transcript }))}
              field="materialsRequired"
              value={form.materialsRequired}
              label="Materials required"
              placeholder="Example: Drawer channels, adhesive..."
              multiline
            />
          </div>

            </div>
          )}

          {formStep === 3 && (
            <div className="staff-form-step-content">
          {/* ISSUES */}

          <div className="staff-form-card">

            <div className="staff-form-card-heading">
              <div>
                <span>
                  SITE STATUS
                </span>

                <h3>
                  Issues & safety
                </h3>
              </div>

              <AlertTriangle size={20} />
            </div>

            <VoiceField
              onChange={updateField}
              onVoiceResult={(field, transcript) => setForm((previous) => ({ ...previous, [field]: previous[field] ? `${previous[field]} ${transcript}` : transcript }))}
              field="issues"
              value={form.issues}
              label="Issues / blockers"
              placeholder="Mention anything delaying the work..."
              multiline
            />

            <VoiceField
              onChange={updateField}
              onVoiceResult={(field, transcript) => setForm((previous) => ({ ...previous, [field]: previous[field] ? `${previous[field]} ${transcript}` : transcript }))}
              field="safety"
              value={form.safety}
              label="Safety / housekeeping"
              placeholder="Example: Site cleaned and tools stored safely..."
              multiline
            />
          </div>

          {/* NOTES */}

          <div className="staff-form-card">

            <VoiceField
              onChange={updateField}
              onVoiceResult={(field, transcript) => setForm((previous) => ({ ...previous, [field]: previous[field] ? `${previous[field]} ${transcript}` : transcript }))}
              field="notes"
              value={form.notes}
              label="Additional notes"
              placeholder="Any additional information for admin..."
              multiline
            />
          </div>

            </div>
          )}

          {formStep === 4 && (
            <div className="staff-form-step-content">
          {/* PHOTOS */}

          <div className="staff-form-card">

            <div className="staff-form-card-heading">
              <div>
                <span>
                  SITE PHOTOS
                </span>

                <h3>
                  Add today's photos
                </h3>
              </div>

              <ImageIcon size={20} />
            </div>

            <label className="staff-upload-box">
              <ImageIcon size={24} />

              <strong>
                Add site photos
              </strong>

              <span>
                You can select multiple images and
                add more later.
              </span>

              <input
                type="file"
                accept="image/*"
                multiple
                onChange={addPhotos}
              />
            </label>

            {photoPreviews.length > 0 && (
              <div className="staff-photo-grid">

                {photoPreviews.map(
                  (photo, index) => (
                    <div
                      key={photo.id}
                      className="staff-photo"
                    >
                      <img
                        src={photo.url}
                        alt={
                          photo.name ||
                          `Site photo ${
                            index + 1
                          }`
                        }
                      />

                      <button
                        type="button"
                        onClick={() =>
                          removePhoto(index)
                        }
                        aria-label="Remove photo"
                      >
                        <X size={15} />
                      </button>

                      <span>
                        {index + 1}
                      </span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

            </div>
          )}

          {/* SAVE */}

          <div className="staff-save-bar">

            <div>
              <strong>
                Ready to save?
              </strong>

              <span>
                {photos.length} photo
                {photos.length === 1
                  ? ''
                  : 's'} selected
              </span>
            </div>

            <div className="staff-step-actions">
              {formStep > 0 && (
                <button type="button" className="staff-step-back" onClick={() => setFormStep((step) => Math.max(0, step - 1))} disabled={saving}>
                  <ArrowLeft size={16} /> Previous
                </button>
              )}
              {formStep < 4 ? (
                <button type="button" className="staff-save-btn" onClick={() => setFormStep((step) => Math.min(4, step + 1))} disabled={saving}>
                  Continue <ChevronRight size={17} />
                </button>
              ) : (
                <button type="submit" className="staff-save-btn" disabled={saving}>
                  {saving
                    ? <><Loader2 size={17} className="staff-spinner" /> Saving...</>
                    : <><Save size={17} /> {role === 'carpenter' ? 'Submit daily report' : 'Save daily update'}</>}
                </button>
              )}
            </div>
          </div>

        </form>
      )}
      {(['supervisor', 'carpenter'].includes(role)) && (
 <section className="staff-materials-panel">
  <div className="staff-section-heading">
    <div className="staff-section-icon">
      <Package size={20} />
    </div>

    <div>
      <span className="staff-eyebrow">
        PROJECT MATERIALS
      </span>
      <h2>Material requests</h2>
      <p>
        Request the materials needed for the next stage of work
        and track their approval status.
      </p>
    </div>
  </div>

  <MaterialRequests
    project={selectedProject}
    role={role}
  />
</section>
)}

      {/* HISTORY */}

      <section className="staff-history">

        <button
          type="button"
          className="staff-history-toggle"
          onClick={() =>
            setShowHistory(
              (previous) => !previous
            )
          }
        >
          <div>
            <span>
              PROJECT HISTORY
            </span>

            <strong>
              Daily updates
            </strong>
          </div>

          <span>
            {updates.length}
          </span>
        </button>

        {showHistory && (
          <div className="staff-history-body">

            {loadingUpdates ? (
              <div className="staff-history-loading">
                <Loader2
                  size={20}
                  className="staff-spinner"
                />

                Loading updates...
              </div>
            ) : updates.length === 0 ? (
              <div className="staff-history-empty">
                <CalendarDays size={22} />

                <strong>
                  No daily updates yet
                </strong>

                <p>
                  The project's daily site history
                  will appear here.
                </p>
              </div>
            ) : (
              updates.map((update) => (
                <UpdateHistoryCard
                  key={update.id}
                  update={update}
                />
              ))
            )}

          </div>
        )}
      </section>

    </div>
  )
}

/* =========================================================
   CARPENTER VIEW
========================================================= */


function CarpenterProjectView({
  project,
  updates,
  role,
}) {
  const latest = updates[0]

  return (
    <div className="staff-carpenter-view">
      <section className="staff-form-card">
        <div className="staff-form-card-heading">
          <div>
            <span>TODAY'S SITE STATUS</span>
            <h3>Current project progress</h3>
          </div>

          <strong className="staff-carpenter-progress">
            {Math.max(
              0,
              Math.min(100, Number(project?.progress || 0))
            )}
            %
          </strong>
        </div>

        <div className="staff-project-track large">
          <div
            style={{
              width: `${Math.max(
                0,
                Math.min(100, Number(project?.progress || 0))
              )}%`,
            }}
          />
        </div>

        {latest ? (
          <div className="staff-latest-update">
            <span>
              Latest supervisor update · {formatDate(latest.date)}
            </span>

            <strong>
              {latest.workCompleted ||
                latest.note ||
                'No work description'}
            </strong>

            {latest.nextStep && (
              <p>Next: {latest.nextStep}</p>
            )}

            {Array.isArray(latest.images) &&
              latest.images.length > 0 && (
                <div className="staff-photo-grid">
                  {latest.images.map((image, index) => (
                    <a
                      key={`${image}-${index}`}
                      href={image}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={image}
                        alt={`Latest site photo ${index + 1}`}
                      />
                    </a>
                  ))}
                </div>
              )}
          </div>
        ) : (
          <p className="staff-muted">
            No daily update has been submitted yet.
          </p>
        )}
      </section>

      <section className="staff-form-card">
        <MaterialRequests
          project={project}
          role={role}
        />
      </section>
    </div>
  )
}


/* =========================================================
   UPDATE HISTORY
========================================================= */

function UpdateHistoryCard({
  update,
}) {
  const [expanded, setExpanded] =
    useState(false)

  const images = Array.isArray(
    update.images
  )
    ? update.images
    : []

  return (
    <article className="staff-history-card">

      <button
        type="button"
        className="staff-history-card-head"
        onClick={() =>
          setExpanded(
            (previous) => !previous
          )
        }
      >
        <div className="staff-history-date">
          <CalendarDays size={16} />

          <div>
            <strong>
              {formatDate(update.date)}
            </strong>

            <span>
              {update.workCompleted ||
                'Daily update'}
            </span>
          </div>
        </div>

        <div className="staff-history-progress">
          <strong>
            {Number(
              update.progress || 0
            )}
            %
          </strong>

          <ChevronRight
            size={17}
            className={
              expanded
                ? 'rotate'
                : ''
            }
          />
        </div>
      </button>

      {expanded && (
        <div className="staff-history-card-body">

          <HistoryRow
            label="Work completed"
            value={
              update.workCompleted
            }
          />

          <HistoryRow
            label="Next step"
            value={
              update.nextStep
            }
          />

          <HistoryRow
            label="Manpower"
            value={
              update.manpower
                ? `${update.manpower} workers`
                : ''
            }
          />

          <HistoryRow
            label="Materials used"
            value={
              update.materialsUsed
            }
          />

          <HistoryRow
            label="Materials required"
            value={
              update.materialsRequired
            }
          />

          <HistoryRow
            label="Issues / blockers"
            value={
              update.issues
            }
          />

          <HistoryRow
            label="Safety / housekeeping"
            value={
              update.safety
            }
          />

          <HistoryRow
            label="Notes"
            value={
              update.notes
            }
          />

          {images.length > 0 && (
            <div className="staff-history-images">

              <span>
                Photos · {images.length}
              </span>

              <div>
                {images.map(
                  (image, index) => (
                    <a
                      key={`${image}-${index}`}
                      href={image}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={image}
                        alt={`Update ${
                          index + 1
                        }`}
                      />
                    </a>
                  )
                )}
              </div>

            </div>
          )}

        </div>
      )}
    </article>
  )
}

function HistoryRow({
  label,
  value,
}) {
  if (!value) return null

  return (
    <div className="staff-history-row">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  )
}
