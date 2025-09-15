#!/usr/bin/env python
import requests, uuid, time, os
from sentence_transformers import SentenceTransformer
import feedparser
import newspaper
from tqdm import tqdm

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
COLLECTION = os.environ.get("QDRANT_COLLECTION", "news_passages")
MODEL_NAME = os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2")
BATCH_SIZE = 64

model = SentenceTransformer(MODEL_NAME)

def chunk_text(text, max_words=200, overlap=40):
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunks.append(" ".join(words[i:i+max_words]))
        i += max_words - overlap
    return chunks

def ensure_collection(vec_size=384):
    url = f"{QDRANT_URL}/collections/{COLLECTION}"
    data = {"vectors": {"size": vec_size, "distance": "Cosine"}}
    r = requests.put(url, json=data)
    print("create collection status:", r.status_code, r.text[:200])

FEEDS = [
    "http://feeds.reuters.com/reuters/topNews",
    "http://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
]

def fetch_articles_from_feed(feed_url, limit=20):
    d = feedparser.parse(feed_url)
    items = []
    for entry in d.entries[:limit]:
        link = entry.get("link")
        title = entry.get("title", "")
        if link:
            items.append({"link": link, "title": title})
    return items

def upsert_batch(points):
    url = f"{QDRANT_URL}/collections/{COLLECTION}/points?wait=true"
    body = {"points": points}
    r = requests.put(url, json=body)  # use PUT not POST
    if r.status_code not in (200, 201):
        print("Upsert failed:", r.status_code, r.text[:400])
    return r

def main():
    print("Using embedding model:", MODEL_NAME)
    vec_size = model.get_sentence_embedding_dimension()
    ensure_collection(vec_size=vec_size)

    points = []
    for feed in FEEDS:
        print("Parsing feed:", feed)
        articles = fetch_articles_from_feed(feed, limit=30)

        for art in articles:
            link = art["link"]
            title = art.get("title", "")
            try:
                a = newspaper.Article(link)
                a.download()
                a.parse()
                text = a.text.strip()
                if not text or len(text.split()) < 50:
                    continue

                chunks = chunk_text(text, max_words=200, overlap=40)
                embeddings = model.encode(chunks)

                for i, chunk in enumerate(chunks):
                    pid = str(uuid.uuid4())
                    point = {
                        "id": pid,
                        "vector": embeddings[i].tolist(),
                        "payload": {
                            "text": chunk,
                            "title": title,
                            "url": link,
                            "chunk_idx": i
                        }
                    }
                    points.append(point)

                    if len(points) >= BATCH_SIZE:
                        print("Upserting batch", len(points))
                        upsert_batch(points)
                        points = []
                        time.sleep(0.5)

            except Exception as e:
                print("skip", link, e)

    if points:
        print("Upserting final batch", len(points))
        upsert_batch(points)

    print("Done ingesting.")

if __name__ == "__main__":
    main()
