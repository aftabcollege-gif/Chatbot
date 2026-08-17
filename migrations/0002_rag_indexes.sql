CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx ON document_chunks USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_items_embedding_hnsw_idx ON knowledge_items USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;
