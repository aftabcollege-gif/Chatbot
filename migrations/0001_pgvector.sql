CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE document_chunks
ADD COLUMN IF NOT EXISTS embedding vector(1536);

ALTER TABLE knowledge_items
ADD COLUMN IF NOT EXISTS embedding vector(1536);
