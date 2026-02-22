import retry from "async-retry";

const USERS_URL = "http://localhost:3002/api/v1";
const TRANSACTIONS_URL = "http://localhost:3001/api/v1";

// ─────────────────────────────────────────────────────────────────────────────
// Wait for BOTH services to be ready
// ─────────────────────────────────────────────────────────────────────────────
async function waitForAllServices(): Promise<void> {
    await Promise.all([
        retry(
            async () => {
                const r = await fetch(`${USERS_URL}/status`);
                if (r.status !== 200) throw new Error("users-service not ready");
            },
            { retries: 100, maxTimeout: 1000 },
        ),
        retry(
            async () => {
                const r = await fetch(`${TRANSACTIONS_URL}/status`);
                if (r.status !== 200) throw new Error("transactions-service not ready");
            },
            { retries: 100, maxTimeout: 1000 },
        ),
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Users helpers — real HTTP calls to users-microservice
// ─────────────────────────────────────────────────────────────────────────────
interface UserResponse {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
}

async function createUser(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
): Promise<UserResponse> {
    const r = await fetch(`${USERS_URL}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email,
            password,
            first_name: firstName,
            last_name: lastName,
        }),
    });

    if (!r.ok) {
        const body = await r.text();
        throw new Error(`Failed to create user (${r.status}): ${body}`);
    }

    return r.json() as Promise<UserResponse>;
}

/**
 * Logs in a user and returns the JWT access_token issued by users-microservice.
 * This is a real JWT — no local signing involved.
 */
async function login(email: string, password: string): Promise<string> {
    const r = await fetch(`${USERS_URL}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });

    if (!r.ok) {
        const body = await r.text();
        throw new Error(`Login failed (${r.status}): ${body}`);
    }

    const data = (await r.json()) as { access_token: string };
    return data.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactions helpers — real HTTP calls to transactions-microservice
// ─────────────────────────────────────────────────────────────────────────────
async function postTransaction(
    token: string,
    body: { amount: number; type: "CREDIT" | "DEBIT" },
    idempotencyKey?: string,
): Promise<Response> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };

    if (idempotencyKey) {
        headers["x-idempotency-key"] = idempotencyKey;
    }

    return fetch(`${TRANSACTIONS_URL}/transactions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
}

async function getBalance(token: string): Promise<{ amount: number }> {
    const r = await fetch(`${TRANSACTIONS_URL}/balance`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return r.json() as Promise<{ amount: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
const orchestrator = {
    waitForAllServices,
    createUser,
    login,
    postTransaction,
    getBalance,
};

export default orchestrator;
