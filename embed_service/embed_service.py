# embed_service/embed_service.py
from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import os

app = Flask(__name__)
MODEL_NAME = os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2")
print("Loading model:", MODEL_NAME)
model = SentenceTransformer(MODEL_NAME)

@app.route("/embed", methods=["POST"])
def embed():
    data = request.json or {}
    if "text" in data:
        emb = model.encode(data["text"]).tolist()
        return jsonify({"embedding": emb})
    if "texts" in data:
        emb = model.encode(data["texts"]).tolist()
        return jsonify({"embeddings": emb})
    return jsonify({"error": "send {text:..., or texts: [...] }"}), 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
