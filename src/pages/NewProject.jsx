import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { ArrowLeft, BedDouble, Check, ImagePlus, IndianRupee, Mail, MapPin, Phone, Plus, Trash2, Tv, UserRound, Utensils, X } from 'lucide-react'
import { db, storage } from '../firebase'
import '../styles/admin.css'
import '../styles/new-project-reference.css'

export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN')
const MAX_IMAGES_PER_CATEGORY = 8
const MAX_FILE_SIZE = 8 * 1024 * 1024
const makeRoom = (id, label, icon = BedDouble, weight = 0) => ({ id, label, icon, weight, images: [] })
const initialRooms = [
  makeRoom('tvUnit', 'TV unit', Tv, 30),
  makeRoom('masterBedroom', 'Master bedroom', BedDouble, 25),
  makeRoom('kitchen', 'Kitchen', Utensils, 30),
  makeRoom('dining', 'Dining', Utensils, 15),
]

export default function NewProject({ onDone }) {
  const [form, setForm] = useState({ name: '', clientName: '', clientPhone: '', clientEmail: '', siteAddress: '', sft: '', rate: '', total: '' })
  const [installments, setInstallments] = useState([
    { id: 'advance', type: 'advance', label: 'Advance', amount: '', dueDate: '' },
    { id: 'midpoint', type: 'midpoint', label: '50% of work completed', amount: '', dueDate: '' },
    { id: 'final', type: 'final', label: 'Final settlement', amount: '', dueDate: '' },
  ])
  const [rooms, setRooms] = useState(initialRooms)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pickerRoomId, setPickerRoomId] = useState(null)
  const pickerRef = useRef(null)
  const objectUrls = useRef([])
  const calculatedTotal = useMemo(() => Number(form.sft || 0) * Number(form.rate || 0), [form.sft, form.rate])

  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])
  const setField = (key) => (event) => {
    const value = event.target.value
    setForm((old) => {
      const next = { ...old, [key]: value }
      if (key === 'sft' || key === 'rate') next.total = String(Number(next.sft || 0) * Number(next.rate || 0))
      return next
    })
  }

  function addRoom() {
    setRooms((old) => [...old, makeRoom(`bedroom-${Date.now()}`, `Bedroom ${old.filter((r) => /bedroom/i.test(r.label)).length + 1}`, BedDouble, 0)])
  }
  function chooseImages(roomId) {
    setPickerRoomId(roomId)
    requestAnimationFrame(() => pickerRef.current?.click())
  }
  function onFiles(event) {
    const files = Array.from(event.target.files || [])
    if (!pickerRoomId || !files.length) return
    const room = rooms.find((r) => r.id === pickerRoomId)
    const remaining = MAX_IMAGES_PER_CATEGORY - (room?.images.length || 0)
    const accepted = []
    for (const file of files.slice(0, remaining)) {
      if (!file.type.startsWith('image/')) { setError(`${file.name} is not an image.`); continue }
      if (file.size > MAX_FILE_SIZE) { setError(`${file.name} is larger than 8 MB.`); continue }
      const previewUrl = URL.createObjectURL(file)
      objectUrls.current.push(previewUrl)
      accepted.push({ id: crypto.randomUUID(), file, previewUrl })
    }
    setRooms((old) => old.map((r) => r.id === pickerRoomId ? { ...r, images: [...r.images, ...accepted] } : r))
    setPickerRoomId(null)
    event.target.value = ''
  }
  function removeImage(roomId, imageId) {
    setRooms((old) => old.map((r) => r.id === roomId ? { ...r, images: r.images.filter((img) => img.id !== imageId) } : r))
  }
  function updateInstallment(id, key, value) {
    // Only the advance amount is editable. The other milestones are calculated from the project total.
    if (key === 'amount' && id !== 'advance') return
    setInstallments((old) => old.map((item) => item.id === id ? { ...item, [key]: value } : item))
  }

  const planTotal = Number(form.total || calculatedTotal || 0)
  const advanceAmount = Number(installments.find((item) => item.type === 'advance')?.amount || 0)
  const midpointAmount = Math.round(planTotal * 0.5)
  const finalAmount = Math.max(0, planTotal - advanceAmount - midpointAmount)

  async function createProject(event) {
    event.preventDefault(); setError(''); setSuccess('')
    if (!form.name.trim() || !form.clientName.trim() || !form.siteAddress.trim()) { setError('Enter the project name, customer and site address.'); return }
    if (!form.clientPhone.trim() || !form.clientEmail.trim()) { setError('Enter the client mobile number and email.'); return }
    if (!(Number(form.sft) > 0) || !(Number(form.rate) > 0) || !(Number(form.total) > 0)) { setError('Enter valid area, rate and project amount.'); return }
    if (!(advanceAmount > 0)) { setError('Enter the booking advance amount.'); return }
    const weightTotal = rooms.reduce((sum, room) => sum + Number(room.weight || 0), 0)
    if (rooms.length === 0 || rooms.some((room) => Number(room.weight) < 0) || Math.abs(weightTotal - 100) > 0.001) { setError(`Unit weights must total exactly 100%. Current total: ${weightTotal}%. Update the weights before creating the project.`); return }
    if (advanceAmount + midpointAmount > planTotal) { setError('The advance cannot exceed the remaining amount after the 50% milestone. Reduce the advance amount.'); return }
    setBusy(true)
    let failedStep = 'Preparing project'
    try {
      const projectRef = doc(collection(db, 'projects'))
      const designReferences = {}
      const flatReferences = []
      failedStep = 'Uploading reference images to Firebase Storage'
      for (const room of rooms) {
        designReferences[room.id] = []
        for (let index = 0; index < room.images.length; index += 1) {
          const image = room.images[index]
          const safeName = image.file.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
          const imageRef = ref(storage, `projects/${projectRef.id}/design-references/${room.id}/${Date.now()}-${index}-${safeName}`)
          await uploadBytes(imageRef, image.file)
          const url = await getDownloadURL(imageRef)
          designReferences[room.id].push(url); flatReferences.push(url)
        }
      }
      failedStep = 'Preparing Firestore project records'
      const batch = writeBatch(db)
      batch.set(projectRef, {
        name: form.name.trim(), clientName: form.clientName.trim(), clientPhone: form.clientPhone.trim(), clientEmail: form.clientEmail.trim().toLowerCase(),
        siteAddress: form.siteAddress.trim(),
        // Dates are confirmed by the client in their proposal and finalized by admin approval.
        sft: Number(form.sft), rate: Number(form.rate), total: Number(form.total), quotationTotal: Number(form.total), quotedAmount: Number(form.total), paid: 0, status: 'quoted', progress: 0,
        units: rooms.map(({ id, label, weight }) => ({ id, label, weight: Number(weight || 0), progress: 0 })), unitProgress: Object.fromEntries(rooms.map((room) => [room.id, 0])),
        installments: installments.map((item) => ({
          type: item.type,
          label: item.label,
          amount: item.type === 'advance' ? advanceAmount : item.type === 'midpoint' ? midpointAmount : finalAmount,
          dueDate: item.dueDate || '',
        })),
        designReferences, refImages: flatReferences, createdAt: serverTimestamp(),
      })
      batch.set(doc(db, 'projects', projectRef.id, 'private', 'contact'), { clientPhone: form.clientPhone.trim(), clientEmail: form.clientEmail.trim().toLowerCase() })
      failedStep = 'Saving project and private contact records to Firestore'
      await batch.commit()
      setSuccess('Project created successfully.')
      onDone?.()
    } catch (err) {
      console.error('Project creation failed:', {
        step: failedStep,
        code: err?.code || 'unknown-error',
        message: err?.message || 'No error message provided',
        error: err,
      })

      setError(
        `${failedStep} failed (${err?.code || 'unknown-error'}): ${
          err?.message || 'Check Firebase permissions and try again.'
        }`
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="np-reference-page">
      <div className="np-reference-page-title"><button type="button" onClick={() => onDone?.()} aria-label="Back to projects"><ArrowLeft size={20}/></button><h1>New project</h1></div>
      <form className="np-reference-form" onSubmit={createProject}>
        <section className="np-reference-section">
          <h2>BASIC DETAILS</h2>
          <label className="np-reference-field"><span>Project name *</span><input required value={form.name} onChange={setField('name')} placeholder="Sharma residence" /></label>
          <label className="np-reference-field"><span>Customer *</span><div className="np-reference-input-icon"><UserRound size={18}/><input required value={form.clientName} onChange={setField('clientName')} placeholder="Customer full name" /></div></label>
          <label className="np-reference-field"><span>Site address *</span><div className="np-reference-input-icon"><MapPin size={18}/><input required value={form.siteAddress} onChange={setField('siteAddress')} placeholder="Flat 4B, Green Meadows" /></div></label>
          <div className="np-reference-grid two"><label className="np-reference-field"><span>Client mobile *</span><div className="np-reference-input-icon"><Phone size={18}/><input required type="tel" value={form.clientPhone} onChange={setField('clientPhone')} placeholder="919876543210" /></div></label><label className="np-reference-field"><span>Client email *</span><div className="np-reference-input-icon"><Mail size={18}/><input required type="email" value={form.clientEmail} onChange={setField('clientEmail')} placeholder="client@example.com" /></div></label></div>
        </section>
        <section className="np-reference-section">
          <h2>AREA &amp; VALUE</h2>
          <div className="np-reference-grid two"><label className="np-reference-field"><span>Total sft *</span><input required min="1" type="number" value={form.sft} onChange={setField('sft')} placeholder="1450" /></label><label className="np-reference-field"><span>Rate / sft</span><div className="np-reference-input-icon"><IndianRupee size={18}/><input required min="1" type="number" value={form.rate} onChange={setField('rate')} placeholder="1800" /></div></label></div>
          <label className="np-reference-field"><span>Project amount *</span><input required min="1" type="number" value={form.total} onChange={setField('total')} placeholder={`Auto-fills: ${calculatedTotal.toLocaleString('en-IN')}`} /></label>
        </section>
        <section className="np-reference-section">
          <h2>PAYMENT INSTALLMENTS</h2>
          {installments.map((item) => {
            const amount = item.type === 'advance' ? advanceAmount : item.type === 'midpoint' ? midpointAmount : finalAmount
            return <div className="np-reference-installment" key={item.id}>
              <div className="np-reference-grid installment-grid">
                <label className="np-reference-field"><span>Milestone</span><select value={item.type} disabled aria-label="Payment milestone"><option value="advance">Advance</option><option value="midpoint">50% of work completed</option><option value="final">Final settlement</option></select></label>
                <label className="np-reference-field"><span>Amount (₹)</span><input min="0" type="number" readOnly={item.type !== 'advance'} value={item.type === 'advance' ? item.amount : amount} onChange={(e) => updateInstallment(item.id, 'amount', e.target.value)} placeholder={item.type === 'advance' ? 'Enter advance amount' : ''} required={item.type === 'advance'} /></label>
              </div>
              <label className="np-reference-field"><span>Due date (optional)</span><input type="date" value={item.dueDate} onChange={(e) => updateInstallment(item.id, 'dueDate', e.target.value)} /></label>
            </div>
          })}
          <div className="np-reference-installment-summary">
            <span>Advance <strong>{inr(advanceAmount)}</strong></span>
            <span>At 50% work <strong>{inr(midpointAmount)}</strong></span>
            <span>Final settlement <strong>{inr(finalAmount)}</strong></span>
            <span>Total plan <strong>{inr(advanceAmount + midpointAmount + finalAmount)}</strong></span>
          </div>
          <p className="np-reference-hint">Enter only the advance. The 50% milestone and final settlement are calculated automatically from the project amount.</p>
        </section>
        <section className="np-reference-section np-reference-rooms-section">
          <h2>REFERENCE IMAGES</h2>
          <p className="np-reference-intro">Upload design references for each room. You can add up to {MAX_IMAGES_PER_CATEGORY} images per room (8 MB maximum each).</p>
          {rooms.map((room) => {
            const Icon = room.icon
            return <div className="np-reference-room" key={room.id}>
              <div className="np-reference-room-heading"><span>{room.label}</span><label style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>Project weight (%)<input aria-label={`${room.label} project weight`} type="number" min="0" max="100" step="1" value={room.weight} onChange={(event) => setRooms((old) => old.map((item) => item.id === room.id ? {...item, weight: event.target.value === '' ? '' : Number(event.target.value)} : item))} style={{width:82}} /></label>{room.id !== 'tvUnit' && room.id !== 'masterBedroom' && room.id !== 'kitchen' && room.id !== 'dining' && <button type="button" onClick={() => setRooms((old) => old.filter((r) => r.id !== room.id))} aria-label={`Remove ${room.label}`}><X size={16}/></button>}</div>
              <div className="np-reference-room-images">{room.images.map((image, i) => <div className="np-reference-room-thumb" key={image.id}><img src={image.previewUrl} alt={`${room.label} ${i + 1}`}/><button type="button" onClick={() => removeImage(room.id, image.id)} aria-label="Remove image"><X size={14}/></button></div>)}
                {room.images.length < MAX_IMAGES_PER_CATEGORY && <button type="button" className="np-reference-upload-tile" onClick={() => chooseImages(room.id)} aria-label={`Add ${room.label} images`}><ImagePlus size={25}/><span>{room.images.length ? 'Add more' : '+'}</span></button>}
              </div>
            </div>
          })}
          <p className="np-reference-hint">Unit weights define each unit's contribution to overall project completion. Total weight must equal 100%. Current total: <strong>{rooms.reduce((sum, room) => sum + Number(room.weight || 0), 0)}%</strong>.</p>
          <button type="button" className="np-reference-outline-button" onClick={addRoom}><Plus size={19}/> Add another bedroom</button>
          <input ref={pickerRef} type="file" accept="image/*" multiple hidden onChange={onFiles}/>
        </section>
        {error && <div className="np-reference-alert error"><X size={18}/>{error}</div>}
        {success && <div className="np-reference-alert success"><Check size={18}/>{success}</div>}
        <div className="np-reference-submit-wrap"><button className="np-reference-submit" type="submit" disabled={busy}>{busy ? 'Creating project…' : 'Create project'}</button><p>Project amount: <strong>{inr(form.total || calculatedTotal)}</strong></p></div>
      </form>
    </div>
  )
}
