export const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE_NAME || 'CozyDoughCustomers';
export const ORDERS_TABLE = process.env.ORDERS_TABLE_NAME || 'CozyDoughOrders';
export const EXTERNAL_SALES_TABLE = process.env.EXTERNAL_SALES_TABLE_NAME || 'CozyDoughExternalSales';

// Customers: one row per real account (customer or staff/admin — role comes
// from a Cognito group, not from a DynamoDB attribute). Guests never get a
// row here at all; their info lives only on their order's `contact` field.
export const customersTableDefinition = {
  TableName: CUSTOMERS_TABLE,
  BillingMode: 'PAY_PER_REQUEST',
  AttributeDefinitions: [
    { AttributeName: 'customerId', AttributeType: 'S' },
    { AttributeName: 'email', AttributeType: 'S' },
  ],
  KeySchema: [{ AttributeName: 'customerId', KeyType: 'HASH' }],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'email-index',
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
};

// Orders: covers customer, admin, and guest orders in one table.
// `customerId` is omitted on guest orders — GSIs are sparse, so those rows
// simply don't appear in customerId-createdAt-index, which is what we want.
export const ordersTableDefinition = {
  TableName: ORDERS_TABLE,
  BillingMode: 'PAY_PER_REQUEST',
  AttributeDefinitions: [
    { AttributeName: 'orderId', AttributeType: 'S' },
    { AttributeName: 'customerId', AttributeType: 'S' },
    { AttributeName: 'status', AttributeType: 'S' },
    { AttributeName: 'createdAt', AttributeType: 'S' },
    { AttributeName: 'email', AttributeType: 'S' },
  ],
  KeySchema: [{ AttributeName: 'orderId', KeyType: 'HASH' }],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'customerId-createdAt-index',
      KeySchema: [
        { AttributeName: 'customerId', KeyType: 'HASH' },
        { AttributeName: 'createdAt', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    {
      IndexName: 'status-createdAt-index',
      KeySchema: [
        { AttributeName: 'status', KeyType: 'HASH' },
        { AttributeName: 'createdAt', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    {
      IndexName: 'email-createdAt-index',
      KeySchema: [
        { AttributeName: 'email', KeyType: 'HASH' },
        { AttributeName: 'createdAt', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
};

// Staff-recorded revenue from sales made outside the site — bare
// { id, amount, createdAt }, no items/flavors. Small and read in full
// (Sales' /api/sales already scans the whole Orders table the same way),
// so no GSI.
export const externalSalesTableDefinition = {
  TableName: EXTERNAL_SALES_TABLE,
  BillingMode: 'PAY_PER_REQUEST',
  AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
  KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
};
