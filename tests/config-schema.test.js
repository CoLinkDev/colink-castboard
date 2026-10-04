import assert from "node:assert/strict";
import test from "node:test";

import { PluginManager, computeEffectiveConfig, validateConfigSchema } from "../src/plugins/manager.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    step: { type: "integer", default: 1, minimum: 1, maximum: 10 },
    enabled: { type: "boolean", default: true },
    theme: {
      type: "string",
      default: "system",
      enum: ["system", "dark"],
      enumTitles: {
        system: { en: "System" },
        dark: { en: "Dark" },
      },
    },
  },
};

test("validates the restricted CastBoard config schema", () => {
  assert.equal(validateConfigSchema(schema), schema);
  for (const invalid of [
    { ...schema, additionalProperties: true },
    {
      ...schema,
      properties: { value: { type: "integer", minimum: 1 } },
    },
    {
      ...schema,
      properties: { value: { type: "object", default: {} } },
    },
    {
      ...schema,
      properties: { value: { type: "integer", default: 0, minimum: 1 } },
    },
  ]) {
    assert.throws(() => validateConfigSchema(invalid), TypeError);
  }
});

test("combines defaults with valid override snapshots", () => {
  const config = computeEffectiveConfig(schema, {
    step: 5,
    enabled: "invalid",
    theme: "removed",
    unknown: true,
  });
  assert.deepEqual(config, { step: 5, enabled: true, theme: "system" });
  assert.equal(Object.isFrozen(config), true);
});

test("keeps context stable while exposing the latest config snapshot", async () => {
  const manager = new PluginManager({ host: { on() {} }, language: "en" });
  const record = manager.registerExternal({
    schemaVersion: "1.0.0",
    id: "com.example.config",
    name: { en: "Config" },
    version: "1.0.0",
    minCastBoardVersion: "2.3.0",
    type: "navigable",
    entry: "index.js",
    configSchema: schema,
  }, { mount() {} }, "https://example.test/plugin/", { step: 2 });
  const context = record.context;

  await manager.updatePluginConfig(record.manifest.id, { step: 6 });

  assert.equal(record.context, context);
  assert.deepEqual(context.config, { step: 6, enabled: true, theme: "system" });
});

test("requires CastBoard 2.3.0 for configurable plugins", () => {
  const manager = new PluginManager({ host: { on() {} }, language: "en" });
  assert.throws(() => manager.registerExternal({
    schemaVersion: "1.0.0",
    id: "com.example.legacy-config",
    name: { en: "Legacy" },
    version: "1.0.0",
    minCastBoardVersion: "2.2.1",
    type: "navigable",
    entry: "index.js",
    configSchema: schema,
  }, { mount() {} }, "https://example.test/plugin/"), /2\.3\.0/);
});
