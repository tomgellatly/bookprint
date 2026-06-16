const { getStore } = require("@netlify/blobs");
const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-haiku-4-5-20251001";
const MIN_POOL_SIZE = 8;       // top up the cached pool until it has at least this many
const TOPUP_REQUEST = 6;       // how many new candidates to ask Claude for per top-up

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function bookKey(title, author) {
  return `${title}|${author || ""}`.toLowerCase().trim();
}

function parseJSON(t) {
  if (!t || typeof t !== "string") throw new Error("Empty response from model");
  let cleaned = t.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in model response");
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("Incomplete JSON in model response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callClaude(client, prompt, maxTokens) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens || 1000,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// Ask Claude to propose brand-new real-world candidates for a mechanism,
// grounded by a few-shot slice of the curator's seed taste (NOT a hard list).
async function generateCandidates(client, mechLabel, mechGloss, seedTitle, seedAuthor, tasteSample, excludeKeys, count) {
  const tasteLines = tasteSample.map(([t, a]) => `${t} — ${a}`).join("\n");
  const excludeList = Array.from(excludeKeys).slice(0, 60).join("; ");

  const prompt = `You recommend books based on a specific reading "mechanism" — the transferable source of pleasure in a book, not its genre or plot.

MECHANISM: ${mechLabel} (${mechGloss})

The reader loved "${seedTitle}"${seedAuthor ? ` by ${seedAuthor}` : ""} for this reason.

Propose ${count} REAL, PUBLISHED books (any book that exists — do not limit yourself to any list) that strongly deliver this exact mechanism. Lean toward books that would resonate with someone whose taste sample looks like this (use it to calibrate sensibility and quality bar, not as a restriction):

TASTE SAMPLE:
${tasteLines}

Do not propose "${seedTitle}". Do not propose any of these already-suggested books: ${excludeList || "(none yet)"}.

Return ONLY valid JSON, no preamble, no markdown fences:
{"books":[{"title":"...","author":"..."}, ...]}`;

  const out = parseJSON(await callClaude(client, prompt, 700));
  return (out.books || []).filter((b) => b && b.title && b.title.trim());
}

// Classify a candidate book against the fixed taxonomy, confirming it actually
// fits the mechanism it was proposed for (guards against the model drifting).
async function classifyAgainstMechanism(client, title, author, mechCode, mechLabel, mechGloss) {
  const prompt = `Does the book "${title}"${author ? ` by ${author}` : ""} genuinely deliver this specific reading mechanism?

MECHANISM ${mechCode}: ${mechLabel} (${mechGloss})

Return ONLY valid JSON, no preamble, no markdown fences:
{"fits": true|false, "why": "<one short clause, the specific way it delivers this mechanism, no spoilers>"}`;

  try {
    const out = parseJSON(await callClaude(client, prompt, 250));
    return { fits: !!out.fits, why: out.why || "" };
  } catch {
    // if classification fails, default to including it rather than blocking the swipe
    return { fits: true, why: "" };
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { mechanismCode, mechanismLabel, mechanismGloss, seedTitle, seedAuthor, tasteSample } = body;
  if (!mechanismCode || !mechanismLabel || !seedTitle) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "mechanismCode, mechanismLabel and seedTitle are required" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "ANTHROPIC_API_KEY environment variable is not set" }) };
  }

  const store = getStore({
    name: "bookprint-events",
    siteID: process.env.BLOBS_SITE_ID,
    token: process.env.BLOBS_TOKEN,
  });

  const poolKey = `pool:${mechanismCode}`;
  const catalogKey = `catalog:books`; // global "every book we've ever surfaced or voted on" index, for dedupe

  try {
    let pool = (await store.get(poolKey, { type: "json" })) || [];
    let catalog = (await store.get(catalogKey, { type: "json" })) || {};

    const seedKey = bookKey(seedTitle, seedAuthor);
    const excludeKeys = new Set([seedKey, ...pool.map((b) => bookKey(b.title, b.author))]);

    // Top up the cached pool if it's thin. This is the only place that calls
    // the model — once a mechanism's pool is warm, every later request
    // (any friend, any session) is served straight from the cache.
    if (pool.length < MIN_POOL_SIZE) {
      const client = new Anthropic({ apiKey });
      const sample = Array.isArray(tasteSample) && tasteSample.length ? tasteSample : [];

      const proposed = await generateCandidates(
        client, mechanismLabel, mechanismGloss || "", seedTitle, seedAuthor,
        sample, excludeKeys, TOPUP_REQUEST
      );

      for (const cand of proposed) {
        const ck = bookKey(cand.title, cand.author);
        if (excludeKeys.has(ck)) continue; // dedupe against pool + seed, skip a redundant classify call
        excludeKeys.add(ck);

        const verdict = await classifyAgainstMechanism(
          client, cand.title, cand.author, mechanismCode, mechanismLabel, mechanismGloss || ""
        );
        if (!verdict.fits) continue;

        const entry = { title: cand.title.trim(), author: (cand.author || "").trim(), why: verdict.why };
        pool.push(entry);

        // register in the global catalog so the Dispensary graph and future
        // dedupe checks know about this book regardless of which mechanism found it
        if (!catalog[ck]) catalog[ck] = { title: entry.title, author: entry.author, firstSeenVia: mechanismCode, addedAt: Date.now() };
      }

      await store.setJSON(poolKey, pool);
      await store.setJSON(catalogKey, catalog);
    }

    // Anything that has already received a vote is a permanent graph node —
    // it stays in the pool indefinitely, it's never pruned back out.
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ books: pool }),
    };
  } catch (err) {
    console.error("candidates error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Failed to build candidate pool: " + err.message }),
    };
  }
};
