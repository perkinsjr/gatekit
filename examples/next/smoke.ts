import { GET } from "./app/route.js";

const missing = await GET(new Request("http://localhost/"));
if (missing.status !== 401) throw new Error(`expected 401, got ${missing.status}`);

const first = await GET(
  new Request("http://localhost/", { headers: { authorization: "Bearer sk_example" } }),
);
if (first.status !== 200) throw new Error(`expected 200, got ${first.status}`);
const body = (await first.json()) as { keyId: string };
if (body.keyId !== "key_example") throw new Error(`unexpected key id ${body.keyId}`);

const second = await GET(
  new Request("http://localhost/", { headers: { authorization: "Bearer sk_example" } }),
);
if (second.status !== 200) throw new Error(`expected 200, got ${second.status}`);

const third = await GET(
  new Request("http://localhost/", { headers: { authorization: "Bearer sk_example" } }),
);
if (third.status !== 429) throw new Error(`expected 429, got ${third.status}`);
if (third.headers.get("retry-after") === null) throw new Error("missing Retry-After");

console.log("next example ok");
