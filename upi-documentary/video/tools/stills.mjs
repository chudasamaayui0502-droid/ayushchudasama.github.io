// Render preview stills for many compositions with a single bundle, then a contact sheet.
// usage: node tools/stills.mjs <sheetName> <compId>:<frame>,<frame> [<compId>:<frames> ...]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const [, , sheet, ...specs] = process.argv;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.join(root, "out", "stills");
fs.mkdirSync(outDir, { recursive: true });
const browserExecutable = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const files = [];
for (const spec of specs) {
  const [id, framesStr] = spec.split(":");
  const composition = await selectComposition({ serveUrl, id, browserExecutable, chromiumOptions: { gl: "swangle" } });
  for (const f of framesStr.split(",").map(Number)) {
    const frame = Math.min(f, composition.durationInFrames - 1);
    const output = path.join(outDir, `${id}_${frame}.jpg`);
    await renderStill({ serveUrl, composition, frame, output, imageFormat: "jpeg", jpegQuality: 85, browserExecutable, chromiumOptions: { gl: "swangle" } });
    files.push(output);
    process.stdout.write(`${id}@${frame} `);
  }
}
const sheetPath = path.join(root, "out", `${sheet}.jpg`);
execFileSync("montage", [...files, "-tile", "3x", "-geometry", "640x360+4+4", "-background", "#222", sheetPath]);
console.log("\n" + sheetPath);
