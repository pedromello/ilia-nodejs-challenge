import retry from "async-retry";
import jwt from "jsonwebtoken";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// For simplicity, hardcoded credentials, but in a real scenario, these should be environment variables
const BASE_URL = "http://localhost:3001/api/v1";
const JWT_SECRET = process.env.JWT_SECRET || "ILIACHALLENGE";
const TEST_DB_URL =
    "postgresql://local_user:local_password@localhost:6431/local_db?schema=public";

// Wait for services
async function waitForAllServices() {
    return retry(
        async () => {
            const response = await fetch(`${BASE_URL}/status`);
            if (response.status !== 200) throw new Error("Service not ready");
        },
        { retries: 100, maxTimeout: 1000 },
    );
}

// Auth helper — generates a JWT locally (no users-microservice needed)
function createAuthToken(userId: string): string {
    return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "1h" }) as string;
}

// Database cleanup
async function cleanDatabase(): Promise<void> {
    const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
    const prisma = new PrismaClient({ adapter } as any);
    try {
        await prisma.idempotencyKey.deleteMany();
        await prisma.transaction.deleteMany();
        await prisma.account.deleteMany();
    } finally {
        await prisma.$disconnect();
    }
}

// HTTP helpers
async function postTransaction(
    token: string,
    body: { amount: number; type: "CREDIT" | "DEBIT"; user_id?: string },
    idempotencyKey?: string,
): Promise<Response> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
    if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;

    return fetch(`${BASE_URL}/transactions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
}

async function getBalance(token: string): Promise<{ amount: number }> {
    const response = await fetch(`${BASE_URL}/balance`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return response.json();
}

const orchestrator = {
    waitForAllServices,
    createAuthToken,
    cleanDatabase,
    postTransaction,
    getBalance,
};

export default orchestrator;

