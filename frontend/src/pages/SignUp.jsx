import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import './AuthForm.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cognito accounts sit in an unconfirmed limbo between signUp() and a
// successful confirmRegistration() — signing up again with that email fails
// ("already exists"), and signing in fails too ("not confirmed"), so this is
// the one thing that must survive a page reload. It deliberately holds only
// the email, never the password — see the empty-password branch in
// handleConfirm below for why that's safe.
const PENDING_EMAIL_KEY = 'pendingSignupEmail';

function SignUp() {
  const { signUp, confirmSignUp, resendConfirmationCode, signIn, getIdToken, error } = useAuth();
  const navigate = useNavigate();

  // 'register' -> 'confirm'. Cognito requires an emailed code before a new
  // account can sign in, so this is a two-step form rather than one.
  const [step, setStep] = useState('register');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState('');
  const [formNote, setFormNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // On mount (which includes a page reload — e.g. a mobile browser
  // reclaiming the tab while the user switched to their email app for the
  // code), pick back up at the confirm step for any signup that was left
  // pending, instead of defaulting to 'register' and leading the user into
  // the exists/not-confirmed dead end.
  useEffect(() => {
    const pendingEmail = localStorage.getItem(PENDING_EMAIL_KEY);
    if (pendingEmail) {
      setEmail(pendingEmail);
      setStep('confirm');
    }
  }, []);

  async function handleRegister(e) {
    e.preventDefault();
    if (!firstName.trim()) return setFormError('First name is required.');
    if (!lastName.trim()) return setFormError('Last name is required.');
    if (!EMAIL_RE.test(email.trim())) return setFormError('A valid email is required.');
    if (password.length < 8) return setFormError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setFormError('Passwords do not match.');

    setFormError('');
    setFormNote('');
    setSubmitting(true);
    const { ok, code } = await signUp(email.trim(), password, firstName.trim(), lastName.trim());
    if (ok) {
      localStorage.setItem(PENDING_EMAIL_KEY, email.trim());
      setSubmitting(false);
      setStep('confirm');
      return;
    }

    // This email already has a signed-up-but-unconfirmed account sitting in
    // Cognito (e.g. from an earlier attempt that got interrupted before the
    // code was entered) — recover instead of dead-ending on "already
    // exists": resend the code and drop them straight into the confirm step.
    if (code === 'UsernameExistsException') {
      const resent = await resendConfirmationCode(email.trim());
      setSubmitting(false);
      if (resent) {
        localStorage.setItem(PENDING_EMAIL_KEY, email.trim());
        setFormNote('This email already has a pending signup — we resent your confirmation code.');
        setStep('confirm');
      }
      return;
    }

    setSubmitting(false);
  }

  async function handleResend() {
    setFormError('');
    setFormNote('');
    setSubmitting(true);
    const resent = await resendConfirmationCode(email.trim());
    setSubmitting(false);
    if (resent) setFormNote('Confirmation code resent.');
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
    localStorage.removeItem(PENDING_EMAIL_KEY);

    // A confirm that picked back up from a reload has no password in memory
    // (it's never persisted — see PENDING_EMAIL_KEY above), so there's
    // nothing to auto-sign-in with. Send them to sign in manually instead of
    // failing a sign-in attempt with an empty password.
    if (!password) {
      setSubmitting(false);
      navigate('/sign-in', { state: { justConfirmed: true, email: email.trim() } });
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
      <p className="required-note">
        <span className="required-mark">*</span> indicates a required field
      </p>

      {step === 'register' ? (
        <>
          <form className="auth-form" onSubmit={handleRegister}>
            <label className="auth-form-field">
              <span>
                First name<span className="required-mark"> *</span>
              </span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </label>

            <label className="auth-form-field">
              <span>
                Last name<span className="required-mark"> *</span>
              </span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </label>

            <label className="auth-form-field">
              <span>
                Email<span className="required-mark"> *</span>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>

            <label className="auth-form-field">
              <span>
                Password<span className="required-mark"> *</span>
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>

            <label className="auth-form-field">
              <span>
                Confirm password<span className="required-mark"> *</span>
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
            <span>
              Confirmation code<span className="required-mark"> *</span>
            </span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
            />
          </label>

          {formNote && <p className="auth-form-note">{formNote}</p>}
          {(formError || error) && <p className="checkout-error">{formError || error}</p>}

          <button
            type="button"
            className="auth-form-resend"
            onClick={handleResend}
            disabled={submitting}
          >
            Resend code
          </button>

          <button type="submit" className="checkout-btn" disabled={submitting}>
            {submitting ? 'Confirming...' : 'Confirm'}
          </button>
        </form>
      )}
    </div>
  );
}

export default SignUp;
