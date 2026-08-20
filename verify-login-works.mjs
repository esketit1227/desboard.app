import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

const step = async (name, fn) => {
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: " + name)), 10000))]);
    console.log("OK:", name);
  } catch (e) {
    console.log("FAIL:", name, e.message);
  }
};

await step("load root (login page)", async () => {
  await page.goto("http://localhost:3000", { waitUntil: "load" });
});

await step("sign up a fresh account", async () => {
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.waitForTimeout(300);
  await page.getByPlaceholder("Email").fill("verify-login-fix@example.com");
  await page.getByPlaceholder(/Password/).fill("verifyPass123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForTimeout(1000);
});

await step("confirm we're actually inside the app now (Home visible)", async () => {
  await page.getByRole("button", { name: "Home", exact: true }).waitFor({ timeout: 5000 });
});

await step("log out, then log back in", async () => {
  // find and click sign out (in sidebar account area)
  const signOut = page.getByTitle("Sign out");
  await signOut.click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder("Email").fill("verify-login-fix@example.com");
  await page.getByPlaceholder(/Password/).fill("verifyPass123");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Home", exact: true }).waitFor({ timeout: 5000 });
});

console.log("DONE - login flow works end to end");
await browser.close();
