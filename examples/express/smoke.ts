import { createApp } from "./src/app.js";

const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("missing port");
const base = `http://127.0.0.1:${address.port}`;

try {
  const missing = await fetch(`${base}/`);
  if (missing.status !== 401) throw new Error(`expected 401, got ${missing.status}`);
  const first = await fetch(`${base}/`, { headers: { authorization: "Bearer sk_example" } });
  if (first.status !== 200) throw new Error(`expected 200, got ${first.status}`);
  const second = await fetch(`${base}/`, { headers: { authorization: "Bearer sk_example" } });
  if (second.status !== 200) throw new Error(`expected 200, got ${second.status}`);
  const third = await fetch(`${base}/`, { headers: { authorization: "Bearer sk_example" } });
  if (third.status !== 429) throw new Error(`expected 429, got ${third.status}`);
  console.log("express example ok");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
