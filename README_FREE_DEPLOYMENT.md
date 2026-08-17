# Free deployment plan

## Architecture

- Frontend/API: Vercel Free Tier
- Database: Free PostgreSQL provider with pgvector support
- AI: OpenAI-compatible endpoint or free provider

## Required variables

See `.env.example`.

## Current modules

- Authentication API
- Chat API
- Document API
- Knowledge API
- Health check API
- Drizzle PostgreSQL layer

## Next implementation steps

1. Complete document ingestion pipeline.
2. Connect embeddings and vector search.
3. Connect UI to APIs.
4. Verify Vercel build.
