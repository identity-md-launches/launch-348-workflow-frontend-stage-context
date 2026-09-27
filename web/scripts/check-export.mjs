import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const manifest = JSON.parse(read("dist/imd-deployment.json"));
const handoff = JSON.parse(read("web/config/deployment.json"));
const network = JSON.parse(read("web/config/network.json"));
const canonical = (x) =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
for (const key of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.deepEqual(manifest[key], handoff[key]);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
assert.deepEqual(
  manifest.contracts.map(({ abiPath, ...rest }) => rest),
  handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
);
const files = [];
const walk = (path = "") =>
  readdirSync(new URL("dist/" + path, root)).forEach((name) => {
    const file = path + name;
    if (statSync(new URL("dist/" + file, root)).isDirectory()) walk(file + "/");
    else if (file !== "imd-deployment.json") files.push(file);
  });
walk();
assert.deepEqual(manifest.assets.map((a) => a.path).sort(), files.sort());
assert(manifest.assets.length <= 128);
let total = read("dist/imd-deployment.json").length;
for (const asset of manifest.assets) {
  assert(
    !asset.path.includes("..") &&
      !asset.path.startsWith("/") &&
      !asset.path.includes(":"),
  );
  const bytes = read("dist/" + asset.path);
  assert(bytes.length <= 8388608);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  total += bytes.length;
}
for (const contract of manifest.contracts)
  assert.equal(
    keccak256(
      toBytes(canonical(JSON.parse(read("dist/" + contract.abiPath)))),
    ).slice(2),
    contract.abiHash,
  );
assert(total < 16 * 1024 * 1024);
const html = read("dist/index.html").toString();
assert(html.includes("./assets/"));
assert(!/src="\/(?!\/)/.test(html));
console.log(
  JSON.stringify(
    {
      result: "PASS",
      assets: files.length,
      totalBytes: total,
      pinnedAbiHashes: manifest.contracts.map((c) => ({
        name: c.name,
        hash: c.abiHash,
      })),
      networkUnchanged: true,
      everyAssetHasValidSha256: true,
    },
    null,
    2,
  ),
);
