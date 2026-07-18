import { GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './client.js';
import { CUSTOMERS_TABLE } from './schema.js';

// An Update (not a Put) on purpose: sync runs on every sign-in, and a full
// overwrite would wipe attributes the token doesn't carry — most importantly
// the rewards balance. Profile fields refresh every time; rewards is only
// initialized (to 0) when the row doesn't have one yet.
export async function upsertCustomer({ customerId, email, firstName, lastName, role, updatedAt }) {
  const { Attributes } = await docClient.send(
    new UpdateCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { customerId },
      UpdateExpression:
        'SET email = :email, firstName = :firstName, lastName = :lastName, ' +
        '#role = :role, updatedAt = :updatedAt, rewards = if_not_exists(rewards, :zero)',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: {
        ':email': email,
        ':firstName': firstName,
        ':lastName': lastName,
        ':role': role,
        ':updatedAt': updatedAt,
        ':zero': 0,
      },
      ReturnValues: 'ALL_NEW',
    })
  );
  return Attributes;
}

// Atomic increment — ADD treats a missing *attribute* as 0 (safe if the row
// somehow predates the rewards field), but a plain ADD also treats a missing
// *item* as an upsert, which would otherwise silently resurrect a deleted
// customer's row with nothing but a customerId and a rewards balance.
// attribute_exists guards against that: it fails loudly (caller already
// handles a thrown error as a non-fatal "earn" failure) instead of quietly
// recreating an account the user explicitly deleted.
export async function addRewardsPoints(customerId, points) {
  const { Attributes } = await docClient.send(
    new UpdateCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { customerId },
      UpdateExpression: 'ADD rewards :points',
      ConditionExpression: 'attribute_exists(customerId)',
      ExpressionAttributeValues: { ':points': points },
      ReturnValues: 'ALL_NEW',
    })
  );
  return Attributes.rewards;
}

// Atomic, guarded decrement — the ConditionExpression makes DynamoDB reject
// the write (not just clamp it) if the balance is too low, so a race between
// two simultaneous redemptions can't drive the balance negative. Returns the
// new balance on success, or null if there weren't enough points (including
// if the row doesn't exist at all — a missing `rewards` attribute also fails
// the >= check, which is the correct "deny by default" behavior here).
export async function redeemRewardsPoints(customerId, points) {
  try {
    const { Attributes } = await docClient.send(
      new UpdateCommand({
        TableName: CUSTOMERS_TABLE,
        Key: { customerId },
        UpdateExpression: 'ADD rewards :negPoints',
        ConditionExpression: 'rewards >= :points',
        ExpressionAttributeValues: { ':negPoints': -points, ':points': points },
        ReturnValues: 'ALL_NEW',
      })
    );
    return Attributes.rewards;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return null;
    throw err;
  }
}

// The Cognito identity itself is deleted separately (client-side, via the
// authenticated session's own deleteUser() call) — this only forgets our
// DynamoDB row (profile + rewards balance). Past order records are left
// alone (a real business keeps its transaction history); once both this row
// and the Cognito account are gone, that customerId no longer resolves to
// anyone, so those orders become as unreachable as a guest's always were.
export async function deleteCustomer(customerId) {
  await docClient.send(
    new DeleteCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { customerId },
    })
  );
}

export async function getCustomerById(customerId) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { customerId },
    })
  );
  return Item ?? null;
}
