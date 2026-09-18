import fs from "node:fs";
import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
const id = Number(process.argv[2] ?? 46630);
const d = JSON.parse(fs.readFileSync("src/networks.json")).find(
  (n) => n.chainId === id,
);
if (!d?.implementation) throw Error("Implementation missing");
const manifest = JSON.parse(fs.readFileSync(`deployments/${id}.json`));
const c = createPublicClient({ transport: http(d.rpc) });
assert.equal(await c.getChainId(), id);
const result = { chainId: id, at: new Date().toISOString(), contracts: [] };
for (const name of [
  "LaunchToken",
  "LaunchCurve",
  "Voidfun",
  ...(d.gateway ? ["AppGateway"] : []),
]) {
  const a = JSON.parse(fs.readFileSync("artifacts/" + name + ".json")),
    address =
      name === "AppGateway" ? d.gateway : manifest.transactions[name].address;
  let expected = a.evm.deployedBytecode.object,
    actual = (await c.getCode({ address })).slice(2);
  for (const ranges of Object.values(
    a.evm.deployedBytecode.immutableReferences,
  ))
    for (const { start, length } of ranges) {
      expected =
        expected.slice(0, start * 2) +
        "0".repeat(length * 2) +
        expected.slice((start + length) * 2);
      actual =
        actual.slice(0, start * 2) +
        "0".repeat(length * 2) +
        actual.slice((start + length) * 2);
    }
  {
    const strip = (code) =>
      code.slice(0, -(parseInt(code.slice(-4), 16) + 2) * 2);
    actual = strip(actual);
    expected = strip(expected);
  }
  assert(actual === expected, name + " runtime bytecode mismatch");
  result.contracts.push({
    name,
    address,
    bytecodeMatches: true,
    comparison:
      name === "AppGateway"
        ? "executable code excluding immutable values and source-path metadata"
        : "executable runtime excluding metadata and separately checked immutable values",
  });
}
const read = (address, name, functionName) =>
  c.readContract({
    address,
    abi: JSON.parse(fs.readFileSync("artifacts/" + name + ".json")).abi,
    functionName,
  });
if (d.gateway) {
  assert.equal(
    (await read(d.gateway, "AppGateway", "implementation")).toLowerCase(),
    d.implementation.toLowerCase(),
  );
  assert.equal(
    (await read(d.gateway, "AppGateway", "runtime")).toLowerCase(),
    d.runtime.toLowerCase(),
  );
  assert.equal(await read(d.gateway, "AppGateway", "deedId"), 1n);
}
assert.equal(
  (await read(d.implementation, "Voidfun", "RUNTIME")).toLowerCase(),
  d.runtime.toLowerCase(),
);
assert.equal(
  (await read(d.implementation, "Voidfun", "PRICE")).toLowerCase(),
  d.price.toLowerCase(),
);
assert.equal(await read(d.runtime, "Runtime", "PROTOCOL_BPS"), 1000n);
for (const [field, name] of [
  ["TOKEN_LOGIC", "LaunchToken"],
  ["CURVE_LOGIC", "LaunchCurve"],
])
  assert.equal(
    (await read(d.implementation, "Voidfun", field)).toLowerCase(),
    manifest.transactions[name].address.toLowerCase(),
  );
assert.equal(await read(d.implementation, "Voidfun", "TRADE_FEE_BPS"), 100n);
assert.equal(
  await read(d.implementation, "Voidfun", "PROTOCOL_SHARE_BPS"),
  3000n,
);
assert.equal(await read(d.implementation, "Voidfun", "CREATE_FEE"), 0n);
assert.equal(
  (await read(d.implementation, "Voidfun", "TREASURY")).toLowerCase(),
  manifest.terms.treasury,
);
fs.writeFileSync(
  `verification/deployed-code-${id}.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  "PASS deployed bytecodes, Runtime 90/10 and separate app fee configuration verified.",
);
