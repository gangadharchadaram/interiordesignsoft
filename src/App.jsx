import { useEffect, useRef, useState } from 'react'
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { LogOut } from 'lucide-react'
import { auth, db } from './firebase'
import AdminShell from './components/admin/AdminShell'
import ClientHome from './pages/ClientHome'
import StaffHome from './pages/StaffHome'
import { hasAnyModulePermission } from './utils/permissions'
import './styles/admin.css'
import './styles/login.css'

const VALID_ROLES = ['admin', 'supervisor', 'carpenter', 'client']

const ROLE_PATH = {
  admin: '/admin',
  supervisor: '/supervisor',
  carpenter: '/carpenter',
  client: '/client',
}

function navigateTo(path, replace = false) {
  if (window.location.pathname === path) return

  if (replace) window.history.replaceState({}, '', path)
  else window.history.pushState({}, '', path)

  window.dispatchEvent(new PopStateEvent('popstate'))
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const login = async (event) => {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError('')
    setMessage('')

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      // The auth listener loads the profile and validates permissions.
    } catch (err) {
      console.error('Login failed:', err)
      setError('Unable to sign in. Please check your email and password.')
    } finally {
      setBusy(false)
    }
  }

  const forgotPassword = async () => {
    const cleanEmail = email.trim()

    if (!cleanEmail) {
      setError('Enter your email address first.')
      setMessage('')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    try {
      await sendPasswordResetEmail(auth, cleanEmail)
    } catch (err) {
      // Use the same response whether or not the account exists.
      console.error('Password reset request failed:', err)
    } finally {
      setMessage(
        'If the account exists, a password reset email has been sent.'
      )
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">NE</div>
          <div>
            <strong>North East Interiors</strong>
            <span>Project Management</span>
          </div>
        </div>

        <div className="login-heading">
          <span>WORKSPACE</span>
          <h1>Welcome back</h1>
          <p>Sign in to continue to your workspace.</p>
        </div>

        <form onSubmit={login}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
              setMessage('')
            }}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError('')
              setMessage('')
            }}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
          />

          {error && <div className="form-error">{error}</div>}
          {message && (
            <div className="form-success" role="status">
              {message}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={busy}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          className="forgot-button"
          onClick={forgotPassword}
          disabled={busy}
        >
          Forgot password?
        </button>
      </div>
    </div>
  )
}

function AccessError({ message }) {
  const handleSignOut = async () => {
    try {
      await signOut(auth)
      navigateTo('/', true)
    } catch (error) {
      console.error('Sign out failed:', error)
    }
  }

  return (
    <div className="access-page">
      <div className="access-card">
        <div className="access-logo">NE</div>
        <span className="access-eyebrow">NORTH EAST INTERIORS</span>
        <h1>Workspace unavailable</h1>
        <p>{message}</p>
        <button
          type="button"
          className="access-signout"
          onClick={handleSignOut}
        >
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  )
}

function AppLoading() {
  return (
    <div className="app-loading">
      <div className="loading-mark">NE</div>
      <div className="loading-content">
        <strong>North East Interiors</strong>
        <span>Loading workspace…</span>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState('')
  const [pathname, setPathname] = useState(window.location.pathname)

  const requestId = useRef(0)

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)

    window.addEventListener('popstate', handlePopState)

    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    let mounted = true

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const currentRequest = ++requestId.current

      if (!mounted) return

      setUser(null)
      setRole(null)
      setAccessError('')

      if (!firebaseUser) {
        setLoading(false)
        return
      }

      setLoading(true)

      let accessStep = 'read your user profile'
      try {
        // 1. Load the signed-in user's Firestore profile.
        const userRef = doc(db, 'users', firebaseUser.uid)
        const userSnap = await getDoc(userRef)

        if (!mounted || currentRequest !== requestId.current) return

        if (!userSnap.exists()) {
          throw new Error(
            'Your user profile was not found in the workspace.'
          )
        }

        const profile = userSnap.data()
        const userRole = profile.role

        if (!VALID_ROLES.includes(userRole)) {
          throw new Error(
            'Your account does not have a valid workspace role.'
          )
        }

        // 2. Admin always has full application permissions.
        let effectivePermissions = profile.permissions || {}

        // 3. Load the latest permissions from the assigned custom role.
        if (userRole !== 'admin' && profile.customRoleId) {
          accessStep = 'read your assigned role permissions'
          const roleSnap = await getDoc(
            doc(db, 'roles', profile.customRoleId)
          )

          if (!mounted || currentRequest !== requestId.current) return

          if (!roleSnap.exists()) {
            throw new Error(
              'Your assigned role no longer exists. Contact your admin.'
            )
          }

          const customRole = roleSnap.data()

          if (customRole.baseRole !== userRole) {
            throw new Error(
              'Your assigned role is invalid. Contact your admin.'
            )
          }

          effectivePermissions = customRole.permissions || {}
        }

        // 4. Combine Firebase Auth identity and Firestore profile.
        const appUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          ...profile,
          role: userRole,
          permissions:
            userRole === 'admin' ? {} : effectivePermissions,
        }

        if (!mounted || currentRequest !== requestId.current) return

        setUser(appUser)
        setRole(userRole)
      } catch (error) {
        console.error('User access lookup failed:', error)

        if (mounted && currentRequest === requestId.current) {
          setUser(null)
          setRole(null)
          setAccessError(
            error?.code === 'permission-denied'
              ? `Access denied while trying to ${accessStep}. Publish the latest Firestore rules, then sign in again.`
              : error?.message || 'Unable to load your workspace.'
          )
        }
      } finally {
        if (mounted && currentRequest === requestId.current) {
          setLoading(false)
        }
      }
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  // Keep the URL aligned with the verified Firestore role.
  useEffect(() => {
    if (!user || !role || accessError) return

    const expectedPath = ROLE_PATH[role]

    if (expectedPath && pathname !== expectedPath) {
      window.history.replaceState({}, '', expectedPath)
      setPathname(expectedPath)
    }
  }, [user, role, accessError, pathname])

  if (loading) return <AppLoading />
  if (accessError) return <AccessError message={accessError} />
  if (!user) return <Login />

  // The verified role determines the workspace.
  if (role === 'admin') {
    return <AdminShell user={user} role={role} />
  }

  if (role === 'supervisor' || role === 'carpenter' || role === 'client') {
    if (user?.customRoleId && hasAnyModulePermission(user)) {
      return <AdminShell user={user} role={role} />
    }
  }

  if (role === 'supervisor' || role === 'carpenter') {
    return <StaffHome user={user} role={role} />
  }

  if (role === 'client') {
    return <ClientHome user={user} role={role} />
  }

  return (
    <AccessError message="Your workspace role could not be determined." />
  )
}
