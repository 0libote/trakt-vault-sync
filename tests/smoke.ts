import { strict as assert } from "node:assert";
import { resetRequestUrlMock } from "obsidian";
import { getTranslator } from "../src/strings";
import { ensureValidToken } from "../src/trakt-auth";
import type { TraktrSettings } from "../src/settings";

assert.equal(getTranslator()("cmd.sync"), "Sync");

const credentials = () => ({
  accessToken: "access",
  refreshToken: "refresh",
  clientId: "client",
  clientSecret: "secret",
  tokenExpiresAt: 0,
}) as TraktrSettings;

void (async () => {
  resetRequestUrlMock(() => ({ status: 500, json: {}, headers: {} }));
  const temporaryFailure = credentials();
  await assert.rejects(() => ensureValidToken(temporaryFailure, async () => {}));
  assert.equal(temporaryFailure.accessToken, "access");

  resetRequestUrlMock(() => ({ status: 401, json: {}, headers: {} }));
  const invalidSession = credentials();
  await assert.rejects(() => ensureValidToken(invalidSession, async () => {}));
  assert.equal(invalidSession.accessToken, "");
})();
