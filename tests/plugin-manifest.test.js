import assert from "node:assert/strict";
import test from "node:test";

import { PluginManager } from "../src/plugins/manager.js";

function manifest(id) {
  return {
    id,
    name: { en: "Test" },
    version: "1.0.0",
    minCastBoardVersion: "2.2.0",
    type: "navigable",
    entry: "index.js",
  };
}

test("accepts omitted and legacy schemaVersion values", () => {
  const manager = new PluginManager({ host: { on() {} }, language: "en" });
  const withoutSchemaVersion = manager.registerExternal(
    manifest("com.example.no-schema-version"),
    { mount() {} },
    "https://example.test/no-schema-version/",
  );
  const withLegacyValue = manager.registerExternal(
    { ...manifest("com.example.legacy-schema-version"), schemaVersion: "legacy" },
    { mount() {} },
    "https://example.test/legacy-schema-version/",
  );

  assert.equal(Object.hasOwn(withoutSchemaVersion.manifest, "schemaVersion"), false);
  assert.equal(withLegacyValue.manifest.schemaVersion, "legacy");
});
