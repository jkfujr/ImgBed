const assert = require('node:assert/strict');
const { verifyAdminCredentials, getEffectiveAdminPassword } = require('../src/services/auth/verify-credentials');

function createMockDb(hasPassword = false, passwordValue = 'db-password') {
  return {
    selectFrom(table) {
      return {
        select(fields) {
          return {
            where(key, op, value) {
              return {
                async executeTakeFirst() {
                  if (hasPassword && value === 'admin_password') {
                    return { value: passwordValue };
                  }
                  return null;
                }
              };
            }
          };
        }
      };
    }
  };
}

async function testGetEffectiveAdminPasswordFromDb() {
  const db = createMockDb(true, 'db-password');
  const result = await getEffectiveAdminPassword(db, 'config-password');
  assert.equal(result, 'db-password');
}

async function testGetEffectiveAdminPasswordFallbackToConfig() {
  const db = createMockDb(false);
  const result = await getEffectiveAdminPassword(db, 'config-password');
  assert.equal(result, 'config-password');
}

async function testVerifyAdminCredentialsSuccess() {
  const db = createMockDb(true, 'correct-password');
  const adminConfig = { username: 'admin', password: 'config-password' };

  const result = await verifyAdminCredentials('admin', 'correct-password', adminConfig, db);
  assert.equal(result, true);
}

async function testVerifyAdminCredentialsWrongPassword() {
  const db = createMockDb(true, 'correct-password');
  const adminConfig = { username: 'admin', password: 'config-password' };

  const result = await verifyAdminCredentials('admin', 'wrong-password', adminConfig, db);
  assert.equal(result, false);
}

async function testVerifyAdminCredentialsWrongUsername() {
  const db = createMockDb(true, 'correct-password');
  const adminConfig = { username: 'admin', password: 'config-password' };

  const result = await verifyAdminCredentials('hacker', 'correct-password', adminConfig, db);
  assert.equal(result, false);
}

async function testVerifyAdminCredentialsEmptyUsername() {
  const db = createMockDb(true, 'correct-password');
  const adminConfig = { username: 'admin', password: 'config-password' };

  const result = await verifyAdminCredentials('', 'correct-password', adminConfig, db);
  assert.equal(result, false);
}

async function testVerifyAdminCredentialsEmptyPassword() {
  const db = createMockDb(true, 'correct-password');
  const adminConfig = { username: 'admin', password: 'config-password' };

  const result = await verifyAdminCredentials('admin', '', adminConfig, db);
  assert.equal(result, false);
}

async function testVerifyAdminCredentialsWithConfigPassword() {
  const db = createMockDb(false);
  const adminConfig = { username: 'admin', password: 'config-password' };

  const result = await verifyAdminCredentials('admin', 'config-password', adminConfig, db);
  assert.equal(result, true);
}

async function main() {
  await testGetEffectiveAdminPasswordFromDb();
  await testGetEffectiveAdminPasswordFallbackToConfig();
  await testVerifyAdminCredentialsSuccess();
  await testVerifyAdminCredentialsWrongPassword();
  await testVerifyAdminCredentialsWrongUsername();
  await testVerifyAdminCredentialsEmptyUsername();
  await testVerifyAdminCredentialsEmptyPassword();
  await testVerifyAdminCredentialsWithConfigPassword();
  console.log('verify-credentials tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
