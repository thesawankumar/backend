Backend – AI Chat with Qdrant, Redis & Gemini

This is the backend for the AI-powered chat application.
It integrates Qdrant (Vector DB) for semantic search, Redis for session storage, and Google Gemini API for generating responses.

🚀 Tech Stack

Node.js + Express – API server

Qdrant – Vector database for storing embeddings

Redis – Session & cache management

Google Gemini API – LLM response generation

📂 Project Structure
backend/
├──embed_services
├──ingest
├── scripts/
│ └── create_qdrant_collection.sh # Script to init collection
├──server.js #Entry point
├── .env # Environment variables
├── package.json
└── README.md

⚙️ Setup

1. Clone repo
   git clone https://github.com/thesawankumar/backend.git
   cd ai-chat-backend

2. Install dependencies
   npm install

3. Configure environment

Create a .env file:

PORT=8080

# Qdrant

QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=news_passages

# Gemini API

GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
GEMINI_API_KEY=your-gemini-api-key

# Redis

REDIS_URL=redis://localhost:6379
SESSION_TTL_SECONDS=604800

# Frontend

FRONTEND_ORIGIN=http://localhost:5173

▶️ Running the Backend
Start server
npm run dev

Create Qdrant Collection
bash scripts/create_qdrant_collection.sh

📡 API Endpoints

1. Send Message
   POST /api/chat
   Content-Type: application/json
   {
   "sessionId": "abc123",
   "message": "Hello AI"
   }

➡️ Returns AI response and updates conversation history in Redis.

2. Get Session History
   GET /sessions/:id

➡️ Returns chat history for a session.

🐳 Using with Docker

Start services with Docker Compose:

docker-compose up -d
