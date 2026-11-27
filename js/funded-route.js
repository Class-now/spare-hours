// The default model route this site pays for, as plain logic with no host API in it,
// so the same code runs in a Cloudflare Pages Function and in the Node tests.
// Refusals are plain text written for the visitor: the runtime shows them as they are.

/** What the site is willing to pay for. Change the numbers here, nowhere else. */
export const ALLOWANCE = Object.freeze({
  provider: "https://api.otari.ai/api/v1",
  models: Object.freeze(["alibaba/qwen3.8-flash"]),
  maxOutputTokens: 1200,
  maxBodyBytes: 120000,
  callsPerDay: 250,
  callsPerVisitorPerDay: 80,
  callsInTotal: 5000,
});

const OWN_KEY_HINT = "Open ⚙ AI model settings and add your own key to keep going.";

export class FundedRoute {
  /**
   * @param {object} options
   * @param {{get: Function, put: Function}} options.store A key-value store for the counters.
   * @param {string} options.providerKey The site's provider key, from a server secret.
   * @param {Function} options.fetchProvider fetch, or a stand-in for tests.
   * @param {Function} [options.now] Returns the current Date.
   */
  constructor({ store, providerKey, fetchProvider, now }) {
    this.store = store;
    this.providerKey = providerKey;
    this.fetchProvider = fetchProvider;
    this.now = now || (() => new Date());
  }

  /** Answers one request to /llm/v1/*. */
  async handle(request) {
    const url = new URL(request.url);
    const cors = FundedRoute.corsHeaders(url.origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      const data = ALLOWANCE.models.map((id) => ({ id, object: "model" }));
      return FundedRoute.json({ object: "list", data }, cors);
    }
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      return FundedRoute.refuse(404, "This route only answers chat completions.", cors);
    }
    // Other web pages may not spend this site's allowance. A script can fake this header,
    // which is why the allowance below is counted as well.
    if (request.headers.get("Origin") !== url.origin) {
      return FundedRoute.refuse(403, "This free route only serves this site's own assistant.", cors);
    }
    if (!this.store || !this.providerKey) {
      return FundedRoute.refuse(503, `This site's free model route is not set up right now. ${OWN_KEY_HINT}`, cors);
    }

    const text = await request.text();
    if (new TextEncoder().encode(text).length > ALLOWANCE.maxBodyBytes) {
      return FundedRoute.refuse(413, `This conversation is too long for the site's free model route. Start a new chat, or ${OWN_KEY_HINT.toLowerCase()}`, cors);
    }
    const forward = FundedRoute.forwardBody(text);
    if (forward.error) {
      return FundedRoute.refuse(400, forward.error, cors);
    }

    const visitor = await FundedRoute.visitorTag(request.headers.get("CF-Connecting-IP") || "unknown", this.dayStamp());
    const refusal = await this.countCall(visitor);
    if (refusal) {
      return FundedRoute.refuse(429, refusal, cors);
    }

    let reply;
    try {
      reply = await this.fetchProvider(`${ALLOWANCE.provider}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.providerKey}` },
        body: JSON.stringify(forward.body),
      });
    } catch {
      return FundedRoute.refuse(502, `The model provider could not be reached. Try again, or ${OWN_KEY_HINT.toLowerCase()}`, cors);
    }
    if (!reply.ok) {
      return FundedRoute.refuse(502, `The model provider refused the site's call (HTTP ${reply.status}). ${OWN_KEY_HINT}`, cors);
    }
    const headers = new Headers(cors);
    headers.set("Content-Type", reply.headers.get("Content-Type") || "text/event-stream");
    headers.set("Cache-Control", "no-store");
    return new Response(reply.body, { status: 200, headers });
  }

  /**
   * Builds the body sent to the provider from what the browser sent. Only the fields the
   * runtime uses are kept, the model must be one the site pays for, and the output limit
   * is the site's.
   */
  static forwardBody(text) {
    let sent;
    try {
      sent = JSON.parse(text);
    } catch {
      return { error: "The request was not valid JSON." };
    }
    if (!sent || !Array.isArray(sent.messages) || !sent.messages.length) {
      return { error: "The request has no messages." };
    }
    if (!ALLOWANCE.models.includes(sent.model)) {
      return { error: `This site pays only for ${ALLOWANCE.models.join(", ")}. ${OWN_KEY_HINT.replace("to keep going", "to use another model")}` };
    }
    const body = { model: sent.model, messages: sent.messages, stream: true, max_tokens: ALLOWANCE.maxOutputTokens };
    if (Array.isArray(sent.tools) && sent.tools.length) {
      body.tools = sent.tools;
      body.tool_choice = "auto";
    }
    return { body };
  }

  /**
   * Counts one call. Returns a refusal for the visitor when an allowance is used up,
   * or "" when the call may go ahead. If the count cannot be saved, the call is refused,
   * so a broken counter never means unlimited spending.
   */
  async countCall(visitor) {
    const day = this.dayStamp();
    let state;
    try {
      state = JSON.parse((await this.store.get("budget")) || "{}");
    } catch {
      state = {};
    }
    const total = Number(state.total) || 0;
    const today = state.day === day ? state : { day, calls: 0, visitors: {} };
    const calls = Number(today.calls) || 0;
    const visitors = today.visitors || {};
    const mine = Number(visitors[visitor]) || 0;

    if (total >= ALLOWANCE.callsInTotal) {
      return `This site's free model allowance is used up. ${OWN_KEY_HINT}`;
    }
    if (calls >= ALLOWANCE.callsPerDay) {
      return `This site's free model allowance for today is used up. It starts again at 00:00 UTC. ${OWN_KEY_HINT}`;
    }
    if (mine >= ALLOWANCE.callsPerVisitorPerDay) {
      return `You have used today's free questions on this site. They start again at 00:00 UTC. ${OWN_KEY_HINT}`;
    }
    visitors[visitor] = mine + 1;
    try {
      await this.store.put("budget", JSON.stringify({ day, calls: calls + 1, visitors, total: total + 1 }));
    } catch {
      return `This site's free model route cannot count its calls right now, so it is paused. ${OWN_KEY_HINT}`;
    }
    return "";
  }

  /** The UTC date, the unit the daily allowance is counted in. */
  dayStamp() {
    return this.now().toISOString().slice(0, 10);
  }

  /** A short tag for one visitor on one day. The address itself is not stored. */
  static async visitorTag(address, day) {
    const bytes = new TextEncoder().encode(`${day}|${address}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  static corsHeaders(origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
  }

  static refuse(status, message, cors) {
    const headers = new Headers(cors);
    headers.set("Content-Type", "text/plain; charset=utf-8");
    headers.set("Cache-Control", "no-store");
    return new Response(message, { status, headers });
  }

  static json(value, cors) {
    const headers = new Headers(cors);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(value), { status: 200, headers });
  }
}
