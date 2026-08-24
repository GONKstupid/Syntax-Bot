// Shim für Pi im CJS-Bundle: Pi liest import.meta.url (u. a. für
// __dirname-Ersatz und die Bun-Erkennung). Der esbuild-Build ersetzt
// „import.meta.url" durch diese Konstante (siehe esbuild.mjs, define+inject).
export const import_meta_url = require("node:url").pathToFileURL(__filename).href;
