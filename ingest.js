// ingest.js
// ingest.js (CommonJS)
const axios = require("axios");
const RSSParser = require("rss-parser");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const cheerio = require("cheerio");
dotenv.config();

// Dynamic fetch for Node 18+
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION = process.env.QDRANT_COLLECTION || "news_passages";
const EMBED_PROVIDER = process.env.EMBED_PROVIDER || "huggingface"; // "openai" or "huggingface"
const BATCH_SIZE = 64;

const FEEDS = [
    // Global general news
    "https://feeds.reuters.com/reuters/topNews",
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://www.theguardian.com/world/rss",
    "https://www.cnn.com/rss/edition.rss",

    // Technology
    "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://www.theverge.com/rss/index.xml",

    // Sports
    "https://www.espn.com/espn/rss/news",
    "https://feeds.bbci.co.uk/sport/rss.xml",

    // Business
    "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
    "https://www.bloomberg.com/feed/podcast/etf-report.xml",

    // Science / Health
    "https://www.sciencemag.org/rss/news_current.xml",
    "https://www.nature.com/subjects/health/rss.xml",
];


// ================= EMBEDDING =================
async function getEmbedding(text) {
    try {
        const r = await axios.post(
            "http://localhost:5001/embed",
            { text },
            { timeout: 60000 }
        );
        return r.data.vector; // embedding array
    } catch (err) {
        console.error("embedText error:", err?.response?.data || err.message);
        return null;
    }
}

// ================= HELPERS =================
function chunkText(text, maxWords = 200, overlap = 40) {
    const words = text.split(/\s+/);
    const chunks = [];
    let i = 0;
    while (i < words.length) {
        chunks.push(words.slice(i, i + maxWords).join(" "));
        i += maxWords - overlap;
    }
    return chunks;
}

async function ensureCollection(vecSize = 384) {
    const url = `${QDRANT_URL}/collections/${COLLECTION}`;
    const data = { vectors: { size: vecSize, distance: "Cosine" } };
    try {
        const r = await axios.put(url, data);
        console.log("✅ Collection ensured:", r.status, r.data?.status || r.data);
    } catch (err) {
        console.error("❌ Collection create error:", err.response?.data || err.message);
    }
}

async function upsertBatch(points) {
    if (!points.length) return;
    const url = `${QDRANT_URL}/collections/${COLLECTION}/points?wait=true`;
    try {
        const r = await axios.put(url, { points });
        console.log(`📌 Upserted ${points.length} points →`, r.status);
    } catch (err) {
        console.error("❌ Upsert failed:", err.response?.data || err.message);
    }
}

// Extract article text
async function extractArticleText(url) {
    try {
        const res = await fetch(url, { timeout: 20000 });
        const html = await res.text();
        const $ = cheerio.load(html);
        const text = $("p").map((_, el) => $(el).text()).get().join(" ").replace(/\s+/g, " ").trim();
        return text;
    } catch (err) {
        console.error("⚠️ Failed to extract article:", url, err.message);
        return "";
    }
}

// ================= MAIN =================
async function main() {
    console.log("🚀 Starting ingestion...");

    // Vector size: 1536 for OpenAI, 384 for HuggingFace
    const vecSize = EMBED_PROVIDER === "openai" ? 1536 : 384;
    await ensureCollection(vecSize);

    const parser = new RSSParser();
    let points = [];

    for (const feedUrl of FEEDS) {
        try {
            console.log("🌐 Parsing feed:", feedUrl);
            const feed = await parser.parseURL(feedUrl);

            for (const entry of feed.items.slice(0, 30)) {
                const link = entry.link;
                const title = entry.title || "";

                try {
                    const text = await extractArticleText(link);
                    if (!text || text.split(/\s+/).length < 50) continue;

                    const chunks = chunkText(text);
                    for (let i = 0; i < chunks.length; i++) {
                        const emb = await getEmbedding(chunks[i]);
                        if (!emb) continue;

                        const pid = uuidv4();
                        const point = {
                            id: pid,
                            vector: emb,
                            payload: { text: chunks[i], title, url: link, chunk_idx: i },
                        };
                        points.push(point);

                        if (points.length >= BATCH_SIZE) {
                            await upsertBatch(points);
                            points = [];
                        }
                    }
                } catch (err) {
                    console.error("⚠️ Skip article", link, "-", err.message);
                }
            }
        } catch (err) {
            console.error("❌ Failed to fetch feed:", feedUrl, "-", err.message);
        }
    }

    if (points.length) {
        await upsertBatch(points);
    }

    console.log("✅ Done ingesting.");
}

main();
