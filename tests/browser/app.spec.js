import { test, expect } from "@playwright/test";
const networks = [
  [46630, "Robinhood Testnet", "ETH"],
  [11155111, "Ethereum Sepolia", "ETH"],
  [84532, "Base Sepolia", "ETH"],
  [763373, "Ink Sepolia", "ETH"],
  [5042002, "Arc Testnet", "USDC"],
];
test.beforeEach(async ({ page }) => {
  await page.route("**/api/market?**", (route) =>
    route.fulfill({
      json: {
        ready: true,
        published: false,
        terms: { fee: "0", trade: "100", share: "3000" },
        rows: [],
        hasMore: false,
        generatedAt: new Date().toISOString(),
      },
    }),
  );
});
for (const [id, name, symbol] of networks)
  test(`manual publication boundary and currency: ${name}`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?chain=" + id);
    await expect(page.getByLabel("Execution network")).toHaveValue(String(id));
    await expect(
      page.getByText("Publish Voidfun manually on", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Create a token", exact: true })
      .click();
    await expect(page.getByText("0 " + symbol, { exact: true })).toBeVisible();
    await expect(page.getByText("1%", { exact: true })).toBeVisible();
    await expect(page.locator("form button.primary")).toBeDisabled();
    await expect(
      page.getByText("Awaiting manual publication", { exact: false }),
    ).toBeVisible();
    assertNoErrors(errors);
  });
function assertNoErrors(errors) {
  expect(errors).toEqual([]);
}
test("network selection changes the page and URL before a wallet is connected", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Execution network").selectOption("5042002");
  await expect(page).toHaveURL(/chain=5042002/);
  await expect(page.getByText("An open start on Arc Testnet.")).toBeVisible();
});
test("mobile layout, wallet chooser and empty search remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.getByLabel("Search tokens").fill("no-such-token");
  await expect(page.getByText("No matching tokens.")).toBeVisible();
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("EIP-6963 connection, rejected network switch, account change and disconnect", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const listeners = new Map();
    let chain = "0xb626";
    const provider = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts")
          return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") {
          if (params[0].chainId === "0x14a34")
            throw { code: 4001, message: "Network switch declined" };
          chain = params[0].chainId;
          return null;
        }
      },
      on: (event, fn) => listeners.set(event, fn),
      removeListener: (event) => listeners.delete(event),
    };
    window.addEventListener("eip6963:requestProvider", () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: { uuid: "test-wallet", name: "Test wallet" },
            provider,
          },
        }),
      ),
    );
    window.testAccountsChanged = () =>
      listeners.get("accountsChanged")?.([
        "0x2222222222222222222222222222222222222222",
      ]);
    window.testDisconnect = () => listeners.get("disconnect")?.();
  });
  await page.goto("/?chain=46630");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Test wallet" }).click();
  await expect(
    page.getByRole("button", { name: "0x1111…1111", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Execution network").selectOption("84532");
  await expect(page.getByRole("status")).toContainText(
    "Network switch declined",
  );
  await expect(page.getByLabel("Execution network")).toHaveValue("46630");
  await page.getByLabel("Execution network").selectOption("5042002");
  await expect(page.getByLabel("Execution network")).toHaveValue("5042002");
  await page.evaluate(() => window.testAccountsChanged());
  await expect(
    page.getByRole("button", { name: "0x2222…2222", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.testDisconnect());
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeVisible();
});
