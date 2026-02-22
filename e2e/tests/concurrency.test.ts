/**
 * E2E — Concurrency scenarios (transactions-microservice)
 *
 * These tests validate that the transactions-microservice handles
 * high-concurrency correctly when BOTH microservices are running.
 * Unlike the integration tests in transactions-microservice/test/,
 * tokens here come from REAL logins on the users-microservice.
 *
 * Prerequisites: both services must be running (`docker compose up -d`).
 */
import orchestrator from "../orchestrator";

// Unique email per run — no DB cleanup needed
const TIMESTAMP = Date.now();
const DEBIT_USER_EMAIL = `concurrent-debit-${TIMESTAMP}@e2e.test`;
const CREDIT_USER_EMAIL = `concurrent-credit-${TIMESTAMP}@e2e.test`;
const PASSWORD = "password123";

let debitToken: string;
let creditToken: string;

beforeAll(async () => {
    await orchestrator.waitForAllServices();

    // Create users and login once for the whole suite
    await orchestrator.createUser(DEBIT_USER_EMAIL, PASSWORD, "Debit", "User");
    await orchestrator.createUser(CREDIT_USER_EMAIL, PASSWORD, "Credit", "User");

    debitToken = await orchestrator.login(DEBIT_USER_EMAIL, PASSWORD);
    creditToken = await orchestrator.login(CREDIT_USER_EMAIL, PASSWORD);
});

// helper: seed initial balance for a user
async function seedCredit(token: string, amount: number): Promise<void> {
    const response = await orchestrator.postTransaction(token, {
        amount,
        type: "CREDIT",
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to seed credit: ${response.status} — ${body}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEBIT concurrency (double-spend prevention)
// ─────────────────────────────────────────────────────────────────────────────
describe("E2E — Debit concurrency (double-spend prevention)", () => {
    it("should allow only 1 debit when there is enough balance for only 1 (10 concurrent requests)", async () => {
        // Initial balance: R$100,00
        await seedCredit(debitToken, 10_000);

        const CONCURRENCY = 10;

        // 10 simultaneous debits of R$100 — only 1 should pass
        const responses = await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                orchestrator.postTransaction(debitToken, {
                    amount: 10_000,
                    type: "DEBIT",
                }),
            ),
        );

        const statuses = responses.map((r) => r.status);
        const successes = statuses.filter((s) => s === 200);
        const failures = statuses.filter((s) => s === 400);

        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(CONCURRENCY - 1);

        const balance = await orchestrator.getBalance(debitToken);
        expect(balance.amount).toBe(0);
    });

    it("balance should never go negative after concurrent debits", async () => {
        // Seed R$100, attempt 20 concurrent debits of R$60
        await seedCredit(debitToken, 10_000);

        const CONCURRENCY = 20;

        await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                orchestrator.postTransaction(debitToken, {
                    amount: 6_000,
                    type: "DEBIT",
                }),
            ),
        );

        const balance = await orchestrator.getBalance(debitToken);

        // Only 1 debit of 6000 can succeed (10000 - 6000 = 4000).
        // The second would require 12000 total which exceeds the 10000 balance.
        expect(balance.amount).toBeGreaterThanOrEqual(0);
        // Exactly R$40,00: first debit passes, all others fail
        expect(balance.amount).toBe(4_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT concurrency (no race conditions on additive operations)
// ─────────────────────────────────────────────────────────────────────────────
describe("E2E — Credit concurrency (no lost updates)", () => {
    it("should apply all concurrent credits without losing any", async () => {
        const CONCURRENCY = 50;
        const CREDIT_AMOUNT = 1_000; // R$10,00 each

        await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                orchestrator.postTransaction(creditToken, {
                    amount: CREDIT_AMOUNT,
                    type: "CREDIT",
                }),
            ),
        );

        const balance = await orchestrator.getBalance(creditToken);

        // Every credit must be recorded — no lost updates
        expect(balance.amount).toBe(CONCURRENCY * CREDIT_AMOUNT); // 50_000
    });
});
