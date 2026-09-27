import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPublicClient, http, defineChain, zeroAddress } from "viem";
import {
  verifyChain,
  readSnapshot,
  readActivity,
  keyFor,
  quote,
} from "../src/chain";
import { poolId } from "../src/math";
import type { Runtime } from "../src/config";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("dist/imd-deployment.json", root), "utf8"),
);
const abi = (path: string) =>
  JSON.parse(readFileSync(new URL("dist/" + path, root), "utf8"));
const exec = promisify(execFile);
const report: Record<string, unknown> = {
  observedAt: new Date().toISOString(),
  source: "Read-only public RPC checks; no wallet and no broadcast.",
  attempts: [],
};
for (const endpoint of manifest.network.rpcUrls) {
  try {
    const chain = defineChain({
      id: manifest.chainId,
      name: manifest.network.name,
      nativeCurrency: manifest.network.nativeCurrency,
      rpcUrls: { default: { http: [endpoint] } },
    });
    const client = createPublicClient({
      chain,
      transport: http(endpoint, {
        timeout: 20000,
        retryCount: 0,
        batch: true,
        fetchFn: async (url, init) => {
          const { stdout } = await exec(
            "curl",
            [
              "--silent",
              "--show-error",
              "--fail",
              "--max-time",
              "18",
              "-H",
              "Content-Type: application/json",
              "--data-binary",
              String(init?.body),
              String(url),
            ],
            { maxBuffer: 4 * 1024 * 1024 },
          );
          return new Response(stdout, {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    });
    const token = manifest.contracts.find(
      (c: { name: string }) => c.name === "VOLM",
    );
    const hook = manifest.contracts.find(
      (c: { name: string }) => c.name === "VolumeLeaderboardHook",
    );
    const r = {
      manifest,
      token,
      hook,
      tokenAbi: abi(token.abiPath),
      hookAbi: abi(hook.abiPath),
      routerAbi: abi(manifest.integrations.poolSwapTest.abiPath),
      stateAbi: abi(manifest.integrations.stateView.abiPath),
      quoterAbi: abi(manifest.integrations.quoter.abiPath),
      chain,
      client,
    } as unknown as Runtime;
    await verifyChain(r);
    const state = await readSnapshot(r);
    let activity;
    try {
      activity = await readActivity(r, state.block);
    } catch (e) {
      activity = { error: (e as Error).message };
    }
    report.result = "PASS";
    report.endpoint = endpoint;
    report.poolId = poolId(keyFor(r));
    report.state = state;
    report.activity = activity;
    try {
      report.readOnlyBuyQuote = {
        inputWei: "1000000000000",
        outputRaw: await quote(r, zeroAddress, 1000000000000n, true),
      };
    } catch (e) {
      report.readOnlyBuyQuote = { error: (e as Error).message.slice(0, 1500) };
    }
    break;
  } catch (e) {
    (report.attempts as unknown[]).push({
      endpoint,
      error: (e as Error).message.slice(0, 1500),
    });
  }
}
report.result ??= "UNAVAILABLE";
const output =
  JSON.stringify(
    report,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ) + "\n";
writeFileSync(new URL("docs/frontend/live-read.json", root), output);
console.log(output);
