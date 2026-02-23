// Mock AWS SDK before handler.js is loaded

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/client-ec2', () => {
  const ec2Send = jest.fn();
  return {
    EC2Client: jest.fn(() => ({ send: ec2Send })),
    StartInstancesCommand:    jest.fn(p => ({ ...p, _cmd: 'StartInstances' })),
    StopInstancesCommand:     jest.fn(p => ({ ...p, _cmd: 'StopInstances' })),
    DescribeInstancesCommand: jest.fn(p => ({ ...p, _cmd: 'DescribeInstances' })),
    _ec2Send: ec2Send,
  };
});

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

const { _send: send }     = jest.requireMock('@aws-sdk/lib-dynamodb');
const { _ec2Send: ec2Send } = jest.requireMock('@aws-sdk/client-ec2');
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
  ec2Send.mockReset();
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
    expect(JSON.parse(res.body).error).toMatch(/full/i);
  });

  test('returns 409 with "Name already taken" when username is in use (case-insensitive)', async () => {
    send.mockResolvedValueOnce({ Items: [{ clientId: 'x1', username: 'Alice' }] });
    const res = await handler(makeVoiceEvent('POST', 'join', { body: { username: 'alice' } }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/taken/i);
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

  test('allows rejoin when previousClientId matches the conflicting participant', async () => {
    send
      .mockResolvedValueOnce({ Items: [{ clientId: 'prev-id', username: 'alice' }] })  // capacity check
      .mockResolvedValueOnce({})                                                         // DeleteCommand: evict stale
      .mockResolvedValueOnce({})                                                         // PutCommand: new record
      .mockResolvedValueOnce({ Items: [{ clientId: 'new-id', username: 'alice' }] });   // return list

    const res = await handler(makeVoiceEvent('POST', 'join', {
      body: { username: 'alice', previousClientId: 'prev-id' },
    }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.clientId).toBe('string');
    // Verify DeleteCommand was called with the stale participant's key
    const deleteCall = send.mock.calls[1][0];
    expect(deleteCall.Key).toEqual({ pk: 'room#main', sk: 'participant#prev-id' });
  });

  test('returns 409 when previousClientId does not match the conflicting participant', async () => {
    send.mockResolvedValueOnce({ Items: [{ clientId: 'other-id', username: 'alice' }] });

    const res = await handler(makeVoiceEvent('POST', 'join', {
      body: { username: 'alice', previousClientId: 'wrong-id' },
    }));

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/taken/i);
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

// ── TURN server ───────────────────────────────────────────────────────────────

describe('TURN server', () => {
  const INSTANCE_ID = 'i-0testinstance';
  const SECRET      = 'testsecret12345';

  beforeEach(() => {
    process.env.TURN_EC2_INSTANCE_ID = INSTANCE_ID;
    process.env.TURN_SECRET          = SECRET;
  });

  afterEach(() => {
    delete process.env.TURN_EC2_INSTANCE_ID;
    delete process.env.TURN_SECRET;
  });

  // helper: DescribeInstances response for a stopped instance
  function stoppedInstance() {
    return { Reservations: [{ Instances: [{ State: { Name: 'stopped' }, PublicIpAddress: null }] }] };
  }

  // helper: DescribeInstances response for a running instance
  function runningInstance(ip = '1.2.3.4') {
    return { Reservations: [{ Instances: [{ State: { Name: 'running' }, PublicIpAddress: ip }] }] };
  }

  test('turnCredentials: username is {expiry}:{clientId} and credential is correct HMAC', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000);  // 1,000,000 seconds since epoch

    send
      .mockResolvedValueOnce({ Items: [] })   // capacity check
      .mockResolvedValueOnce({})              // PutCommand
      .mockResolvedValueOnce({ Items: [{ clientId: 'abc', username: 'alice' }] });  // return list
    ec2Send.mockResolvedValueOnce(stoppedInstance());  // DescribeInstances
    ec2Send.mockResolvedValueOnce({});                 // StartInstances

    const res  = await handler(makeVoiceEvent('POST', 'join', { body: { username: 'alice' } }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.turn).toBeDefined();

    const expectedExpiry    = 1_000_000_000 / 1000 + 3600;
    const expectedUsername  = `${expectedExpiry}:${body.clientId}`;
    const expectedCredential = require('crypto')
      .createHmac('sha1', SECRET)
      .update(expectedUsername)
      .digest('base64');

    expect(body.turn.username).toBe(expectedUsername);
    expect(body.turn.credential).toBe(expectedCredential);
  });

  test('voiceJoin when room is empty: calls StartInstances and returns turn object', async () => {
    send
      .mockResolvedValueOnce({ Items: [] })  // capacity check (empty room)
      .mockResolvedValueOnce({})             // PutCommand
      .mockResolvedValueOnce({ Items: [{ clientId: 'abc', username: 'alice' }] });
    ec2Send.mockResolvedValueOnce(stoppedInstance());  // DescribeInstances
    ec2Send.mockResolvedValueOnce({});                 // StartInstances

    const res  = await handler(makeVoiceEvent('POST', 'join', { body: { username: 'alice' } }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.turn).toBeDefined();
    expect(body.turnReady).toBe(false);
    expect(ec2Send.mock.calls.some(([cmd]) => cmd._cmd === 'StartInstances')).toBe(true);
  });

  test('voiceJoin when room is non-empty: does NOT call StartInstances', async () => {
    send
      .mockResolvedValueOnce({ Items: [{ clientId: 'x1', username: 'bob' }] })  // existing participant
      .mockResolvedValueOnce({})   // PutCommand
      .mockResolvedValueOnce({ Items: [{ clientId: 'x1', username: 'bob' }, { clientId: 'abc', username: 'alice' }] });
    ec2Send.mockResolvedValueOnce(runningInstance());  // DescribeInstances (already running)

    const res  = await handler(makeVoiceEvent('POST', 'join', { body: { username: 'alice' } }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.turn).toBeDefined();
    expect(ec2Send.mock.calls.some(([cmd]) => cmd._cmd === 'StartInstances')).toBe(false);
  });

  test('voiceJoin when instance is running: returns turnReady: true with turnHost', async () => {
    send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [{ clientId: 'abc', username: 'alice' }] });
    ec2Send.mockResolvedValueOnce(runningInstance('5.6.7.8'));

    const res  = await handler(makeVoiceEvent('POST', 'join', { body: { username: 'alice' } }));
    const body = JSON.parse(res.body);

    expect(body.turnReady).toBe(true);
    expect(body.turnHost).toBe('5.6.7.8');
  });

  test('voiceLeave last participant: calls StopInstances', async () => {
    send
      .mockResolvedValueOnce({})               // DeleteCommand
      .mockResolvedValueOnce({ Items: [] });   // getParticipants → empty
    ec2Send.mockResolvedValueOnce({});         // StopInstances

    const res = await handler(makeVoiceEvent('POST', 'leave', { body: { clientId: 'abc' } }));

    expect(res.statusCode).toBe(200);
    expect(ec2Send.mock.calls.some(([cmd]) => cmd._cmd === 'StopInstances')).toBe(true);
  });

  test('voiceLeave not last participant: does NOT call StopInstances', async () => {
    send
      .mockResolvedValueOnce({})  // DeleteCommand
      .mockResolvedValueOnce({ Items: [{ clientId: 'x1', username: 'bob' }] });  // still someone

    const res = await handler(makeVoiceEvent('POST', 'leave', { body: { clientId: 'abc' } }));

    expect(res.statusCode).toBe(200);
    expect(ec2Send).not.toHaveBeenCalled();
  });

  test('GET /voice/turn/status when running: returns { ready: true, host }', async () => {
    ec2Send.mockResolvedValueOnce(runningInstance('1.2.3.4'));

    const res  = await handler(makeVoiceEvent('GET', 'turn/status'));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.host).toBe('1.2.3.4');
  });

  test('GET /voice/turn/status when pending: returns { ready: false, host: null }', async () => {
    ec2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: 'pending' }, PublicIpAddress: null }] }] });

    const res  = await handler(makeVoiceEvent('GET', 'turn/status'));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.host).toBeNull();
  });
});
