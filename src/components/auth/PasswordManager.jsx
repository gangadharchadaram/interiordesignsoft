import { useState } from 'react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { KeyRound, X } from 'lucide-react'
import { auth } from '../../firebase'

export default function PasswordManager() {
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const close = () => {
    setOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setMessage('')
  }

  const save = async (event) => {
    event.preventDefault()
    const user = auth.currentUser
    if (!user?.email) {
      setError('This account cannot change its password here. Use Forgot password on the sign-in screen.')
      return
    }
    if (newPassword.length < 8) {
      setError('Use at least 8 characters for your new password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPassword)
      setMessage('Your password has been updated.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential'
        ? 'Current password is incorrect.'
        : err.code === 'auth/too-many-requests'
          ? 'Too many attempts. Please try again later.'
          : 'Could not update your password. Please try again or use Forgot password on the sign-in screen.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <button type="button" className="password-manager-trigger" onClick={() => setOpen(true)}>
      <KeyRound size={16} /><span>Change password</span>
    </button>
    {open && <div className="password-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) close()
    }}>
      <section className="password-modal" role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
        <button className="password-modal-close" type="button" onClick={close} aria-label="Close" disabled={busy}><X size={18} /></button>
        <span className="password-modal-icon"><KeyRound size={20} /></span>
        <h2 id="password-modal-title">Change password</h2>
        <p>Confirm your current password, then choose a new one.</p>
        <form onSubmit={save}>
          <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
          <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required /><small>At least 8 characters</small></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required /></label>
          {error && <div className="password-modal-error" role="alert">{error}</div>}
          {message && <div className="password-modal-success" role="status">{message}</div>}
          <button className="password-modal-submit" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>
      </section>
    </div>}
  </>
}
