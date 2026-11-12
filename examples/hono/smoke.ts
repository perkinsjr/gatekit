import { serve } from "@hono/node-server";
import { createApp } from "./src/app.js";

const app = createApp();
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("missing port");
const base = `http://127.0.0.1:${address.port}`;

try {
  const missing = await fetch(`${base}/`);
  if (missing.status !== 401) throw new Error(`expected 401, got ${missing.status}`);
  const first = await fetch(`${base}/`, { headers: { authorization: "Bearer sk_example" } });
  if (first.status !== 200) throw new Error(`expected 200, got ${first.status}`);
  const body = (await first.json()) as { keyId: string };
  if (body.keyId !== "key_example") throw new Error(`unexpected key id ${body.keyId}`);
  const second = await fetch(`${base}/`, { headers: { authorization: "Bearer sk_example" } });
  if (second.status !== 200) throw new Error(`expected 200, got ${second.status}`);
  const third = await fetch(`${base}/`, { headers: { authorization: "Bearer sk_example" } });
  if (third.status !== 429) throw new Error(`expected 429, got ${third.status}`);
  if (third.headers.get("retry-after") === null) throw new Error("missing Retry-After");
  console.log("hono example ok");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
