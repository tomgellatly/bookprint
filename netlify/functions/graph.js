const { getStore } = require("@netlify/blobs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

const MAX_BOOKS_PER_MECH = 25; // a "playlist" can hold more than the old graph's top-12
const MIN_VOTES_TO_SHOW = 1;

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

    const playlists = [];

    await Promise.all(
      blobs.map(async ({ key }) => {
        const mechCode = key.slice(4);
        const agg = await store.get(key, { type: "json" });
        if (!agg) return;

        const books = Object.values(agg)
          .map((b) => ({
            title: b.title,
            author: b.author || "",
            cover: b.cover || null,
            score: b.score,
            votes: (b.yes || 0) + (b.no || 0),
            yes: b.yes || 0,
            no: b.no || 0,
          }))
          .filter((b) => b.votes >= MIN_VOTES_TO_SHOW)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_BOOKS_PER_MECH);

        if (books.length === 0) return;

        playlists.push({
          code: mechCode,
          totalVotes: books.reduce((sum, b) => sum + b.votes, 0),
          books,
        });
      })
    );

    // most-voted mechanisms first, so the browse screen leads with what's actually alive
    playlists.sort((a, b) => b.totalVotes - a.totalVotes);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ playlists, generatedAt: Date.now() }),
    };
  } catch (err) {
    console.error("graph error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Failed to build playlists: " + err.message }),
    };
  }
};
