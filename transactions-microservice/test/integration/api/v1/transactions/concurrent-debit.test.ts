/**
 * E2E — Debit concurrency (Double-Spend)
 *
 * The goal is to validate that the current system does not allow double-spend in scenarios
 * of high concurrency.
 */
import orchestrator from "../../../../orchestrator";

const USER_ID = "test-user-concurrent-debit";

beforeAll(async () => {
    await orchestrator.waitForAllServices();
});

beforeEach(async () => {
    await orchestrator.cleanDatabase();
});

// Local helpers
async function seedCredit(amount: number): Promise<void> {
    const token = orchestrator.createAuthToken(USER_ID);
    const response = await orchestrator.postTransaction(token, {
        amount,
        type: "CREDIT",
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to seed credit: ${response.status} — ${body}`);
    }
}

// Scenario 1: 10 concurrent debits with enough balance for only 1
describe("POST /transactions — Debit concurrency", () => {
    it("should allow only 1 debit when there is enough balance for only 1 (10 concurrent requests)", async () => {
        // Initial balance: 10.000 cents (R$ 100,00)
        await seedCredit(10000);

        const token = orchestrator.createAuthToken(USER_ID);
        const CONCURRENCY = 10;

        // Send 10 debits of R$ 100 at the same time — only 1 should pass
        const responses = await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                orchestrator.postTransaction(token, {
                    amount: 10000,
                    type: "DEBIT",
                }),
            ),
        );

        const statuses = responses.map((r) => r.status);
        const successes = statuses.filter((s) => s === 200);
        const failures = statuses.filter((s) => s === 400);

        // Exactly 1 should have passed
        expect(successes).toHaveLength(1);
        // The other 9 should have received INSUFFICIENT_BALANCE
        expect(failures).toHaveLength(CONCURRENCY - 1);
    });

    // Scenario 2: the balance should never be negative after concurrent debits
    it("balance should never be negative after multiple concurrent debits", async () => {
        // Balance: R$ 100,00 — debits of R$ 60,00
        await seedCredit(10000);

        const token = orchestrator.createAuthToken(USER_ID);
        const CONCURRENCY = 20;

        await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                orchestrator.postTransaction(token, {
                    amount: 6000,
                    type: "DEBIT",
                }),
            ),
        );

        const balance = await orchestrator.getBalance(token);

        // Balance should be R$ 40,00   
        expect(balance.amount).toBe(4000);
    });
});

describe("POST /transactions — Credit concurrency", () => {
    it("should allow multiple credits without race conditions", async () => {
        const token = orchestrator.createAuthToken(USER_ID);
        const CONCURRENCY = 100;

        await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                orchestrator.postTransaction(token, {
                    amount: 10000,
                    type: "CREDIT",
                }),
            ),
        );

        const balance = await orchestrator.getBalance(token);

        expect(balance.amount).toBe(10000 * CONCURRENCY);
    });
});
