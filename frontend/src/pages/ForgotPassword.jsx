import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import { EMAIL_RE } from '../constants.js';
import './AuthForm.css';

function ForgotPassword() {
  const { forgotPassword, confirmForgotPassword, error, errorCode } = useAuth();
  const navigate = useNavigate();

  // 'request' -> 'code' -> 'password'. Split into three screens rather than
  // one combined code+password form. Note the code isn't actually verified
  // against Cognito until the password step submits — ConfirmForgotPassword
  // validates the code and sets the new password together in one atomic
  // request, there's no separate "just check this code" API — but a wrong
  // code is expected to be rare here since it was only just emailed.
  const [step, setStep] = useState('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formNote, setFormNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest(e) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setFormError('A valid email is required.');

    setFormError('');
    setFormNote('');
    setSubmitting(true);
    const ok = await forgotPassword(email.trim());
    setSubmitting(false);

    // UserNotFoundException is treated the same as success — surfacing it
    // would let this form be used to check whether an email has an account.
    // If it genuinely doesn't exist, no code was sent and the password step
    // below will just fail on submit, same end result.
    if (ok || errorCode === 'UserNotFoundException') {
      setStep('code');
    }
  }

  async function handleResend() {
    setFormError('');
    setFormNote('');
    setSubmitting(true);
    const ok = await forgotPassword(email.trim());
    setSubmitting(false);
    if (ok || errorCode === 'UserNotFoundException') setFormNote('Code resent.');
  }

  function handleCodeNext(e) {
    e.preventDefault();
    if (!code.trim()) return setFormError('Confirmation code is required.');
    setFormError('');
    setFormNote('');
    setStep('password');
  }

  async function handleReset(e) {
    e.preventDefault();
    if (newPassword.length < 8) return setFormError('Password must be at least 8 characters.');
    if (newPassword !== confirmPassword) return setFormError('Passwords do not match.');

    setFormError('');
    setSubmitting(true);
    const ok = await confirmForgotPassword(email.trim(), code.trim(), newPassword);
    setSubmitting(false);
    if (ok) {
      navigate('/sign-in', { state: { justConfirmed: true, email: email.trim() } });
    }
  }

  return (
    <div className="signin-page">
      <div className="page-mascot">
        <Mascot />
      </div>
      <h1>Forgot Password</h1>

      {step === 'request' && (
        <>
          <form className="auth-form" onSubmit={handleRequest}>
            <p className="auth-form-note">
              Enter your account email and we&apos;ll send you a code to reset your password.
            </p>
            <label className="auth-form-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>

            {(formError || error) && <p className="checkout-error">{formError || error}</p>}

            <button type="submit" className="checkout-btn" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send Code'}
            </button>
          </form>
          <p className="auth-form-link">
            <Link to="/sign-in">Back to sign in</Link>
          </p>
        </>
      )}

      {step === 'code' && (
        <form className="auth-form" onSubmit={handleCodeNext}>
          <p className="auth-form-note">
            If an account exists for {email}, we sent a code to it. Enter it below.
          </p>
          <label className="auth-form-field">
            <span>Confirmation code</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              autoFocus
            />
          </label>

          {formNote && <p className="auth-form-note">{formNote}</p>}
          {formError && <p className="checkout-error">{formError}</p>}

          <button
            type="button"
            className="auth-form-resend"
            onClick={handleResend}
            disabled={submitting}
          >
            Resend code
          </button>

          <button type="submit" className="checkout-btn">
            Next
          </button>
        </form>
      )}

      {step === 'password' && (
        <form className="auth-form" onSubmit={handleReset}>
          <p className="auth-form-note">Choose a new password for {email}.</p>
          <label className="auth-form-field">
            <span>New password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </label>

          <label className="auth-form-field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          {(formError || error) && <p className="checkout-error">{formError || error}</p>}

          <button type="submit" className="checkout-btn" disabled={submitting}>
            {submitting ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      )}
    </div>
  );
}

export default ForgotPassword;
