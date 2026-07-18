import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { getCustomerById } from '../db/customersRepo.js';

let verifier = null;

// Built lazily on first use, not at module load — CognitoJwtVerifier.create
// validates COGNITO_USER_POOL_ID's shape eagerly and throws if it's missing
// or a placeholder, which would otherwise crash the whole server at import
// time (before Cognito is even set up) and break guest checkout along with
// it. Deferring construction means the server still starts fine, and only
// a request that actually presents a Bearer token can hit this failure —
// caught below and treated as unauthenticated either way.
function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID,
      tokenUse: 'id',
      clientId: process.env.COGNITO_CLIENT_ID,
    });
  }
  return verifier;
}

async function decodeUser(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  try {
    const payload = await getVerifier().verify(token);
    const groups = payload['cognito:groups'] || [];
    return {
      customerId: payload.sub,
      email: payload.email,
      firstName: payload.given_name,
      lastName: payload.family_name,
      role: groups.includes('staff') ? 'staff' : 'customer',
    };
  } catch {
    return null;
  }
}

// Attaches req.user if a valid token is present, but never blocks the
// request — used on /api/checkout so guest checkout keeps working
// unauthenticated.
export async function optionalAuth(req, res, next) {
  req.user = await decodeUser(req);
  next();
}

// 401s if there's no valid token — used on customer-only endpoints.
export async function requireAuth(req, res, next) {
  const user = await decodeUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign-in required.' });
  }
  req.user = user;
  next();
}

// A Cognito ID token stays cryptographically valid for its full lifetime
// even after the account behind it is deleted — deleting a user doesn't
// revoke tokens already issued to it. So a second tab that was signed in
// before the account was deleted elsewhere would otherwise keep passing
// requireAuth indefinitely. This closes that gap by checking our own
// Customers row still exists. Must run after requireAuth. Deliberately not
// applied to /api/customers/sync, whose entire job is to create this row
// when it doesn't exist yet — requiring it there would make sync unable to
// ever run for a brand-new account.
export async function requireActiveCustomer(req, res, next) {
  const customer = await getCustomerById(req.user.customerId);
  if (!customer) {
    return res.status(401).json({ error: 'This account no longer exists. Please sign in again.' });
  }
  next();
}
