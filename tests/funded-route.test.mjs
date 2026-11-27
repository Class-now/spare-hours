// Tests for the default model route the site pays for (js/funded-route.js).
// No network: the provider and the counter store are stand-ins.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const { FundedRoute, ALLOWANCE } = await import("../js/funded-route.js");

const SITE = "https://site.example";
const MODEL = ALLOWANCE.models[0];

/** A key-value store in memory, with the two calls the route uses. */
class MemoryStore {
  constructor() {
    this.values = new Map();
    this.failWrites = false;
  }
  async get(key) { return this.values.has(key) ? this.values.get(key) : null; }
  async put(key, value) {
    if (this.failWrites) throw new Error("write limit");
    this.values.set(key, value);
  }
  budget() { return JSON.parse(this.values.get("budget") || "{}"); }
}

/** Records what the route sends to the provider and answers with one stream line. */
class StubProvider {
  constructor(status = 200) {
    this.status = status;
    this.calls = [];
  }
  fetch = async (url, init) => {
    this.calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response("data: [DONE]\n\n", { status: this.status, headers: { "Content-Type": "text/event-stream" } });
  };
}

class FundedRouteTest {
  static route({ store = new MemoryStore(), provider = new StubProvider(), key = "site-key", day = "2026-12-01" } = {}) {
    const route = new FundedRoute({ store, providerKey: key, fetchProvider: provider.fetch, now: () => new Date(`${day}T12:00:00Z`) });
    return { route, store, provider };
  }

  static post(body, { origin = SITE, ip = "203.0.113.5", headers = {} } = {}) {
    return new Request(`${SITE}/llm/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": ip, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  static chat(extra = {}) {
    return { model: MODEL, messages: [{ role: "user", content: "hello" }], stream: true, ...extra };
  }
}

test("forwards a chat call with the site's key, model and output limit", async () => {
  const { route, provider, store } = FundedRouteTest.route();
  const tools = [{ type: "function", function: { name: "website_find_calls", parameters: {} } }];
  const reply = await route.handle(FundedRouteTest.post(FundedRouteTest.chat({ tools, max_tokens: 99999, temperature: 2 })));
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.match(await reply.text(), /DONE/);
  assert.equal(provider.calls.length, 1);
  const sent = provider.calls[0];
  assert.equal(sent.url, `${ALLOWANCE.provider}/chat/completions`);
  assert.equal(sent.init.headers.Authorization, "Bearer site-key");
  assert.deepEqual(Object.keys(sent.body).sort(), ["max_tokens", "messages", "model", "stream", "tool_choice", "tools"]);
  assert.equal(sent.body.max_tokens, ALLOWANCE.maxOutputTokens);
  assert.equal(store.budget().calls, 1);
  assert.equal(store.budget().total, 1);
});

test("never forwards a key that comes from the browser", async () => {
  const { route, provider } = FundedRouteTest.route();
  await route.handle(FundedRouteTest.post(FundedRouteTest.chat(), { headers: { Authorization: "Bearer visitor-key" } }));
  assert.equal(provider.calls[0].init.headers.Authorization, "Bearer site-key");
  assert.ok(!JSON.stringify(provider.calls[0].init).includes("visitor-key"));
});

test("refuses other origins, other models, bad and oversized bodies without calling the provider", async () => {
  const { route, provider, store } = FundedRouteTest.route();
  const cases = [
    [FundedRouteTest.post(FundedRouteTest.chat(), { origin: "https://other.example" }), 403],
    [FundedRouteTest.post(FundedRouteTest.chat(), { origin: "" }), 403],
    [FundedRouteTest.post(FundedRouteTest.chat({ model: "openai/gpt-5" })), 400],
    [FundedRouteTest.post("{not json"), 400],
    [FundedRouteTest.post(FundedRouteTest.chat({ messages: [] })), 400],
    [FundedRouteTest.post(FundedRouteTest.chat({ messages: [{ role: "user", content: "x".repeat(ALLOWANCE.maxBodyBytes) }] })), 413],
    [new Request(`${SITE}/llm/v1/embeddings`, { method: "POST", headers: { Origin: SITE }, body: "{}" }), 404],
  ];
  for (const [request, status] of cases) {
    const reply = await route.handle(request);
    assert.equal(reply.status, status);
    assert.match(reply.headers.get("Content-Type"), /^text\/plain/);
    assert.equal(reply.headers.get("Access-Control-Allow-Origin"), SITE);
    assert.ok((await reply.text()).length > 10);
  }
  assert.equal(provider.calls.length, 0);
  assert.equal(store.budget().calls, undefined);
});

test("stops at the visitor, daily and total allowances, and starts again the next day", async () => {
  const store = new MemoryStore();
  const first = FundedRouteTest.route({ store });
  const visitor = await FundedRoute.visitorTag("203.0.113.5", "2026-12-01");
  store.values.set("budget", JSON.stringify({ day: "2026-12-01", calls: 100, visitors: { [visitor]: ALLOWANCE.callsPerVisitorPerDay }, total: 100 }));
  let reply = await first.route.handle(FundedRouteTest.post(FundedRouteTest.chat()));
  assert.equal(reply.status, 429);
  assert.match(await reply.text(), /today's free questions/);
  reply = await first.route.handle(FundedRouteTest.post(FundedRouteTest.chat(), { ip: "203.0.113.6" }));
  assert.equal(reply.status, 200);

  store.values.set("budget", JSON.stringify({ day: "2026-12-01", calls: ALLOWANCE.callsPerDay, visitors: {}, total: 900 }));
  reply = await first.route.handle(FundedRouteTest.post(FundedRouteTest.chat()));
  assert.equal(reply.status, 429);
  assert.match(await reply.text(), /for today is used up/);

  const nextDay = FundedRouteTest.route({ store, day: "2026-12-02" });
  reply = await nextDay.route.handle(FundedRouteTest.post(FundedRouteTest.chat()));
  assert.equal(reply.status, 200);
  assert.deepEqual([store.budget().day, store.budget().calls, store.budget().total], ["2026-12-02", 1, 901]);

  store.values.set("budget", JSON.stringify({ day: "2026-12-02", calls: 1, visitors: {}, total: ALLOWANCE.callsInTotal }));
  reply = await nextDay.route.handle(FundedRouteTest.post(FundedRouteTest.chat()));
  assert.equal(reply.status, 429);
  assert.equal(first.provider.calls.length + nextDay.provider.calls.length, 2);
});

test("is paused when the count cannot be saved or the route is not set up", async () => {
  const store = new MemoryStore();
  store.failWrites = true;
  const broken = FundedRouteTest.route({ store });
  let reply = await broken.route.handle(FundedRouteTest.post(FundedRouteTest.chat()));
  assert.equal(reply.status, 429);
  assert.equal(broken.provider.calls.length, 0);

  const noKey = FundedRouteTest.route({ key: "" });
  reply = await noKey.route.handle(FundedRouteTest.post(FundedRouteTest.chat()));
  assert.equal(reply.status, 503);
  assert.equal(noKey.provider.calls.length, 0);
});

test("turns a provider failure into a plain message and answers the preflight and the model list", async () => {
  const failing = FundedRouteTest.route({ provider: new StubProvider(402) });
  let reply = await failing.route.handle(FundedRouteTest.post(FundedRouteTest.chat()));
  assert.equal(reply.status, 502);
  assert.match(await reply.text(), /HTTP 402/);

  const { route } = FundedRouteTest.route();
  reply = await route.handle(new Request(`${SITE}/llm/v1/chat/completions`, { method: "OPTIONS", headers: { Origin: SITE } }));
  assert.equal(reply.status, 204);
  assert.match(reply.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  reply = await route.handle(new Request(`${SITE}/llm/v1/models`));
  assert.deepEqual((await reply.json()).data.map((m) => m.id), [...ALLOWANCE.models]);
});

test("the manifest's default route is this function and the paid model is the network's model", async () => {
  const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.llm_router.publisher_funded, true);
  assert.match(manifest.llm_router.base_url, /\/llm\/v1$/);
  assert.notEqual(manifest.llm_router.byok_router, manifest.llm_router.base_url);
  assert.equal(manifest.llm_router.byok_router, ALLOWANCE.provider);
  const network = JSON.parse(await readFile(new URL(`../${manifest.networks[0].hocon}`, import.meta.url), "utf8"));
  assert.ok(ALLOWANCE.models.includes(network.llm_config.model_name));
});
