import {
  decodeEventLog,
  createWalletClient,
  custom,
  BaseError,
  zeroAddress,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import type { Runtime, Provider } from "./config";
import { identity, poolId, priceLimit, type PoolKey } from "./math";

export type Board = {
  epoch: bigint;
  users: Address[];
  volumes: bigint[];
  pot: bigint;
  claimed: boolean[];
  finalized: boolean;
};
export type Snapshot = {
  block: bigint;
  timestamp: bigint;
  receivedAt: number;
  epoch: bigint;
  end: bigint;
  current: Board;
  past: Board[];
  sqrtPrice: bigint;
  lpFee: number;
  protocolFee: number;
  decimals: number;
  balance: bigint;
  ethBalance: bigint;
  allowance: bigint;
  volume: bigint;
};
export type Activity = {
  name: string;
  epoch: bigint;
  address?: Address;
  amount: bigint;
  hash: Hex;
  block: bigint;
  index: number;
};
export function keyFor(r: Runtime): PoolKey {
  if (r.manifest.pool.pairedCurrency !== zeroAddress)
    throw new Error("This interface requires the attested native ETH pool.");
  return {
    currency0: r.manifest.pool.pairedCurrency,
    currency1: r.token.address,
    fee: r.manifest.pool.fee,
    tickSpacing: r.manifest.pool.tickSpacing,
    hooks: r.hook.address,
  };
}
export function errorMessage(error: unknown) {
  const value = error as {
    code?: number;
    shortMessage?: string;
    message?: string;
  };
  if (value?.code === 4001 || /rejected|denied/i.test(value?.message ?? ""))
    return "Request declined in your wallet. You can try again when ready.";
  if (error instanceof BaseError)
    return (
      error.shortMessage +
      (error.details && error.details.length < 250 ? ` ${error.details}` : "")
    );
  return (
    value?.shortMessage ||
    value?.message?.slice(0, 320) ||
    "Request failed. Check your connection and try again."
  );
}
export async function verifyChain(r: Runtime) {
  if ((await r.client.getChainId()) !== r.manifest.chainId)
    throw new Error("The RPC returned the wrong chain. Actions are disabled.");
  const addresses = [
    ...r.manifest.contracts.map((c) => c.address),
    r.manifest.network.uniswapV4.poolManager,
    r.manifest.network.uniswapV4.stateView,
    r.manifest.network.uniswapV4.quoter,
    r.manifest.integrations.poolSwapTest.address,
  ];
  await Promise.all(
    addresses.map(async (address) => {
      const code = await r.client.getCode({ address });
      if (!code || code === "0x")
        throw new Error(
          `No contract code at ${address}. Actions are disabled.`,
        );
    }),
  );
  const [hookManager, routerManager] = await Promise.all([
    r.client.readContract({
      address: r.hook.address,
      abi: r.hookAbi,
      functionName: "poolManager",
    }),
    r.client.readContract({
      address: r.manifest.integrations.poolSwapTest.address,
      abi: r.routerAbi,
      functionName: "manager",
    }),
  ]);
  if (
    [hookManager, routerManager].some(
      (a) =>
        String(a).toLowerCase() !==
        r.manifest.network.uniswapV4.poolManager.toLowerCase(),
    )
  )
    throw new Error(
      "Hook or router PoolManager mismatch. Actions are disabled.",
    );
}
export async function readSnapshot(
  r: Runtime,
  account?: Address,
): Promise<Snapshot> {
  const block = await r.client.getBlock();
  const blockNumber = block.number;
  const read = (functionName: string, args?: unknown[]) =>
    r.client.readContract({
      address: r.hook.address,
      abi: r.hookAbi,
      functionName,
      args,
      blockNumber,
    });
  const epoch = (await read("epochNow")) as bigint;
  const id = poolId(keyFor(r));
  const board = async (epoch: bigint): Promise<Board> => {
    const [value, finalized] = await Promise.all([
      read("leaderboard", [id, epoch]),
      read("isFinalized", [id, epoch]),
    ]);
    const [users, volumes, pot, claimed] = value as [
      Address[],
      bigint[],
      bigint,
      boolean[],
    ];
    return {
      epoch,
      users,
      volumes,
      pot,
      claimed,
      finalized: finalized as boolean,
    };
  };
  const [
    end,
    current,
    past,
    slot,
    decimals,
    balance,
    ethBalance,
    allowance,
    volume,
  ] = await Promise.all([
    read("epochEnd", [epoch]) as Promise<bigint>,
    board(epoch),
    Promise.all(
      Array.from({ length: Number(epoch < 4n ? epoch : 4n) }, (_, i) =>
        board(epoch - BigInt(i + 1)),
      ),
    ),
    r.client.readContract({
      address: r.manifest.network.uniswapV4.stateView,
      abi: r.stateAbi,
      functionName: "getSlot0",
      args: [id],
      blockNumber,
    }) as Promise<[bigint, number, number, number]>,
    r.client.readContract({
      address: r.token.address,
      abi: r.tokenAbi,
      functionName: "decimals",
      blockNumber,
    }) as Promise<number>,
    account
      ? (r.client.readContract({
          address: r.token.address,
          abi: r.tokenAbi,
          functionName: "balanceOf",
          args: [account],
          blockNumber,
        }) as Promise<bigint>)
      : 0n,
    account ? r.client.getBalance({ address: account, blockNumber }) : 0n,
    account
      ? (r.client.readContract({
          address: r.token.address,
          abi: r.tokenAbi,
          functionName: "allowance",
          args: [account, r.manifest.integrations.poolSwapTest.address],
          blockNumber,
        }) as Promise<bigint>)
      : 0n,
    account ? (read("volumeOf", [id, epoch, account]) as Promise<bigint>) : 0n,
  ]);
  return {
    block: blockNumber,
    timestamp: block.timestamp,
    receivedAt: Date.now(),
    epoch,
    end,
    current,
    past,
    sqrtPrice: slot[0],
    protocolFee: slot[2],
    lpFee: slot[3],
    decimals,
    balance,
    ethBalance,
    allowance,
    volume,
  };
}
export async function readActivity(r: Runtime, toBlock: bigint) {
  const start = toBlock > 599n ? toBlock - 599n : 0n;
  const fromBlock =
    start > BigInt(r.manifest.deploymentBlock)
      ? start
      : BigInt(r.manifest.deploymentBlock);
  const id = poolId(keyFor(r));
  const requests = [];
  for (let from = fromBlock; from <= toBlock; from += 200n)
    requests.push(
      r.client.getLogs({
        address: r.hook.address,
        fromBlock: from,
        toBlock: from + 199n < toBlock ? from + 199n : toBlock,
      }),
    );
  const logs = (await Promise.all(requests)).flat();
  const events: Activity[] = [];
  for (const log of logs) {
    try {
      const event = decodeEventLog({
        abi: r.hookAbi,
        data: log.data,
        topics: log.topics,
      });
      const args = event.args as unknown as {
        poolId: Hex;
        epoch: bigint;
        user?: Address;
        recipient?: Address;
        ethVolume?: bigint;
        amount?: bigint;
        carry?: bigint;
      };
      if (
        !event.eventName ||
        args.poolId !== id ||
        !log.transactionHash ||
        log.blockNumber === null
      )
        continue;
      events.push({
        name: event.eventName,
        epoch: args.epoch,
        address: args.user || args.recipient,
        amount: args.ethVolume ?? args.amount ?? args.carry ?? 0n,
        hash: log.transactionHash,
        block: log.blockNumber,
        index: log.logIndex ?? 0,
      });
    } catch {
      /* Only the three implementation events apply to this feed. */
    }
  }
  return {
    fromBlock,
    toBlock,
    events: events
      .sort((a, b) => Number(b.block - a.block) || b.index - a.index)
      .slice(0, 8),
  };
}
export async function switchNetwork(provider: Provider, r: Runtime) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: r.manifest.walletAddChain.chainId }],
    });
  } catch (e) {
    const error = e as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      error.code !== 4902 &&
      error.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(error.message ?? "")
    )
      throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [r.manifest.walletAddChain],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: r.manifest.walletAddChain.chainId }],
    });
  }
}
export async function assertWallet(
  provider: Provider,
  r: Runtime,
  account: Address,
) {
  const [chain, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (
    Number(chain) !== r.manifest.chainId ||
    accounts[0]?.toLowerCase() !== account.toLowerCase()
  )
    throw new Error(
      "Wallet account or network changed. Reconnect and review the action again.",
    );
}
export type ContractAction = {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
};
export async function transact(
  r: Runtime,
  provider: Provider,
  account: Address,
  action: ContractAction,
  onStatus: (text: string, hash?: Hex) => void,
) {
  await assertWallet(provider, r, account);
  onStatus("Checking the transaction…");
  const { request } = await r.client.simulateContract({ ...action, account });
  await assertWallet(provider, r, account);
  onStatus("Confirm the transaction in your wallet.");
  const wallet = createWalletClient({
    chain: r.chain,
    transport: custom(provider),
    account,
  });
  const hash = await wallet.writeContract(request);
  onStatus("Transaction submitted. Waiting for confirmation…", hash);
  const receipt = await r.client.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  if (receipt.status !== "success")
    throw new Error(
      "Transaction reverted on-chain. Refresh the state before trying again.",
    );
  onStatus("Transaction confirmed. Refreshing the pool…", hash);
  return hash;
}
export function swapAction(
  r: Runtime,
  account: Address,
  amount: bigint,
  buy: boolean,
  sqrtPrice: bigint,
  bps: number,
): ContractAction {
  return {
    address: r.manifest.integrations.poolSwapTest.address,
    abi: r.routerAbi,
    functionName: "swap",
    args: [
      keyFor(r),
      {
        zeroForOne: buy,
        amountSpecified: -amount,
        sqrtPriceLimitX96: priceLimit(sqrtPrice, buy, bps),
      },
      { takeClaims: false, settleUsingBurn: false },
      identity(account),
    ],
    value: buy ? amount : 0n,
  };
}
export async function quote(
  r: Runtime,
  account: Address,
  amount: bigint,
  buy: boolean,
) {
  const simulation = await r.client.simulateContract({
    address: r.manifest.network.uniswapV4.quoter,
    abi: r.quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: keyFor(r),
        zeroForOne: buy,
        exactAmount: amount,
        hookData: identity(account),
      },
    ],
    account,
  });
  return (simulation.result as [bigint, bigint])[0];
}
