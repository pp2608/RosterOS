const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function readAuthConfig(env = process.env) {
  return {
    username: env.DEMO_LOGIN_USERNAME?.trim() || '',
    password: env.DEMO_LOGIN_PASSWORD || '',
    secret: env.DEMO_AUTH_SECRET || '',
  };
}

function assertAuthConfiguration(env = process.env) {
  const config = readAuthConfig(env);
  if (!config.username || !config.password || !config.secret) {
    throw new Error('Demo authentication is required. Set DEMO_LOGIN_USERNAME, DEMO_LOGIN_PASSWORD, and DEMO_AUTH_SECRET on the API server.');
  }
  if (config.password.length < 12) throw new Error('DEMO_LOGIN_PASSWORD must contain at least 12 characters.');
  if (Buffer.byteLength(config.secret) < 32) {
    throw new Error('DEMO_AUTH_SECRET must contain at least 32 bytes.');
  }
  return config;
}

function safeEqual(value, expected) {
  const left = createHash('sha256').update(String(value)).digest();
  const right = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(left, right);
}

function credentialsMatch(username, password, config = readAuthConfig()) {
  const usernameMatches = safeEqual(username || '', config.username);
  const passwordMatches = safeEqual(password || '', config.password);
  return Boolean(config.username && config.password && usernameMatches && passwordMatches);
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function issueToken(username, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub: username, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token, secret, now = Date.now()) {
  if (!token || !secret) return false;
  const [payload, signature, extra] = String(token).split('.');
  if (!payload || !signature || extra !== undefined) return false;
  const expected = sign(payload, secret);
  if (!safeEqual(signature, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims.sub === 'string' && claims.sub.length > 0 && Number.isInteger(claims.exp) && claims.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

function requireAuthentication(req, res, next) {
  if (req.method === 'OPTIONS' || (req.method === 'GET' && req.path === '/health') || (req.method === 'POST' && req.path === '/auth/login')) return next();
  const { secret } = readAuthConfig();
  const authorization = req.get('authorization') || '';
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!verifyToken(token, secret)) return res.status(401).json({ error: 'Sign in to access roster data and actions.' });
  return next();
}

module.exports = { assertAuthConfiguration, credentialsMatch, issueToken, readAuthConfig, requireAuthentication, verifyToken };
