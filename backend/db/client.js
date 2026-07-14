import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

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
