/**
 * E2E — Race Conditions and Idempotency
 */
import orchestrator from "../../../../orchestrator";

const USER_ID = "test-user-idempotency";

beforeAll(async () => {
    await orchestrator.waitForAllServices();
});

beforeEach(async () => {
    await orchestrator.cleanDatabase();
});

// Scenario 3: sequential idempotency (basic behavior — should PASS)
describe("POST /transactions — Idempotency with Concurrency", () => {
    it("should create only 1 transaction when the same key is sent sequentially", async () => {
        const token = orchestrator.createAuthToken(USER_ID);
        const idempotencyKey = `seq-key-${Date.now()}`;

        // 1st request — should create the transaction
        const first = await orchestrator.postTransaction(
            token,
            { amount: 1000, type: "CREDIT" },
            idempotencyKey,
        );
        expect(first.status).toBe(200);
        const firstBody = await first.json();

        // 2nd request (sequential) with the same key — should return 200 as well
        const second = await orchestrator.postTransaction(
            token,
            { amount: 1000, type: "CREDIT" },
            idempotencyKey,
        );
        expect(second.status).toBe(200);
        const secondBody = await second.json();

        // The body of the duplicate response should contain the data of the original transaction
        expect(secondBody).toBeDefined();
        expect(secondBody.id).toBe(firstBody.id);

        // The balance should be 1000 (Only processed once)
        const balance = await orchestrator.getBalance(token);
        expect(balance.amount).toBe(1000);
    });

    // Scenario 4: 5 parallel requests with the same key
    it("should create only 1 transaction when the same key is sent in parallel (race condition)", async () => {
        const token = orchestrator.createAuthToken(USER_ID);
        const idempotencyKey = `parallel-key-${Date.now()}`;
        const CONCURRENCY = 5;

        // Send 5 parallel requests with the same idempotency key
        const responses = await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                orchestrator.postTransaction(
                    token,
                    { amount: 1500, type: "CREDIT" },
                    idempotencyKey,
                ),
            ),
        );

        const statuses = responses.map((r) => r.status);
        const successes = statuses.filter((s) => s === 200);

        // All requests should have the same status as the first one.
        // The server returns the same status for all requests but only the first one should create the transaction
        expect(successes).toHaveLength(CONCURRENCY);

        // The balance should reflect exactly 1 credit of 1500 cents
        const balance = await orchestrator.getBalance(token);
        expect(balance.amount).toBe(1500);
    });

    // Scenario 5: distinct keys should not interfere with each other
    it("should process normally parallel requests with distinct keys", async () => {
        const token = orchestrator.createAuthToken(USER_ID);
        const CONCURRENCY = 5;

        // 5 requests simultâneas, cada uma com uma chave DIFERENTE
        const responses = await Promise.all(
            Array.from({ length: CONCURRENCY }, (_, i) =>
                orchestrator.postTransaction(
                    token,
                    { amount: 1000, type: "CREDIT" },
                    // Idempotency key with different value for each request
                    `distinct-key-${Date.now()}-${i}`,
                ),
            ),
        );

        const statuses = responses.map((r) => r.status);

        // All should pass — different keys = independent transactions
        expect(statuses.every((s) => s === 200)).toBe(true);

        // Balance should be 5 * 1.000 = 5.000 cents
        const balance = await orchestrator.getBalance(token);
        expect(balance.amount).toBe(5000);
    });
});
