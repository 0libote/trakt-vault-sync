import { strict as assert } from "node:assert";
import { getTranslator } from "../src/strings";

assert.equal(getTranslator()("cmd.sync"), "Sync");
