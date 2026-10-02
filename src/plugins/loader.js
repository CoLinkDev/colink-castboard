import { CASTBOARD_VERSION } from "../version.js";

export class PluginLoader {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
  }

  async load({ manifest, baseUrl }, { enforceMinimumVersion = true } = {}) {
    if (!/^\d+\.\d+\.\d+$/.test(manifest?.minCastBoardVersion || "")) {
      throw new TypeError("Plugin minCastBoardVersion must be a semantic version");
    }
    if (
      enforceMinimumVersion
      && window.castBoardUtils.compareSemver(CASTBOARD_VERSION, manifest.minCastBoardVersion) < 0
    ) {
      throw new Error(`Plugin ${manifest.id} requires CastBoard ${manifest.minCastBoardVersion} or newer`);
    }
    const normalizedBaseUrl = new URL(baseUrl, window.location.href);
    const entryUrl = new URL(manifest.entry, normalizedBaseUrl);
    const module = await import(/* @vite-ignore */ entryUrl.href);
    return this.pluginManager.registerExternal(manifest, module.default, normalizedBaseUrl.href);
  }

  async loadRegistration(payload) {
    const registrations = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.plugins)
        ? payload.plugins
        : [payload];
    return Promise.allSettled(registrations.map((registration) => this.load(registration)));
  }

  async loadDevelopmentPlugins() {
    if (!window.castBoardHost.config.debug) return [];
    const response = await fetch("/__castboard_dev_plugins", { cache: "no-store" });
    if (!response.ok) throw new Error(`Development plugin index failed: ${response.status}`);
    const plugins = await response.json();
    return Promise.allSettled(plugins.map((plugin) => (
      this.load(plugin, { enforceMinimumVersion: false })
    )));
  }
}
