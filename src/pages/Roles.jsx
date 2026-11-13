
import { useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  doc,
} from 'firebase/firestore'
import {
  ArrowLeft,
  Plus,
  ShieldCheck,
  Eye,
  Pencil,
  Trash2,
} from 'lucide-react'
import { db } from '../firebase'
import '../styles/roles.css'


const MODULE_GROUPS = [
  {
    title: 'Application modules',
    modules: [
      ['dashboard', 'Dashboard'],
      ['projects', 'Projects'],
      ['new-project', 'New project'],
      ['team', 'Team'],
      ['payments', 'Payments'],
      ['roles', 'Roles'],
      ['vendors', 'Vendors'],
      ['proposals', 'Proposals'],
    ],
  },
]

const ALL_MODULES = MODULE_GROUPS.flatMap(
  group => group.modules
)


const emptyPermissions = () =>
  Object.fromEntries(
    ALL_MODULES.map(([key]) => [
      key,
      { read: false, write: false },
    ])
  )

const makePermissions = (enabledModules = []) => {
  const permissions = emptyPermissions()

  enabledModules.forEach(key => {
    if (permissions[key]) {
      permissions[key] = { read: true, write: true }
    }
  })

  return permissions
}


const BUILT_IN_ROLES = [
  {
    name: 'Admin',
    description: 'Full access',
    baseRole: 'admin',
    system: true,
    permissions: makePermissions(
      ALL_MODULES.map(([key]) => key)
    ),
  },
  {
    name: 'Project manager',
    description: 'Oversees assigned site projects',
    baseRole: 'supervisor',
    system: false,
    permissions: (() => {
      const p = makePermissions([
        'dashboard',
        'projects',
        'new-project',
        'team',
        'payments',
        'vendors',
        'proposals',
      ])

      p.projects.write = true
      p['new-project'].write = true

      return p
    })(),
  },
  {
    name: 'Carpenter',
    description: 'Site work and material reporting',
    baseRole: 'carpenter',
    system: false,
    permissions: makePermissions([
      'dashboard',
      'projects',
    ]),
  },
  {
    name: 'Customer',
    description: 'View project progress and updates',
    baseRole: 'client',
    system: false,
    permissions: makePermissions([
      'dashboard',
      'projects',
      'proposals',
    ]),
  },
]


function normalizePermissions(saved = {}) {
  const result = emptyPermissions()

  ALL_MODULES.forEach(([key]) => {
    const value = saved[key]

    // Support existing roles that stored simple boolean permissions.
    if (typeof value === 'boolean') {
      result[key] = { read: value, write: value }
    } else if (value && typeof value === 'object') {
      result[key] = {
        read: Boolean(value.read),
        write: Boolean(value.write),
      }
    }
  })

  return result
}

export default function Roles({ user, role, canWrite = false, canReadTeam = false }) {
  const [roles, setRoles] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [baseRole, setBaseRole] = useState('supervisor')
  const [permissions, setPermissions] = useState(emptyPermissions)
  const [saving, setSaving] = useState(false)
  const [deletingRoleId, setDeletingRoleId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let seeded = false

    const unsubRoles = onSnapshot(
      collection(db, 'roles'),
      async snapshot => {
        if (snapshot.empty && !seeded && canWrite) {
          seeded = true
          try {
            await Promise.all(
              BUILT_IN_ROLES.map(r =>
                addDoc(collection(db, 'roles'), {
                  ...r,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                })
              )
            )
          } catch (e) {
            console.error('Could not seed roles', e)
            setError('Could not initialize roles. Check Firestore permissions.')
            setLoading(false)
          }
          return
        }

        const saved = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data(),
        }))

        setRoles(
          saved.sort(
            (a, b) =>
              Number(Boolean(b.system)) - Number(Boolean(a.system)) ||
              String(a.name).localeCompare(String(b.name))
          )
        )
        setLoading(false)
      },
      e => {
        console.error(e)
        setError('Could not load roles. Check Firestore permissions.')
        setLoading(false)
      }
    )

    const unsubUsers = canReadTeam ? onSnapshot(
      collection(db, 'users'),
      snapshot => setUsers(snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      }))),
      e => console.warn('Could not load role user counts', e)
    ) : () => {}

    return () => {
      unsubRoles()
      unsubUsers()
    }
  }, [canWrite, canReadTeam])

  const roleCounts = useMemo(() => {
    const counts = {}

    users.forEach(u => {
      const key = u.customRoleId || u.roleId
      if (key) counts[key] = (counts[key] || 0) + 1
    })

    return counts
  }, [users])

  const enabledCount = useMemo(
    () => ALL_MODULES.reduce((total, [key]) => {
      const p = permissions[key]
      return total + Number(Boolean(p?.read)) + Number(Boolean(p?.write))
    }, 0),
    [permissions]
  )

  const openNew = () => {
    setEditing({ id: null, system: false })
    setName('')
    setDescription('')
    setBaseRole('supervisor')
    setPermissions(emptyPermissions())
    setError('')
  }

  const openEdit = r => {
    if (r.system) return

    setEditing(r)
    setName(r.name || '')
    setDescription(r.description || '')
    setBaseRole(r.baseRole || 'supervisor')
    setPermissions(normalizePermissions(r.permissions))
    setError('')
  }

  const closeEditor = () => {
    setEditing(null)
    setError('')
  }

  const togglePermission = (moduleKey, type) => {
    setPermissions(previous => {
      const current = previous[moduleKey] || { read: false, write: false }
      const nextValue = !current[type]

      return {
        ...previous,
        [moduleKey]: {
          ...current,
          [type]: nextValue,
          // Write requires read access; turning read off also turns write off.
          ...(type === 'read' && !nextValue ? { write: false } : {}),
          ...(type === 'write' && nextValue ? { read: true } : {}),
        },
      }
    })
  }

  const setAllPermissions = type => {
    setPermissions(previous => {
      const next = { ...previous }

      ALL_MODULES.forEach(([key]) => {
        const current = next[key] || { read: false, write: false }

        if (type === 'read') {
          next[key] = { read: true, write: current.write }
        } else {
          next[key] = { read: true, write: true }
        }
      })

      return next
    })
  }

  const clearPermissions = () => setPermissions(emptyPermissions())

  const saveRole = async e => {
    e.preventDefault()
    if (!canWrite) return
    setError('')

    if (!name.trim()) {
      setError('Enter a role name.')
      return
    }

    if (
      roles.some(
        r =>
          r.name?.trim().toLowerCase() === name.trim().toLowerCase() &&
          r.id !== editing?.id
      )
    ) {
      setError('A role with this name already exists.')
      return
    }

    setSaving(true)

    try {
      const normalized = normalizePermissions(permissions)

      const payload = {
        name: name.trim(),
        description: description.trim(),
        baseRole,
        permissions: normalized,
        system: false,
        updatedAt: serverTimestamp(),
      }

      if (editing?.id) {
        await updateDoc(doc(db, 'roles', editing.id), payload)
      } else {
        await addDoc(collection(db, 'roles'), {
          ...payload,
          createdAt: serverTimestamp(),
        })
      }

      closeEditor()
    } catch (e) {
      console.error(e)
      setError(e.message || 'Could not save role. Check Firestore permissions.')
    } finally {
      setSaving(false)
    }
  }

  const deleteRole = async (roleToDelete, usersCount) => {
    if (!canWrite || !roleToDelete?.id || roleToDelete.system || usersCount > 0) return
    const confirmed = window.confirm(`Delete the “${roleToDelete.name}” role? This cannot be undone.`)
    if (!confirmed) return

    setDeletingRoleId(roleToDelete.id)
    setError('')
    try {
      await deleteDoc(doc(db, 'roles', roleToDelete.id))
    } catch (e) {
      console.error('Could not delete role:', e)
      setError(e.message || 'Could not delete role. Check Firestore permissions.')
    } finally {
      setDeletingRoleId('')
    }
  }

  if (editing) {
    return (
      <section className="roles-page">
        <div className="roles-editor-heading">
          <button
            className="roles-back"
            type="button"
            onClick={closeEditor}
            aria-label="Back to roles"
          >
            <ArrowLeft />
          </button>

          <div>
            <h1>{editing.id ? 'Edit role' : 'New role'}</h1>
            <p>Choose which modules this role can read and write.</p>
          </div>
        </div>

        <form className="roles-form-card" onSubmit={saveRole}>
          <label className="roles-field">
            Role name *
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Site supervisor"
              maxLength={60}
            />
          </label>

          <label className="roles-field">
            Description
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe this role's responsibilities"
              maxLength={180}
            />
          </label>

          <label className="roles-field">
            Base role
            <select
              value={baseRole}
              onChange={e => setBaseRole(e.target.value)}
            >
              <option value="supervisor">Supervisor</option>
              <option value="carpenter">Carpenter</option>
              <option value="client">Customer</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <div className="roles-permissions-toolbar">
            <div>
              <strong>Module permissions</strong>
              <p>
                {enabledCount} of {ALL_MODULES.length * 2} permissions enabled
              </p>
            </div>

            <div className="roles-bulk-actions">
              <button type="button" onClick={() => setAllPermissions('read')}>
                Select all read
              </button>
              <button type="button" onClick={() => setAllPermissions('write')}>
                Select all write
              </button>
              <button type="button" onClick={clearPermissions}>
                Clear all
              </button>
            </div>
          </div>

          <div className="roles-permissions-table">
            <div className="roles-permissions-table-head">
              <span>Module</span>
              <span><Eye size={15} /> Read</span>
              <span><Pencil size={15} /> Write</span>
            </div>

            {MODULE_GROUPS.map(group => (
              <section className="roles-permission-group" key={group.title}>
                <h2>{group.title}</h2>

                {group.modules.map(([key, label]) => (
                  <div className="roles-module-row" key={key}>
                    <span className="roles-module-name">{label}</span>

                    {['read', 'write'].map(type => (
                      <label
                        className="roles-toggle-cell"
                        key={type}
                        aria-label={`${type} ${label}`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(permissions[key]?.[type])}
                          onChange={() => togglePermission(key, type)}
                        />
                        <span className="roles-switch" />
                      </label>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>

          <p className="roles-permission-note">
            Write access automatically includes read access. Disabling read
            access also disables write access.
          </p>

          {error && <p className="roles-error">{error}</p>}

          <div className="roles-form-actions">
            <button
              type="button"
              className="roles-button secondary"
              onClick={closeEditor}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="roles-button primary"
              disabled={saving}
            >
              {saving ? 'Saving…' : editing.id ? 'Save role' : 'Create role'}
            </button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className="roles-page">
      <header className="roles-list-heading">
        <div>
          <h1>Roles & permissions</h1>
          <p>{roles.length} roles configured</p>
        </div>

        {canWrite && <button
          type="button"
          className="roles-button primary"
          onClick={openNew}
        >
          <Plus size={18} /> Add role
        </button>}
      </header>

      {error && <p className="roles-error">{error}</p>}

      <div className="roles-list-card">
        {loading ? (
          <p className="roles-loading">Loading roles…</p>
        ) : roles.map(r => {
          const p = normalizePermissions(r.permissions)
          const count = ALL_MODULES.reduce(
            (total, [key]) =>
              total + Number(p[key].read) + Number(p[key].write),
            0
          )

          const usersCount =
            roleCounts[r.id] ||
            users.filter(
              u => u.customRoleName === r.name || u.roleName === r.name
            ).length

          return (
            <div className="roles-list-row" key={r.id || r.name}>
              <span className="roles-list-copy">
                <strong>{r.name}</strong>
                <small>
                  {r.system
                    ? 'Full access · System role'
                    : `${count} permissions enabled`} · {usersCount} users
                </small>
                {!r.system && usersCount > 0 && canWrite && (
                  <small className="roles-delete-note">
                    Reassign these users before deleting this role.
                  </small>
                )}
              </span>

              {r.system ? (
                <span className="roles-system-badge">
                  <ShieldCheck size={14} /> System
                </span>
              ) : canWrite && (
                <div className="roles-row-actions">
                  <button
                    type="button"
                    className="roles-row-action"
                    onClick={() => openEdit(r)}
                    aria-label={`Edit ${r.name}`}
                  >
                    <Pencil size={16} /> <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    className="roles-row-action danger"
                    onClick={() => deleteRole(r, usersCount)}
                    disabled={usersCount > 0 || deletingRoleId === r.id}
                    title={usersCount > 0 ? 'Reassign users before deleting this role' : 'Delete role'}
                    aria-label={`Delete ${r.name}`}
                  >
                    <Trash2 size={16} /> <span>{deletingRoleId === r.id ? 'Deleting…' : 'Delete'}</span>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="roles-hint">
        Create custom roles and control read/write access for each module.
        Assign roles when creating employees in Team.
      </p>
    </section>
  )
}
