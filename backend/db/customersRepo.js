import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

// Atomic increment — ADD treats a missing attribute as 0, so this is safe
// even if the row somehow predates the rewards field.
export async function addRewardsPoints(customerId, points) {
  const { Attributes } = await docClient.send(
    new UpdateCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { customerId },
      UpdateExpression: 'ADD rewards :points',
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

export async function getCustomerById(customerId) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { customerId },
    })
  );
  return Item ?? null;
}
