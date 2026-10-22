import { build } from "esbuild";
import { copyFile } from "node:fs/promises";

// Only switch the served page after a successful build.
await build({
  entryPoints: ["frontend/main.jsx"],
  bundle: true,
  minify: true,
  outfile: "static/dist/app.js",
});
await copyFile("frontend/index.html", "static/index.html");
