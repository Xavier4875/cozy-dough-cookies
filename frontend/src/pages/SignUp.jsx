import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import './AuthForm.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SignUp() {
  const { signUp, confirmSignUp, signIn, getIdToken, error } = useAuth();
  const navigate = useNavigate();

  // 'register' -> 'confirm'. Cognito requires an emailed code before a new
  // account can sign in, so this is a two-step form rather than one.
  const [step, setStep] = useState('register');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister(e) {
    e.preventDefault();
    if (!firstName.trim()) return setFormError('First name is required.');
    if (!lastName.trim()) return setFormError('Last name is required.');
    if (!EMAIL_RE.test(email.trim())) return setFormError('A valid email is required.');
    if (password.length < 8) return setFormError('Password must be at least 8 characters.');

    setFormError('');
    setSubmitting(true);
    const ok = await signUp(email.trim(), password, firstName.trim(), lastName.trim());
    setSubmitting(false);
    if (ok) setStep('confirm');
  }

  async function handleConfirm(e) {
    e.preventDefault();
    if (!code.trim()) return setFormError('Confirmation code is required.');

    setFormError('');
    setSubmitting(true);
    const confirmed = await confirmSignUp(email.trim(), code.trim());
    if (!confirmed) {
      setSubmitting(false);
      return;
    }

    const signedIn = await signIn(email.trim(), password);
    if (!signedIn) {
      setSubmitting(false);
      return;
    }

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
    <div className="signup-page">
      <div className="page-mascot">
        <Mascot />
      </div>
      <h1>Sign Up</h1>

      {step === 'register' ? (
        <>
          <form className="auth-form" onSubmit={handleRegister}>
            <label className="auth-form-field">
              <span>First name</span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </label>

            <label className="auth-form-field">
              <span>Last name</span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </label>

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
                autoComplete="new-password"
              />
            </label>

            {(formError || error) && <p className="checkout-error">{formError || error}</p>}

            <button type="submit" className="checkout-btn" disabled={submitting}>
              {submitting ? 'Creating account...' : 'Sign Up'}
            </button>
          </form>
          <p className="auth-form-link">
            Already have an account? <Link to="/sign-in">Sign in</Link>
          </p>
        </>
      ) : (
        <form className="auth-form" onSubmit={handleConfirm}>
          <p className="auth-form-note">
            We emailed a confirmation code to {email}. Enter it below to finish creating your
            account.
          </p>
          <label className="auth-form-field">
            <span>Confirmation code</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
            />
          </label>

          {(formError || error) && <p className="checkout-error">{formError || error}</p>}

          <button type="submit" className="checkout-btn" disabled={submitting}>
            {submitting ? 'Confirming...' : 'Confirm'}
          </button>
        </form>
      )}
    </div>
  );
}

export default SignUp;
