import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

// Every account is enrolled here automatically (see /api/customers/sync in
// index.js) — staff are moved into their own group by hand in the AWS
// Console, and that logic deliberately never touches this group in either
// direction.
export const CUSTOMER_GROUP_NAME = 'customer';

let client = null;
function getClient() {
  if (!client) {
    client = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION });
  }
  return client;
}

// Never throws — called from the customer-sync path on every sign-in, and a
// transient AWS error here (e.g. missing IAM permission) must not block
// syncing the DynamoDB Customers row, which is the more important side
// effect. Idempotent: adding an existing member again is a harmless no-op.
export async function addToCustomerGroup(username) {
  try {
    await getClient().send(
      new AdminAddUserToGroupCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: username,
        GroupName: CUSTOMER_GROUP_NAME,
      })
    );
  } catch (err) {
    console.error('Failed to add user to Cognito customer group:', err);
  }
}
