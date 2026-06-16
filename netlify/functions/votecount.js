const { getStore } = require("@netlify/blobs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

// The displayed counter is BASELINE + real votes cast from here on.
// BASELINE is a deliberate starting number chosen by the product owner;
// everything added on top of it reflects genuine recorded votes.
const BASELINE = 1030;

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
    const { blobs } = await store.list({ prefix: "vote:" });
    const realVotes = blobs.length;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ count: BASELINE + realVotes, baseline: BASELINE, realVotes }),
    };
  } catch (err) {
    console.error("votecount error:", err);
    // fail soft: still show the baseline rather than breaking the homepage
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ count: BASELINE, baseline: BASELINE, realVotes: 0, error: err.message }),
    };
  }
};
