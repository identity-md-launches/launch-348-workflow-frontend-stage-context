import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, zeroAddress, type Address, type Hex } from "viem";
import { loadDeployment, type Runtime } from "./config";
import {
  readSnapshot,
  readActivity,
  verifyChain,
  errorMessage,
  switchNetwork,
  transact,
  quote,
  swapAction,
  keyFor,
  type Snapshot,
  type Board,
  type ContractAction,
} from "./chain";
import {
  amountIn,
  countdown,
  displayAmount,
  payout,
  sharePercent,
} from "./math";

type Feed = Awaited<ReturnType<typeof readActivity>>;
type Quoted = {
  output: bigint;
  input: bigint;
  buy: boolean;
  bps: number;
  account: Address;
  sqrtPrice: bigint;
  time: number;
};
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

function AddressLink({ address, r }: { address: Address; r: Runtime }) {
  return (
    <a
      className="address"
      href={`${r.manifest.network.explorer}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={address}
      aria-label={`View address ${address} on the explorer`}
    >
      <bdi>{short(address)}</bdi>
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}
function Amount({
  value,
  decimals = 18,
  unit = "ETH",
}: {
  value: bigint;
  decimals?: number;
  unit?: string;
}) {
  return (
    <span className="numeric" title={`${formatUnits(value, decimals)} ${unit}`}>
      {displayAmount(value, decimals)} <span className="unit">{unit}</span>
    </span>
  );
}

export default function App() {
  const [r, setRuntime] = useState<Runtime>();
  const [configError, setConfigError] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [feed, setFeed] = useState<Feed>();
  const [readError, setReadError] = useState("");
  const [eventError, setEventError] = useState("");
  const [verified, setVerified] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [walletPresent, setWalletPresent] = useState(!!window.ethereum);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const [txHash, setTxHash] = useState<Hex>();
  const [now, setNow] = useState(Date.now());
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [bps, setBps] = useState(100);
  const [quoted, setQuoted] = useState<Quoted>();
  const [fieldError, setFieldError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    loadDeployment()
      .then(setRuntime)
      .catch((e) => setConfigError(errorMessage(e)));
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const accounts = (values: string[]) => {
      generation.current++;
      setAccount(values[0] as Address | undefined);
      setQuoted(undefined);
      setSnapshot(undefined);
    };
    const chain = (value: string) => {
      setWalletChain(Number(value));
      setQuoted(undefined);
    };
    const disconnect = () => {
      generation.current++;
      setAccount(undefined);
      setQuoted(undefined);
      setSnapshot(undefined);
    };
    provider.on("accountsChanged", accounts);
    provider.on("chainChanged", chain);
    provider.on("disconnect", disconnect);
    // Reconnect only already-authorized accounts; never prompt on page load.
    Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ])
      .then(([a, c]) => {
        accounts(a);
        chain(c);
      })
      .catch(() => {});
    return () => {
      provider.removeListener("accountsChanged", accounts);
      provider.removeListener("chainChanged", chain);
      provider.removeListener("disconnect", disconnect);
    };
  }, [walletPresent]);

  const refresh = useCallback(async () => {
    if (!r) return;
    const current = ++generation.current;
    setRefreshing(true);
    try {
      await verifyChain(r);
      const next = await readSnapshot(r, account);
      if (current !== generation.current) return;
      setSnapshot(next);
      setVerified(true);
      setReadError("");
      try {
        const events = await readActivity(r, next.block);
        if (current === generation.current) {
          setFeed(events);
          setEventError("");
        }
      } catch (e) {
        if (current === generation.current) setEventError(errorMessage(e));
      }
    } catch (e) {
      if (current === generation.current) {
        setVerified(false);
        setReadError(errorMessage(e));
      }
    } finally {
      if (current === generation.current) setRefreshing(false);
    }
  }, [r, account]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    setQuoted(undefined);
    setFieldError("");
  }, [buy, amount, bps, account, walletChain]);

  const wrongChain = !!account && walletChain !== r?.manifest.chainId;
  const stale = !!snapshot && now - snapshot.receivedAt > 60000;
  const canAct =
    !!r &&
    !!account &&
    !wrongChain &&
    verified &&
    !!snapshot &&
    !stale &&
    !readError &&
    !busy;
  const tradeReady = canAct && snapshot!.sqrtPrice > 0n;
  const quoteFresh =
    !!quoted &&
    now - quoted.time < 45000 &&
    quoted.account === account &&
    quoted.buy === buy &&
    quoted.bps === bps;
  const needsApproval =
    !!quoted && !buy && !!snapshot && snapshot.allowance < quoted.input;
  const reason = !account
    ? "Connect a browser wallet to trade or settle epochs."
    : wrongChain
      ? `Switch your wallet to ${r?.manifest.network.name} to continue.`
      : !verified
        ? "Contract checks must succeed before actions are available."
        : stale
          ? "State is out of date. Refresh before continuing."
          : !snapshot
            ? "Waiting for pool state…"
            : snapshot.sqrtPrice === 0n
              ? "This pool has not been initialized."
              : "";

  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    setStatus("");
    setTxHash(undefined);
    try {
      await work();
    } catch (e) {
      setActionError(errorMessage(e));
      setStatus("");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function connect() {
    const provider = window.ethereum;
    if (!provider) {
      setActionError(
        "No browser wallet found. Install an Ethereum browser wallet, then reload this page.",
      );
      return;
    }
    setWalletPresent(true);
    await run(async () => {
      const values = await provider.request({ method: "eth_requestAccounts" });
      setAccount(values[0]);
      setWalletChain(Number(await provider.request({ method: "eth_chainId" })));
      setStatus("Wallet connected.");
    });
  }
  async function send(action: ContractAction) {
    if (!canAct || !r || !account || !window.ethereum) return;
    await run(async () => {
      await transact(r, window.ethereum!, account, action, (message, hash) => {
        setStatus(message);
        if (hash) setTxHash(hash);
      });
      setQuoted(undefined);
      await refresh();
    });
  }
  async function previewTrade() {
    if (!tradeReady || !r || !account || !snapshot) return;
    let input: bigint;
    try {
      input = amountIn(
        amount,
        buy ? r.manifest.network.nativeCurrency.decimals : snapshot.decimals,
      );
      if (input > (buy ? snapshot.ethBalance : snapshot.balance))
        throw new Error(
          `Enter an amount within your ${buy ? "ETH" : "VOLM"} balance. Leave ETH for gas.`,
        );
    } catch (e) {
      setFieldError(errorMessage(e));
      amountRef.current?.focus();
      return;
    }
    setFieldError("");
    setQuoted(undefined);
    await run(async () => {
      setStatus("Fetching a quote…");
      const output = await quote(r, account, input, buy);
      if (output <= 0n)
        throw new Error(
          "This amount returns no output. Try a different amount.",
        );
      setQuoted({
        input,
        output,
        buy,
        bps,
        account,
        sqrtPrice: snapshot.sqrtPrice,
        time: Date.now(),
      });
      setStatus(
        "Quote ready. Review the amount and price limit before continuing.",
      );
    });
  }
  const boardRows = (board: Board, ended = false) =>
    board.users.map((user, i) => (
      <tr key={i}>
        <td>
          <span className={`rank rank-${i + 1}`}>
            {String(i + 1).padStart(2, "0")}
          </span>
        </td>
        <td>
          {user === zeroAddress ? (
            <span className="muted">Open rank</span>
          ) : (
            r && <AddressLink address={user} r={r} />
          )}
          {user === account && <span className="you">You</span>}
        </td>
        <td className="number">
          <Amount value={ended ? payout(board.pot, i) : board.volumes[i]} />
        </td>
        <td className="number">
          {ended ? (
            user === zeroAddress ? (
              <span className="muted">Carry</span>
            ) : board.claimed[i] ? (
              <span className="paid">Paid ✓</span>
            ) : (
              <button
                className="small"
                disabled={!canAct}
                aria-label={`Claim epoch ${board.epoch} rank ${i + 1}`}
                onClick={() =>
                  void send({
                    address: r!.hook.address,
                    abi: r!.hookAbi,
                    functionName: "claim",
                    args: [keyFor(r!), board.epoch, BigInt(i + 1)],
                  })
                }
              >
                Claim<span className="sr-only"> for {user}</span>
              </button>
            )
          ) : (
            <span className="reward">{String(sharePercent[i])}%</span>
          )}
        </td>
      </tr>
    ));
  const chainNow = snapshot
    ? Number(snapshot.timestamp) * 1000 + now - snapshot.receivedAt
    : now;
  const price = snapshot?.sqrtPrice
    ? (Number(snapshot.sqrtPrice) ** 2 / 2 ** 192) *
      10 ** (18 - snapshot.decimals)
    : 0;

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header shell">
        <a href="#main" className="brand" aria-label="Volume home">
          <span className="brand-mark" aria-hidden="true">
            v
          </span>
          volume<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Primary">
          <a href="#leaderboard">Leaderboard</a>
          <a href="#epochs">Past epochs</a>
        </nav>
        <div className="wallet">
          <span className="network-tag">
            <span aria-hidden="true">◈</span>{" "}
            {r?.manifest.network.name || "Testnet"}
          </span>
          {account ? (
            <>
              <span className="wallet-address" title={account}>
                {short(account)}
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  generation.current++;
                  setAccount(undefined);
                  setSnapshot(undefined);
                  setQuoted(undefined);
                  setTxHash(undefined);
                  setStatus("Wallet disconnected from this page.");
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="connect"
              disabled={busy || !r}
              onClick={() => void connect()}
            >
              Connect wallet <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>

      <main id="main" className="shell" tabIndex={-1}>
        <div className="hero">
          <div>
            <p className="eyebrow">The weekly volume race</p>
            <h1>
              Every swap.
              <br />
              <span>A place in the race.</span>
            </h1>
            <p className="intro">
              Trade VOLM. Follow the top five. Each swap adds to a shared weekly
              pot on Sepolia.
            </p>
          </div>
          <div className="race-art" aria-hidden="true">
            <div className="track t1"></div>
            <div className="track t2"></div>
            <div className="track t3"></div>
            <div className="track t4"></div>
            <span className="track-number">05</span>
            <span className="track-caption">One pool. Five places.</span>
          </div>
        </div>
        <div className="notice">
          <span className="notice-label">Testnet only</span>
          <p>
            VOLM and the pot have no value. This is an experiment, with no
            promised return.
          </p>
          <a href="#how-it-works">
            How it works <span aria-hidden="true">↗</span>
          </a>
        </div>

        {configError && (
          <div className="alert" role="alert">
            <strong>Deployment could not be verified.</strong> {configError}{" "}
            <button onClick={() => window.location.reload()}>
              Reload configuration
            </button>
          </div>
        )}
        {wrongChain && (
          <div className="alert">
            <strong>Wallet on a different network.</strong>
            <span>Switch to {r?.manifest.network.name} to use this pool.</span>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await switchNetwork(window.ethereum!, r!);
                  setWalletChain(
                    Number(
                      await window.ethereum!.request({ method: "eth_chainId" }),
                    ),
                  );
                  setStatus("Network switched.");
                })
              }
            >
              Switch to {r?.manifest.network.name}
            </button>
          </div>
        )}
        {readError && (
          <div className="alert" role="alert">
            <strong>Live reads unavailable.</strong> {readError}{" "}
            <button disabled={refreshing} onClick={() => void refresh()}>
              Retry live reads
            </button>
          </div>
        )}
        {stale && !readError && (
          <div className="alert">
            Last read is more than a minute old. Actions are paused until fresh
            data arrives.
          </div>
        )}
        <div className="transaction-status" aria-live="polite" role="status">
          {status}
          {txHash && r && (
            <>
              {" "}
              <a
                href={`${r.manifest.network.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            </>
          )}
        </div>
        {actionError && (
          <div className="alert" role="alert">
            {actionError}
            {txHash && r && (
              <a
                href={`${r.manifest.network.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Check submitted transaction ↗
              </a>
            )}
            <button onClick={() => setActionError("")}>Dismiss</button>
          </div>
        )}

        <div className="main-grid">
          <section
            id="leaderboard"
            className="race-section"
            aria-labelledby="race-title"
          >
            <div className="section-heading">
              <h2 id="race-title">This week’s race</h2>
              <span className="live-tag">
                {snapshot && !readError && !stale
                  ? "● Live reads"
                  : readError
                    ? "○ Offline"
                    : "○ Connecting"}
              </span>
            </div>
            <div className="pot-panel">
              <div>
                <p className="eyebrow">Current epoch pot</p>
                <div className="pot-value">
                  {snapshot ? displayAmount(snapshot.current.pot) : "—"}{" "}
                  <span>ETH</span>
                </div>
                <p className="pot-note">
                  40 / 25 / 15 / 10 / 10% · Top five split
                </p>
              </div>
              <div className="epoch-clock">
                <span>
                  Epoch{" "}
                  {snapshot ? snapshot.epoch.toString().padStart(2, "0") : "—"}
                </span>
                <strong>
                  {snapshot ? countdown(snapshot.end, chainNow) : "—d —h —m"}
                </strong>
                <span>
                  {snapshot && chainNow >= Number(snapshot.end) * 1000
                    ? "Epoch ended · refreshing"
                    : "until the next epoch"}
                </span>
              </div>
            </div>
            <div className="leaderboard card">
              <div className="card-heading">
                <h3>The top five</h3>
                <span className="muted">Ranked by ETH volume</span>
              </div>
              <table>
                <caption className="sr-only">
                  Current epoch’s top five addresses, ETH volume, and pot share
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Wallet</th>
                    <th scope="col" className="number">
                      Volume
                    </th>
                    <th scope="col" className="number">
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot
                    ? boardRows(snapshot.current)
                    : Array.from({ length: 5 }, (_, i) => (
                        <tr key={i}>
                          <td>
                            <span className="rank">0{i + 1}</span>
                          </td>
                          <td className="muted">Awaiting live data</td>
                          <td className="number">—</td>
                          <td className="number">{String(sharePercent[i])}%</td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {snapshot &&
                snapshot.current.users.every((a) => a === zeroAddress) && (
                  <p className="table-note">
                    No credited swaps this epoch. A swap with this page credits
                    your connected wallet.
                  </p>
                )}
              <div className="your-volume">
                <span>Your epoch volume</span>
                <strong>
                  {account && snapshot ? (
                    <Amount value={snapshot.volume} />
                  ) : (
                    "Connect to view"
                  )}
                </strong>
              </div>
            </div>
            <div className="read-meta">
              <span>
                {snapshot
                  ? `Read at block ${snapshot.block.toLocaleString()}${stale || readError ? " · stale" : ""}`
                  : "Fetching on-chain state…"}{" "}
                · refreshes every 20s
              </span>
              <button
                className="text-button"
                disabled={!r || refreshing}
                onClick={() => void refresh()}
              >
                {refreshing ? "Refreshing…" : "Refresh ↻"}
              </button>
            </div>
          </section>

          <section
            className="trade card"
            id="trade"
            aria-labelledby="trade-title"
          >
            <div className="section-heading">
              <h2 id="trade-title">Make a swap</h2>
              <span className="pair-tag">ETH / VOLM</span>
            </div>
            <div
              className="trade-toggle"
              role="group"
              aria-label="Trade direction"
            >
              <button
                aria-pressed={buy}
                disabled={busy}
                onClick={() => setBuy(true)}
              >
                Buy VOLM
              </button>
              <button
                aria-pressed={!buy}
                disabled={busy}
                onClick={() => setBuy(false)}
              >
                Sell VOLM
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void previewTrade();
              }}
              noValidate
            >
              <label className="amount-box" htmlFor="amount">
                <span>You pay</span>
                <div className="amount-line">
                  <input
                    id="amount"
                    ref={amountRef}
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    disabled={busy}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-invalid={!!fieldError}
                    aria-describedby="amount-hint amount-error"
                  />
                  <strong>{buy ? "ETH" : "VOLM"}</strong>
                </div>
                <span id="amount-hint">
                  Balance:{" "}
                  {account && snapshot
                    ? displayAmount(
                        buy ? snapshot.ethBalance : snapshot.balance,
                        buy ? 18 : snapshot.decimals,
                      )
                    : "—"}{" "}
                  {buy ? "ETH" : "VOLM"}
                </span>
              </label>
              <p
                id="amount-error"
                className="field-error"
                role={fieldError ? "alert" : undefined}
              >
                {fieldError}
              </p>
              <div className="quote-box">
                <span>Estimated receive</span>
                <strong>
                  {quoteFresh && quoted && snapshot ? (
                    <Amount
                      value={quoted.output}
                      decimals={buy ? snapshot.decimals : 18}
                      unit={buy ? "VOLM" : "ETH"}
                    />
                  ) : (
                    <span>
                      — <span className="unit">{buy ? "VOLM" : "ETH"}</span>
                    </span>
                  )}
                </strong>
                <span>Includes pool and hook fees</span>
              </div>
              <div className="price-limit">
                <label htmlFor="limit">Price movement limit</label>
                <select
                  id="limit"
                  name="limit"
                  value={bps}
                  disabled={busy}
                  onChange={(e) => setBps(Number(e.target.value))}
                >
                  <option value={10}>0.1%</option>
                  <option value={50}>0.5%</option>
                  <option value={100}>1%</option>
                  <option value={200}>2%</option>
                  <option value={500}>5%</option>
                </select>
              </div>
              <dl className="trade-details">
                <div>
                  <dt>Pool price</dt>
                  <dd>
                    {price
                      ? `1 ETH ≈ ${price.toLocaleString("en-US", { maximumSignificantDigits: 6 })} VOLM`
                      : "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>LP fee / hook fee</dt>
                  <dd>
                    {snapshot ? `${snapshot.lpFee / 10000}%` : "—"} / 0.3%
                  </dd>
                </div>
                {!!snapshot?.protocolFee && (
                  <div>
                    <dt>Protocol fee</dt>
                    <dd>Active · included in quote</dd>
                  </div>
                )}
              </dl>
              <p className="trade-help">
                The price limit includes this swap’s price impact. PoolSwapTest
                has no minimum-output guarantee or deadline; a partial fill
                reverts.
              </p>
              <button
                className={quoteFresh ? "full" : "primary full"}
                type="submit"
                disabled={!tradeReady}
              >
                {busy
                  ? "Request in progress…"
                  : quoteFresh
                    ? "Refresh quote"
                    : "Get quote"}
              </button>
            </form>
            {reason && <p className="prerequisite">{reason}</p>}
            {quoteFresh && quoted && r && account && (
              <div className="trade-review">
                <p>
                  Pay{" "}
                  <Amount
                    value={quoted.input}
                    decimals={buy ? 18 : snapshot!.decimals}
                    unit={buy ? "ETH" : "VOLM"}
                  />
                  . Credit volume to <bdi>{short(account)}</bdi>.
                </p>
                <p className="muted">
                  Quote expires in{" "}
                  {Math.max(0, Math.ceil((45000 - now + quoted.time) / 1000))}s.
                  You pay network gas separately.
                </p>
                {needsApproval ? (
                  <>
                    <p>
                      Approve this exact VOLM amount for PoolSwapTest, then
                      request a fresh quote.
                    </p>
                    <button
                      className="primary full"
                      disabled={!tradeReady}
                      onClick={() =>
                        void send({
                          address: r.token.address,
                          abi: r.tokenAbi,
                          functionName: "approve",
                          args: [
                            r.manifest.integrations.poolSwapTest.address,
                            quoted.input,
                          ],
                        })
                      }
                    >
                      Approve {displayAmount(quoted.input, snapshot!.decimals)}{" "}
                      VOLM
                    </button>
                  </>
                ) : (
                  <button
                    className="primary full"
                    disabled={!tradeReady}
                    onClick={() =>
                      void send(
                        swapAction(
                          r,
                          account,
                          quoted.input,
                          buy,
                          quoted.sqrtPrice,
                          quoted.bps,
                        ),
                      )
                    }
                  >
                    {buy ? "Confirm buy" : "Confirm sell"}
                  </button>
                )}
              </div>
            )}
            {!quoteFresh && quoted && (
              <p className="prerequisite">
                Quote expired. Get a fresh quote to continue.
              </p>
            )}
            <div className="trade-footer">
              <span aria-hidden="true">↗</span> Swaps through Uniswap v4 ·
              Sepolia
            </div>
          </section>
        </div>

        <section
          className="past-section"
          id="epochs"
          aria-labelledby="epochs-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Close the loop</p>
              <h2 id="epochs-title">Past epochs</h2>
            </div>
            <span className="muted">Last four ended epochs</span>
          </div>
          <p className="section-description">
            Anyone can claim for a winner. ETH goes to the recorded wallet; the
            caller pays gas. Finalize carries unused shares and rounding into
            the current pot.
          </p>
          {!snapshot ? (
            <div className="empty card">
              Past epochs will appear when live state is available.
            </div>
          ) : snapshot.past.length === 0 ? (
            <div className="empty card">
              The first epoch is still running. Ended epochs will appear here.
            </div>
          ) : (
            <div className="epoch-grid">
              {snapshot.past.map((board) => (
                <article className="epoch-card card" key={String(board.epoch)}>
                  <div className="card-heading">
                    <h3>Epoch {String(board.epoch).padStart(2, "0")}</h3>
                    <span className="muted">
                      Original pot <Amount value={board.pot} />
                    </span>
                  </div>
                  <table>
                    <caption className="sr-only">
                      Payouts for epoch {String(board.epoch)}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Rank</th>
                        <th scope="col">Recipient</th>
                        <th scope="col" className="number">
                          Payout
                        </th>
                        <th scope="col" className="number">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>{boardRows(board, true)}</tbody>
                  </table>
                  <div className="epoch-bottom">
                    <span className="muted">
                      {board.finalized ? (
                        "Unused shares carried forward"
                      ) : (
                        <>
                          <Amount
                            value={
                              board.pot -
                              board.users.reduce(
                                (total, user, i) =>
                                  total +
                                  (user !== zeroAddress
                                    ? payout(board.pot, i)
                                    : 0n),
                                0n,
                              )
                            }
                          />{" "}
                          to carry
                        </>
                      )}
                    </span>
                    <button
                      disabled={!canAct || board.finalized}
                      onClick={() =>
                        void send({
                          address: r!.hook.address,
                          abi: r!.hookAbi,
                          functionName: "finalize",
                          args: [keyFor(r!), board.epoch],
                        })
                      }
                    >
                      {board.finalized
                        ? "Finalized ✓"
                        : `Finalize epoch ${board.epoch}`}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="bottom-grid">
          <section className="activity card" aria-labelledby="activity-title">
            <div className="card-heading">
              <h2 id="activity-title">Pool activity</h2>
              <span className="muted">Recent events</span>
            </div>
            {eventError ? (
              <p className="inset" role="status">
                Event feed unavailable: {eventError} Use Refresh to retry.
              </p>
            ) : !feed ? (
              <p className="inset muted">Waiting for event reads…</p>
            ) : feed.events.length === 0 ? (
              <p className="inset muted">
                No hook events in this block window. The leaderboard above is
                read directly from contract views.
              </p>
            ) : (
              <ul className="event-list">
                {feed.events.map((event) => (
                  <li key={`${event.hash}-${event.index}`}>
                    <div>
                      <strong>
                        {event.name === "Credited"
                          ? "Volume credited"
                          : event.name === "Claimed"
                            ? "Rank paid"
                            : "Epoch finalized"}
                      </strong>
                      <span className="muted">
                        Epoch {String(event.epoch)}
                        {event.address && r && (
                          <>
                            {" "}
                            · <AddressLink address={event.address} r={r} />
                          </>
                        )}
                      </span>
                    </div>
                    <div className="number">
                      <Amount value={event.amount} />
                      <a
                        href={`${r!.manifest.network.explorer}/tx/${event.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${event.name} transaction ${event.hash}`}
                      >
                        View transaction ↗
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {feed && (
              <p className="feed-window">
                Blocks {String(feed.fromBlock)}–{String(feed.toBlock)} · Most
                recent eight events
              </p>
            )}
          </section>
          <section
            className="rules"
            id="how-it-works"
            aria-labelledby="rules-title"
          >
            <p className="eyebrow">The rules, on-chain</p>
            <h2 id="rules-title">
              Seven days.
              <br />
              Five places.
            </h2>
            <ol>
              <li>
                <strong>Trade to record volume.</strong> Buys and sells count
                their ETH leg. Ties keep the earlier wallet ahead.
              </li>
              <li>
                <strong>Each swap funds the pot.</strong> A 0.3% hook fee joins
                the weekly pot, alongside the separate 0.3% LP fee.
              </li>
              <li>
                <strong>Settle when the week ends.</strong> The top five receive
                40%, 25%, 15%, 10%, and 10%. No automatic payout.
              </li>
            </ol>
            <details>
              <summary>Economics & identity limitations</summary>
              <p>
                Wash volume costs the LP fee plus the hook fee on every leg. It
                only pays economically when the pot funded by other traders
                exceeds that cost.
              </p>
              <p>
                This page encodes your connected wallet in hookData. The hook
                does not authenticate that identity: another caller can credit
                any address. The leaderboard is not proof of unique traders.
              </p>
              <p>
                Finalization and claims work in either order. A recipient that
                rejects ETH leaves only its own share unpaid. An ended epoch’s
                displayed pot is its original pot, including amounts already
                paid.
              </p>
            </details>
          </section>
        </div>

        <footer>
          <div className="footer-top">
            <a className="brand" href="#main">
              volume<span className="brand-dot">.</span>
            </a>
            <p>A small experiment in on-chain participation.</p>
            <span className="network-tag">Sepolia testnet</span>
          </div>
          {r && (
            <details className="deployment-details">
              <summary>Deployment & contract details</summary>
              <p>
                Configuration and implementation ABIs are loaded from this
                export’s <a href="./imd-deployment.json">deployment manifest</a>
                . Chain, code and manager checks:{" "}
                {verified
                  ? "passed for the latest successful read"
                  : "pending or unavailable"}
                .
              </p>
              <ul>
                {r.manifest.contracts.map((c) => (
                  <li key={c.name}>
                    {c.name}: <AddressLink address={c.address} r={r} />
                  </li>
                ))}
                <li>
                  PoolSwapTest:{" "}
                  <AddressLink
                    address={r.manifest.integrations.poolSwapTest.address}
                    r={r}
                  />
                </li>
                <li>
                  StateView:{" "}
                  <AddressLink
                    address={r.manifest.network.uniswapV4.stateView}
                    r={r}
                  />
                </li>
                <li>
                  PoolManager:{" "}
                  <AddressLink
                    address={r.manifest.network.uniswapV4.poolManager}
                    r={r}
                  />
                </li>
                <li>
                  Quoter:{" "}
                  <AddressLink
                    address={r.manifest.network.uniswapV4.quoter}
                    r={r}
                  />
                </li>
              </ul>
              <p className="hash">
                Deployed source: {r.manifest.sourceCommit}
                <br />
                Attestation: {r.manifest.attestationHash}
              </p>
              <a
                href={r.manifest.network.faucets[0]}
                target="_blank"
                rel="noreferrer"
              >
                Get test ETH from the Sepolia faucet ↗
              </a>
            </details>
          )}
          <div className="footer-bottom">
            <span>VOLM · No value. No promised return.</span>
            <span>Built for the IdentityMD network</span>
          </div>
        </footer>
      </main>
    </>
  );
}
