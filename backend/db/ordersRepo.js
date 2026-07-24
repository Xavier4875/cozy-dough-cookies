import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, scanAll } from './client.js';
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

// Sets an order's status and any number of stage timestamps in one write.
// A null value REMOVEs that attribute instead of SETting it — needed when
// staff correct a status backward (e.g. ready -> placed should drop both
// confirmedAt and readyAt, not leave a stale one behind for Recent Orders'
// eventual timeline to show incorrectly). Shared by set-status (free
// correction among placed/confirmed/ready) and complete (the sole
// ready->completed transition).
export async function setOrderStatus(orderId, updates) {
  const names = {};
  const values = {};
  const setParts = [];
  const removeParts = [];
  for (const [key, value] of Object.entries(updates)) {
    const nameKey = `#${key}`;
    names[nameKey] = key;
    if (value === null) {
      removeParts.push(nameKey);
    } else {
      const valueKey = `:${key}`;
      setParts.push(`${nameKey} = ${valueKey}`);
      values[valueKey] = value;
    }
  }
  const expression = [
    setParts.length && `SET ${setParts.join(', ')}`,
    removeParts.length && `REMOVE ${removeParts.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' ');
  await docClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression: expression,
      ExpressionAttributeNames: names,
      ...(Object.keys(values).length > 0 && { ExpressionAttributeValues: values }),
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

// A guest's full order history, looked up by the email they checked out
// with — the email-createdAt-index GSI has existed since the table was
// created but had no caller until Past Orders needed one. Same shape as
// queryOrdersByCustomerId (newest first).
export async function queryOrdersByEmail(email) {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: 'email-createdAt-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      ScanIndexForward: false,
    })
  );
  return Items ?? [];
}

// Every guest checkout (no customerId at all — registered customers' orders
// are reached via queryOrdersByCustomerId instead). Used by Past Orders
// search to build the "default guest list" and to name-match guests, since
// there's no index over contact names to query directly. Same
// first-full-table-Scan trade-off as scanAllCustomers (customersRepo.js).
// Paged via scanAll — FilterExpression is applied after each page is read,
// not before, so a plain single Scan would still silently truncate at 1MB.
export async function scanGuestOrders() {
  return scanAll({
    TableName: ORDERS_TABLE,
    FilterExpression: 'attribute_not_exists(customerId)',
  });
}

const ACTIVE_STATUSES = ['placed', 'confirmed', 'ready'];

// Every order not yet fulfilled, across every customer (and guests) —
// staff's fulfillment queue. "Not yet fulfilled" now spans three status
// values (placed/confirmed/ready), so this queries status-createdAt-index
// once per status and merges — the index's partition key is an exact status
// match, it can't select a range of statuses in one query. Oldest-first: the
// order that's been waiting longest should be the first thing staff see.
export async function queryActiveOrders() {
  const results = await Promise.all(
    ACTIVE_STATUSES.map((status) =>
      docClient.send(
        new QueryCommand({
          TableName: ORDERS_TABLE,
          IndexName: 'status-createdAt-index',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': status },
        })
      )
    )
  );
  const orders = results.flatMap((r) => r.Items ?? []);
  orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return orders;
}

// Every fulfilled order, newest-completed-first. The GSI's sort key is
// createdAt (placement time), not completedAt, so it can't range-filter by
// completion time itself — callers filter the returned items to a recent
// window (e.g. Recent Orders' 7-day display cutoff) in application code.
export async function queryCompletedOrders() {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: 'status-createdAt-index',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'completed' },
      ScanIndexForward: false,
    })
  );
  return Items ?? [];
}

// Every canceled order, newest-canceled-first (well, newest-placed-first —
// same createdAt-sort-key caveat as queryCompletedOrders above). Shown
// alongside completed orders in Recent Orders so a cancellation still leaves
// a visible record, not a silent disappearance.
export async function queryCanceledOrders() {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: 'status-createdAt-index',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'canceled' },
      ScanIndexForward: false,
    })
  );
  return Items ?? [];
}

// Every order, every status — Sales needs the whole table regardless of
// period (even "Today" can't be answered by any existing GSI, since none of
// them range on createdAt alone; "Total" inherently needs everything
// anyway). Same full-table-Scan trade-off as scanGuestOrders/
// scanAllCustomers, filtered/aggregated by the caller in memory. Paged via
// scanAll — a plain single Scan silently truncates at 1MB, which Total's
// "everything, forever" premise can't tolerate once the table grows.
export async function scanAllOrders() {
  return scanAll({ TableName: ORDERS_TABLE });
}
