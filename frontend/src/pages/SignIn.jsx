import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import Mascot from '../components/Mascot.jsx';
import './AuthForm.css';

function SignIn() {
  const { signIn, getIdToken, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return setFormError('Email is required.');
    if (!password) return setFormError('Password is required.');

    setFormError('');
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

        {(formError || error) && <p className="checkout-error">{formError || error}</p>}

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
