import { strict as assert } from "node:assert";
import { getTranslator } from "../src/strings";
import {
  DEFAULT_SETTINGS,
  getEffectiveMetadataLanguage,
  getEffectiveTemplateLanguage,
} from "../src/settings";

assert.equal(getTranslator()("cmd.sync"), "Sync");
assert.equal(getEffectiveMetadataLanguage(DEFAULT_SETTINGS), "");
assert.equal(getEffectiveTemplateLanguage(DEFAULT_SETTINGS), "");
