const { getStore } = require("@netlify/blobs");

const DEFAULT_ELO = 1500;
const K = 32;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function randomSuffix() {
  return Math.random().toString(36).slice(2, 9);
}

function bookKey(title, author) {
  return `${title}|${author || ""}`.toLowerCase();
}

async function updateElo(store, mechanismCode, title, author, verdict) {
  const bk = bookKey(title, author);
  const eloKey = `elo:${mechanismCode}`;

  let agg = {};
  try {
    const raw = await store.get(eloKey, { type: "json" });
    if (raw) agg = raw;
  } catch {}

  if (!agg[bk]) agg[bk] = { title, author, score: DEFAULT_ELO, yes: 0, no: 0 };

  const entry = agg[bk];
  const cur = entry.score;
  const resultScore = verdict === "yes" ? 1 : 0;
  const expected = 1 / (1 + Math.pow(10, (DEFAULT_ELO - cur) / 400));
  entry.score = Math.round(cur + K * (resultScore - expected));
  entry[verdict] = (entry[verdict] || 0) + 1;

  await store.setJSON(eloKey, agg);
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

  const { type } = body;
  if (!type) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing event type" }) };
  }

  // getStore MUST be called inside the handler, not at module level
  const store = getStore({
    name: "bookprint-events",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.BLOBS_TOKEN,
  });

  try {
    const ts = Date.now();
    const key = `${type}:${ts}:${randomSuffix()}`;
    const payload = { ...body, serverTimestamp: ts };

    await store.setJSON(key, payload);

    // maintain running ELO aggregate for vote events (skip is ignored)
    if (type === "vote" && (body.verdict === "yes" || body.verdict === "no")) {
      await updateElo(store, body.mechanismCode, body.candidateTitle, body.candidateAuthor, body.verdict);
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("record error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Failed to record event: " + err.message }),
    };
  }
};
