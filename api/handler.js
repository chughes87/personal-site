const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { randomBytes } = require('crypto');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MESSAGES_TABLE  = process.env.MESSAGES_TABLE;
const RATE_TABLE      = process.env.RATE_TABLE;
const RATE_LIMIT      = parseInt(process.env.RATE_LIMIT || '15', 10);
const ALLOWED_ORIGIN  = process.env.ALLOWED_ORIGIN || '*';

const ROOM        = 'main';
const MAX_CONTENT = 500;
const MAX_USER    = 30;

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
};

// ── helpers ────────────────────────────────────────────────────────────────

function nowSec()     { return Math.floor(Date.now() / 1000); }
function ttl(secs)    { return nowSec() + secs; }
function hourBucket() { return new Date().toISOString().slice(0, 13).replace(/\D/g, ''); }

function resp(statusCode, body, extra = {}) {
  return { statusCode, headers: { ...CORS, ...extra }, body: JSON.stringify(body) };
}

// ── rate limiting ──────────────────────────────────────────────────────────

async function checkRate(ip) {
  const result = await ddb.send(new UpdateCommand({
    TableName: RATE_TABLE,
    Key: { pk: `${ip}#${hourBucket()}` },
    UpdateExpression: 'ADD #n :one SET #ttl = if_not_exists(#ttl, :ttl)',
    ExpressionAttributeNames: { '#n': 'count', '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':one': 1, ':ttl': ttl(7200) },
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes.count <= RATE_LIMIT;
}

// ── GET /messages ──────────────────────────────────────────────────────────

async function getMessages(since) {
  // Default to last 24 h so initial load isn't empty on old rooms
  const sinceTs = since ? Number(since) : Date.now() - 86_400_000;
  const sk = `${sinceTs}#`;

  const result = await ddb.send(new QueryCommand({
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: '#r = :r AND #sk > :sk',
    ExpressionAttributeNames: { '#r': 'room', '#sk': 'sk' },
    ExpressionAttributeValues: { ':r': ROOM, ':sk': sk },
    Limit: 100,
    ScanIndexForward: true,
  }));

  return (result.Items || []).map(({ id, username, content, ts }) => ({ id, username, content, ts }));
}

// ── POST /messages ─────────────────────────────────────────────────────────

async function postMessage(ip, username, content) {
  if (!username?.trim() || !content?.trim()) {
    return resp(400, { error: 'username and content are required' });
  }
  if (content.length > MAX_CONTENT) {
    return resp(400, { error: 'Message too long' });
  }

  if (!(await checkRate(ip))) {
    return resp(429, { error: 'Rate limit reached — try again in an hour.' });
  }

  const ts = Date.now();
  const id = randomBytes(4).toString('hex');
  const item = {
    room:     ROOM,
    sk:       `${ts}#${id}`,
    id,
    ts,
    username: username.trim().slice(0, MAX_USER),
    content:  content.trim().slice(0, MAX_CONTENT),
    ttl:      ttl(7 * 86_400),
  };

  await ddb.send(new PutCommand({ TableName: MESSAGES_TABLE, Item: item }));
  const { id: i, username: u, content: c, ts: t } = item;
  return resp(201, { id: i, username: u, content: c, ts: t });
}

// ── handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const method = event.requestContext.http.method;
  const ip     = event.requestContext.http.sourceIp;

  if (method === 'OPTIONS') {
    return resp(200, '', {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
  }

  try {
    if (method === 'GET') {
      const since    = event.queryStringParameters?.since ?? null;
      const messages = await getMessages(since);
      return resp(200, messages);
    }

    if (method === 'POST') {
      const { username, content } = JSON.parse(event.body || '{}');
      return await postMessage(ip, username, content);
    }

    return resp(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return resp(500, { error: 'Internal error' });
  }
};
