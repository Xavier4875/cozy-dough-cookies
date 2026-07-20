import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './client.js';
import { ORDERS_TABLE } from './schema.js';

export async function createOrder(record) {
  await docClient.send(
    new PutCommand({
      TableName: ORDERS_TABLE,
      Item: record,
    })
  );
  return record;
}

// Replaces the whole fulfillment map in one write, rather than a partial
// nested-attribute update expression — simpler and safe here since callers
// (currently only the address-verification retry queue) always have the
// complete, correct new value.
export async function updateOrderFulfillment(orderId, fulfillment) {
  await docClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET fulfillment = :fulfillment',
      ExpressionAttributeValues: { ':fulfillment': fulfillment },
    })
  );
}

export async function getOrderById(orderId) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
    })
  );
  return Item ?? null;
}

export async function queryOrdersByCustomerId(customerId) {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: 'customerId-createdAt-index',
      KeyConditionExpression: 'customerId = :customerId',
      ExpressionAttributeValues: { ':customerId': customerId },
      ScanIndexForward: false,
    })
  );
  return Items ?? [];
}
