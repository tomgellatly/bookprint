const Anthropic = require("@anthropic-ai/sdk");

// Change this constant to swap models without hunting through code.
const MODEL = "claude-haiku-4-5-20251001";

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
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY environment variable is not set" }),
    };
  }

  let prompt, maxTokens;
  try {
    ({ prompt, maxTokens } = JSON.parse(event.body));
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Request body must be JSON with { prompt, maxTokens }" }),
    };
  }

  if (!prompt || typeof prompt !== "string") {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "prompt is required and must be a string" }),
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens || 1200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    const status = err.status || 500;
    const message = err.message || "Unknown error calling Anthropic API";
    return {
      statusCode: status,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: message }),
    };
  }
};
