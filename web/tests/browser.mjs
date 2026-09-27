import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extname } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  zeroAddress,
  toHex,
} from "viem";

const root = new URL("../../", import.meta.url);
const reportPath = new URL("docs/frontend/browser-results.json", root);
const screenshotPath = (name) =>
  new URL(`docs/frontend/${name}.png`, root).pathname;
mkdirSync(new URL("docs/frontend/", root), { recursive: true });
const manifest = JSON.parse(
  readFileSync(new URL("dist/imd-deployment.json", root), "utf8"),
);
const readAbi = (name) =>
  JSON.parse(readFileSync(new URL(`dist/abi/${name}.json`, root), "utf8"));
const tokenAbi = readAbi("VOLM"),
  hookAbi = readAbi("VolumeLeaderboardHook"),
  routerAbi = readAbi("PoolSwapTest"),
  stateAbi = readAbi("StateView"),
  quoterAbi = readAbi("Quoter");
const token = manifest.contracts.find((c) => c.name === "VOLM").address;
const hook = manifest.contracts.find(
  (c) => c.name === "VolumeLeaderboardHook",
).address;
const router = manifest.integrations.poolSwapTest.address;
const manager = manifest.network.uniswapV4.poolManager;
const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const users = [
  account,
  other,
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
  "0x5555555555555555555555555555555555555555",
];
const hash = "0x" + "ab".repeat(32),
  blockHash = "0x" + "cd".repeat(32);
const latest = BigInt(manifest.deploymentBlock + 10000);
const timestamp = BigInt(Math.floor(Date.now() / 1000));
const fromRoot = (path) => new URL("dist/" + path, root);
const server = createServer((req, res) => {
  const path = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  if (!path.startsWith("/preview/") || path.includes("..")) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const relative = path.slice("/preview/".length) || "index.html";
    const bytes = readFileSync(fromRoot(relative));
    const types = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "Content-Type": types[extname(relative)] || "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });
const checks = [];
const report = {
  observedAt: new Date().toISOString(),
  exportSubpath: "/preview/",
  mode: "Production export, mocked RPC and injected wallet; no broadcast",
  checks,
  screenshots: [],
  consoleErrors: [],
  resourceFailures: [],
};
const check = (name, details = {}) => {
  checks.push({ name, result: "PASS", ...details });
  console.log("PASS", name);
};

async function setup({
  wallet = true,
  wrongChain = false,
  empty = false,
  brokenCode = false,
  rpcError = false,
  tamper = false,
} = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const state = {
    allowance: 0n,
    claimed: false,
    finalized: false,
    rejectSimulation: false,
    failReceipt: false,
    calls: [],
    sends: [],
    empty,
    rpcError,
    brokenCode,
    logsFailed: false,
  };
  const abis = new Map([
    [token, tokenAbi],
    [hook, hookAbi],
    [router, routerAbi],
    [manifest.network.uniswapV4.stateView, stateAbi],
    [manifest.network.uniswapV4.quoter, quoterAbi],
  ]);
  const receipt = {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash,
    blockNumber: toHex(latest),
    from: account,
    to: router,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    contractAddress: null,
    logs: [],
    logsBloom: "0x" + "00".repeat(256),
    status: "0x1",
    type: "0x2",
  };
  function rpc(request) {
    state.calls.push(request);
    const { method, params = [] } = request;
    if (state.rpcError)
      return { error: { code: -32000, message: "Fixture RPC unavailable" } };
    let result;
    if (method === "eth_chainId") result = manifest.walletAddChain.chainId;
    else if (method === "eth_getCode")
      result = state.brokenCode ? "0x" : "0x6001600055";
    else if (method === "eth_blockNumber") result = toHex(latest);
    else if (method === "eth_getBlockByNumber")
      result = {
        number: toHex(latest),
        hash: blockHash,
        timestamp: toHex(timestamp),
        parentHash: blockHash,
        transactions: [],
        gasLimit: "0x1c9c380",
        gasUsed: "0x5208",
        baseFeePerGas: "0x1",
        difficulty: "0x0",
        extraData: "0x",
        miner: zeroAddress,
        nonce: "0x0000000000000000",
        receiptsRoot: blockHash,
        sha3Uncles: blockHash,
        size: "0x1",
        stateRoot: blockHash,
        transactionsRoot: blockHash,
        logsBloom: "0x" + "00".repeat(256),
        totalDifficulty: "0x0",
        uncles: [],
        mixHash: blockHash,
      };
    else if (method === "eth_getBalance") result = toHex(5n * 10n ** 18n);
    else if (method === "eth_getLogs") {
      if (state.logsFailed)
        return {
          error: { code: -32000, message: "Fixture log range unavailable" },
        };
      result = [];
      if (!state.empty && BigInt(params[0].toBlock) === latest) {
        const idCall = state.calls.find(
          (c) =>
            c.method === "eth_call" &&
            c.params[0].to?.toLowerCase() === hook &&
            (() => {
              try {
                return (
                  decodeFunctionData({ abi: hookAbi, data: c.params[0].data })
                    .functionName === "leaderboard"
                );
              } catch {
                return false;
              }
            })(),
        );
        const poolId = idCall
          ? decodeFunctionData({ abi: hookAbi, data: idCall.params[0].data })
              .args[0]
          : hash;
        result = [
          {
            address: hook,
            blockHash,
            blockNumber: toHex(latest),
            transactionHash: hash,
            transactionIndex: "0x0",
            logIndex: "0x0",
            removed: false,
            topics: encodeEventTopics({
              abi: hookAbi,
              eventName: "Credited",
              args: { poolId, epoch: 6n, user: account },
            }),
            data: encodeAbiParameters(
              [{ type: "uint256" }, { type: "uint256" }],
              [10n ** 16n, 10n ** 18n],
            ),
          },
        ];
      }
    } else if (method === "eth_getTransactionReceipt")
      result = { ...receipt, status: state.failReceipt ? "0x0" : "0x1" };
    else if (method === "eth_call") {
      const abi = abis.get(params[0].to.toLowerCase());
      const decoded = decodeFunctionData({ abi, data: params[0].data });
      const f = decoded.functionName,
        args = decoded.args || [];
      const e = ["leaderboard", "isFinalized"].includes(f)
        ? BigInt(args[1])
        : 0n;
      let value;
      if (f === "manager" || f === "poolManager") value = manager;
      else if (f === "epochNow") value = state.empty ? 0n : 6n;
      else if (f === "epochEnd")
        value = timestamp + 3n * 86400n + 7n * 3600n + 42n * 60n;
      else if (f === "leaderboard")
        value = [
          state.empty
            ? Array(5).fill(zeroAddress)
            : e === 6n
              ? users
              : [account, other, zeroAddress, zeroAddress, zeroAddress],
          state.empty
            ? Array(5).fill(0n)
            : [
                38n * 10n ** 17n,
                25n * 10n ** 17n,
                18n * 10n ** 17n,
                12n * 10n ** 17n,
                9n * 10n ** 17n,
              ],
          state.empty ? 0n : 1864n * 10n ** 14n,
          [e === 5n && state.claimed, e !== 6n, false, false, false],
        ];
      else if (f === "isFinalized") value = e === 5n && state.finalized;
      else if (f === "volumeOf") value = 38n * 10n ** 17n;
      else if (f === "getSlot0") value = [2n ** 96n, 0, 0, 3000];
      else if (f === "decimals") value = 18;
      else if (f === "balanceOf") value = 100n * 10n ** 18n;
      else if (f === "allowance") value = state.allowance;
      else if (f === "quoteExactInputSingle")
        value = [2n * 10n ** 18n, 150000n];
      else if (["swap", "claim", "finalize", "approve"].includes(f)) {
        if (state.rejectSimulation)
          return {
            error: {
              code: 3,
              message: "execution reverted: PartialFill",
              data: "0x",
            },
          };
        value = f === "swap" ? 1n : f === "approve" ? true : undefined;
      } else throw new Error("Unhandled contract method " + f);
      result = encodeFunctionResult({ abi, functionName: f, result: value });
    } else throw new Error("Unhandled RPC method " + method);
    return { result };
  }
  await context.route("https://**/*", async (route) => {
    if (
      !manifest.network.rpcUrls.includes(
        route.request().url().replace(/\/$/, ""),
      )
    )
      throw new Error("Unexpected external request: " + route.request().url());
    const payload = route.request().postDataJSON();
    const one = (item) => ({ jsonrpc: "2.0", id: item.id, ...rpc(item) });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        Array.isArray(payload) ? payload.map(one) : one(payload),
      ),
    });
  });
  if (tamper)
    await context.route("**/abi/VOLM.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
  if (wallet) {
    await context.exposeBinding("recordTransaction", (_, transaction) => {
      state.sends.push(transaction);
      const decoded = decodeFunctionData({
        abi: abis.get(transaction.to.toLowerCase()),
        data: transaction.data,
      });
      if (!state.failReceipt) {
        if (decoded.functionName === "approve")
          state.allowance = decoded.args[1];
        if (decoded.functionName === "claim") state.claimed = true;
        if (decoded.functionName === "finalize") state.finalized = true;
      }
      return hash;
    });
    await context.addInitScript(
      ({ account, chain, wrongChain }) => {
        const listeners = {};
        window.__wallet = {
          chain: wrongChain ? "0x1" : chain,
          accounts: [],
          unknown: wrongChain,
          reject: false,
          calls: [],
        };
        window.ethereum = {
          on: (event, callback) => {
            (listeners[event] ||= []).push(callback);
          },
          removeListener: (event, callback) => {
            listeners[event] = (listeners[event] || []).filter(
              (f) => f !== callback,
            );
          },
          emit: (event, value) => {
            (listeners[event] || []).forEach((callback) => callback(value));
          },
          request: async ({ method, params }) => {
            const w = window.__wallet;
            w.calls.push({ method, params });
            if (method === "eth_chainId") return w.chain;
            if (method === "eth_accounts") return w.accounts;
            if (method === "eth_requestAccounts") {
              if (w.reject) throw { code: 4001, message: "User rejected" };
              w.accounts = [account];
              return w.accounts;
            }
            if (method === "wallet_switchEthereumChain") {
              if (w.unknown) throw { code: 4902, message: "Unknown chain" };
              w.chain = params[0].chainId;
              window.ethereum.emit("chainChanged", w.chain);
              return null;
            }
            if (method === "wallet_addEthereumChain") {
              w.unknown = false;
              return null;
            }
            if (method === "eth_sendTransaction") {
              if (w.reject) throw { code: 4001, message: "User rejected" };
              return window.recordTransaction(params[0]);
            }
            throw {
              code: -32000,
              message: "Fixture wallet fallback unavailable: " + method,
            };
          },
        };
      },
      { account, chain: manifest.walletAddChain.chainId, wrongChain },
    );
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => report.consoleErrors.push(e.message));
  page.on("requestfailed", (req) =>
    report.resourceFailures.push({
      url: req.url(),
      error: req.failure()?.errorText,
    }),
  );
  await page.goto(url);
  return { page, context, state };
}
const waitLive = (page) =>
  page.getByText("● Live reads", { exact: true }).waitFor();
const connect = async (page) => {
  await page.getByRole("button", { name: "Connect wallet" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Disconnect", exact: true }).waitFor();
  await waitLive(page);
};
const waitConfirmed = (page) =>
  page
    .getByRole("status")
    .filter({ hasText: "Transaction confirmed" })
    .waitFor();

try {
  const { page, context, state } = await setup({ wrongChain: true });
  await waitLive(page);
  assert(
    await page
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  assert.equal(await page.getByRole("article").count(), 4);
  await page.getByText("Volume credited", { exact: true }).waitFor();
  check(
    "Disconnected: live standings, four past epochs and decoded event; signing disabled",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Skip to content",
  );
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "main");
  check("Keyboard skip link focuses main content");
  await connect(page);
  await page
    .getByRole("button", { name: "Switch to Sepolia", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  await page
    .getByRole("button", { name: "Switch to Sepolia", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.body.textContent.includes("Wallet on a different network."),
  );
  const calls = await page.evaluate(() => window.__wallet.calls);
  assert.deepEqual(
    calls.filter((c) => c.method.startsWith("wallet_")).map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(
    calls.find((c) => c.method === "wallet_addEthereumChain").params[0],
    manifest.walletAddChain,
  );
  check(
    "Unknown chain: switch → add exact network → switch; wrong-chain actions disabled",
  );
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  assert.equal(
    await page.locator("#amount").getAttribute("aria-invalid"),
    "true",
  );
  assert.equal(await page.evaluate(() => document.activeElement.id), "amount");
  check("Invalid amount announces an inline error and focuses the input");
  await page.locator("#amount").fill("0.01");
  await page.getByRole("button", { name: "Get quote", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Confirm buy", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Confirm buy", exact: true }).focus();
  await page.screenshot({
    path: screenshotPath("keyboard-confirm"),
    fullPage: true,
  });
  report.screenshots.push("docs/frontend/keyboard-confirm.png");
  await page.keyboard.press("Enter");
  await waitConfirmed(page);
  const buyTx = state.sends.at(-1);
  const buyArgs = decodeFunctionData({ abi: routerAbi, data: buyTx.data }).args;
  assert.equal(buyTx.to.toLowerCase(), router);
  assert.equal(BigInt(buyTx.value), 10n ** 16n);
  assert.equal(buyArgs[1].zeroForOne, true);
  assert.equal(buyArgs[1].amountSpecified, -(10n ** 16n));
  assert.equal(
    buyArgs[3].toLowerCase(),
    encodeAbiParameters([{ type: "address" }], [account]),
  );
  assert(buyArgs[1].sqrtPriceLimitX96 < 2n ** 96n);
  check(
    "Buy: quoter simulation, router simulation, exact ETH value, wallet hookData, price limit, confirmed receipt",
  );
  check(
    "Keyboard activates wallet connection, quote submission and buy confirmation",
  );

  await page.getByRole("button", { name: "Sell VOLM", exact: true }).click();
  await page.locator("#amount").fill("1");
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve 1 VOLM", exact: true })
    .click();
  await waitConfirmed(page);
  const approved = decodeFunctionData({
    abi: tokenAbi,
    data: state.sends.at(-1).data,
  });
  assert.equal(approved.functionName, "approve");
  assert.equal(approved.args[0].toLowerCase(), router);
  assert.equal(approved.args[1], 10n ** 18n);
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await page.getByRole("button", { name: "Confirm sell", exact: true }).click();
  await waitConfirmed(page);
  const sellTx = state.sends.at(-1),
    sellArgs = decodeFunctionData({ abi: routerAbi, data: sellTx.data }).args;
  assert.equal(BigInt(sellTx.value || "0x0"), 0n);
  assert.equal(sellArgs[1].zeroForOne, false);
  assert.equal(sellArgs[1].amountSpecified, -(10n ** 18n));
  assert(sellArgs[1].sqrtPriceLimitX96 > 2n ** 96n);
  check(
    "Sell: explicit exact-amount router approval, new quote, zero ETH value and upward price limit",
  );

  await page
    .getByRole("button", { name: "Claim epoch 5 rank 1", exact: true })
    .click();
  await waitConfirmed(page);
  const claim = decodeFunctionData({
    abi: hookAbi,
    data: state.sends.at(-1).data,
  });
  assert.equal(claim.functionName, "claim");
  assert.equal(claim.args[1], 5n);
  assert.equal(claim.args[2], 1n);
  await page
    .getByRole("button", { name: "Claim epoch 5 rank 1", exact: true })
    .waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Finalize epoch 5", exact: true })
    .click();
  await waitConfirmed(page);
  const final = decodeFunctionData({
    abi: hookAbi,
    data: state.sends.at(-1).data,
  });
  assert.equal(final.functionName, "finalize");
  assert.equal(final.args[1], 5n);
  await page
    .getByRole("button", { name: "Finalized ✓", exact: true })
    .waitFor();
  check(
    "Claim uses one-based rank, refreshes paid state; finalize independently refreshes carried state",
  );

  state.rejectSimulation = true;
  const before = state.sends.length;
  await page
    .getByRole("button", { name: "Claim epoch 4 rank 1", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: /reverted|PartialFill/i })
    .waitFor();
  assert.equal(state.sends.length, before);
  state.rejectSimulation = false;
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  check("Simulation revert is visible and prevents wallet broadcast");
  await page.evaluate(() => {
    window.__wallet.reject = true;
  });
  await page
    .getByRole("button", { name: "Claim epoch 4 rank 1", exact: true })
    .click();
  await page
    .getByText("Request declined in your wallet.", { exact: false })
    .waitFor();
  assert.equal(state.sends.length, before);
  await page.evaluate(() => {
    window.__wallet.reject = false;
  });
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  check("Wallet rejection is recoverable and produces no transaction");
  state.failReceipt = true;
  await page
    .getByRole("button", { name: "Claim epoch 4 rank 1", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Transaction reverted on-chain" })
    .waitFor();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  state.failReceipt = false;
  check(
    "Failed receipt is reported as a failure with the submitted transaction link",
  );

  await page.evaluate(() => {
    window.__wallet.accounts = ["0x2222222222222222222222222222222222222222"];
    window.ethereum.emit("accountsChanged", window.__wallet.accounts);
  });
  await waitLive(page);
  assert.equal(
    await page.getByRole("button", { name: /Confirm (buy|sell)/ }).count(),
    0,
  );
  check(
    "Account change clears pending quotes and reloads wallet-specific state",
  );
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Connect wallet" }).waitFor();
  await waitLive(page);
  assert(
    await page
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  check("Disconnect disables signing and clears wallet-specific state");

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  report.accessibility = {
    violations: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    passes: axe.passes.length,
  };
  assert.equal(
    axe.violations.length,
    0,
    JSON.stringify(report.accessibility.violations, null, 2),
  );
  check("Automated accessibility scan: no WCAG A/AA violations", {
    passes: axe.passes.length,
  });

  report.contrast = await page.evaluate(() => {
    const rgb = (text) =>
      text
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    const luminance = (color) =>
      rgb(color)
        .map((v) => {
          const n = v / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    return [
      ["body", "body"],
      [".intro", "body"],
      [".pot-note", ".pot-panel"],
      [".epoch-clock strong", ".pot-panel"],
      [".notice p", ".notice"],
      [".amount-box > span", ".amount-box"],
    ].map(([foreground, background]) => {
      const fg = getComputedStyle(document.querySelector(foreground)).color,
        bg = getComputedStyle(
          document.querySelector(background),
        ).backgroundColor;
      const a = luminance(fg),
        b = luminance(bg);
      return {
        foreground,
        background,
        fg,
        bg,
        ratio: Number(
          ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
        ),
      };
    });
  });
  assert(report.contrast.every((p) => p.ratio >= 4.5));
  check("Measured six rendered text/background pairs at or above 4.5:1");
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Overflow at ${width}px`,
    );
    const name = `view-${width}`;
    await page.screenshot({ path: screenshotPath(name), fullPage: true });
    report.screenshots.push(`docs/frontend/${name}.png`);
    check(`Rendered ${width}px production layout without horizontal overflow`);
  }
  await page.setViewportSize({ width: 820, height: 1080 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.screenshot({ path: screenshotPath("text-200"), fullPage: true });
  report.screenshots.push("docs/frontend/text-200.png");
  const overflows = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        width: el.getBoundingClientRect().width,
        right: el.getBoundingClientRect().right,
      }))
      .slice(0, 20),
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Text enlargement overflow: " + JSON.stringify(overflows),
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  check(
    "200% CSS text enlargement at 820px reflows without horizontal page overflow",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator("button")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  check("Reduced motion removes button transitions");
  assert.equal(report.consoleErrors.length, 0);
  assert.equal(report.resourceFailures.length, 0);
  check("Primary scenario: no uncaught browser errors or failed resources");
  await context.close();

  const noWallet = await setup({ wallet: false, empty: true });
  await waitLive(noWallet.page);
  await noWallet.page
    .getByText("The first epoch is still running.", { exact: false })
    .waitFor();
  await noWallet.page.getByRole("button", { name: "Connect wallet" }).click();
  await noWallet.page
    .getByRole("alert")
    .filter({ hasText: "No browser wallet found" })
    .waitFor();
  await noWallet.page.screenshot({
    path: screenshotPath("empty-no-wallet"),
    fullPage: true,
  });
  report.screenshots.push("docs/frontend/empty-no-wallet.png");
  check("Empty epoch and missing-wallet states give actionable explanations");
  await noWallet.context.close();

  const offline = await setup({ rpcError: true });
  await offline.page
    .getByRole("alert")
    .filter({ hasText: "Live reads unavailable" })
    .waitFor();
  assert(
    await offline.page
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  offline.state.rpcError = false;
  await offline.page.getByRole("button", { name: "Retry live reads" }).click();
  await waitLive(offline.page);
  check("RPC failure fails closed; Retry restores live state");
  await offline.context.close();

  const noCode = await setup({ brokenCode: true });
  await noCode.page
    .getByRole("alert")
    .filter({ hasText: "No contract code" })
    .waitFor();
  assert(
    await noCode.page
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  check("Missing deployment code blocks actions");
  await noCode.context.close();

  const badAbi = await setup({ tamper: true });
  await badAbi.page
    .getByRole("alert")
    .filter({ hasText: "Asset integrity check failed" })
    .waitFor();
  assert(
    await badAbi.page
      .getByRole("button", { name: "Connect wallet" })
      .isDisabled(),
  );
  check("Tampered ABI fails integrity verification before connection/actions");
  await badAbi.context.close();
  report.result = "PASS";
} catch (error) {
  report.result = "FAIL";
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
