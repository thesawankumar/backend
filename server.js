// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const Redis = require("ioredis");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.FRONTEND_ORIGIN || "*" } });

app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));

// env
const PORT = process.env.PORT || 8080;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const SESSION_TTL = parseInt(process.env.SESSION_TTL_SECONDS || "604800", 10);
const EMBED_URL = process.env.EMBEDDING_URL || "http://localhost:5000";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "news_passages";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const GEMINI_API_URL = process.env.GEMINI_API_URL || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// Redis client
const redis = new Redis(REDIS_URL);
redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (e) => console.error("❌ Redis error:", e.message));

// Helpers
async function appendToSession(sessionId, role, text) {
    const key = `session:${sessionId}`;
    const raw = await redis.get(key);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ role, text, ts: Date.now() });
    await redis.set(key, JSON.stringify(arr), "EX", SESSION_TTL);
}

app.post("/api/session", async (req, res) => {
    const id = uuidv4();
    await redis.set(`session:${id}`, JSON.stringify([]), "EX", SESSION_TTL);
    res.json({ sessionId: id });
});

app.get("/api/session/:id/history", async (req, res) => {
    const raw = await redis.get(`session:${req.params.id}`);
    res.json({ history: raw ? JSON.parse(raw) : [] });
});

app.post("/api/session/:id/clear", async (req, res) => {
    await redis.del(`session:${req.params.id}`);
    res.json({ ok: true });
});

// embedding microservice call
async function embedText(text) {
    try {
        const r = await axios.post(`${EMBED_URL}/embed`, { text }, { timeout: 60000 });
        if (r.data && r.data.embedding) return r.data.embedding;
        throw new Error("bad shape from embedding service");
    } catch (err) {
        console.error("embedText error:", err.message);
        throw err;
    }
}

// qdrant vector search
async function qdrantSearchByVector(vector, limit = 5) {
    try {
        const url = `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/search`;
        const headers = {};
        if (QDRANT_API_KEY) headers["api-key"] = QDRANT_API_KEY;
        const resp = await axios.post(url, { vector, limit, with_payload: true }, { headers, timeout: 30000 });
        return resp.data.result || resp.data;
    } catch (err) {
        console.error("qdrant search err:", err?.response?.data || err?.message);
        throw err;
    }
}

// build prompt from retrieved passages
function buildPrompt(retrieved, question) {
    const context = (retrieved || []).map((p, i) => {
        const payload = p.payload || {};
        const title = payload.title || "";
        const url = payload.url || "";
        const text = payload.text || "";
        return `PASSAGE ${i + 1} (${title} ${url ? "- " + url : ""}):\n${text}`;
    }).join("\n\n---\n\n");

    return `You are a helpful assistant. Use ONLY the CONTEXT passages below to answer the user's question. If the answer is not in the context, reply "I don't know from the provided articles."

CONTEXT:
${context}

QUESTION:
${question}

Answer concisely and cite the source title and url if possible.`;
}

// call Gemini (basic wrapper) with fallback
// call Gemini (basic wrapper) with fallback
async function callGemini(prompt) {
    if (!GEMINI_API_URL || !GEMINI_API_KEY) {
        // fallback: return short synthesized answer from prompt (NOT a real LLM)
        const preview = prompt.slice(0, 600);
        return `NOTE: Gemini not configured. Returning context preview:\n\n${preview}\n\n(Configure GEMINI_API_URL/GEMINI_API_KEY to use Gemini.)`;
    }

    try {
        const resp = await axios.post(
            `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,   // ✅ key in query param
            {
                contents: [
                    {
                        parts: [{ text: prompt }],       // ✅ correct payload shape
                    },
                ],
            },
            {
                headers: { "Content-Type": "application/json" }, // ✅ no Bearer header
                timeout: 120000,
            }
        );

        // ✅ safely extract the text
        return resp.data?.candidates?.[0]?.content?.parts?.[0]?.text
            || JSON.stringify(resp.data);
    } catch (err) {
        console.error("callGemini err:", err?.response?.data || err.message);
        throw err;
    }
}

// REST chat endpoint (non-stream)
app.post("/api/chat", async (req, res) => {
    try {
        const { sessionId, message } = req.body;
        if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message required" });

        await appendToSession(sessionId, "user", message);
        const vector = await embedText(message);
        const results = await qdrantSearchByVector(vector, 5);
        const prompt = buildPrompt(results, message);
        const answer = await callGemini(prompt);
        await appendToSession(sessionId, "assistant", answer);
        res.json({ answer });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || "server error" });
    }
});

// Socket.io streaming (simulated)
io.on("connection", (socket) => {
    console.log("socket connected", socket.id);

    socket.on("send_message", async ({ sessionId, message }) => {
        if (!sessionId || !message) {
            socket.emit("assistant_error", { message: "sessionId & message required" });
            return;
        }
        try {
            await appendToSession(sessionId, "user", message);
            const vector = await embedText(message);
            const results = await qdrantSearchByVector(vector, 5);
            const prompt = buildPrompt(results, message);
            const fullAnswer = await callGemini(prompt);

            // simulate streaming: emit chunks
            const CHUNK_SIZE = 120;
            for (let i = 0; i < fullAnswer.length; i += CHUNK_SIZE) {
                const chunk = fullAnswer.slice(i, i + CHUNK_SIZE);
                socket.emit("assistant_chunk", { chunk, done: false });
                await new Promise((r) => setTimeout(r, 40));
            }
            socket.emit("assistant_chunk", { chunk: "", done: true });
            await appendToSession(sessionId, "assistant", fullAnswer);
        } catch (err) {
            console.error(err);
            socket.emit("assistant_error", { message: err.message || "server error" });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});
