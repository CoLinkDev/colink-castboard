import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(projectRoot, "src");
const developmentPluginsRoot = resolve(sourceRoot, "plugins", "dev");
const semanticVersionPattern = /^\d+\.\d+\.\d+$/;

function releaseVersionFromRef(refName) {
  const version = refName.replace(/^v/, "");
  if (!semanticVersionPattern.test(version)) {
    throw new Error(`GitHub release ref must be a semantic version tag: ${refName}`);
  }
  return version;
}

function exactTagVersion() {
  try {
    const tag = execFileSync("git", ["describe", "--tags", "--exact-match"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const version = tag.replace(/^v/, "");
    return semanticVersionPattern.test(version) ? version : null;
  } catch {
    return null;
  }
}

function developmentVersion() {
  try {
    const hash = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `${hash}-dev`;
  } catch {
    return "0.0.0-dev";
  }
}

function castBoardVersion() {
  const githubRefName = process.env.GITHUB_REF_NAME?.trim();
  if (githubRefName) return releaseVersionFromRef(githubRefName);
  return exactTagVersion() ?? developmentVersion();
}

function developmentPlugins() {
  return {
    name: "castboard-development-plugins",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        if (pathname !== "/__castboard_dev_plugins") {
          next();
          return;
        }

        try {
          const entries = existsSync(developmentPluginsRoot)
            ? await readdir(developmentPluginsRoot, { withFileTypes: true })
            : [];
          const plugins = [];
          for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            if (!entry.isDirectory()) continue;
            const manifestPath = join(developmentPluginsRoot, entry.name, "manifest.json");
            if (!existsSync(manifestPath)) continue;
            const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
            plugins.push({
              manifest,
              baseUrl: `/plugins/dev/${encodeURIComponent(entry.name)}/`,
            });
          }
          response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify(plugins));
        } catch (error) {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
  };
}

function fontLicenses() {
  const licenses = ["LICENSE-GoogleSansFlex.txt", "LICENSE-SourceHanSans.txt"];
  return {
    name: "castboard-font-licenses",
    apply: "build",
    async buildStart() {
      for (const license of licenses) {
        this.emitFile({
          type: "asset",
          fileName: `fonts/${license}`,
          source: await readFile(resolve(sourceRoot, "fonts", license)),
        });
      }
    },
  };
}

export default defineConfig({
  root: sourceRoot,
  base: "./",
  define: {
    __CASTBOARD_VERSION__: JSON.stringify(castBoardVersion()),
  },
  plugins: [developmentPlugins(), fontLicenses()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
  },
});
