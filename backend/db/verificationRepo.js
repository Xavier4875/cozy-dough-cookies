import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './client.js';
import { EMAIL_VERIFICATIONS_TABLE } from './schema.js';
import { EMAIL_VERIFICATION_CODE_TTL_MS, EMAIL_VERIFICATION_VERIFIED_TTL_MS } from '../constants.js';

// A fresh send always replaces any prior record for that email (Put, not
// Update) — the old code, and its attempt count, stop working the moment a
// new one is issued.
export async function putCode(email, code) {
  await docClient.send(
    new PutCommand({
      TableName: EMAIL_VERIFICATIONS_TABLE,
      Item: {
        email,
        code,
        verified: false,
        attempts: 0,
        expiresAt: Math.floor((Date.now() + EMAIL_VERIFICATION_CODE_TTL_MS) / 1000),
      },
    })
  );
}

export async function getVerification(email) {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: EMAIL_VERIFICATIONS_TABLE, Key: { email } })
  );
  return Item ?? null;
}

// Atomic, guarded update — only succeeds if the stored code still matches
// and the attempt cap hasn't already been hit, so two concurrent guesses
// can't both pass the attempts check and both mutate the row. On success,
// extends expiresAt into a longer window so checkout has time to complete
// without asking the guest to re-verify mid-form.
export async function markVerified(email, code, maxAttempts) {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: EMAIL_VERIFICATIONS_TABLE,
        Key: { email },
        UpdateExpression: 'SET verified = :true, expiresAt = :extended',
        ConditionExpression: 'code = :code AND attempts < :maxAttempts',
        ExpressionAttributeValues: {
          ':true': true,
          ':extended': Math.floor((Date.now() + EMAIL_VERIFICATION_VERIFIED_TTL_MS) / 1000),
          ':code': code,
          ':maxAttempts': maxAttempts,
        },
      })
    );
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

// Records a failed guess. Guarded by attribute_exists so a guess against a
// nonexistent (never sent, or already-swept) record is a silent no-op rather
// than resurrecting a row with nothing but an attempt count in it.
export async function recordFailedAttempt(email) {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: EMAIL_VERIFICATIONS_TABLE,
        Key: { email },
        UpdateExpression: 'ADD attempts :one',
        ConditionExpression: 'attribute_exists(email)',
        ExpressionAttributeValues: { ':one': 1 },
      })
    );
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

// Whether `email` currently has a completed, unexpired verification — the
// check checkout gates guest orders on.
export function isCurrentlyVerified(record) {
  return !!record && record.verified === true && record.expiresAt * 1000 > Date.now();
}
