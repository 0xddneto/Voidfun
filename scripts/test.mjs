import fs from "node:fs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  decodeEventLog,
  parseEther,
  keccak256,
  toHex,
} from "viem";
import { foundry } from "viem/chains";
import { loadMarket } from "../shared/market.js";
import { loadHistory } from "../shared/history.js";
const testChainId = Number(process.env.TEST_CHAIN_ID ?? 31337);
const testChain = { ...foundry, id: testChainId };
const usdPrice = testChainId === 5042002 ? 1n : 2000n;
const exe =
  process.platform === "win32"
    ? "node_modules/@foundry-rs/anvil-win32-amd64/bin/anvil.exe"
    : "anvil";
const processLocal = spawn(
  exe,
  [
    "--port",
    "8567",
    "--silent",
    "--chain-id",
    String(testChainId),
    "--balance",
    "1000000",
  ],
  {
    stdio: "ignore",
    windowsHide: true,
  },
);
const c = createPublicClient({
  chain: testChain,
  transport: http("http://127.0.0.1:8567", { retryCount: 0 }),
});
const A = (n) => JSON.parse(fs.readFileSync("artifacts/" + n + ".json"));
const read = (address, n, fn, args = []) =>
  c.readContract({ address, abi: A(n).abi, functionName: fn, args });
let w,
  owner,
  trader,
  treasury,
  other,
  checks = 0;
const ok = (name) => {
  checks++;
  console.log("PASS", name);
};
async function write(address, n, fn, args = [], opts = {}) {
  const spec = { address, abi: A(n).abi, functionName: fn, args, ...opts };
  await c.simulateContract({ ...spec, account: opts.account ?? owner });
  const h = await w.writeContract(spec);
  const r = await c.waitForTransactionReceipt({ hash: h });
  assert.equal(r.status, "success");
  return r;
}
async function deploy(n, args = []) {
  const hash = await w.deployContract({
    abi: A(n).abi,
    bytecode: "0x" + A(n).evm.bytecode.object,
    args,
  });
  const r = await c.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success");
  return r.contractAddress;
}
try {
  for (let i = 0; i < 50; i++) {
    try {
      await c.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  [owner, trader, treasury, other] = await c.request({
    method: "eth_accounts",
  });
  w = createWalletClient({
    account: owner,
    chain: testChain,
    transport: http("http://127.0.0.1:8567"),
  });
  const deed = await deploy("DeedCollection", [treasury, ""]);
  await write(deed, "DeedCollection", "mint", [], {
    value: parseEther(".001"),
  });
  const price = await deploy("TestnetPriceOracle", [
    owner,
    testChainId === 5042002,
  ]);
  if (testChainId !== 5042002)
    await write(price, "TestnetPriceOracle", "publish", [usdPrice * 10n ** 8n]);
  const factory = await deploy("RuntimeFactory", [deed, price, treasury]);
  const tokenLogic = await deploy("LaunchToken"),
    curveLogic = await deploy("LaunchCurve");
  const logic = await deploy("Voidfun", [
    factory,
    price,
    treasury,
    tokenLogic,
    curveLogic,
    100n,
    3000n,
    0n,
  ]);
  const pub = await write(factory, "RuntimeFactory", "publish", [
    1n,
    logic,
    "0x",
    keccak256(toHex("test")),
  ]);
  const runtime = await read(factory, "RuntimeFactory", "runtimeOf", [1n]);
  const gateway = pub.logs
    .flatMap((log) => {
      try {
        return [decodeEventLog({ abi: A("DeedRuntime").abi, ...log })];
      } catch {
        return [];
      }
    })
    .find((e) => e.eventName === "Published").args.gateway;
  await c.request({ method: "evm_mine" });
  async function execute(
    fn,
    args = [],
    value = 0n,
    account = owner,
    overrides = {},
  ) {
    const [toll, revision] = await read(runtime, "DeedRuntime", "quote");
    const data = encodeFunctionData({
      abi: A("Voidfun").abi,
      functionName: fn,
      args,
    });
    return write(
      runtime,
      "DeedRuntime",
      "execute",
      [
        {
          app: gateway,
          data,
          revision,
          maxToll: toll,
          appValue: value,
          appGas: 1900000n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
          ...overrides,
        },
      ],
      { account, value: toll + value, gas: 3000000n },
    );
  }
  const launch = await execute("createToken", [
    "First token",
    "FIRST",
    "https://example.com",
  ]);
  const ev = launch.logs
    .filter((l) => l.address.toLowerCase() === gateway.toLowerCase())
    .map((l) => {
      try {
        return decodeEventLog({ abi: A("Voidfun").abi, ...l });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "Launched");
  const curve = ev.args.curve,
    token = ev.args.token;
  assert.equal(
    await read(token, "LaunchToken", "totalSupply"),
    parseEther("1000000000"),
  );
  assert.equal(await read(token, "LaunchToken", "name"), "First token");
  assert.equal(
    (await read(curve, "LaunchCurve", "creator")).toLowerCase(),
    owner.toLowerCase(),
  );
  assert.equal(
    await read(curve, "LaunchCurve", "phantomQuote"),
    parseEther("3000") / usdPrice,
  );
  ok("gateway creates token/curve under 1.9M app gas with USD 3000 reference");
  assert.equal(await read(curve, "LaunchCurve", "realReserve"), 0n);
  assert.equal(await c.getBalance({ address: curve }), 0n);
  ok("virtual reserves are not real ETH");
  await assert.rejects(() =>
    write(logic, "Voidfun", "createToken", ["Bad", "BAD", ""]),
  );
  await assert.rejects(() =>
    write(curve, "LaunchCurve", "buy", [other, 0n], { value: 1n }),
  );
  await assert.rejects(() =>
    write(curve, "LaunchCurve", "sell", [owner, 1n, 0n]),
  );
  ok("direct implementation, forged-user buy and sell rejected");
  await assert.rejects(() =>
    write(token, "LaunchToken", "initialize", ["Again", "NO", owner, 100n]),
  );
  await assert.rejects(() =>
    write(curve, "LaunchCurve", "initialize", [
      token,
      owner,
      treasury,
      1n,
      1n,
      1n,
      0n,
      0n,
      2000n,
    ]),
  );
  ok("initialization cannot be repeated");
  const beforeTreasury = await c.getBalance({ address: treasury });
  const amount = parseEther(".1");
  const [tokens, spent, fee] = await read(curve, "LaunchCurve", "quoteBuy", [
    amount,
  ]);
  await execute("buy", [curve, tokens], amount, trader);
  assert.equal(await read(token, "LaunchToken", "balanceOf", [trader]), tokens);
  assert.equal(await read(curve, "LaunchCurve", "realReserve"), spent - fee);
  assert.equal(
    await read(curve, "LaunchCurve", "claimable", [treasury]),
    (fee * 3000n) / 10000n,
  );
  assert.equal(
    await read(curve, "LaunchCurve", "claimable", [owner]),
    fee - (fee * 3000n) / 10000n,
  );
  const toll = (await read(runtime, "DeedRuntime", "quote"))[0];
  assert.equal(
    (await c.getBalance({ address: treasury })) - beforeTreasury,
    (toll * 1000n) / 10000n,
  );
  ok("buy has 1% app fee and 30/70 split separate from Deed 90/10 toll");
  await assert.rejects(() => execute("sell", [curve, tokens, 0n], 0n, trader));
  await write(token, "LaunchToken", "approve", [curve, tokens], {
    account: trader,
  });
  const [out, sellFee] = await read(curve, "LaunchCurve", "quoteSell", [
    tokens,
  ]);
  assert(out < amount);
  await execute("sell", [curve, tokens, out], 0n, trader);
  const real = await read(curve, "LaunchCurve", "realReserve");
  assert(real <= 1n);
  const fees =
    (await read(curve, "LaunchCurve", "claimable", [owner])) +
    (await read(curve, "LaunchCurve", "claimable", [treasury]));
  assert.equal(await c.getBalance({ address: curve }), real + fees);
  ok("sell requires token approval and conserves reserves plus fees");
  await write(curve, "LaunchCurve", "claim", [other], { account: owner });
  assert.equal(await read(curve, "LaunchCurve", "claimable", [owner]), 0n);
  ok("creator claims only earned fees to chosen recipient");
  const launch2 = await execute("createToken", ["Second token", "SECOND", ""]);
  const curve2 = launch2.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: A("Voidfun").abi, ...l });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "Launched").args.curve;
  assert.equal(await read(curve2, "LaunchCurve", "realReserve"), 0n);
  ok("launch reserves are isolated");
  await assert.rejects(() => execute("createToken", ["", "BAD", ""]));
  await assert.rejects(() =>
    execute("buy", [curve, 2n ** 255n], amount, trader),
  );
  await assert.rejects(() =>
    execute("buy", [curve, 0n], amount, trader, { deadline: 1n }),
  );
  await assert.rejects(() =>
    execute("buy", [curve, 0n], amount, trader, { revision: 999n }),
  );
  await assert.rejects(() =>
    execute("buy", [curve, 0n], amount, trader, { maxToll: 0n }),
  );
  ok(
    "invalid metadata, slippage, expired calls, stale revision and toll over budget rejected",
  );
  const recipients = Array.from({ length: 10 }, (_, i) => ({
    wallet: "0x" + (1000 + i).toString(16).padStart(40, "0"),
    bps: 1000,
  }));
  await write(deed, "DeedCollection", "configure", [
    1n,
    parseEther(".01"),
    "",
    recipients,
  ]);
  const splitToll = (await read(runtime, "DeedRuntime", "quote"))[0];
  const beforeSplit = await Promise.all(
    recipients.map((r) => c.getBalance({ address: r.wallet })),
  );
  const treasuryBeforeCycles = await c.getBalance({ address: treasury });
  for (let round = 0; round < 5; round++) {
    const [quantity] = await read(curve2, "LaunchCurve", "quoteBuy", [amount]);
    await execute("buy", [curve2, quantity], amount, trader);
    const token2 = await read(curve2, "LaunchCurve", "token");
    await write(token2, "LaunchToken", "approve", [curve2, quantity], {
      account: trader,
    });
    const [minimum] = await read(curve2, "LaunchCurve", "quoteSell", [
      quantity,
    ]);
    await execute("sell", [curve2, quantity, minimum], 0n, trader);
    const balance = await c.getBalance({ address: curve2 });
    assert.equal(
      balance,
      (await read(curve2, "LaunchCurve", "realReserve")) +
        (await read(curve2, "LaunchCurve", "claimable", [owner])) +
        (await read(curve2, "LaunchCurve", "claimable", [treasury])),
    );
  }
  const ownerShare = splitToll - splitToll / 10n,
    each = ownerShare / 10n;
  for (let index = 0; index < 10; index++)
    assert.equal(
      (await c.getBalance({ address: recipients[index].wallet })) -
        beforeSplit[index],
      10n * (index === 9 ? ownerShare - each * 9n : each),
    );
  assert.equal(
    (await c.getBalance({ address: treasury })) - treasuryBeforeCycles,
    10n * (splitToll / 10n),
  );
  await write(deed, "DeedCollection", "configure", [
    1n,
    parseEther(".01"),
    "",
    [],
  ]);
  ok(
    "five buy/sell cycles conserve balances and distribute Deed toll to ten recipients without taxing approvals",
  );
  const secondFactory = await deploy("RuntimeFactory", [deed, price, treasury]);
  const badPub = await write(secondFactory, "RuntimeFactory", "publish", [
    1n,
    logic,
    "0x",
    keccak256(toHex("foreign")),
  ]);
  const badGateway = badPub.logs
    .flatMap((log) => {
      try {
        return [decodeEventLog({ abi: A("DeedRuntime").abi, ...log })];
      } catch {
        return [];
      }
    })
    .find((e) => e.eventName === "Published").args.gateway;
  const badRuntime = await read(secondFactory, "RuntimeFactory", "runtimeOf", [
    1n,
  ]);
  await c.request({ method: "evm_mine" });
  const [badToll, badRevision] = await read(badRuntime, "DeedRuntime", "quote");
  await assert.rejects(() =>
    write(
      badRuntime,
      "DeedRuntime",
      "execute",
      [
        {
          app: badGateway,
          data: encodeFunctionData({
            abi: A("Voidfun").abi,
            functionName: "createToken",
            args: ["Wrong", "BAD", ""],
          }),
          revision: badRevision,
          maxToll: badToll,
          appValue: 0n,
          appGas: 1900000n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        },
      ],
      { value: badToll, gas: 3000000n },
    ),
  );
  ok(
    "a gateway from another factory cannot impersonate the configured protocol",
  );
  const remaining = await read(curve, "LaunchCurve", "remainingCost");
  const [finalTokens, finalSpent] = await read(
    curve,
    "LaunchCurve",
    "quoteBuy",
    [remaining + parseEther("1")],
  );
  const traderBeforeFinal = await c.getBalance({ address: trader });
  const finalReceipt = await execute(
    "buy",
    [curve, finalTokens],
    remaining + parseEther("1"),
    trader,
  );
  const traderAfterFinal = await c.getBalance({ address: trader });
  assert.equal(
    traderBeforeFinal - traderAfterFinal,
    finalSpent + toll + finalReceipt.gasUsed * finalReceipt.effectiveGasPrice,
  );
  assert.equal(
    await c.getBalance({ address: curve }),
    (await read(curve, "LaunchCurve", "realReserve")) +
      (await read(curve, "LaunchCurve", "claimable", [owner])) +
      (await read(curve, "LaunchCurve", "claimable", [treasury])),
  );
  assert.equal(await read(curve, "LaunchCurve", "complete"), true);
  assert.equal(
    await read(curve, "LaunchCurve", "trackedTokens"),
    await read(curve, "LaunchCurve", "reservedTokens"),
  );
  await assert.rejects(() => execute("buy", [curve, 0n], 1n, trader));
  await assert.rejects(() => execute("sell", [curve, 1n, 0n], 0n, trader));
  ok(
    "completion clips/refunds excess, retains 20% tokens and closes trading without a pool",
  );
  const earned = await read(curve, "LaunchCurve", "claimable", [treasury]);
  await assert.rejects(() =>
    write(curve, "LaunchCurve", "claim", [other], { account: other }),
  );
  for (let i = 0; i < 25; i++)
    await execute("createToken", ["Pagination " + i, "PAGE", ""]);
  await write(runtime, "DeedRuntime", "remove", [gateway]);
  await write(curve, "LaunchCurve", "claim", [treasury], { account: treasury });
  assert(earned > 0n);
  assert.equal(await read(curve, "LaunchCurve", "claimable", [treasury]), 0n);
  ok("earned-fee claims remain available after unregister");
  const localConfig = {
    chainId: testChainId,
    rpc: "http://127.0.0.1:8567",
    runtimeFactory: factory,
    runtime,
    gateway,
    implementation: logic,
    price,
    deedId: "1",
    deploymentBlock: String(pub.blockNumber),
  };
  const market = await loadMarket(localConfig, { curve });
  assert.equal(market.rows.length, 24);
  assert.equal(market.count, 27);
  assert.equal(market.hasMore, true);
  assert(!market.rows.some((row) => row.address === curve));
  assert.equal(market.selected.address, curve);
  assert.equal(market.published, false);
  assert.equal(market.ethUsd, Number(usdPrice));
  const older = await loadMarket(localConfig, { offset: 24 });
  assert.equal(older.rows.length, 3);
  assert.equal(older.hasMore, false);
  assert(
    !older.rows.some((row) =>
      market.rows.some((latest) => latest.address === row.address),
    ),
  );
  assert.equal((await loadMarket(localConfig, { offset: 48 })).rows.length, 0);
  await assert.rejects(() => loadMarket(localConfig, { curve: other }));
  const history = await loadHistory(localConfig, curve);
  assert(history.logs.length >= 3);
  assert(history.logs.every((log) => log.time > 0));
  await assert.rejects(() => loadHistory(localConfig, other));
  ok(
    "actual market API reads, deep links, pagination, removed registration and canonical history",
  );
  await write(deed, "DeedCollection", "mint", [], {
    account: other,
    value: parseEther(".001"),
  });
  const publication2 = await write(factory, "RuntimeFactory", "publish", [
    2n,
    logic,
    "0x",
    keccak256(toHex("second-deed")),
  ]);
  const gateway2 = publication2.logs
    .flatMap((log) => {
      try {
        return [decodeEventLog({ abi: A("DeedRuntime").abi, ...log })];
      } catch {
        return [];
      }
    })
    .find((event) => event.eventName === "Published").args.gateway;
  const runtime2 = await read(factory, "RuntimeFactory", "runtimeOf", [2n]);
  assert.notEqual(runtime2, runtime);
  await c.request({ method: "evm_mine" });
  const [toll2, revision2] = await read(runtime2, "DeedRuntime", "quote");
  const call2 = async (fn, args) =>
    write(
      runtime2,
      "DeedRuntime",
      "execute",
      [
        {
          app: gateway2,
          data: encodeFunctionData({
            abi: A("Voidfun").abi,
            functionName: fn,
            args,
          }),
          revision: revision2,
          maxToll: toll2,
          appValue: 0n,
          appGas: 1900000n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        },
      ],
      { account: trader, value: toll2, gas: 3000000n },
    );
  await call2("createToken", ["Another Deed", "NEW", ""]);
  await assert.rejects(() => call2("sell", [curve2, 1n, 0n]));
  const secondMarket = await loadMarket({
    ...localConfig,
    gateway: gateway2,
    runtime: runtime2,
    deedId: "2",
  });
  assert.equal(secondMarket.count, 1);
  assert.equal(
    secondMarket.rows[0].creator.toLowerCase(),
    trader.toLowerCase(),
  );
  assert.equal((await loadMarket(localConfig)).count, 27);
  ok(
    "one implementation supports separate Deed runtimes without crossing launch lists or trading authority",
  );
  fs.writeFileSync(
    `verification/local-tests-${testChainId}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed: checks,
        chain: "local Anvil",
        mainnet: false,
      },
      null,
      2,
    ),
  );
  console.log("All", checks, "functional/accounting checks passed.");
} finally {
  processLocal.kill();
}
