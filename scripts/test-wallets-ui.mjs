import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
let passed = 0;
const address = "0xA7a12A1D7000e40Ecc18a62Af456791b89cB2770";
const open = async (page) => {
  await page.goto("http://127.0.0.1:3050");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
};
async function scenario(name, fn) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fn(page);
    assert.deepEqual(errors, []);
    console.log("PASS", name);
    passed++;
  } finally {
    await context.close();
  }
}
try {
  await scenario(
    "No extension: chooser and explicit fallback guidance",
    async (page) => {
      await open(page);
      await expect(
        page.getByText("No browser wallet detected.", { exact: false }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "WalletConnect Mobile / QR code" })
        .click();
      await expect(page.getByRole("alert")).toContainText("not available yet");
      await page
        .getByRole("button", { name: "Close wallet selection" })
        .click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    },
  );
  await scenario(
    "Multiple wallets: chosen provider signs, accounts and disconnect follow it",
    async (page) => {
      await page.addInitScript(
        ({ address }) => {
          window.calls = [];
          window.providers = {};
          function provider(name) {
            const events = {};
            let chain = "0xb626";
            const p = {
              request: async ({ method, params }) => {
                window.calls.push(name + ":" + method);
                if (
                  method === "eth_requestAccounts" ||
                  method === "eth_accounts"
                )
                  return [address];
                if (method === "eth_chainId") return chain;
                if (method === "wallet_switchEthereumChain")
                  chain = params[0].chainId;
                return null;
              },
              on: (name, fn) => (events[name] = fn),
              removeListener: (name) => delete events[name],
              emit: (name, value) => events[name]?.(value),
            };
            window.providers[name] = p;
            return p;
          }
          const rabby = provider("Rabby"),
            brave = provider("Brave");
          window.ethereum = brave;
          window.addEventListener("eip6963:requestProvider", () => {
            for (const [name, p] of [
              ["Rabby", rabby],
              ["Brave Wallet", brave],
            ])
              window.dispatchEvent(
                new CustomEvent("eip6963:announceProvider", {
                  detail: { info: { uuid: name, name }, provider: p },
                }),
              );
          });
        },
        { address },
      );
      await open(page);
      await page.getByRole("button", { name: "Rabby ↗" }).click();
      await expect(
        page.getByRole("button", { name: "0xA7a1…2770" }),
      ).toBeVisible();
      await page.evaluate(async (address) => {
        const { createNetworkContext, networks } = await import("/src/web3.js");
        await createNetworkContext(networks[0]).wallet(address);
      }, address);
      const calls = await page.evaluate(() => window.calls);
      assert(calls.includes("Rabby:wallet_switchEthereumChain"));
      assert(!calls.some((x) => x.startsWith("Brave:")));
      await page.evaluate(() =>
        window.providers.Rabby.emit("accountsChanged", [
          "0x1111111111111111111111111111111111111111",
        ]),
      );
      await expect(
        page.getByRole("button", { name: "0x1111…1111" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "0x1111…1111" }).click();
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeVisible();
    },
  );
  await scenario(
    "Legacy provider and rejected/pending wallet errors remain retryable",
    async (page) => {
      await page.addInitScript(
        ({ address }) => {
          window.mode = "reject";
          window.ethereum = {
            request: async () => {
              if (window.mode === "reject") throw { code: 4001 };
              if (window.mode === "pending") throw { code: -32002 };
              return [address];
            },
          };
        },
        { address },
      );
      await open(page);
      await page.getByRole("button", { name: "Browser wallet ↗" }).click();
      await expect(page.getByRole("alert")).toContainText(
        "Connection declined",
      );
      await page.evaluate(() => (window.mode = "pending"));
      await page.getByRole("button", { name: "Browser wallet ↗" }).click();
      await expect(page.getByRole("alert")).toContainText("already open");
      await page.evaluate(() => (window.mode = "success"));
      await page.getByRole("button", { name: "Browser wallet ↗" }).click();
      await expect(
        page.getByRole("button", { name: "0xA7a1…2770" }),
      ).toBeVisible();
    },
  );
  await scenario(
    "Pending connection visible; cancelled approval cannot connect later",
    async (page) => {
      await page.addInitScript(() => {
        window.ethereum = {
          request: () => new Promise((resolve) => (window.approve = resolve)),
        };
      });
      await open(page);
      await page.getByRole("button", { name: "Browser wallet ↗" }).click();
      await expect(page.getByRole("dialog").getByRole("status")).toContainText(
        "Waiting for",
      );
      await page
        .getByRole("button", { name: "Close wallet selection" })
        .click();
      await page.evaluate((address) => window.approve([address]), address);
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeVisible();
    },
  );
  await scenario(
    "WalletConnect QR UI, cancellation and approval (mock relay)",
    async (page) => {
      await page.route("**/src/walletconnect.js*", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: `export const walletConnectConfigured=true;export async function mobileProvider(onUri,signal){return{provider:{isWalletConnect:true,request:async()=>[],enable:()=>{onUri('wc:local-ui-test@2?relay-protocol=irn&symKey='+'a'.repeat(64));return new Promise(resolve=>window.approveMobile=()=>resolve(['${address}']));}},cleanup:()=>{}};}`,
        }),
      );
      await open(page);
      await page
        .getByRole("button", { name: "WalletConnect Mobile / QR code" })
        .click();
      await expect(
        page.getByAltText("WalletConnect connection QR code"),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.evaluate(() => window.approveMobile());
      await expect(
        page.getByRole("button", { name: "0xA7a1…2770" }),
      ).toBeVisible();
    },
  );
  console.log(
    "All",
    passed,
    "wallet UI scenarios passed. QR relay test uses a mock, not a real WalletConnect session.",
  );
} finally {
  await browser.close();
}
