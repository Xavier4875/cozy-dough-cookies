import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import './AuthForm.css';

const PENDING_EMAIL_KEY = 'pendingSignupEmail';

function SignIn() {
  const { signIn, getIdToken, resendConfirmationCode, error, errorCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email ?? '');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formNote, setFormNote] = useState(
    location.state?.justConfirmed ? 'Account confirmed! Sign in below.' : ''
  );
  const [submitting, setSubmitting] = useState(false);

  // Signing in to an account that was signed up but never had its emailed
  // code entered fails with "not confirmed" — recover instead of
  // dead-ending there: resend the code and send them back to the signup
  // page's confirm step (which restores from the same pending-signup key
  // this sets, whether or not this tab is the one that started the signup).
  async function handleResendAndConfirm() {
    setFormError('');
    setSubmitting(true);
    const resent = await resendConfirmationCode(email.trim());
    setSubmitting(false);
    if (resent) {
      localStorage.setItem(PENDING_EMAIL_KEY, email.trim());
      navigate('/sign-up');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return setFormError('Email is required.');
    if (!password) return setFormError('Password is required.');

    setFormError('');
    setFormNote('');
    setSubmitting(true);
    const ok = await signIn(email.trim(), password);
    if (!ok) {
      setSubmitting(false);
      return;
    }

    // Cognito doesn't know about our DynamoDB Customers table — sync it
    // now that we have a fresh token. Safe to call every sign-in.
    try {
      const token = await getIdToken();
      await fetch('/api/customers/sync', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // Non-fatal — the customer row just stays stale until next sign-in.
    }

    setSubmitting(false);
    navigate('/');
  }

  return (
    <div className="signin-page">
      <div className="page-mascot">
        <Mascot />
      </div>
      <h1>Sign In</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-form-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        <label className="auth-form-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {formNote && <p className="auth-form-note">{formNote}</p>}
        {(formError || error) && <p className="checkout-error">{formError || error}</p>}
        {errorCode === 'UserNotConfirmedException' && (
          <button
            type="button"
            className="auth-form-resend"
            onClick={handleResendAndConfirm}
            disabled={submitting}
          >
            Resend confirmation code
          </button>
        )}

        <button type="submit" className="checkout-btn" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
      <p className="auth-form-link">
        Don&apos;t have an account? <Link to="/sign-up">Sign up</Link>
      </p>
    </div>
  );
}

export default SignIn;
