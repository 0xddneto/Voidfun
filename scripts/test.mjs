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
const testChainId=Number(process.env.TEST_CHAIN_ID??31337);
const testChain={...foundry,id:testChainId};
const usdPrice=testChainId===5042002?1n:2000n;
const exe =
  process.platform === "win32"
    ? "node_modules/@foundry-rs/anvil-win32-amd64/bin/anvil.exe"
    : "anvil";
const processLocal = spawn(exe, ["--port", "8567", "--silent", "--chain-id", String(testChainId), "--balance", "1000000"], {
  stdio: "ignore",
  windowsHide: true,
});
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
  const deed = await deploy("Deed", [treasury, ""]);
  await write(deed, "Deed", "mint", [], { value: parseEther(".001") });
  const feed = await deploy("TestnetPriceFeed", [owner]);
  await write(feed, "TestnetPriceFeed", "publish", [usdPrice * 10n ** 8n]);
  const price = await deploy("NativePrice", [feed, 7200n]);
  const runtime = await deploy("Runtime", [deed, price, treasury]);
  const tokenLogic = await deploy("LaunchToken"),
    curveLogic = await deploy("LaunchCurve");
  const logic = await deploy("Voidfun", [
    runtime,
    price,
    treasury,
    tokenLogic,
    curveLogic,
    100n,
    3000n,
    0n,
  ]);
  const pub = await write(runtime, "Runtime", "publish", [
    1n,
    logic,
    "0x",
    keccak256(toHex("test")),
  ]);
  const gateway = decodeEventLog({
    abi: A("Runtime").abi,
    ...pub.logs.find((l) => l.address.toLowerCase() === runtime.toLowerCase()),
  }).args.app;
  await c.request({ method: "evm_mine" });
  async function execute(fn, args = [], value = 0n, account = owner) {
    const [toll, revision] = await read(runtime, "Runtime", "quote", [1n]);
    const data = encodeFunctionData({
      abi: A("Voidfun").abi,
      functionName: fn,
      args,
    });
    return write(
      runtime,
      "Runtime",
      "execute",
      [
        gateway,
        data,
        revision,
        toll,
        value,
        1900000n,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
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
    parseEther("3000")/usdPrice,
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
  const toll = (await read(runtime, "Runtime", "quote", [1n]))[0];
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
  await write(runtime, "Runtime", "unregister", [gateway]);
  await write(curve, "LaunchCurve", "claim", [treasury], { account: treasury });
  assert(earned > 0n);
  assert.equal(await read(curve, "LaunchCurve", "claimable", [treasury]), 0n);
  ok("earned-fee claims remain available after unregister");
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
