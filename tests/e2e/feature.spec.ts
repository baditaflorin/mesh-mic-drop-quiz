import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("alice submits quiz, both peers see it, bob answers, answer syncs", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await a.waitForTimeout(500);

    await a.getByPlaceholder("your question").fill("2+2 = ?");
    await a.getByPlaceholder("option A").fill("3");
    await a.getByPlaceholder("option B").fill("4");
    await a.getByPlaceholder("option C").fill("5");
    await a.getByPlaceholder("option D").fill("6");
    await a.locator('input[type="radio"][value="1"]').check();
    await a.getByRole("button", { name: "submit my quiz", exact: true }).click();
    await b.waitForTimeout(400);

    await b.getByPlaceholder("your question").fill("Pick A");
    await b.getByPlaceholder("option A").fill("A");
    await b.getByPlaceholder("option B").fill("B");
    await b.getByPlaceholder("option C").fill("C");
    await b.getByPlaceholder("option D").fill("D");
    await b.locator('input[type="radio"][value="0"]').check();
    await b.getByRole("button", { name: "submit my quiz", exact: true }).click();
    await a.waitForTimeout(400);

    await a.getByRole("button", { name: "start hosting", exact: true }).click();
    await b.waitForTimeout(500);

    const hostA = (await a.locator(".quiz-host-name").innerText()).trim();
    const hostB = (await b.locator(".quiz-host-name").innerText()).trim();
    if (hostA !== hostB) throw new Error("host disagree: " + hostA + " vs " + hostB);

    const guesser = hostA === "alice" ? b : a;
    await guesser.getByRole("button", { name: "answer B", exact: true }).click();
    const host = hostA === "alice" ? a : b;
    await expect(host.locator(".quiz-answer-count")).toContainText("1");
  } finally {
    await cleanup();
  }
});
