const { getStore } = require("@netlify/blobs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

const MAX_BOOKS_PER_MECH = 12; // top-N by score within each mechanism become edge-eligible
const MIN_VOTES_TO_SHOW = 1;   // a book needs at least this many total votes to appear as a node

function bookKey(title, author) {
  return `${title}|${author || ""}`.toLowerCase().trim();
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const store = getStore({
    name: "bookprint-events",
    siteID: process.env.BLOBS_SITE_ID,
    token: process.env.BLOBS_TOKEN,
  });

  try {
    const { blobs } = await store.list({ prefix: "elo:" });

    const nodes = new Map();   // bookKey -> { id, title, author, totalVotes, mechCount }
    const edges = new Map();   // "a|b|mechCode" -> { source, target, mechanismCode, weight }
    const mechMeta = [];       // per-mechanism summary, for the legend / picker

    await Promise.all(
      blobs.map(async ({ key }) => {
        const mechCode = key.slice(4);
        const agg = await store.get(key, { type: "json" });
        if (!agg) return;

        const entries = Object.entries(agg)
          .map(([bk, b]) => ({ bk, ...b, totalVotes: (b.yes || 0) + (b.no || 0) }))
          .filter((b) => b.totalVotes >= MIN_VOTES_TO_SHOW)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_BOOKS_PER_MECH);

        if (entries.length === 0) return;

        mechMeta.push({ code: mechCode, bookCount: entries.length });

        // register nodes
        for (const b of entries) {
          if (!nodes.has(b.bk)) {
            nodes.set(b.bk, { id: b.bk, title: b.title, author: b.author || "", totalVotes: 0, mechanisms: new Set() });
          }
          const n = nodes.get(b.bk);
          n.totalVotes += b.totalVotes;
          n.mechanisms.add(mechCode);
        }

        // connect every pair within this mechanism's top-N — the edge IS the
        // shared mechanism; weight is the combined vote strength backing it
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const a = entries[i], b = entries[j];
            const edgeKey = [a.bk, b.bk].sort().join("|") + "|" + mechCode;
            if (edges.has(edgeKey)) continue;
            edges.set(edgeKey, {
              source: a.bk,
              target: b.bk,
              mechanismCode: mechCode,
              weight: a.totalVotes + b.totalVotes,
            });
          }
        }
      })
    );

    const nodeList = Array.from(nodes.values()).map((n) => ({
      id: n.id,
      title: n.title,
      author: n.author,
      totalVotes: n.totalVotes,
      mechanisms: Array.from(n.mechanisms),
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        nodes: nodeList,
        edges: Array.from(edges.values()),
        mechanisms: mechMeta,
        generatedAt: Date.now(),
      }),
    };
  } catch (err) {
    console.error("graph error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Failed to build graph: " + err.message }),
    };
  }
};
