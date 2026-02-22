/**
 * E2E — Full cross-service flow
 *
 * This test exercises the complete lifecycle involving BOTH microservices:
 *   1. Create two real users  (users-microservice  → POST /api/v1/users)
 *   2. Login as each user     (users-microservice  → POST /api/v1/auth)  → real JWT
 *   3. Seed money for user A  (transactions-microservice → POST /api/v1/transactions)
 *   4. Verify balances
 *   5. Transfer from A to B   (DEBIT on A, CREDIT on B)
 *   6. Verify final balances
 *
 * Unlike the integration tests inside each microservice, no JWT is fabricated
 * locally — every token is issued by the real users-microservice.
 *
 * Prerequisites: both services must be running (`docker compose up -d` from the root).
 */
import orchestrator from "../orchestrator";

// Use timestamps so each test run creates brand-new users without any DB cleanup.
const TIMESTAMP = Date.now();
const USER_A_EMAIL = `alice-${TIMESTAMP}@e2e.test`;
const USER_B_EMAIL = `bob-${TIMESTAMP}@e2e.test`;
const PASSWORD = "password123";

// Amounts in cents (the ledger uses integer cents, e.g. R$500,00 = 50_000)
const SEED_AMOUNT = 50_000; // R$ 500,00
const TRANSFER_AMOUNT = 20_000; // R$ 200,00

beforeAll(async () => {
    await orchestrator.waitForAllServices();
});

describe("E2E — Full transaction flow between two users", () => {
    it("should complete the full cycle: create users → seed money → transfer between them", async () => {
        // ── Step 1: Create user A ──────────────────────────────────────────────
        const userA = await orchestrator.createUser(
            USER_A_EMAIL,
            PASSWORD,
            "Alice",
            "Test",
        );
        expect(userA.id).toBeDefined();
        expect(userA.email).toBe(USER_A_EMAIL);

        // ── Step 2: Create user B ──────────────────────────────────────────────
        const userB = await orchestrator.createUser(
            USER_B_EMAIL,
            PASSWORD,
            "Bob",
            "Test",
        );
        expect(userB.id).toBeDefined();
        expect(userB.email).toBe(USER_B_EMAIL);

        // ── Step 3: Login as A and B → get real JWTs ──────────────────────────
        const tokenA = await orchestrator.login(USER_A_EMAIL, PASSWORD);
        const tokenB = await orchestrator.login(USER_B_EMAIL, PASSWORD);

        expect(tokenA).toBeDefined();
        expect(tokenB).toBeDefined();
        expect(tokenA).not.toBe(tokenB);

        // ── Step 4: Seed R$500,00 into account A ──────────────────────────────
        const seedResponse = await orchestrator.postTransaction(tokenA, {
            amount: SEED_AMOUNT,
            type: "CREDIT",
        });
        expect(seedResponse.status).toBe(200);

        // ── Step 5: Verify initial balances ───────────────────────────────────
        const balanceAAfterSeed = await orchestrator.getBalance(tokenA);
        expect(balanceAAfterSeed.amount).toBe(SEED_AMOUNT); // R$ 500,00

        const balanceBBeforeTransfer = await orchestrator.getBalance(tokenB);
        expect(balanceBBeforeTransfer.amount).toBe(0); // brand-new user

        // ── Step 6: Transfer R$200,00 from A to B ─────────────────────────────
        // In this architecture there is no native "transfer" endpoint;
        // a transfer is modelled as a DEBIT on the sender + CREDIT on the receiver.
        const debitResponse = await orchestrator.postTransaction(tokenA, {
            amount: TRANSFER_AMOUNT,
            type: "DEBIT",
        });
        expect(debitResponse.status).toBe(200);

        const creditResponse = await orchestrator.postTransaction(tokenB, {
            amount: TRANSFER_AMOUNT,
            type: "CREDIT",
        });
        expect(creditResponse.status).toBe(200);

        // ── Step 7: Verify final balances ─────────────────────────────────────
        const finalBalanceA = await orchestrator.getBalance(tokenA);
        const finalBalanceB = await orchestrator.getBalance(tokenB);

        // A started with R$500, transferred R$200 → R$300
        expect(finalBalanceA.amount).toBe(SEED_AMOUNT - TRANSFER_AMOUNT); // 30_000
        // B started with R$0, received R$200 → R$200
        expect(finalBalanceB.amount).toBe(TRANSFER_AMOUNT); // 20_000
    });

    it("should reject a debit that exceeds the available balance", async () => {
        // Register and fund a fresh user so the test is fully self-contained.
        const email = `carol-${Date.now()}@e2e.test`;
        await orchestrator.createUser(email, PASSWORD, "Carol", "Test");
        const token = await orchestrator.login(email, PASSWORD);

        // Seed R$10,00
        await orchestrator.postTransaction(token, { amount: 1_000, type: "CREDIT" });

        // Try to debit R$50,00 — should fail
        const response = await orchestrator.postTransaction(token, {
            amount: 5_000,
            type: "DEBIT",
        });
        expect(response.status).toBe(400);

        // Balance must remain unchanged
        const balance = await orchestrator.getBalance(token);
        expect(balance.amount).toBe(1_000);
    });
});
