#!/usr/bin/env bash
# create_qdrant_collection.sh
# Usage: bash scripts/create_qdrant_collection.sh

QDRANT_URL=${QDRANT_URL:-"http://localhost:6333"}
COLLECTION=${QDRANT_COLLECTION:-"news_passages"}
VEC_SIZE=${1:-384}  # default 384 (all-MiniLM-L6-v2)

# Check if collection exists
EXISTS=$(curl -s "${QDRANT_URL}/collections/${COLLECTION}" | jq -r '.status.error // empty')

if [[ "$EXISTS" == "Collection already exists" ]] || [[ "$EXISTS" == "" ]]; then
    echo "Collection '${COLLECTION}' already exists. Skipping creation."
else
    echo "Creating collection ${COLLECTION} at ${QDRANT_URL} [vector size=${VEC_SIZE}]..."
    curl -s -X PUT "${QDRANT_URL}/collections/${COLLECTION}" \
      -H "Content-Type: application/json" \
      -d "{
        \"vectors\": { \"size\": ${VEC_SIZE}, \"distance\": \"Cosine\" }
      }" | jq .
    echo "Collection created successfully."
fi
