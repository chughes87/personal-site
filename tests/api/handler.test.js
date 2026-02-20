// Mock AWS SDK before handler.js is loaded

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const send = jest.fn();
  return {
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send })) },
    QueryCommand: jest.fn(p => p),
    PutCommand: jest.fn(p => p),
    UpdateCommand: jest.fn(p => p),
    _send: send,
  };
});

process.env.MESSAGES_TABLE = 'test-messages';
process.env.RATE_TABLE = 'test-rates';
process.env.RATE_LIMIT = '15';

const { _send: send } = jest.requireMock('@aws-sdk/lib-dynamodb');
const { handler } = require('../../api/handler');

function makeEvent(method, { qs = null, body = null } = {}) {
  return {
    requestContext: { http: { method, sourceIp: '1.2.3.4' } },
    queryStringParameters: qs,
    body: body != null ? JSON.stringify(body) : null,
  };
}

beforeEach(() => {
  send.mockReset();
});

describe('OPTIONS', () => {
  test('returns 200 with CORS preflight headers', async () => {
    const res = await handler(makeEvent('OPTIONS'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET,POST,OPTIONS');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type');
  });
});

describe('GET /messages', () => {
  test('returns 200 with mapped messages (strips internal DynamoDB fields)', async () => {
    send.mockResolvedValueOnce({
      Items: [
        { id: 'abc', username: 'alice', content: 'hello', ts: 1000, room: 'main', sk: '1000#abc', ttl: 9999 },
      ],
    });

    const res = await handler(makeEvent('GET'));

    expect(res.statusCode).toBe(200);
    const msgs = JSON.parse(res.body);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ id: 'abc', username: 'alice', content: 'hello', ts: 1000 });
    expect(msgs[0].room).toBeUndefined();
    expect(msgs[0].sk).toBeUndefined();
    expect(msgs[0].ttl).toBeUndefined();
  });

  test('returns empty array when no messages found', async () => {
    send.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET'));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  test('passes since param to DynamoDB query as sk prefix', async () => {
    send.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', { qs: { since: '99999' } }));

    const queryArg = send.mock.calls[0][0];
    expect(queryArg.ExpressionAttributeValues[':sk']).toBe('99999#');
  });

  test('returns 500 when DynamoDB throws', async () => {
    send.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const res = await handler(makeEvent('GET'));

    expect(res.statusCode).toBe(500);
  });
});

describe('POST /messages', () => {
  test('returns 400 when username is missing', async () => {
    const res = await handler(makeEvent('POST', { body: { content: 'hi' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when content is empty string', async () => {
    const res = await handler(makeEvent('POST', { body: { username: 'alice', content: '' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when content is whitespace only', async () => {
    const res = await handler(makeEvent('POST', { body: { username: 'alice', content: '   ' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when content exceeds 500 characters', async () => {
    const res = await handler(makeEvent('POST', { body: { username: 'alice', content: 'x'.repeat(501) } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 201 with message on success', async () => {
    send
      .mockResolvedValueOnce({ Attributes: { count: 1 } })  // checkRate
      .mockResolvedValueOnce({});                             // PutCommand

    const res = await handler(makeEvent('POST', { body: { username: 'alice', content: 'hello' } }));

    expect(res.statusCode).toBe(201);
    const msg = JSON.parse(res.body);
    expect(msg.username).toBe('alice');
    expect(msg.content).toBe('hello');
    expect(typeof msg.id).toBe('string');
    expect(typeof msg.ts).toBe('number');
  });

  test('trims and truncates long usernames to 30 chars', async () => {
    send
      .mockResolvedValueOnce({ Attributes: { count: 1 } })
      .mockResolvedValueOnce({});

    const longName = 'a'.repeat(50);
    const res = await handler(makeEvent('POST', { body: { username: longName, content: 'hi' } }));

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).username).toHaveLength(30);
  });

  test('returns 429 when rate limit is exceeded', async () => {
    send.mockResolvedValueOnce({ Attributes: { count: 16 } }); // count > RATE_LIMIT (15)

    const res = await handler(makeEvent('POST', { body: { username: 'alice', content: 'hi' } }));

    expect(res.statusCode).toBe(429);
  });

  test('returns 500 when DynamoDB throws during post', async () => {
    send.mockRejectedValueOnce(new Error('DynamoDB write failed'));

    const res = await handler(makeEvent('POST', { body: { username: 'alice', content: 'hi' } }));

    expect(res.statusCode).toBe(500);
  });
});

describe('unknown method', () => {
  test('returns 405 for DELETE', async () => {
    const res = await handler(makeEvent('DELETE'));
    expect(res.statusCode).toBe(405);
  });
});

describe('CORS headers', () => {
  test('all responses include Content-Type and Access-Control-Allow-Origin', async () => {
    send.mockResolvedValueOnce({ Items: [] });
    const res = await handler(makeEvent('GET'));
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Access-Control-Allow-Origin']).toBeDefined();
  });
});
