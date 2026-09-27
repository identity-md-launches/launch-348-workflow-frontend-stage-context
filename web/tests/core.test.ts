import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodeFunctionData,
  decodeFunctionData,
  decodeAbiParameters,
  zeroAddress,
  type Address,
} from "viem";
import {
  amountIn,
  priceLimit,
  integerSqrt,
  payout,
  identity,
  poolId,
  type PoolKey,
} from "../src/math";
import {
  switchNetwork,
  assertWallet,
  swapAction,
  verifyChain,
  transact,
} from "../src/chain";
import { canonical } from "../src/canonical";
import type { Runtime, Provider } from "../src/config";

const manifest = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const abi = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../dist/abi/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const account = "0x1111111111111111111111111111111111111111" as Address;
const runtime = {
  manifest,
  routerAbi: abi("PoolSwapTest"),
  tokenAbi: abi("VOLM"),
  hookAbi: abi("VolumeLeaderboardHook"),
  token: manifest.contracts[0],
  hook: manifest.contracts[1],
} as Runtime;
const key: PoolKey = {
  currency0: zeroAddress,
  currency1: runtime.token.address,
  hooks: runtime.hook.address,
  fee: 3000,
  tickSpacing: 60,
};

test("amount parsing rejects rounding, exponents, negatives, dust zero and int128 overflow", () => {
  assert.equal(amountIn("1.000000000000000001", 18), 1000000000000000001n);
  for (const value of [
    "1e3",
    "-1",
    "0",
    "0.0000000000000000001",
    "1.234",
    "NaN",
  ])
    assert.throws(() => amountIn(value, value === "1.234" ? 2 : 18));
  assert.throws(() => amountIn((2n ** 127n).toString(), 0));
});
test("integer price limits bound both directions without float loss", () => {
  const q = 2n ** 96n;
  const buy = priceLimit(q, true, 100),
    sell = priceLimit(q, false, 100);
  assert(buy < q && sell > q);
  assert.equal(buy, integerSqrt((q * q * 9900n) / 10000n));
  assert.equal(sell, integerSqrt((q * q * 10100n) / 10000n));
  assert.throws(() => priceLimit(q, true, 0));
});
test("payout floors leave every remainder for finalization", () => {
  for (let pot = 0n; pot < 1000n; pot++) {
    const paid = [0, 1, 2, 3, 4].map((i) => payout(pot, i));
    assert(paid.reduce((a, b) => a + b, 0n) <= pot);
    assert.equal(paid[0], (pot * 40n) / 100n);
  }
});
test("canonical JSON orders objects and preserves ABI array order", () => {
  assert.equal(
    canonical({ z: [{ b: 1, a: 2 }], a: "x" }),
    '{"a":"x","z":[{"a":2,"b":1}]}',
  );
  assert.notEqual(canonical([1, 2]), canonical([2, 1]));
});
test("swap calldata is exact-input, router-bound and credits the wallet", () => {
  for (const buy of [true, false]) {
    const action = swapAction(runtime, account, 1000n, buy, 2n ** 96n, 100);
    assert.equal(action.address, manifest.integrations.poolSwapTest.address);
    const encoded = encodeFunctionData(action);
    const decoded = decodeFunctionData({
      abi: runtime.routerAbi,
      data: encoded,
    }).args as unknown as [
      PoolKey,
      { amountSpecified: bigint; zeroForOne: boolean },
      { takeClaims: boolean; settleUsingBurn: boolean },
      `0x${string}`,
    ];
    assert.equal(decoded[1].amountSpecified, -1000n);
    assert.equal(decoded[1].zeroForOne, buy);
    assert.deepEqual(decoded[2], { takeClaims: false, settleUsingBurn: false });
    assert.equal(decoded[3], identity(account));
    assert.equal(
      decodeAbiParameters([{ type: "address" }], decoded[3])[0].toLowerCase(),
      account,
    );
    assert.equal(action.value, buy ? 1000n : 0n);
    assert.equal(poolId(decoded[0]), poolId(key));
  }
});
test("unknown chain adds exact handoff parameters, then switches again", async () => {
  const calls: { method: string; params?: unknown }[] = [];
  const provider = {
    request: async (call: { method: string; params?: unknown }) => {
      calls.push(call);
      if (calls.length === 1) throw { code: 4902 };
    },
  } as unknown as Provider;
  await switchNetwork(provider, runtime);
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [manifest.walletAddChain]);
});
test("switch rejection does not offer chain addition", async () => {
  let calls = 0;
  const provider = {
    request: async () => {
      calls++;
      throw { code: 4001 };
    },
  } as unknown as Provider;
  await assert.rejects(switchNetwork(provider, runtime));
  assert.equal(calls, 1);
});
test("account/network changes block transaction signing", async () => {
  const provider = {
    request: async ({ method }: { method: string }) =>
      method === "eth_chainId" ? "0x1" : [account],
  } as unknown as Provider;
  await assert.rejects(assertWallet(provider, runtime, account), /changed/);
});
test("empty contract code fails closed", async () => {
  const r = {
    ...runtime,
    client: {
      getChainId: async () => manifest.chainId,
      getCode: async () => "0x",
    },
  } as unknown as Runtime;
  await assert.rejects(verifyChain(r), /No contract code/);
});
test("failed simulation never reaches wallet signing", async () => {
  const calls: string[] = [];
  const provider = {
    request: async ({ method }: { method: string }) => {
      calls.push(method);
      return method === "eth_chainId"
        ? manifest.walletAddChain.chainId
        : [account];
    },
  } as unknown as Provider;
  const r = {
    ...runtime,
    client: {
      simulateContract: async () => {
        throw new Error("PartialFill");
      },
    },
  } as unknown as Runtime;
  await assert.rejects(
    transact(
      r,
      provider,
      account,
      swapAction(runtime, account, 1n, true, 2n ** 96n, 100),
      () => {},
    ),
    /PartialFill/,
  );
  assert(!calls.includes("eth_sendTransaction"));
});
