exports.handler = async function(event, context) {
    // Grab the search query sent from your frontend
    const { searchQuery } = event.queryStringParameters;
    
    // Grab your secret API key safely from Netlify's environment
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    
    // Construct the secure Google Books URL
    const googleBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchQuery)}&key=${apiKey}`;

    try {
        const response = await fetch(googleBooksUrl);
        const data = await response.json();

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed fetching book covers" })
        };
    }
};