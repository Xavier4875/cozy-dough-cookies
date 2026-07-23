// One-off backfill: /api/customers/sync only creates a Customers row on
// sign-in, so any account that exists in the Cognito User Pool but hasn't
// signed in since the local DB was last reset has no row here — invisible
// to Past Orders search. This lists every Cognito user directly and upserts
// each one, using the same upsertCustomer() call /api/customers/sync makes,
// so the result is indistinguishable from that account having just signed
// in. Safe to re-run.
import 'dotenv/config';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { upsertCustomer } from '../db/customersRepo.js';

const client = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION });
const UserPoolId = process.env.COGNITO_USER_POOL_ID;

async function listAllUsers() {
  const users = [];
  let PaginationToken;
  do {
    const res = await client.send(new ListUsersCommand({ UserPoolId, PaginationToken }));
    users.push(...(res.Users || []));
    PaginationToken = res.PaginationToken;
  } while (PaginationToken);
  return users;
}

// Group membership isn't included on ListUsers itself — a separate call,
// same as how role is only known via the 'staff' Cognito group everywhere
// else in this app (see middleware/auth.js).
async function listStaffUsernames() {
  const usernames = new Set();
  let NextToken;
  do {
    const res = await client.send(new ListUsersInGroupCommand({ UserPoolId, GroupName: 'staff', NextToken }));
    for (const user of res.Users || []) usernames.add(user.Username);
    NextToken = res.NextToken;
  } while (NextToken);
  return usernames;
}

function attr(user, name) {
  return user.Attributes?.find((a) => a.Name === name)?.Value;
}

async function main() {
  const [users, staffUsernames] = await Promise.all([listAllUsers(), listStaffUsernames()]);
  console.log(`Found ${users.length} Cognito user(s), ${staffUsernames.size} in the staff group.`);

  let synced = 0;
  for (const user of users) {
    const customerId = attr(user, 'sub');
    const email = attr(user, 'email');
    if (!customerId || !email) {
      console.warn(`Skipping ${user.Username} — missing sub or email attribute.`);
      continue;
    }
    await upsertCustomer({
      customerId,
      email,
      firstName: attr(user, 'given_name') || '',
      lastName: attr(user, 'family_name') || '',
      role: staffUsernames.has(user.Username) ? 'staff' : 'customer',
      updatedAt: new Date().toISOString(),
    });
    synced++;
    console.log(`Synced ${email} (${customerId}, ${staffUsernames.has(user.Username) ? 'staff' : 'customer'}).`);
  }
  console.log(`Done — synced ${synced}/${users.length} account(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
