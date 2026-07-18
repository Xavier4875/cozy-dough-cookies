import { createContext, useEffect, useState } from 'react';
import {
  CognitoUser,
  CognitoUserAttribute,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';
import { userPool } from '../auth/cognito.js';

// Exported so useAuth.js (a separate file, kept apart so this file only
// exports the AuthProvider component — mixing a component export with a
// plain hook export in one file breaks Vite Fast Refresh) can read from it.
export const AuthContext = createContext(null);

const NOT_CONFIGURED_ERROR = 'Sign-in is not configured yet.';

function userFromSession(session) {
  const payload = session.getIdToken().decodePayload();
  const groups = payload['cognito:groups'] || [];
  return {
    customerId: payload.sub,
    email: payload.email,
    firstName: payload.given_name,
    lastName: payload.family_name,
    role: groups.includes('staff') ? 'staff' : 'customer',
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The Cognito exception name (e.g. "UsernameExistsException",
  // "UserNotConfirmedException") behind the current `error` message, if any
  // — kept separate so callers can branch on a stable machine-readable value
  // instead of matching against message text.
  const [errorCode, setErrorCode] = useState('');
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);

  // Cognito's SDK persists tokens in its own localStorage keys, so restoring
  // an existing session on mount needs no hand-rolled token storage.
  useEffect(() => {
    const current = userPool?.getCurrentUser();
    if (!current) {
      setLoading(false);
      return;
    }
    current.getSession((err, session) => {
      if (err || !session?.isValid()) {
        setLoading(false);
        return;
      }
      setUser(userFromSession(session));
      setLoading(false);
    });
  }, []);

  // Resolves { ok, code } rather than a plain boolean — unlike the other
  // auth actions, a caller here (SignUp's handleRegister) needs to branch
  // immediately on *which* error happened, right after the await. Reading
  // the reactive errorCode state at that point would see whatever it was
  // before this call started, not the value this call just set — state
  // updates don't retroactively change a closure already in flight.
  function signUp(email, password, firstName, lastName) {
    setError('');
    setErrorCode('');
    if (!userPool) {
      setError(NOT_CONFIGURED_ERROR);
      return Promise.resolve({ ok: false, code: '' });
    }
    return new Promise((resolve) => {
      userPool.signUp(
        email,
        password,
        [
          new CognitoUserAttribute({ Name: 'given_name', Value: firstName }),
          new CognitoUserAttribute({ Name: 'family_name', Value: lastName }),
        ],
        null,
        (err) => {
          if (err) {
            setError(err.message);
            setErrorCode(err.code || '');
            resolve({ ok: false, code: err.code || '' });
            return;
          }
          resolve({ ok: true });
        }
      );
    });
  }

  function confirmSignUp(email, code) {
    setError('');
    setErrorCode('');
    if (!userPool) {
      setError(NOT_CONFIGURED_ERROR);
      return Promise.resolve(false);
    }
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    return new Promise((resolve) => {
      cognitoUser.confirmRegistration(code, true, (err) => {
        if (err) {
          setError(err.message);
          setErrorCode(err.code || '');
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  // Cognito resends the same signup confirmation code by re-issuing it to
  // the account's email — this is what lets someone recover a pending
  // (signed-up-but-unconfirmed) account without hitting the "user already
  // exists" wall a second signUp() call would raise.
  function resendConfirmationCode(email) {
    setError('');
    setErrorCode('');
    if (!userPool) {
      setError(NOT_CONFIGURED_ERROR);
      return Promise.resolve(false);
    }
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    return new Promise((resolve) => {
      cognitoUser.resendConfirmationCode((err) => {
        if (err) {
          setError(err.message);
          setErrorCode(err.code || '');
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  function signIn(email, password) {
    setError('');
    setErrorCode('');
    if (!userPool) {
      setError(NOT_CONFIGURED_ERROR);
      return Promise.resolve(false);
    }
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });
    return new Promise((resolve) => {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          setUser(userFromSession(session));
          resolve(true);
        },
        onFailure: (err) => {
          setError(err.message);
          setErrorCode(err.code || '');
          resolve(false);
        },
      });
    });
  }

  function signOut() {
    if (!window.confirm('Are you sure you want to sign out?')) return;
    userPool?.getCurrentUser()?.signOut();
    setUser(null);
    setIsAccountOpen(false);
  }

  // Deletes the DynamoDB profile/rewards row first, while the session is
  // still valid enough to authenticate that request, then deletes the
  // Cognito identity itself — in that order, since the reverse would leave
  // an authenticated request with no Cognito user left to authenticate it.
  // amazon-cognito-identity-js's deleteUser() removes the signed-in user's
  // own account directly, no admin credentials needed. Local sign-out is
  // unconditional once the DynamoDB delete succeeds (see below) — that step
  // is the irreversible one, so the UI must reflect "signed out" regardless
  // of whether the follow-up Cognito call also succeeds.
  function deleteAccount() {
    setError('');
    const current = userPool?.getCurrentUser();
    if (!current) return Promise.resolve(false);
    return new Promise((resolve) => {
      current.getSession(async (err, session) => {
        if (err || !session?.isValid()) {
          setError('Your session has expired. Please sign in again.');
          resolve(false);
          return;
        }
        try {
          const res = await fetch('/api/customers/me', {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${session.getIdToken().getJwtToken()}` },
          });
          if (!res.ok) throw new Error();
        } catch {
          setError('Failed to delete account. Please try again.');
          resolve(false);
          return;
        }

        // From here on the account's data is already permanently gone — sign
        // the user out locally no matter what happens next. deleteUser() is
        // best-effort cleanup of the Cognito identity itself; if it errors
        // (e.g. a second tab racing the same deletion, or any other Cognito
        // hiccup) that's no reason to leave the UI pretending they're still
        // signed in to an account with nothing behind it.
        current.deleteUser((deleteErr) => {
          if (deleteErr) {
            console.error('Cognito deleteUser failed after account data was already removed:', deleteErr);
          }
          setUser(null);
          setIsAccountOpen(false);
          setIsDeleteAccountOpen(false);
          resolve(true);
        });
      });
    });
  }

  // Resolved at call time rather than cached in state: getSession()
  // transparently refreshes an expired session using the stored refresh
  // token, so caching a token value in state risks handing out a stale one.
  function getIdToken() {
    const current = userPool?.getCurrentUser();
    if (!current) return Promise.resolve(null);
    return new Promise((resolve) => {
      current.getSession((err, session) => {
        if (err || !session?.isValid()) resolve(null);
        else resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  const value = {
    user,
    isAuthenticated: !!user,
    loading,
    error,
    errorCode,
    signUp,
    confirmSignUp,
    resendConfirmationCode,
    signIn,
    signOut,
    getIdToken,
    isAccountOpen,
    openAccount: () => setIsAccountOpen(true),
    closeAccount: () => setIsAccountOpen(false),
    toggleAccount: () => setIsAccountOpen((prev) => !prev),
    isDeleteAccountOpen,
    openDeleteAccount: () => setIsDeleteAccountOpen(true),
    closeDeleteAccount: () => setIsDeleteAccountOpen(false),
    deleteAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
