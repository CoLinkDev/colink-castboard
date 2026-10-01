const REQUIRED_MANIFEST_FIELDS = ["id", "name", "version", "type", "entry"];
const LIFECYCLE_HOOKS = ["mount", "activate", "deactivate", "unmount", "onResize"];
const PLUGIN_TYPES = new Set(["navigable", "transient"]);

export class PluginManager extends EventTarget {
  constructor({ host, language }) {
    super();
    this.host = host;
    this.language = language;
    this.plugins = new Map();
  }

  registerBuiltin(manifest, plugin, baseUrl) {
    return this.register(manifest, plugin, baseUrl, "builtin");
  }

  registerExternal(manifest, plugin, baseUrl) {
    return this.register(manifest, plugin, baseUrl, "external");
  }

  register(manifest, plugin, baseUrl, source) {
    validateManifest(manifest);
    validatePlugin(plugin);
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin id is already registered: ${manifest.id}`);
    }

    const record = {
      manifest: Object.freeze({ ...manifest }),
      plugin,
      baseUrl: new URL("./", baseUrl).href,
      source,
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
    this.plugins.set(manifest.id, record);
    this.dispatchEvent(new CustomEvent("changed", { detail: { id: manifest.id, source } }));
    return record;
  }

  createContext(record) {
    const storagePrefix = `castboard.plugin.${record.manifest.id}.`;
    return Object.freeze({
      events: Object.freeze({ on: (type, handler) => this.host.on(type, handler) }),
      navigation: Object.freeze({
        showTransient: (durationMs) => {
          if (record.manifest.type !== "transient") {
            throw new Error(`Plugin ${record.manifest.id} is not transient`);
          }
          window.navManager?.showTransient(record.manifest.id, durationMs);
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
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new TypeError("Plugin manifest is required");
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field]) throw new TypeError(`Plugin manifest field is required: ${field}`);
  }
  if (!PLUGIN_TYPES.has(manifest.type)) throw new TypeError(`Unsupported plugin type: ${manifest.type}`);
  for (const field of ["version", "minCastBoardVersion"]) {
    if (!/^\d+\.\d+\.\d+$/.test(manifest[field])) {
      throw new TypeError(`Plugin manifest field must be a semantic version: ${field}`);
    }
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
