import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

// DYNAMODB_ENDPOINT points at DynamoDB Local during development; leaving it
// unset in real AWS lets the SDK resolve the real regional endpoint itself.
// Exported directly too — table management (create/list/describe) isn't
// available on the document client wrapper below, only on the base client.
export const baseClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.DYNAMODB_ENDPOINT && { endpoint: process.env.DYNAMODB_ENDPOINT }),
});

export const docClient = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// A bare Scan only returns up to 1MB per call — past that it sets
// LastEvaluatedKey and expects the caller to page through the rest. Every
// full-table-Scan repo function (scanAllOrders, scanGuestOrders,
// scanAllCustomers, and Sales' external-sales scan) needs this same loop,
// so it lives here once rather than duplicated at each call site.
export async function scanAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await docClient.send(new ScanCommand({ ...params, ExclusiveStartKey }));
    items.push(...(result.Items ?? []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}
