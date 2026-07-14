import 'dotenv/config';
import { CreateTableCommand, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { baseClient } from '../db/client.js';
import { customersTableDefinition, ordersTableDefinition } from '../db/schema.js';

async function createIfMissing(definition) {
  const { TableNames } = await baseClient.send(new ListTablesCommand({}));
  if (TableNames.includes(definition.TableName)) {
    console.log(`Table "${definition.TableName}" already exists — skipping.`);
    return;
  }
  await baseClient.send(new CreateTableCommand(definition));
  console.log(`Created table "${definition.TableName}".`);
}

async function main() {
  await createIfMissing(customersTableDefinition);
  await createIfMissing(ordersTableDefinition);
}

main().catch((err) => {
  console.error('Failed to set up DynamoDB tables:', err);
  process.exit(1);
});
