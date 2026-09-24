#!/usr/bin/env node
/**
 * @tahweel/mcp
 * Open-Source Model Context Protocol (MCP) Server for Tahweel Payment Gateway.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const TAHWEEL_URL = (process.env.TAHWEEL_URL || "http://localhost:3000").replace(/\/$/, "");
const API_KEY = process.env.TAHWEEL_API_KEY || "";
const ADMIN_PASSWORD = process.env.TAHWEEL_ADMIN_PASSWORD || "";

let adminJwt: string | null = null;
let jwtExpiry = 0;

async function getAdminToken(): Promise<string | null> {
  if (!ADMIN_PASSWORD) return null;
  const now = Date.now() / 1000;
  if (adminJwt && now < jwtExpiry - 120) return adminJwt;

  try {
    const res = await fetch(`${TAHWEEL_URL}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { token?: string };
    adminJwt = data.token || null;
    jwtExpiry = now + 24 * 3600;
    return adminJwt;
  } catch {
    return null;
  }
}

async function tahweelFetch(
  path: string,
  options: { method?: string; body?: unknown; useAdmin?: boolean } = {}
) {
  const url = `${TAHWEEL_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (options.useAdmin) {
    const token = await getAdminToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } else if (API_KEY) {
    headers["X-Api-Key"] = API_KEY;
  }

  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      throw new Error(`Tahweel API Error (${res.status}): ${JSON.stringify(json)}`);
    }
    return json;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot connect to Tahweel at ${TAHWEEL_URL}: ${msg}. ` +
        "Ensure the Tahweel container is running ('docker compose up -d')."
    );
  }
}

const server = new McpServer({
  name: "tahweel-mcp",
  version: "0.1.0",
});

// Tool: create_payment_intent
server.tool(
  "create_payment_intent",
  "Registers an expected mobile wallet payment in Tahweel (Vodafone Cash, e& money, Orange Cash).",
  {
    reference: z.string().describe("Unique order or invoice ID (e.g. 'INV-2026-001')"),
    amount: z.number().positive().describe("Amount in EGP"),
    sender_phone: z.string().describe("Customer's 11-digit mobile wallet number"),
    expires_in_minutes: z.number().int().positive().default(120).describe("Expiry time in minutes"),
    metadata: z.record(z.any()).optional().describe("Optional metadata"),
    webhook_url: z.string().url().optional().describe("Optional intent-specific webhook URL"),
  },
  async (args) => {
    try {
      const data = await tahweelFetch("/api/v1/intents", {
        method: "POST",
        body: args,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// Tool: get_payment_intent
server.tool(
  "get_payment_intent",
  "Retrieves the status and receipt of a mobile wallet payment intent (pending, matched, cancelled, expired).",
  {
    reference: z.string().optional().describe("Unique reference string"),
    id: z.string().optional().describe("Internal Tahweel intent UUID"),
  },
  async (args) => {
    try {
      const path = args.id
        ? `/api/v1/intents/${args.id}`
        : `/api/v1/intents/by-reference/${encodeURIComponent(args.reference || "")}`;
      const data = await tahweelFetch(path);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// Tool: cancel_payment_intent
server.tool(
  "cancel_payment_intent",
  "Cancels an active pending payment intent.",
  { id: z.string().describe("Intent UUID to cancel") },
  async ({ id }) => {
    try {
      const data = await tahweelFetch(`/api/v1/intents/${id}/cancel`, { method: "POST" });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// Tool: list_payment_intents
server.tool(
  "list_payment_intents",
  "Lists payment intents filtered by status.",
  {
    status: z.enum(["pending", "matched", "cancelled", "expired"]).optional(),
    limit: z.number().int().default(20),
    offset: z.number().int().default(0),
  },
  async ({ status, limit, offset }) => {
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (status) q.set("status", status);
      const data = await tahweelFetch(`/api/v1/intents?${q.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// Tool: get_device_status
server.tool(
  "get_device_status",
  "Checks all connected Android listener phones forwarding wallet SMS receipts to Tahweel.",
  {},
  async () => {
    try {
      const data = await tahweelFetch("/admin/devices", { useAdmin: true });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// Tool: list_unmatched_receipts
server.tool(
  "list_unmatched_receipts",
  "Lists incoming SMS transfers received on phone that did not match an active intent.",
  { limit: z.number().int().default(20) },
  async ({ limit }) => {
    try {
      const data = await tahweelFetch(`/admin/messages?status=unmatched&limit=${limit}`, {
        useAdmin: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

// Tool: manual_match_receipt
server.tool(
  "manual_match_receipt",
  "Manually binds an unallocated incoming SMS receipt to a payment intent.",
  {
    message_id: z.string().describe("Message UUID"),
    intent_id: z.string().describe("Intent UUID"),
  },
  async ({ message_id, intent_id }) => {
    try {
      const data = await tahweelFetch(`/admin/messages/${message_id}/match`, {
        method: "POST",
        body: { intent_id },
        useAdmin: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error in Tahweel MCP server:", err);
  process.exit(1);
});
