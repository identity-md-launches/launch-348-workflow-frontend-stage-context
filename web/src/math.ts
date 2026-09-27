import {
  encodeAbiParameters,
  keccak256,
  parseUnits,
  formatUnits,
  type Address,
} from "viem";

export const poolKeyType = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;
export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
export const poolId = (key: PoolKey) =>
  keccak256(encodeAbiParameters([poolKeyType], [key]));
export const identity = (account: Address) =>
  encodeAbiParameters([{ type: "address" }], [account]);
export const sharePercent = [40n, 25n, 15n, 10n, 10n];
export const payout = (pot: bigint, index: number) =>
  (pot * sharePercent[index]) / 100n;
export function amountIn(text: string, decimals: number) {
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ||
    (text.split(".")[1]?.length ?? 0) > decimals
  )
    throw new Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const amount = parseUnits(text, decimals);
  if (amount <= 0n || amount >= 2n ** 127n)
    throw new Error(
      "Enter a positive amount within the pool’s supported range.",
    );
  return amount;
}
export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("Negative square root");
  if (value < 2n) return value;
  let x = value,
    y = (value + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}
// PoolSwapTest has no minimum-output or deadline parameter. Bound the on-chain
// terminal spot price instead; the hook reverts any resulting partial fill.
export function priceLimit(sqrtPrice: bigint, buy: boolean, bps: number) {
  if (!Number.isInteger(bps) || bps < 10 || bps > 500)
    throw new Error("Choose a price limit from 0.1% to 5%.");
  const value = integerSqrt(
    (sqrtPrice * sqrtPrice * BigInt(10000 + (buy ? -bps : bps))) / 10000n,
  );
  if (
    value <= 4295128739n ||
    value >= 1461446703485210103287273052203988822378723970342n
  )
    throw new Error("Price limit is outside the pool’s supported range.");
  return value;
}
export function displayAmount(value: bigint, decimals = 18, precision = 5) {
  const exact = formatUnits(value, decimals);
  const [whole, fraction = ""] = exact.split(".");
  if (value > 0n && whole === "0" && Number(exact) < 10 ** -precision)
    return `<${(10 ** -precision).toFixed(precision)}`;
  return (
    Number(whole).toLocaleString("en-US") +
    (fraction.slice(0, precision).replace(/0+$/, "")
      ? "." + fraction.slice(0, precision).replace(/0+$/, "")
      : "")
  );
}
export function countdown(end: bigint, now: number) {
  const seconds = Math.max(0, Number(end) - Math.floor(now / 1000));
  const days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}
