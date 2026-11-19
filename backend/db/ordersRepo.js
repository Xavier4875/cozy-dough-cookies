import { createHash } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, scanAll } from './client.js';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './schema.js';

// The id of the nth order created from one Stripe payment. Derived from the
// payment (not random) on purpose: createOrder refuses to overwrite an
// existing id, so two checkout requests racing to finalize the same payment
// collide on the same ids and exactly one of them can win — DynamoDB itself is
// the lock. UUID-shaped like the random ids it replaced, so nothing that reads
// an orderId cares. Also lets anything holding a payment id (the webhook's
// "was this ever turned into an order?" check) look the orders up directly.
export function deterministicOrderId(paymentIntentId, index) {
  const hex = createHash('sha256').update(`order:${paymentIntentId}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Thrown by createOrder when an order with that id already exists.
export class DuplicateOrderError extends Error {
  constructor(orderId) {
    super(`An order with id ${orderId} already exists.`);
    this.name = 'DuplicateOrderError';
    this.orderId = orderId;
  }
}

// Writes a brand-new order, and only if its id isn't taken — never an
// overwrite. A caller that gets DuplicateOrderError knows another request
// already created it.
export async function createOrder(record) {
  try {
    await docClient.send(
      new PutCommand({
        TableName: ORDERS_TABLE,
        Item: record,
        ConditionExpression: 'attribute_not_exists(orderId)',
      })
    );
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') throw new DuplicateOrderError(record.orderId);
    throw err;
  }
  return record;
}

// Thrown by createOrdersSpendingPoints when the customer's balance can't cover
// the points the orders redeem (or they have no points account at all).
export class InsufficientPointsError extends Error {
  constructor() {
    super('Not enough reward points.');
    this.name = 'InsufficientPointsError';
  }
}

// Saves the orders of a checkout that costs no money — everything in it is paid
// for with reward points — and takes those points off the customer's balance, in
// ONE all-or-nothing DynamoDB transaction. There is no Stripe payment behind
// such an order to refund if a later step fails, so it can't be done in two
// steps the way a paid checkout is: either the customer has the order AND the
// points are gone, or neither happened. That also makes it impossible to get the
// order without paying the points (the balance condition rejects the whole
// transaction), and — because the order ids are derived from the checkout's
// one-time key (see freeCheckout.js) — a repeated request can't place it, or
// spend the points, a second time.
//
// Throws DuplicateOrderError if any order id already exists (the same checkout
// was already placed) and InsufficientPointsError if the balance is too low;
// nothing is written in either case.
export async function createOrdersSpendingPoints(records, customerId, points) {
  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          ...records.map((record) => ({
            Put: { TableName: ORDERS_TABLE, Item: record, ConditionExpression: 'attribute_not_exists(orderId)' },
          })),
          {
            Update: {
              TableName: CUSTOMERS_TABLE,
              Key: { customerId },
              UpdateExpression: 'ADD rewards :negPoints',
              // A missing row or missing balance also fails this, which is the
              // right answer: no account, no points to spend.
              ConditionExpression: 'rewards >= :points',
              ExpressionAttributeValues: { ':negPoints': -points, ':points': points },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') throw err;
    const reasons = err.CancellationReasons ?? [];
    // Reported per item, in the order given above: the orders first, then the
    // customer. An existing order wins over a short balance — the first request
    // already placed this checkout (and spent its points), so the repeat must
    // read as "already placed", not "not enough points".
    const duplicate = records.findIndex((_, i) => reasons[i]?.Code === 'ConditionalCheckFailed');
    if (duplicate !== -1) throw new DuplicateOrderError(records[duplicate].orderId);
    if (reasons[records.length]?.Code === 'ConditionalCheckFailed') throw new InsufficientPointsError();
    throw err;
  }
  return records;
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

// Corrects the reward points recorded on orders after the fact. Used when the
// points a checkout meant to move never did (the spend was refused, or awarding
// gave up), so a later cancel doesn't return or take back points that were
// never actually moved. Only the fields given are touched.
export async function updateOrderPoints(orderId, { pointsEarned, pointsSpent }) {
  const sets = [];
  const names = {};
  const values = {};
  for (const [key, value] of Object.entries({ pointsEarned, pointsSpent })) {
    if (value === undefined) continue;
    sets.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = value;
  }
  if (sets.length === 0) return;
  await docClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

// Marks an order canceled and, in the same all-or-nothing write, moves its
// reward points back: the points it earned come off the customer's balance and
// the points it spent on redeemed rewards are returned. Doing both in one
// DynamoDB transaction is what makes the points move exactly once — a second
// cancel racing the first (a double-click, a retry) fails the status condition
// and so changes nothing, and the order can never end up canceled with its
// points still unadjusted.
//
// `points` is { earned, spent } from pointsToReverse(), or zeros when staff
// canceled without a refund (the customer paid and keeps what they earned).
// The balance is allowed to dip below zero: if the customer already spent
// points this order earned, the shortfall is simply owed back, and the
// existing redemption check (balance >= cost) keeps them from spending more
// until they've earned it.
//
// `afterCompletion` is the refund of an order that was already picked up or
// delivered (a "past order"): the same write, but the guard is reversed — it only
// applies to an order that IS completed — and the order is marked
// `refundedAfterCompletion` so screens can say "Refunded" instead of "Canceled".
// completedAt is left as it was: "it was picked up, then refunded" is real
// history, and the order stays out of Sales like any canceled order.
//
// Returns { canceled: false } if the order wasn't in the state this needs (already
// canceled or completed — or, for afterCompletion, not completed): nothing
// written. Else { canceled: true, pointsAdjusted } where pointsAdjusted is
// { earned, spent } or null if no points moved.
export async function cancelOrderRecord(order, { canceledAt, refund, refundSkipped, points, afterCompletion = false }) {
  const { earned = 0, spent = 0 } = points ?? {};
  const moveFor = order.customerId && (earned > 0 || spent > 0) ? order.customerId : null;

  const sets = ['#status = :canceled', '#canceledAt = :canceledAt'];
  const names = { '#status': 'status', '#canceledAt': 'canceledAt' };
  const values = { ':canceled': 'canceled', ':canceledAt': canceledAt, ':completed': 'completed' };
  if (afterCompletion) {
    sets.push('#refundedAfterCompletion = :true');
    names['#refundedAfterCompletion'] = 'refundedAfterCompletion';
    values[':true'] = true;
  }
  if (refund) {
    sets.push('#refund = :refund');
    names['#refund'] = 'refund';
    values[':refund'] = refund;
  }
  if (refundSkipped) {
    sets.push('#refundSkipped = :refundSkipped');
    names['#refundSkipped'] = 'refundSkipped';
    values[':refundSkipped'] = true;
  }
  const orderUpdate = (withPoints) => ({
    TableName: ORDERS_TABLE,
    Key: { orderId: order.orderId },
    UpdateExpression: `SET ${[
      ...sets,
      ...(withPoints ? ['#pointsAdjustment = :pointsAdjustment'] : []),
    ].join(', ')}`,
    ConditionExpression: afterCompletion ? '#status = :completed' : 'NOT (#status IN (:canceled, :completed))',
    ExpressionAttributeNames: { ...names, ...(withPoints && { '#pointsAdjustment': 'pointsAdjustment' }) },
    ExpressionAttributeValues: {
      ...values,
      ...(withPoints && { ':pointsAdjustment': { earnedTakenBack: earned, spentReturned: spent } }),
    },
  });

  const orderOnly = async () => {
    try {
      await docClient.send(new UpdateCommand(orderUpdate(false)));
      return { canceled: true, pointsAdjusted: null };
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return { canceled: false };
      throw err;
    }
  };

  if (!moveFor) return orderOnly();

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          { Update: orderUpdate(true) },
          {
            Update: {
              TableName: CUSTOMERS_TABLE,
              Key: { customerId: moveFor },
              UpdateExpression: 'ADD rewards :net',
              // Like addRewardsPoints: never resurrect a deleted account's row.
              ConditionExpression: 'attribute_exists(customerId)',
              ExpressionAttributeValues: { ':net': spent - earned },
            },
          },
        ],
      })
    );
    return { canceled: true, pointsAdjusted: { earned, spent } };
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') throw err;
    const [orderReason, customerReason] = err.CancellationReasons ?? [];
    if (orderReason?.Code === 'ConditionalCheckFailed') return { canceled: false };
    // The customer deleted their account, so there's no balance to adjust —
    // that must not stop staff canceling the order.
    if (customerReason?.Code === 'ConditionalCheckFailed') return orderOnly();
    throw err;
  }
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
// with (via the email-createdAt-index GSI). Same shape as
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
