// Cloudflare Pages Function for /llm/v1/*: the default model route this site pays for
// (agent-manifest.json, llm_router.publisher_funded). The browser calls it with no key.
// It adds the site's provider key from a server secret, allows one model, sets the
// output limit itself and counts calls against a daily and a total allowance.
// A visitor who adds their own key never reaches this route: the runtime sends that
// key to llm_router.byok_router instead.
import { FundedRoute } from "../../../js/funded-route.js";

export async function onRequest({ request, env }) {
  const route = new FundedRoute({
    store: env.LLM_BUDGET,
    providerKey: env.OTARI_API_KEY,
    fetchProvider: (url, init) => fetch(url, init),
  });
  return route.handle(request);
}
