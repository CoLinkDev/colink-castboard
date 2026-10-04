const REQUIRED_MANIFEST_FIELDS = [
  "schemaVersion",
  "id",
  "name",
  "version",
  "minCastBoardVersion",
  "type",
  "entry",
];
const LIFECYCLE_HOOKS = ["mount", "activate", "deactivate", "unmount", "onResize", "onConfigChange"];
const PLUGIN_TYPES = new Set(["navigable", "transient"]);
const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const CONFIG_SCHEMA_MIN_VERSION = "2.3.0";
const CONFIG_SCHEMA_KEYS = new Set(["type", "additionalProperties", "properties"]);
const CONFIG_FIELD_COMMON_KEYS = new Set(["type", "default", "title", "description"]);
const CONFIG_FIELD_NUMBER_KEYS = new Set([...CONFIG_FIELD_COMMON_KEYS, "minimum", "maximum"]);
const CONFIG_FIELD_STRING_KEYS = new Set([...CONFIG_FIELD_COMMON_KEYS, "format", "enum", "enumTitles"]);

export class PluginManager extends EventTarget {
  constructor({ host, language }) {
    super();
    this.host = host;
    this.language = language;
    this.plugins = new Map();
  }

  registerBuiltin(manifest, plugin, baseUrl) {
    return this.register(manifest, plugin, baseUrl, "builtin", {});
  }

  registerExternal(manifest, plugin, baseUrl, config = {}) {
    return this.register(manifest, plugin, baseUrl, "external", config);
  }

  register(manifest, plugin, baseUrl, source, config) {
    const normalizedManifest = normalizeManifest(manifest);
    validatePlugin(plugin);
    if (this.plugins.has(normalizedManifest.id)) {
      throw new Error(`Plugin id is already registered: ${normalizedManifest.id}`);
    }

    const record = {
      manifest: normalizedManifest,
      plugin,
      baseUrl: new URL("./", baseUrl).href,
      source,
      config: computeEffectiveConfig(normalizedManifest.configSchema, config),
      mounted: false,
      mountPromise: null,
      active: false,
      failed: false,
      shell: null,
      shadowRoot: null,
      context: null,
      cancelPendingHide: null,
    };
    record.context = this.createContext(record);
    this.plugins.set(normalizedManifest.id, record);
    this.dispatchEvent(new CustomEvent("changed", { detail: { id: normalizedManifest.id, source } }));
    return record;
  }

  createContext(record) {
    const storagePrefix = `castboard.plugin.${record.manifest.id}.`;
    return Object.freeze({
      get config() { return record.config; },
      events: Object.freeze({ on: (type, handler) => this.host.on(type, handler) }),
      navigation: Object.freeze({
        showTransient: (durationMs) => {
          if (record.manifest.type !== "transient") {
            throw new Error(`Plugin ${record.manifest.id} is not transient`);
          }
          return window.navManager?.showTransient(record.manifest.id, durationMs);
        },
        requestTemporaryFocus: (durationMs) => {
          if (record.manifest.type !== "navigable") {
            throw new Error(`Plugin ${record.manifest.id} is not navigable`);
          }
          return window.navManager?.requestTemporaryFocus(record.manifest.id, durationMs);
        },
        extendTemporaryFocus: (durationMs) => {
          if (record.manifest.type !== "navigable") {
            throw new Error(`Plugin ${record.manifest.id} is not navigable`);
          }
          return window.navManager?.extendTemporaryFocus(record.manifest.id, durationMs) ?? false;
        },
      }),
      i18n: Object.freeze({ language: this.language }),
      storage: Object.freeze({
        get(key) {
          const value = localStorage.getItem(storagePrefix + key);
          return value === null ? null : JSON.parse(value);
        },
        set(key, value) {
          localStorage.setItem(storagePrefix + key, JSON.stringify(value));
        },
      }),
      assets: Object.freeze({
        resolveAsset: (path) => new URL(path, record.baseUrl).href,
      }),
    });
  }

  get(id) {
    return this.plugins.get(id) || null;
  }

  getNavigablePages() {
    return [...this.plugins.values()].filter(({ manifest, failed }) => manifest.type === "navigable" && !failed);
  }

  getTransientPages() {
    return [...this.plugins.values()].filter(({ manifest, failed }) => manifest.type === "transient" && !failed);
  }

  async invoke(record, hook, ...args) {
    const callback = record.plugin[hook];
    if (typeof callback !== "function") return true;
    try {
      await callback.call(record.plugin, record.shadowRoot, record.context, ...args);
      return true;
    } catch (error) {
      record.failed = true;
      record.active = false;
      renderPluginError(record, error);
      window.castBoardUtils.log("plugin", "lifecycle-failed", {
        id: record.manifest.id,
        hook,
        error: String(error),
      });
      this.dispatchEvent(new CustomEvent("failed", { detail: { id: record.manifest.id, hook, error } }));
      return false;
    }
  }

  async mount(record, shell) {
    record.shell = shell;
    record.shadowRoot = shell.attachShadow({ mode: "open" });
    record.mounted = await this.invoke(record, "mount");
    if (record.mounted) {
      const baseStyle = document.createElement("style");
      baseStyle.textContent = `:host{position:fixed;inset:0;display:block;width:100%;height:100%;overflow:hidden;touch-action:none;color:#fff;font-family:inherit;pointer-events:inherit}:host([hidden]){display:none!important}.page{position:fixed;inset:0;width:100%;height:100%;overflow:hidden;touch-action:none;pointer-events:inherit}.page[hidden]{display:none!important}:host *{touch-action:none}button,a,[role="button"]{touch-action:manipulation;cursor:pointer;pointer-events:auto}`;
      record.shadowRoot.prepend(baseStyle);
    }
    return record.mounted;
  }

  async activate(record) {
    if (record.failed) return false;
    record.active = await this.invoke(record, "activate");
    return record.active;
  }

  async deactivate(record) {
    if (!record?.mounted || !record.active) return true;
    const ok = await this.invoke(record, "deactivate");
    record.active = false;
    return ok;
  }

  async unmount(record) {
    if (!record.mounted) return true;
    await this.deactivate(record);
    const ok = await this.invoke(record, "unmount");
    record.cancelPendingHide?.();
    record.shell?.remove();
    record.mounted = false;
    record.mountPromise = null;
    record.shell = null;
    record.shadowRoot = null;
    record.cancelPendingHide = null;
    return ok;
  }

  async resize(metrics) {
    const record = [...this.plugins.values()].find(({ active }) => active);
    if (record) await this.invoke(record, "onResize", metrics);
  }

  async updatePluginConfig(id, overrides, reload) {
    const record = this.get(id);
    if (!record) throw new Error(`Plugin is not registered: ${id}`);
    if (!record.manifest.configSchema) throw new Error(`Plugin is not configurable: ${id}`);

    const previousConfig = record.config;
    const newConfig = computeEffectiveConfig(record.manifest.configSchema, overrides);
    if (equalConfig(previousConfig, newConfig)) return true;
    record.config = newConfig;
    if (!record.mounted) return true;

    const callback = record.plugin.onConfigChange;
    if (typeof callback === "function") {
      try {
        await callback.call(record.plugin, record.shadowRoot, record.context, newConfig, previousConfig);
        return true;
      } catch (error) {
        window.castBoardUtils.log("plugin", "config-change-failed", {
          id: record.manifest.id,
          error: String(error),
        });
      }
    }

    if (typeof reload !== "function") {
      throw new Error(`Plugin ${id} requires a configuration reload handler`);
    }
    return reload(record);
  }
}

function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("Plugin manifest must be an object");
  }
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(manifest, field)) {
      throw new TypeError(`Plugin manifest field is required: ${field}`);
    }
  }
  if (typeof manifest.id !== "string" || manifest.id.trim() === "") {
    throw new TypeError("Plugin manifest id must be a non-empty string");
  }
  if (typeof manifest.entry !== "string" || manifest.entry.trim() === "") {
    throw new TypeError("Plugin manifest entry must be a non-empty string");
  }
  if (!PLUGIN_TYPES.has(manifest.type)) throw new TypeError(`Unsupported plugin type: ${manifest.type}`);
  for (const field of ["schemaVersion", "version", "minCastBoardVersion"]) {
    if (typeof manifest[field] !== "string" || !SEMANTIC_VERSION_PATTERN.test(manifest[field])) {
      throw new TypeError(`Plugin manifest field must be a semantic version: ${field}`);
    }
  }
  validateLocalizedText(manifest.name, "name");
  if (manifest.description !== undefined) {
    validateLocalizedText(manifest.description, "description");
  }
  if (manifest.configSchema !== undefined) {
    validateConfigSchema(manifest.configSchema);
    if (compareReleaseVersions(manifest.minCastBoardVersion, CONFIG_SCHEMA_MIN_VERSION) < 0) {
      throw new TypeError(`Plugins with configSchema require minCastBoardVersion ${CONFIG_SCHEMA_MIN_VERSION} or newer`);
    }
  }

  return Object.freeze({
    ...manifest,
    name: Object.freeze({ ...manifest.name }),
    ...(manifest.description === undefined
      ? {}
      : { description: Object.freeze({ ...manifest.description }) }),
    ...(manifest.configSchema === undefined
      ? {}
      : { configSchema: freezeConfigSchema(manifest.configSchema) }),
  });
}

export function validateConfigSchema(schema) {
  if (!isPlainObject(schema) || !hasOnlyKeys(schema, CONFIG_SCHEMA_KEYS)) {
    throw new TypeError("Plugin configSchema must be an object with only supported root fields");
  }
  if (schema.type !== "object" || schema.additionalProperties !== false || !isPlainObject(schema.properties)) {
    throw new TypeError('Plugin configSchema must declare type "object", additionalProperties false, and properties');
  }
  for (const [name, field] of Object.entries(schema.properties)) {
    if (name.trim() === "") throw new TypeError("Plugin configSchema property names must be non-empty");
    validateConfigField(field, name);
  }
  return schema;
}

export function computeEffectiveConfig(schema, overrides = {}) {
  if (schema === undefined) return Object.freeze({});
  validateConfigSchema(schema);
  if (!isPlainObject(overrides)) throw new TypeError("Plugin config overrides must be an object");

  const effective = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    effective[name] = Object.prototype.hasOwnProperty.call(overrides, name)
      && isValidConfigValue(overrides[name], field)
      ? overrides[name]
      : field.default;
  }
  return Object.freeze(effective);
}

function validateConfigField(field, name) {
  if (!isPlainObject(field) || !["boolean", "number", "integer", "string"].includes(field.type)) {
    throw new TypeError(`Plugin configSchema property ${name} has an unsupported type`);
  }
  const allowedKeys = field.type === "string"
    ? CONFIG_FIELD_STRING_KEYS
    : field.type === "number" || field.type === "integer"
      ? CONFIG_FIELD_NUMBER_KEYS
      : CONFIG_FIELD_COMMON_KEYS;
  if (!hasOnlyKeys(field, allowedKeys)) {
    throw new TypeError(`Plugin configSchema property ${name} contains unsupported fields`);
  }
  if (!Object.prototype.hasOwnProperty.call(field, "default")) {
    throw new TypeError(`Plugin configSchema property ${name} must declare a default`);
  }
  if (field.title !== undefined) validateLocalizedText(field.title, `configSchema.properties.${name}.title`);
  if (field.description !== undefined) validateLocalizedText(field.description, `configSchema.properties.${name}.description`);

  if (field.type === "number" || field.type === "integer") {
    for (const key of ["minimum", "maximum"]) {
      if (field[key] !== undefined && (typeof field[key] !== "number" || !Number.isFinite(field[key]))) {
        throw new TypeError(`Plugin configSchema property ${name}.${key} must be a finite number`);
      }
    }
    if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) {
      throw new TypeError(`Plugin configSchema property ${name} minimum must not exceed maximum`);
    }
  }

  if (field.type === "string") {
    if (field.format !== undefined && field.format !== "password") {
      throw new TypeError(`Plugin configSchema property ${name} has an unsupported format`);
    }
    if (field.enum !== undefined) {
      if (!Array.isArray(field.enum) || field.enum.length === 0
        || field.enum.some((value) => typeof value !== "string")
        || new Set(field.enum).size !== field.enum.length) {
        throw new TypeError(`Plugin configSchema property ${name}.enum must contain unique strings`);
      }
    }
    if (field.enumTitles !== undefined) {
      if (!field.enum || !isPlainObject(field.enumTitles)
        || Object.keys(field.enumTitles).length !== field.enum.length
        || field.enum.some((value) => !Object.prototype.hasOwnProperty.call(field.enumTitles, value))) {
        throw new TypeError(`Plugin configSchema property ${name}.enumTitles must describe every enum value`);
      }
      for (const [value, title] of Object.entries(field.enumTitles)) {
        validateLocalizedText(title, `configSchema.properties.${name}.enumTitles.${value}`);
      }
    }
  }

  if (!isValidConfigValue(field.default, field)) {
    throw new TypeError(`Plugin configSchema property ${name} has an invalid default`);
  }
}

function isValidConfigValue(value, field) {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "string") {
    return typeof value === "string" && (!field.enum || field.enum.includes(value));
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (field.type === "integer" && !Number.isInteger(value)) return false;
  if (field.minimum !== undefined && value < field.minimum) return false;
  if (field.maximum !== undefined && value > field.maximum) return false;
  return true;
}

function freezeConfigSchema(schema) {
  const properties = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    properties[name] = Object.freeze({
      ...field,
      ...(field.title === undefined ? {} : { title: Object.freeze({ ...field.title }) }),
      ...(field.description === undefined ? {} : { description: Object.freeze({ ...field.description }) }),
      ...(field.enum === undefined ? {} : { enum: Object.freeze([...field.enum]) }),
      ...(field.enumTitles === undefined ? {} : {
        enumTitles: Object.freeze(Object.fromEntries(
          Object.entries(field.enumTitles).map(([value, titles]) => [value, Object.freeze({ ...titles })]),
        )),
      }),
    });
  }
  return Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze(properties) });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function compareReleaseVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function equalConfig(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function validateLocalizedText(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Plugin manifest ${field} must be a localized string object`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([locale, text]) => (
    locale.trim() === "" || typeof text !== "string" || text.trim() === ""
  ))) {
    throw new TypeError(`Plugin manifest ${field} must contain non-empty locale and string entries`);
  }
}

function validatePlugin(plugin) {
  if (!plugin || typeof plugin !== "object") throw new TypeError("Plugin module must export an object");
  for (const hook of LIFECYCLE_HOOKS) {
    if (plugin[hook] !== undefined && typeof plugin[hook] !== "function") {
      throw new TypeError(`Plugin lifecycle hook must be a function: ${hook}`);
    }
  }
  if (typeof plugin.mount !== "function") throw new TypeError("Plugin mount hook is required");
}

function renderPluginError(record, error) {
  if (!record.shadowRoot) return;
  const title = window.castBoardI18n.t("plugin.unavailable");
  record.shadowRoot.innerHTML = `<style>:host{position:fixed;inset:0;display:grid;place-items:center;background:#000;color:#fff;font-family:inherit}.error{max-width:36rem;padding:2rem;text-align:center}.error h1{font-size:1.4rem}.error p{color:#aeb4be}</style><section class="error"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(record.manifest.name?.en || record.manifest.id)}</p></section>`;
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value);
  return element.innerHTML;
}
