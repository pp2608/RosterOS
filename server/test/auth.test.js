const test=require('node:test');
const assert=require('node:assert/strict');
const {assertAuthConfiguration,credentialsMatch,issueToken,verifyToken}=require('../src/auth');

test('demo authentication requires server-only credentials and a strong signing secret',()=>{
  assert.throws(()=>assertAuthConfiguration({}),/Demo authentication is required/);
  assert.throws(()=>assertAuthConfiguration({DEMO_LOGIN_USERNAME:'demo',DEMO_LOGIN_PASSWORD:'long-enough-password',DEMO_AUTH_SECRET:'too-short'}),/at least 32 bytes/);
  assert.throws(()=>assertAuthConfiguration({DEMO_LOGIN_USERNAME:'demo',DEMO_LOGIN_PASSWORD:'short',DEMO_AUTH_SECRET:'x'.repeat(32)}),/at least 12 characters/);
  assert.equal(assertAuthConfiguration({DEMO_LOGIN_USERNAME:'demo',DEMO_LOGIN_PASSWORD:'long-enough-password',DEMO_AUTH_SECRET:'x'.repeat(32)}).username,'demo');
});

test('demo credentials and signed session tokens reject incorrect, expired, or tampered values',()=>{
  const config={username:'demo',password:'password',secret:'x'.repeat(32)};
  const now=Date.UTC(2026,10,3);
  assert.equal(credentialsMatch('demo','password',config),true);
  assert.equal(credentialsMatch('demo','incorrect',config),false);
  const token=issueToken(config.username,config.secret,now);
  assert.equal(verifyToken(token,config.secret,now),true);
  assert.equal(verifyToken(token,config.secret,now+9*60*60*1000),false);
  assert.equal(verifyToken(`${token}tampered`,config.secret,now),false);
  assert.equal(verifyToken(token,'y'.repeat(32),now),false);
});
