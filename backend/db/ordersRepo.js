import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
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

export async function getOrderById(orderId) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
    })
  );
  return Item ?? null;
}
