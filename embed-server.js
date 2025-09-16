// embed-server.js
const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");

// Xenova Transformers (works fully in Node.js without API key)
const { pipeline } = require("@xenova/transformers");


dotenv.config();

const app = express();
app.use(bodyParser.json());

let embedder;

// Load model once at startup
(async () => {
    console.log("⏳ Loading embedding model...");
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("✅ Model loaded successfully!");
})();

// POST /embed
// Body: { "text": "Your sentence here" }
app.post("/embed", async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || typeof text !== "string") {
            return res.status(400).json({ error: "Missing or invalid 'text' field" });
        }

        if (!embedder) {
            return res.status(503).json({ error: "Model is still loading, try again later." });
        }

        // Generate embeddings
        const output = await embedder(text, { pooling: "mean", normalize: true });
        const embedding = Array.from(output.data);

        res.json({
            text,
            vector: embedding,
            dimensions: embedding.length,
        });
    } catch (err) {
        console.error("❌ Error generating embedding:", err);
        res.status(500).json({ error: "Failed to generate embedding" });
    }
});

// Health check
app.get("/", (req, res) => {
    res.send("✅ HuggingFace Embedding server is running!");
});

// Start server
const PORT = 5001;
app.listen(PORT, () => {
    console.log(`🚀 Embedding server listening on http://localhost:${PORT}`);
});
