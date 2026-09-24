import fs from "node:fs";
import solc from "solc";
const sources = Object.fromEntries(
  fs
    .readdirSync("contracts")
    .filter((f) => f.endsWith(".sol"))
    .map((f) => [
      "contracts/" + f,
      {
        content: fs
          .readFileSync("contracts/" + f, "utf8")
          .replace(/\r\n/g, "\n"),
      },
    ]),
);
for (const f of fs
    .readdirSync("tests/protocol/current")
  .filter((f) => f.endsWith(".sol")))
  sources["tests/protocol/current/" + f] = {
    content: fs
      .readFileSync("tests/protocol/current/" + f, "utf8")
      .replace(/\r\n/g, "\n"),
  };
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "cancun",
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.immutableReferences",
          "metadata",
        ],
      },
    },
  },
};
const out = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (p) => {
      try {
        const content = fs.readFileSync("node_modules/" + p, "utf8");
        input.sources[p] = { content };
        return { contents: content };
      } catch {
        return { error: p };
      }
    },
  }),
);
for (const e of out.errors ?? [])
  if (e.severity === "error") console.error(e.formattedMessage);
if (out.errors?.some((e) => e.severity === "error")) process.exit(1);
fs.mkdirSync("artifacts", { recursive: true });
const abi = {};
for (const [p, cs] of Object.entries(out.contracts))
  if (p.startsWith("contracts/") || p.startsWith("tests/protocol/"))
    for (const [n, c] of Object.entries(cs)) {
      abi[n] = c.abi;
      fs.writeFileSync("artifacts/" + n + ".json", JSON.stringify(c));
      console.log(n, c.evm.deployedBytecode.object.length / 2, "bytes");
    }
fs.writeFileSync("artifacts/compiler-input.json", JSON.stringify(input));
fs.writeFileSync("src/abis.json", JSON.stringify(abi));
