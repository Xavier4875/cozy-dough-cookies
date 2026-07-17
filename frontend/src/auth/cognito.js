import { CognitoUserPool } from 'amazon-cognito-identity-js';

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;

// CognitoUserPool throws if either id is missing/undefined — guard so a
// not-yet-configured (or briefly stale, e.g. a dev server started before
// .env existed) Cognito setup doesn't crash the entire app on import. Only
// auth actions themselves fail until real values are in place; everything
// else (menu, guest checkout) keeps working.
export const userPool =
  userPoolId && clientId ? new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId }) : null;
