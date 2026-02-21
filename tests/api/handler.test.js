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
    DeleteCommand: jest.fn(p => p),
    _send: send,
  };
});

process.env.MESSAGES_TABLE = 'test-messages';
process.env.RATE_TABLE     = 'test-rates';
process.env.RATE_LIMIT     = '15';
process.env.VOICE_TABLE    = 'test-voice';

const { _send: send } = jest.requireMock('@aws-sdk/lib-dynamodb');
const { handler } = require('../../api/handler');

function makeEvent(method, { qs = null, body = null } = {}) {
  return {
    requestContext: { http: { method, sourceIp: '1.2.3.4' } },
    queryStringParameters: qs,
    body: body != null ? JSON.stringify(body) : null,
  };
}

function makeVoiceEvent(method, route, { qs = null, body = null } = {}) {
  return {
    rawPath: `/voice/${route}`,
    requestContext: { http: { method, sourceIp: '1.2.3.4' } },
    queryStringParameters: qs,
    body: body != null ? JSON.stringify(body) : null,
  };
}

beforeEach(() => {
  send.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('OPTIONS', () => {
  test('returns 200 with CORS preflight headers', async () => {
    const res = await handler(makeEvent('OPTIONS'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET,POST,DELETE,OPTIONS');
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

describe('POST /voice/join', () => {
  test('returns 400 when username is missing', async () => {
    const res = await handler(makeVoiceEvent('POST', 'join', { body: {} }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 409 when room has 10 participants', async () => {
    const fullRoom = Array.from({ length: 10 }, (_, i) => ({ clientId: `id${i}`, username: `user${i}` }));
    send.mockResolvedValueOnce({ Items: fullRoom });
    const res = await handler(makeVoiceEvent('POST', 'join', { body: { username: 'alice' } }));
    expect(res.statusCode).toBe(409);
  });

  test('returns 200 with clientId and participants on success', async () => {
    send
      .mockResolvedValueOnce({ Items: [] })                                          // capacity check
      .mockResolvedValueOnce({})                                                     // PutCommand
      .mockResolvedValueOnce({ Items: [{ clientId: 'abc', username: 'alice' }] });  // return list

    const res = await handler(makeVoiceEvent('POST', 'join', { body: { username: 'alice' } }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.clientId).toBe('string');
    expect(body.participants).toEqual([{ clientId: 'abc', username: 'alice' }]);
  });
});

describe('POST /voice/heartbeat', () => {
  test('returns 400 when clientId is missing', async () => {
    const res = await handler(makeVoiceEvent('POST', 'heartbeat', { body: {} }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 200 with updated participant list', async () => {
    send
      .mockResolvedValueOnce({})                                                     // UpdateCommand
      .mockResolvedValueOnce({ Items: [{ clientId: 'abc', username: 'alice' }] });  // getParticipants

    const res = await handler(makeVoiceEvent('POST', 'heartbeat', { body: { clientId: 'abc' } }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).participants).toEqual([{ clientId: 'abc', username: 'alice' }]);
  });
});

describe('POST /voice/leave', () => {
  test('returns 400 when clientId is missing', async () => {
    const res = await handler(makeVoiceEvent('POST', 'leave', { body: {} }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 200 and deletes participant record', async () => {
    send.mockResolvedValueOnce({});

    const res = await handler(makeVoiceEvent('POST', 'leave', { body: { clientId: 'abc' } }));

    expect(res.statusCode).toBe(200);
    expect(send.mock.calls[0][0].Key).toEqual({ pk: 'room#main', sk: 'participant#abc' });
  });
});

describe('POST /voice/signal', () => {
  test('returns 400 when required fields are missing', async () => {
    const res = await handler(makeVoiceEvent('POST', 'signal', { body: { from: 'a', to: 'b' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when type is not offer or answer', async () => {
    const res = await handler(makeVoiceEvent('POST', 'signal', {
      body: { from: 'a', to: 'b', type: 'invalid', sdp: 'v=0' },
    }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 201 and writes to correct inbox partition', async () => {
    send.mockResolvedValueOnce({});

    const res = await handler(makeVoiceEvent('POST', 'signal', {
      body: { from: 'aaa', to: 'bbb', type: 'offer', sdp: 'v=0' },
    }));

    expect(res.statusCode).toBe(201);
    const item = send.mock.calls[0][0].Item;
    expect(item.pk).toBe('inbox#bbb');
    expect(item.from).toBe('aaa');
    expect(item.type).toBe('offer');
    expect(item.sdp).toBe('v=0');
  });
});

describe('GET /voice/signals', () => {
  test('returns 400 when clientId is missing', async () => {
    const res = await handler(makeVoiceEvent('GET', 'signals'));
    expect(res.statusCode).toBe(400);
  });

  test('returns signals and deletes them from inbox', async () => {
    send
      .mockResolvedValueOnce({
        Items: [{ pk: 'inbox#abc', sk: '1000#x', from: 'def', type: 'offer', sdp: 'v=0' }],
      })
      .mockResolvedValueOnce({});  // DeleteCommand

    const res = await handler(makeVoiceEvent('GET', 'signals', { qs: { clientId: 'abc' } }));

    expect(res.statusCode).toBe(200);
    const signals = JSON.parse(res.body);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual({ from: 'def', type: 'offer', sdp: 'v=0' });
    expect(signals[0].pk).toBeUndefined();
    expect(send.mock.calls[1][0].Key).toEqual({ pk: 'inbox#abc', sk: '1000#x' });
  });

  test('returns empty array when no signals pending', async () => {
    send.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeVoiceEvent('GET', 'signals', { qs: { clientId: 'abc' } }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });
});
