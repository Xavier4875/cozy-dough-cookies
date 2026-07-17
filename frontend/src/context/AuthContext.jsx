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
  const [isAccountOpen, setIsAccountOpen] = useState(false);

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

  function signUp(email, password, firstName, lastName) {
    setError('');
    if (!userPool) {
      setError(NOT_CONFIGURED_ERROR);
      return Promise.resolve(false);
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
            resolve(false);
            return;
          }
          resolve(true);
        }
      );
    });
  }

  function confirmSignUp(email, code) {
    setError('');
    if (!userPool) {
      setError(NOT_CONFIGURED_ERROR);
      return Promise.resolve(false);
    }
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    return new Promise((resolve) => {
      cognitoUser.confirmRegistration(code, true, (err) => {
        if (err) {
          setError(err.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  function signIn(email, password) {
    setError('');
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
    signUp,
    confirmSignUp,
    signIn,
    signOut,
    getIdToken,
    isAccountOpen,
    openAccount: () => setIsAccountOpen(true),
    closeAccount: () => setIsAccountOpen(false),
    toggleAccount: () => setIsAccountOpen((prev) => !prev),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
