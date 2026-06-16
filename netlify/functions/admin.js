const { getStore } = require("@netlify/blobs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let password;
  try {
    ({ password } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

   const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || password !== adminPassword) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Unauthorised",
        debug: {
          envVarSet: !!adminPassword,
          envVarLength: adminPassword ? adminPassword.length : 0,
          submittedLength: password ? password.length : 0,
        },
      }),
    };
  }

  // getStore MUST be called inside the handler
  const store = getStore({
    name: "bookprint-events",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.BLOBS_TOKEN,
  });

  try {
    // list all keys (paginated internally by the SDK)
    const { blobs } = await store.list();

    const votes = [];
    const customs = [];
    const eloAggregates = {};

    await Promise.all(
      blobs.map(async ({ key }) => {
        try {
          const data = await store.get(key, { type: "json" });
          if (!data) return;

          if (key.startsWith("elo:")) {
            const mechCode = key.slice(4);
            eloAggregates[mechCode] = data;
          } else if (key.startsWith("vote:")) {
            votes.push(data);
          } else if (key.startsWith("custom_mechanism:")) {
            customs.push(data);
          }
        } catch {}
      })
    );

    // sort by server timestamp descending
    votes.sort((a, b) => (b.serverTimestamp || 0) - (a.serverTimestamp || 0));
    customs.sort((a, b) => (b.serverTimestamp || 0) - (a.serverTimestamp || 0));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ votes, customs, eloAggregates }),
    };
  } catch (err) {
    console.error("admin error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Failed to read store: " + err.message }),
    };
  }
};
