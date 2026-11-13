
import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import {
  MoreVertical,
  Eye,
  Pencil,
  Trash2,
  X,
  ArrowLeft,
} from 'lucide-react'
import { db, functions, auth } from '../firebase'

export default function Team({ canWrite = false }) {
  const [f, setF] = useState({
    name: '',
    email: '',
  })

  const [staff, setStaff] = useState([])
  const [availableRoles, setAvailableRoles] = useState([])
  const [customRoleId, setCustomRoleId] = useState('')

  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const [menuId, setMenuId] = useState(null)
  const [selectedMember, setSelectedMember] = useState(null)
  const [modal, setModal] = useState('')
  const [editForm, setEditForm] = useState({
    name: '',
    customRoleId: '',
  })
  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => {
    return onSnapshot(
      collection(db, 'roles'),
      snapshot => {
        setAvailableRoles(
          snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        )
      },
      error => {
        console.error('Failed to load roles:', error)
      }
    )
  }, [])

  useEffect(() => {
    const q = query(
      collection(db, 'users'),
      where('role', 'in', [
        'supervisor',
        'carpenter',
        'client',
      ])
    )

    return onSnapshot(
      q,
      snapshot => {
        setStaff(
          snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(member => member.id !== auth.currentUser?.uid)
        )
        setLoading(false)
      },
      error => {
        console.error('Failed to load team:', error)
        setMsg('Could not load team members. Check Firestore permissions.')
        setMsgType('error')
        setLoading(false)
      }
    )
  }, [])

  const assignableRoles = useMemo(
    () =>
      availableRoles.filter(
        r => !r.system && r.baseRole !== 'admin'
      ),
    [availableRoles]
  )

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase()

    return staff.filter(member => {
      const matchesRole =
        filter === 'all' ||
        member.role === filter ||
        member.customRoleId === filter

      const matchesSearch =
        !term ||
        member.name?.toLowerCase().includes(term) ||
        member.email?.toLowerCase().includes(term) ||
        member.customRoleName?.toLowerCase().includes(term) ||
        member.role?.toLowerCase().includes(term)

      return matchesRole && matchesSearch
    })
  }, [staff, filter, search])

  const supervisors = staff.filter(
    member => member.role === 'supervisor'
  ).length

  const carpenters = staff.filter(
    member => member.role === 'carpenter'
  ).length

  const openDetails = member => {
    setSelectedMember(member)
    setModal('view')
    setMenuId(null)
  }

  const openEdit = member => {
    setSelectedMember(member)

    setEditForm({
      name: member.name || '',
      customRoleId: member.customRoleId || '',
    })

    setModal('edit')
    setMenuId(null)
    setMsg('')
  }

  const closeModal = () => {
    if (actionBusy) return
    setModal('')
    setSelectedMember(null)
  }

  const add = async e => {
    e.preventDefault()

    if (!canWrite) return

    if (busy) return

    if (!customRoleId) {
      setMsg('Please choose a role.')
      setMsgType('error')
      return
    }

    setBusy(true)
    setMsg('')
    setMsgType('')

    try {
      const createStaff = httpsCallable(functions, 'createStaff')

      const result = await createStaff({
        name: f.name.trim(),
        email: f.email.trim(),
        customRoleId,
      })

      console.log('createStaff response:', result.data)

      setMsg(`Account creation completed for ${f.email}.`)
      setMsgType('success')
      setF({ name: '', email: '' })
      setCustomRoleId('')
    } catch (err) {
      console.error('createStaff failed:', err)

      let message = err?.message || 'Failed to create team member.'

      if (err?.code === 'functions/permission-denied') {
        message = 'Only an admin can create team members.'
      } else if (err?.code === 'functions/already-exists') {
        message = 'This email already has a login.'
      } else if (err?.code === 'functions/invalid-argument') {
        message = 'Please enter a valid name, email and role.'
      }

      setMsg(message)
      setMsgType('error')
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async e => {
    e.preventDefault()

    if (!canWrite) return

    if (!selectedMember || actionBusy) return

    const selectedRole = assignableRoles.find(
      role => role.id === editForm.customRoleId
    )

    if (!selectedRole) {
      setMsg('Please select a valid custom role.')
      setMsgType('error')
      return
    }

    setActionBusy(true)

    try {
await updateDoc(doc(db, 'users', selectedMember.id), {
  name: editForm.name.trim(),
  role: selectedRole.baseRole,
  customRoleId: selectedRole.id,
  customRoleName: selectedRole.name,
  permissions: selectedRole.permissions || {},
})

      setModal('')
      setSelectedMember(null)
      setMsg('Team member updated successfully.')
      setMsgType('success')
    } catch (error) {
      console.error('Failed to update team member:', error)
      setMsg(error.message || 'Could not update team member.')
      setMsgType('error')
    } finally {
      setActionBusy(false)
    }
  }

  const deleteMember = async () => {
    if (!canWrite) return
    if (!selectedMember || actionBusy) return

    setActionBusy(true)

    try {
      // This removes the Firestore profile only.
      // It does NOT delete the Firebase Authentication account.
      await deleteDoc(doc(db, 'users', selectedMember.id))

      setModal('')
      setSelectedMember(null)
      setMsg('Team member profile deleted.')
      setMsgType('success')
    } catch (error) {
      console.error('Failed to delete team member:', error)
      setMsg(error.message || 'Could not delete team member.')
      setMsgType('error')
    } finally {
      setActionBusy(false)
    }
  }

  const selectedRole = assignableRoles.find(
    role => role.id === customRoleId
  )

  return (
    <main className="team-page">
      <div className="team-heading">
        <div>
          <span className="eyebrow">North East Interiors</span>
          <h1>Team Management</h1>
          <p>Manage your employees, roles and team access.</p>
        </div>

        <div className="team-total">
          <span>Total Members</span>
          <strong>{staff.length}</strong>
        </div>
      </div>

      <div className="team-stats">
        <div className="team-stat-card">
          <div className="team-stat-icon supervisor-icon">S</div>
          <div>
            <span>Supervisors</span>
            <strong>{supervisors}</strong>
          </div>
        </div>

        <div className="team-stat-card">
          <div className="team-stat-icon carpenter-icon">C</div>
          <div>
            <span>Carpenters</span>
            <strong>{carpenters}</strong>
          </div>
        </div>

        <div className="team-stat-card">
          <div className="team-stat-icon total-icon">T</div>
          <div>
            <span>Active Team</span>
            <strong>{staff.length}</strong>
          </div>
        </div>
      </div>

      <div className="team-layout">
        {canWrite && <section className="team-create-card">
          <div className="team-card-heading">
            <div className="team-heading-icon">＋</div>
            <div>
              <span className="eyebrow">Team onboarding</span>
              <h2>Add Team Member</h2>
              <p>Create a login for your site staff.</p>
            </div>
          </div>

          <form className="team-form" onSubmit={add}>
            <div className="team-field">
              <label htmlFor="staff-name">Full Name</label>
              <input
                id="staff-name"
                required
                placeholder="Enter full name"
                value={f.name}
                onChange={e =>
                  setF({ ...f, name: e.target.value })
                }
              />
            </div>

            <div className="team-field">
              <label htmlFor="staff-email">Email Address</label>
              <input
                id="staff-email"
                required
                type="email"
                placeholder="name@example.com"
                value={f.email}
                onChange={e =>
                  setF({ ...f, email: e.target.value })
                }
              />
            </div>

            <div className="team-field">
              <label htmlFor="staff-role">Role *</label>
              <select
                id="staff-role"
                required
                value={customRoleId}
                onChange={e => setCustomRoleId(e.target.value)}
              >
                <option value="">Choose a role</option>
                {assignableRoles.map(role => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedRole && (
              <div className="team-role-preview">
                <span className="team-role-preview-icon">
                  {(selectedRole.name || 'R').charAt(0).toUpperCase()}
                </span>
                <div>
                  <strong>{selectedRole.name}</strong>
                  <p>
                    {selectedRole.description ||
                      'Access is based on the permissions configured for this role.'}
                  </p>
                </div>
              </div>
            )}

            <button className="btn team-submit" disabled={busy}>
              {busy ? 'Creating Account...' : 'Create Login & Send Email'}
            </button>

            {msg && (
              <div className={`team-message ${msgType}`} role="status">
                <span>{msgType === 'success' ? '✓' : '!'}</span>
                {msg}
              </div>
            )}
          </form>
        </section>}

        <section className="team-directory">
          <div className="team-directory-heading">
            <div>
              <span className="eyebrow">People & access</span>
              <h2>Your Team</h2>
              <p>View and manage registered team members.</p>
            </div>
            <span className="team-member-count">
              {staff.length} Members
            </span>
          </div>

          <div className="team-controls">
            <div className="team-search">
              <span>⌕</span>
              <input
                aria-label="Search team members"
                placeholder="Search by name or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <select
              aria-label="Filter team by role"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            >
              <option value="all">All Roles</option>
              {assignableRoles.map(role => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
              <option value="supervisor">Supervisors</option>
              <option value="carpenter">Carpenters</option>
              <option value="client">Clients</option>
            </select>
          </div>

          {loading ? (
            <div className="team-empty">Loading team members...</div>
          ) : filteredStaff.length === 0 ? (
            <div className="team-empty">
              <div className="team-empty-icon">♙</div>
              <h3>
                {staff.length
                  ? 'No matching members'
                  : 'No team members yet'}
              </h3>
              <p>
                {staff.length
                  ? 'Try changing your search or role filter.'
                  : 'Create your first employee account using the form.'}
              </p>
            </div>
          ) : (
            <div className="team-member-list">
              {filteredStaff.map(member => (
                <div className="team-member" key={member.id}>
                  <div className={`team-avatar ${member.role}`}>
                    {(member.name || member.email || '?')
                      .charAt(0)
                      .toUpperCase()}
                  </div>

                  <div className="team-member-info">
                    <strong>{member.name || 'Unnamed member'}</strong>
                    <span>{member.email}</span>
                  </div>

                  <span className={`team-role-badge ${member.role}`}>
                    {member.customRoleName || member.role}
                  </span>

                  <div className="team-member-actions">
                    <button
                      type="button"
                      className="team-action-trigger"
                      aria-label={`Actions for ${member.name || member.email}`}
                      aria-expanded={menuId === member.id}
                      onClick={() =>
                        setMenuId(previous =>
                          previous === member.id ? null : member.id
                        )
                      }
                    >
                      <MoreVertical size={19} />
                    </button>

                    {menuId === member.id && (
                      <div className="team-action-menu">
                        <button
                          type="button"
                          onClick={() => openDetails(member)}
                        >
                          <Eye size={16} />
                          View
                        </button>

                        {canWrite && <button
                          type="button"
                          onClick={() => openEdit(member)}
                        >
                          <Pencil size={16} />
                          Edit
                        </button>}

                        {canWrite && <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            setSelectedMember(member)
                            setModal('delete')
                            setMenuId(null)
                          }}
                        >
                          <Trash2 size={16} />
                          Delete
                        </button>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {modal && selectedMember && (
        <div
          className="team-modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <section
            className="team-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-modal-title"
          >
            <div className="team-modal-heading">
              <div>
                <span className="eyebrow">People & access</span>
                <h2 id="team-modal-title">
                  {modal === 'view'
                    ? 'Team member details'
                    : modal === 'edit'
                      ? 'Edit team member'
                      : 'Delete team member'}
                </h2>
              </div>

                        {canWrite && <button
                type="button"
                className="team-modal-close"
                onClick={closeModal}
                aria-label="Close dialog"
              >
                <X size={20} />
                        </button>}
            </div>

            {modal === 'view' && (
              <div className="team-detail-list">
                <div>
                  <span>Full name</span>
                  <strong>{selectedMember.name || '—'}</strong>
                </div>
                <div>
                  <span>Email address</span>
                  <strong>{selectedMember.email || '—'}</strong>
                </div>
                <div>
                  <span>Workspace role</span>
                  <strong>{selectedMember.role || '—'}</strong>
                </div>
                <div>
                  <span>Custom role</span>
                  <strong>{selectedMember.customRoleName || 'Not assigned'}</strong>
                </div>
                <div>
                  <span>User ID</span>
                  <strong className="team-user-id">{selectedMember.id}</strong>
                </div>
                <div>
                  <span>Permissions</span>
                  <pre>
                    {JSON.stringify(selectedMember.permissions || {}, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {modal === 'edit' && (
              <form className="team-form" onSubmit={saveEdit}>
                <div className="team-field">
                  <label htmlFor="edit-staff-name">Full Name</label>
                  <input
                    id="edit-staff-name"
                    required
                    value={editForm.name}
                    onChange={e =>
                      setEditForm({
                        ...editForm,
                        name: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="team-field">
                  <label>Email Address</label>
                  <input value={selectedMember.email || ''} disabled />
                  <small>
                    Email changes require a separate Firebase Authentication
                    workflow.
                  </small>
                </div>

                <div className="team-field">
                  <label htmlFor="edit-staff-role">Assigned Role *</label>
                  <select
                    id="edit-staff-role"
                    required
                    value={editForm.customRoleId}
                    onChange={e =>
                      setEditForm({
                        ...editForm,
                        customRoleId: e.target.value,
                      })
                    }
                  >
                    <option value="">Choose a role</option>
                    {assignableRoles.map(role => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="team-modal-actions">
                  <button
                    type="button"
                    className="team-secondary-btn"
                    onClick={closeModal}
                    disabled={actionBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="team-primary-btn"
                    disabled={actionBusy}
                  >
                    {actionBusy ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </form>
            )}

            {modal === 'delete' && (
              <div className="team-delete-content">
                <div className="team-delete-icon">
                  <Trash2 size={24} />
                </div>
                <p>
                  Delete the Firestore profile for{' '}
                  <strong>
                    {selectedMember.name || selectedMember.email}
                  </strong>
                  ?
                </p>
                <p className="team-delete-warning">
                  This action removes the profile document only. The Firebase
                  Authentication account will remain active until deleted
                  separately through a protected Cloud Function.
                </p>

                <div className="team-modal-actions">
                  <button
                    type="button"
                    className="team-secondary-btn"
                    onClick={closeModal}
                    disabled={actionBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="team-danger-btn"
                    onClick={deleteMember}
                    disabled={actionBusy}
                  >
                    {actionBusy ? 'Deleting...' : 'Delete profile'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
