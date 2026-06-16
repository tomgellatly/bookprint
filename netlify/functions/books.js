exports.handler = async function(event, context) {
    const { searchQuery } = event.queryStringParameters;
    // Ensure this key name matches exactly what is in your Netlify Settings
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

    try {
        const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchQuery)}&key=${apiKey}`);

        // Read the body as text first to see what's actually coming back
        const text = await response.text();

        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: "Google API Error", details: text })
            };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: text
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: "Fetch failed: " + error.message }) };
    }
};
