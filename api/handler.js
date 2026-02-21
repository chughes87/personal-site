const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { randomBytes } = require('crypto');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MESSAGES_TABLE  = process.env.MESSAGES_TABLE;
const RATE_TABLE      = process.env.RATE_TABLE;
const RATE_LIMIT      = parseInt(process.env.RATE_LIMIT || '15', 10);
const ALLOWED_ORIGIN  = process.env.ALLOWED_ORIGIN || '*';
const VOICE_TABLE     = process.env.VOICE_TABLE;

const ROOM             = 'main';
const MAX_CONTENT      = 500;
const MAX_USER         = 30;
const MAX_PARTICIPANTS = 10;

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
};

// ── helpers ────────────────────────────────────────────────────────────────

function nowSec()     { return Math.floor(Date.now() / 1000); }
function ttl(secs)    { return nowSec() + secs; }
function hourBucket() { return new Date().toISOString().slice(0, 13).replace(/\D/g, ''); }
function randomId()   { return randomBytes(4).toString('hex'); }

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
  const id = randomId();
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

// ── voice helpers ──────────────────────────────────────────────────────────

async function getParticipants(roomId) {
  const result = await ddb.send(new QueryCommand({
    TableName: VOICE_TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':pk': `room#${roomId}`, ':prefix': 'participant#' },
  }));
  return (result.Items || []).map(({ clientId, username }) => ({ clientId, username }));
}

// ── POST /voice/join ───────────────────────────────────────────────────────

async function voiceJoin(body) {
  const { username, roomId = 'main' } = body;
  if (!username?.trim()) return resp(400, { error: 'username is required' });

  const existing = await getParticipants(roomId);
  if (existing.length >= MAX_PARTICIPANTS) return resp(409, { error: 'Room is full' });

  const clientId = randomId();
  await ddb.send(new PutCommand({
    TableName: VOICE_TABLE,
    Item: {
      pk: `room#${roomId}`,
      sk: `participant#${clientId}`,
      clientId,
      username: username.trim().slice(0, MAX_USER),
      ttl: ttl(30),
    },
  }));

  const participants = await getParticipants(roomId);
  return resp(200, { clientId, participants });
}

// ── POST /voice/heartbeat ──────────────────────────────────────────────────

async function voiceHeartbeat(body) {
  const { clientId, roomId = 'main' } = body;
  if (!clientId) return resp(400, { error: 'clientId is required' });

  await ddb.send(new UpdateCommand({
    TableName: VOICE_TABLE,
    Key: { pk: `room#${roomId}`, sk: `participant#${clientId}` },
    UpdateExpression: 'SET #ttl = :ttl',
    ExpressionAttributeNames: { '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':ttl': ttl(30) },
  }));

  const participants = await getParticipants(roomId);
  return resp(200, { participants });
}

// ── POST /voice/leave ──────────────────────────────────────────────────────

async function voiceLeave(body) {
  const { clientId, roomId = 'main' } = body;
  if (!clientId) return resp(400, { error: 'clientId is required' });

  await ddb.send(new DeleteCommand({
    TableName: VOICE_TABLE,
    Key: { pk: `room#${roomId}`, sk: `participant#${clientId}` },
  }));

  return resp(200, {});
}

// ── POST /voice/signal ─────────────────────────────────────────────────────

async function voiceSignal(body) {
  const { from, to, type, sdp } = body;
  if (!from || !to || !type || !sdp) {
    return resp(400, { error: 'from, to, type, and sdp are required' });
  }
  if (type !== 'offer' && type !== 'answer') {
    return resp(400, { error: 'type must be offer or answer' });
  }

  const ts = Date.now();
  const id = randomId();
  await ddb.send(new PutCommand({
    TableName: VOICE_TABLE,
    Item: { pk: `inbox#${to}`, sk: `${ts}#${id}`, from, to, type, sdp, ttl: ttl(60) },
  }));

  return resp(201, {});
}

// ── GET /voice/signals ─────────────────────────────────────────────────────

async function voiceSignals(clientId) {
  if (!clientId) return resp(400, { error: 'clientId is required' });

  const result = await ddb.send(new QueryCommand({
    TableName: VOICE_TABLE,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `inbox#${clientId}` },
  }));

  const items = result.Items || [];

  await Promise.all(items.map(item =>
    ddb.send(new DeleteCommand({
      TableName: VOICE_TABLE,
      Key: { pk: item.pk, sk: item.sk },
    }))
  ));

  return resp(200, items.map(({ from, type, sdp }) => ({ from, type, sdp })));
}

// ── voice router ───────────────────────────────────────────────────────────

async function handleVoice(method, path, event) {
  const body  = method !== 'GET' ? JSON.parse(event.body || '{}') : {};
  const route = path.replace(/^\/voice\//, '');

  if (method === 'POST' && route === 'join')      return voiceJoin(body);
  if (method === 'POST' && route === 'heartbeat') return voiceHeartbeat(body);
  if (method === 'POST' && route === 'leave')     return voiceLeave(body);
  if (method === 'POST' && route === 'signal')    return voiceSignal(body);
  if (method === 'GET'  && route === 'signals')   return voiceSignals(event.queryStringParameters?.clientId);

  return resp(404, { error: 'Not found' });
}

// ── handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const method = event.requestContext.http.method;
  const ip     = event.requestContext.http.sourceIp;
  const path   = event.rawPath || '';

  if (method === 'OPTIONS') {
    return resp(200, '', {
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
  }

  try {
    if (path.startsWith('/voice/')) {
      return await handleVoice(method, path, event);
    }

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
