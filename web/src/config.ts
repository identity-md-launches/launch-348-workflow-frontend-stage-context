import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  custom,
  keccak256,
  sha256,
  toBytes,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
import { canonical } from "./canonical";

export type Provider = EIP1193Provider;
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export interface Deployment {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: {
      poolManager: Address;
      stateView: Address;
      quoter: Address;
      universalRouter: Address;
      permit2: Address;
      positionManager: Address;
    };
  };
  walletAddChain: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: { fee: number; tickSpacing: number; pairedCurrency: Address };
  deploymentBlock: number;
  integrations: {
    poolSwapTest: { address: Address; abiPath: string };
    stateView: { abiPath: string };
    quoter: { abiPath: string };
  };
}

function safePath(path: string) {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").includes("..")
  )
    throw new Error("Unsafe deployment asset path");
  return path;
}
async function fetchText(path: string) {
  const result = await fetch(
    new URL(
      safePath(path),
      new URL(import.meta.env.BASE_URL, window.location.href),
    ),
    { cache: "no-cache" },
  );
  if (!result.ok)
    throw new Error(
      `Unable to load ${path} (${result.status}). Reload the page to retry.`,
    );
  return result.text();
}
export async function loadDeployment() {
  const manifest: Deployment = JSON.parse(
    await fetchText("imd-deployment.json"),
  );
  if (
    manifest.version !== 1 ||
    manifest.chainId !== manifest.network.chainId ||
    Number(manifest.walletAddChain.chainId) !== manifest.chainId ||
    manifest.contracts.length !== 2
  )
    throw new Error(
      "Deployment configuration does not match its network. Actions are disabled.",
    );
  const contract = (name: string) => {
    const found = manifest.contracts.find((c) => c.name === name);
    if (!found) throw new Error(`Missing ${name} in deployment configuration`);
    return found;
  };
  const abi = async (path: string, expectedHash?: string): Promise<Abi> => {
    const text = await fetchText(path);
    const asset = manifest.assets.find((a) => a.path === path);
    if (!asset || sha256(toBytes(text)).slice(2) !== asset.sha256)
      throw new Error(`Asset integrity check failed: ${path}`);
    const value = JSON.parse(text);
    if (
      !Array.isArray(value) ||
      (expectedHash &&
        keccak256(toBytes(canonical(value))).slice(2) !== expectedHash)
    )
      throw new Error(`ABI verification failed: ${path}`);
    return value as Abi;
  };
  const token = contract("VOLM"),
    hook = contract("VolumeLeaderboardHook");
  const [tokenAbi, hookAbi, routerAbi, stateAbi, quoterAbi] = await Promise.all(
    [
      abi(token.abiPath, token.abiHash),
      abi(hook.abiPath, hook.abiHash),
      abi(manifest.integrations.poolSwapTest.abiPath),
      abi(manifest.integrations.stateView.abiPath),
      abi(manifest.integrations.quoter.abiPath),
    ],
  );
  const chain = defineChain({
    id: manifest.chainId,
    name: manifest.network.name,
    nativeCurrency: manifest.network.nativeCurrency,
    rpcUrls: { default: { http: manifest.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: manifest.network.explorer },
    },
    testnet: manifest.network.testnet,
  });
  const transports = manifest.network.rpcUrls.map((url) =>
    http(url, { timeout: 7000, retryCount: 0, batch: true }),
  );
  const client = createPublicClient({
    chain,
    transport: fallback(
      [
        ...transports,
        ...(window.ethereum
          ? [custom(window.ethereum, { retryCount: 0 })]
          : []),
      ],
      { retryCount: 0 },
    ),
    batch: { multicall: false },
  });
  return {
    manifest,
    token,
    hook,
    tokenAbi,
    hookAbi,
    routerAbi,
    stateAbi,
    quoterAbi,
    chain,
    client,
  };
}
export type Runtime = Awaited<ReturnType<typeof loadDeployment>>;
