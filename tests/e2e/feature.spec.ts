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

test("a correct answer on the guesser increments the score visible on the HOST peer", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await a.waitForTimeout(500);

    // Alice authors a quiz whose correct answer is option B (index 1).
    await a.getByPlaceholder("your question").fill("2+2 = ?");
    await a.getByPlaceholder("option A").fill("3");
    await a.getByPlaceholder("option B").fill("4");
    await a.getByPlaceholder("option C").fill("5");
    await a.getByPlaceholder("option D").fill("6");
    await a.locator('input[type="radio"][value="1"]').check();
    await a.getByRole("button", { name: "submit my quiz", exact: true }).click();
    await b.waitForTimeout(400);

    // Bob authors a quiz whose correct answer is option A (index 0).
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

    // Both peers must agree on who is hosting this slot.
    const hostA = (await a.locator(".quiz-host-name").innerText()).trim();
    const hostB = (await b.locator(".quiz-host-name").innerText()).trim();
    if (hostA !== hostB) throw new Error("host disagree: " + hostA + " vs " + hostB);

    // The guesser is the NON-hosting peer; the host's own quiz holds the
    // correct answer. Click that quiz's correct option on the guesser.
    const hostIsAlice = hostA === "alice";
    const guesser = hostIsAlice ? b : a;
    const host = hostIsAlice ? a : b;
    const guesserName = hostIsAlice ? "bob" : "alice";
    // Alice's quiz → correct is B; Bob's quiz → correct is A.
    const correctLetter = hostIsAlice ? "answer B" : "answer A";
    await guesser.getByRole("button", { name: correctLetter, exact: true }).click();

    // ── Cross-peer assertion: the guesser's correct answer increments the
    // shared `scores` Y.Map. The HOST peer (who never answered) must now see
    // the guesser's score as 1 on its own leaderboard. This proves both the
    // answer event log AND the score Y.Map crossed the mesh to the opposite
    // peer.
    const guesserRow = host.locator(".mesh-leaderboard-row").filter({ hasText: guesserName });
    await expect(guesserRow.locator(".mesh-leaderboard-score")).toHaveText("1");
  } finally {
    await cleanup();
  }
});
