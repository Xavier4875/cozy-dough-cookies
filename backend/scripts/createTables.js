import 'dotenv/config';
import { CreateTableCommand, ListTablesCommand, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import { baseClient } from '../db/client.js';
import {
  customersTableDefinition,
  ordersTableDefinition,
  externalSalesTableDefinition,
  emailVerificationsTableDefinition,
} from '../db/schema.js';

async function createIfMissing(definition) {
  const { TableNames } = await baseClient.send(new ListTablesCommand({}));
  if (TableNames.includes(definition.TableName)) {
    console.log(`Table "${definition.TableName}" already exists — skipping.`);
    return;
  }
  await baseClient.send(new CreateTableCommand(definition));
  console.log(`Created table "${definition.TableName}".`);
}

// DynamoDB Local accepts this call but never actually expires items — fine
// for dev, where verificationRepo.js's own manual expiry check is what
// actually matters. Real AWS DynamoDB does the background cleanup.
async function enableTtl(definition, attributeName) {
  try {
    await baseClient.send(
      new UpdateTimeToLiveCommand({
        TableName: definition.TableName,
        TimeToLiveSpecification: { AttributeName: attributeName, Enabled: true },
      })
    );
    console.log(`Enabled TTL on "${definition.TableName}".`);
  } catch (err) {
    // Already enabled (e.g. table pre-existed from a prior run) — not an error.
    if (err.name !== 'ValidationException') throw err;
  }
}

async function main() {
  await createIfMissing(customersTableDefinition);
  await createIfMissing(ordersTableDefinition);
  await createIfMissing(externalSalesTableDefinition);
  await createIfMissing(emailVerificationsTableDefinition);
  await enableTtl(emailVerificationsTableDefinition, 'expiresAt');
}

main().catch((err) => {
  console.error('Failed to set up DynamoDB tables:', err);
  process.exit(1);
});
