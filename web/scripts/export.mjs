import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, toBytes, parseAbi } from "viem";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
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
const save = (path, value) =>
  writeFileSync(
    new URL("dist/" + path, root),
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
  );
mkdirSync(new URL("dist/abi/", root), { recursive: true });
const contracts = handoff.contracts.map(({ name, address, abiHash }) => {
  const path = `docs/abi/${name}.json`;
  const pinned = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:${path}`],
    { cwd: root, encoding: "utf8" },
  );
  if (pinned !== read(path))
    throw new Error(`${path} differs from pinned implementation export`);
  const abi = JSON.parse(pinned);
  if (
    !Array.isArray(abi) ||
    keccak256(toBytes(canonical(abi))).slice(2) !== abiHash
  )
    throw new Error(`ABI hash mismatch: ${name}`);
  save(`abi/${name}.json`, pinned);
  return { name, address, abiHash, abiPath: `abi/${name}.json` };
});
if (network.network.chainId !== handoff.chainId)
  throw new Error("Handoff/network chain mismatch");
const key =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
save(
  "abi/PoolSwapTest.json",
  parseAbi([
    "function manager() view returns (address)",
    `function swap(${key} key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,(bool takeClaims,bool settleUsingBurn) testSettings,bytes hookData) payable returns (int256 delta)`,
  ]),
);
save(
  "abi/StateView.json",
  parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  ]),
);
save(
  "abi/Quoter.json",
  parseAbi([
    `function quoteExactInputSingle((${key} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
  ]),
);
save(
  "mark.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#273e31"/><path d="m9 11 8 18h6l8-18h-7l-4 11-4-11z" fill="#d5f77c"/></svg>\n',
);
const assets = [];
function inventory(folder = "") {
  for (const entry of readdirSync(new URL("dist/" + folder, root)).sort()) {
    const path = folder + entry;
    if (path === "imd-deployment.json") continue;
    const stat = statSync(new URL("dist/" + path, root));
    if (stat.isDirectory()) inventory(path + "/");
    else {
      if (stat.size > 8 * 1024 * 1024)
        throw new Error(`Asset exceeds budget: ${path}`);
      assets.push({
        path,
        sha256: createHash("sha256")
          .update(readFileSync(new URL("dist/" + path, root)))
          .digest("hex"),
      });
    }
  }
}
inventory();
if (assets.length > 128) throw new Error("Too many assets");
save("imd-deployment.json", {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  network: network.network,
  walletAddChain: network.walletAddChain,
  pool: handoff.manifest.pool,
  deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
  integrations: {
    // Explicit site assignment takes precedence over the generic Universal Router reference.
    poolSwapTest: {
      address: "0x9b6b46e2c869aa39918db7f52f5557fe577b6eee",
      abiPath: "abi/PoolSwapTest.json",
    },
    stateView: { abiPath: "abi/StateView.json" },
    quoter: { abiPath: "abi/Quoter.json" },
  },
});
console.log(
  `Verified ${contracts.length} pinned ABI hashes; exported ${assets.length} assets and runtime deployment manifest.`,
);
