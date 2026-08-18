# ENTERPRISE GAP ANALYSIS
## Enterprise Offline AI Knowledge & Organizational Experience Platform
### Forensic Audit Report — PHASE 0

**Date:** 2025  
**Auditor:** Enterprise Engineering Team  
**Repository:** aftabcollege-gif/Chatbot (main branch)  
**Sandbox State:** Arena Next.js PostgreSQL Starter (bare template)

---

## 1. EXISTING ARCHITECTURE ASSESSMENT

### 1.1 Local Sandbox (Current Build Target)
The local sandbox contains only a bare Next.js + PostgreSQL starter template:
- `src/db/schema.ts` — Empty (only `export {}`), no tables defined
- `src/db/index.ts` — Drizzle + pg Pool connection (functional)
- `src/app/page.tsx` — Static placeholder page with DB health check
- `src/app/api/health/route.ts` — Minimal health check endpoint
- `src/app/globals.css` — Tailwind import only
- No authentication, no UI modules, no domain logic

### 1.2 GitHub Repository (aftabcollege-gif/Chatbot — Reference Codebase)
The GitHub repo has a substantially more developed codebase:

#### Working/Partially Implemented Features:
| Feature | Status | Quality |
|---|---|---|
| Database Schema (Organizations, Users, Roles, Documents, Knowledge, Conversations, Messages, Audit) | PARTIAL | Good structure, missing: Experience table, proper versioning, HNSW indexes |
| Authentication (JWT + sessions) | PARTIAL | JWT verify present, but no refresh token rotation, no rate limiting |
| Local Embedding (HashingVectorizer) | WORKING | Functional but NOT semantic — uses hashing trick, not real embeddings |
| RAG Pipeline | PARTIAL | Retrieves docs + knowledge, but falls back silently to cloud API |
| Document Text Extraction | PARTIAL | PDF, DOCX, TXT, MD, CSV only — missing XLSX, PPTX, ODT, RTF, images with OCR, ZIP |
| Vector Search | PARTIAL | In-memory cosine similarity (loads ALL chunks into RAM — scalability blocker) |
| Chunking | PARTIAL | Basic text chunking present |
| Audit Logging | PARTIAL | Basic event logging, no immutability enforcement |
| Chat UI | EXISTS | Functional but no streaming, no RAG trace UI |
| Knowledge Management | PARTIAL | DRAFT→APPROVED workflow but missing PUBLISHED, ARCHIVED states |
| Admin Dashboard | PARTIAL | Exists but incomplete |
| Search | PARTIAL | Combines document + knowledge search |

#### Missing Critical Features:
- **Experience Management Module** — Completely absent
- **Experience-as-Source RAG Integration** — Not implemented
- **Real Local LLM** — Only hashing trick "local" embedding; LLM defaults to cloud API
- **Real Local Embedding Model** — HashingVectorizer is NOT a real embedding model
- **OCR Pipeline** — Completely absent
- **Background Job System** — No queue, retry, backoff, or progress tracking
- **Document Versioning** — Schema has single version; no DocumentVersion table
- **RBAC Enforcement** — UI hides buttons but server-side permission check is minimal
- **Tenant Isolation** — organizationId present but not enforced in all queries
- **Windows Installer** — Not present
- **Backup/Restore System** — Not present
- **Performance Indexes** — Missing HNSW, full-text search indexes
- **Rate Limiting** — Not implemented
- **CSRF Protection** — Not present
- **Persian RTL UI** — Not RTL; no Jalali date display
- **Setup Wizard** — Referenced in page.tsx but not fully implemented

---

## 2. CRITICAL SECURITY ISSUES

### 2.1 BLOCKER: Silent Cloud Fallback (Violates Directive §15)
```
// In src/lib/rag.ts:
if (isAIConfigured()) {
  try { 
    return await aiChat(...); // CALLS EXTERNAL CLOUD API
  } catch (error) {
    console.error("...falling back to local extractive answer:", error);
    // SILENT FALLBACK — user never informed
  }
}
```
**Risk:** Data exfiltration to external cloud services without user knowledge.  
**Classification:** PRODUCTION BLOCKER — violates zero-compromise rule.

### 2.2 BLOCKER: Fake Embedding (Not Real Semantic Search)
The "local embedding" is a HashingVectorizer (FNV hash + bigrams). This is:
- NOT a trained neural embedding model
- NOT semantically aware
- Only measures lexical token overlap
- Will fail on synonyms, paraphrasing, domain-specific Persian terms
**Classification:** PRODUCTION BLOCKER — RAG quality will be unacceptably poor.

### 2.3 BLOCKER: Unbounded Memory Query in Vector Search
```typescript
// src/lib/vector-search.ts — loads ALL document chunks into application memory:
const rows = await db.select({...}).from(documentChunks)...
// No LIMIT clause — at 100k+ chunks, this will OOM crash the server
```
**Classification:** PRODUCTION BLOCKER — scalability failure.

### 2.4 HIGH: Weak JWT Secret Default
```typescript
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-this-to-random-64-char-string"  // FALLBACK!
);
```
If `JWT_SECRET` is not set, the system uses a predictable public string.

### 2.5 HIGH: No Rate Limiting
Login, chat, upload, and AI generation endpoints have no rate limiting.

### 2.6 HIGH: No CSRF Protection
API routes have no CSRF token validation.

### 2.7 MEDIUM: Incomplete Tenant Isolation
`organizationId` filtering is applied inconsistently across queries.

### 2.8 MEDIUM: No File Upload Security
Upload validation lacks: MIME sniffing, path traversal prevention, zip bomb protection, content-based type verification.

---

## 3. DATA MODEL PROBLEMS

### 3.1 Missing Tables (Required by Directive §21):
- `experiences` — Organizational experience entries
- `experience_versions` — Version history for experiences  
- `document_versions` — Immutable document versioning
- `knowledge_versions` — Version history for knowledge items
- `processing_jobs` — Background job tracking
- `attachments` — File attachments for experiences/knowledge
- `feedback` — Dedicated feedback table (currently inline in messages)
- `embeddings` — Separate embedding storage table

### 3.2 Schema Quality Issues:
- `knowledgeItems` conflates "knowledge" with "experience" fields (problemDescription, actionTaken, lessonLearned belong to experience)
- `documents.status` uses varchar without CHECK constraint
- No `deleted_at` soft-delete column on any table
- `documentChunks.embedding` stored as jsonb — works but cannot use pgvector HNSW indexing
- Missing composite indexes for common query patterns (org+status, org+dept+status)

---

## 4. AI / RAG PROBLEMS

### 4.1 LLM: No Real Local LLM
- The current system has NO local LLM capability whatsoever
- "Local" means hashing trick + extractive answer stitching from retrieved text
- The real LLM path calls an external OpenAI-compatible API
- **Required:** Integration with llama.cpp via node-llama-cpp or ollama REST API

### 4.2 Embedding: HashingVectorizer ≠ Real Embedding
- Required: multilingual-e5-large or BAAI/bge-m3 (ONNX runtime, local)
- Current implementation cannot handle semantic similarity

### 4.3 RAG Pipeline Issues:
- No Reranking (BAAI/bge-reranker-v2-m3 required)
- No Hybrid Search (Semantic + BM25 keyword fusion)
- No Context budget management
- No Conversation summarization
- Citations built from LLM output, not from retrieval system
- Experience source type not distinguished in citations

### 4.4 OCR: Completely Missing
- Required: Tesseract OCR with Persian language pack
- No support for scanned PDFs or image-based documents

---

## 5. UX PROBLEMS

### 5.1 Not RTL
- Globals.css has no `direction: rtl` or `font-family` for Persian
- No Jalali date display
- No Persian-specific typography

### 5.2 Missing UI Modules:
- Experience Management UI (create, edit, submit, review, approve, publish)
- Document Management with proper upload pipeline status
- Review & Governance workflow UI
- System Health & Monitoring dashboard
- Backup & Restore UI
- Job Queue monitor
- RAG Trace viewer (for admins)
- Organization & Department management

---

## 6. INFRASTRUCTURE PROBLEMS

### 6.1 No Background Job System
Document processing (OCR → Extract → Chunk → Embed → Index) runs synchronously in request handler. This will timeout for large documents.

### 6.2 No pgvector
Schema uses `jsonb` for embeddings instead of pgvector `vector` type. While functional at small scale, cannot use HNSW index at 1M+ chunks.

### 6.3 No Storage Abstraction
Files are stored to filesystem paths but there's no StorageProvider interface, no SHA-256 verification, no path traversal prevention.

### 6.4 No Windows Installer
No packaging, no offline installer, no Windows-specific deployment artifacts.

### 6.5 No CI/CD Pipeline
No GitHub Actions, no test pipeline, no build gate.

---

## 7. TESTING PROBLEMS

### 7.1 No Tests Whatsoever
- Zero unit tests
- Zero integration tests  
- Zero security tests
- Zero RAG evaluation tests
- Zero E2E tests

---

## 8. RECOMMENDED ARCHITECTURE

### 8.1 Data Architecture
```
PostgreSQL (with pgvector extension)
├── Core tables: organizations, departments, users, roles, permissions
├── Content tables: documents, document_versions, document_chunks
├── Knowledge tables: knowledge_items, knowledge_versions, knowledge_tags
├── Experience tables: experiences, experience_versions, experience_attachments
├── RAG tables: embeddings (pgvector), message_sources
├── System tables: processing_jobs, audit_logs, system_settings, setup_status
└── Session tables: sessions
```

### 8.2 AI Architecture (Offline-First)
```
Application
└── AI Orchestrator (src/lib/ai/orchestrator.ts)
    ├── LLMProvider Interface
    │   └── OllamaLLMProvider (calls local Ollama: Qwen2.5-7B-Instruct)
    ├── EmbeddingProvider Interface  
    │   └── OllamaEmbeddingProvider (local mxbai-embed-large or nomic-embed-text)
    └── RerankProvider Interface
        └── LocalRerankProvider (cross-encoder via Transformers.js ONNX)
```

### 8.3 Document Processing Pipeline
```
Upload → Validate → Hash(SHA256) → Store → Queue Job
→ Worker: Extract Text (Parser by MIME type)
         → OCR if needed (Tesseract.js)
         → Normalize (Persian chars)
         → Structure Detection
         → Chunk (sliding window, 512 tokens, 50 token overlap)
         → Embed (batch, Ollama/local)
         → Index (pgvector)
         → Update status: READY
```

### 8.4 RAG Pipeline
```
User Query → Auth/Permission Check → Embed Query
→ Vector Search (pgvector HNSW) + BM25 Keyword Search
→ Fusion (RRF algorithm)
→ Rerank (cross-encoder)
→ Permission Filter (per-chunk org/dept/visibility)
→ Context Assembly (with budget)
→ LLM (Ollama, Qwen2.5-7B-Instruct)
→ Answer + Citations (from retrieval, NOT from LLM)
→ Audit Log
```

---

## 9. PRODUCTION BLOCKERS (Must Fix Before Any Phase 1+)

| # | Blocker | Severity | Category |
|---|---|---|---|
| B-01 | Silent cloud fallback in RAG (src/lib/rag.ts) | CRITICAL | Security |
| B-02 | Fake local embedding (HashingVectorizer) | CRITICAL | AI Quality |
| B-03 | Unbounded memory query in vector-search.ts | CRITICAL | Performance |
| B-04 | No real local LLM integration | CRITICAL | AI |
| B-05 | Empty schema in local sandbox | CRITICAL | Foundation |
| B-06 | No Experience module | CRITICAL | Feature |
| B-07 | No OCR pipeline | HIGH | Feature |
| B-08 | No background job system | HIGH | Architecture |
| B-09 | No RBAC server-side enforcement | HIGH | Security |
| B-10 | No rate limiting | HIGH | Security |
| B-11 | Weak JWT secret default | HIGH | Security |
| B-12 | No CSRF protection | HIGH | Security |
| B-13 | No tests | HIGH | Quality |
| B-14 | No backup/restore | HIGH | Operations |
| B-15 | Non-RTL UI | MEDIUM | UX |
| B-16 | No Jalali date display | MEDIUM | UX |
| B-17 | No Windows installer | MEDIUM | Deployment |

---

## 10. MIGRATION PLAN

### Phase 1 (Architecture Hardening):
- Establish proper Next.js App Router domain structure
- Fix env validation (FAIL FAST)
- Remove silent cloud fallback
- Add RTL CSS foundation
- Set up proper error boundaries

### Phase 2 (Data Architecture):
- Implement full schema (all tables from directive §21)
- Add pgvector support
- Create proper indexes
- Apply migrations

### Phase 3 (Identity & Access):
- Full RBAC with 7 roles + granular permissions
- Session management (HttpOnly, SameSite, expiry, revocation)
- Rate limiting (login, chat, upload, AI)
- Audit logging for all sensitive events
- Multi-tenant enforcement at every layer

### Phase 4-5 (Local AI Runtime):
- Ollama integration (LLM + Embedding providers)
- Provider interface with NO cloud fallback in production registry
- Model verification (checksum)
- Graceful degradation (not crash) when model unavailable

### Phase 6-7 (RAG & Search):
- Hybrid search (pgvector HNSW + BM25 tsvector)
- Reranking pipeline
- Permission-aware retrieval
- Citation system from retrieval (not LLM)
- Conversation context budget

### Phase 8-9 (Document Management):
- Universal document parser (DocumentParser interface)
- OCR pipeline (Tesseract.js with Persian)
- Background job system
- Document versioning (immutable)
- File integrity (SHA-256)

### Phase 10-11 (Knowledge & Experience):
- Knowledge management (full workflow)
- Experience management (DRAFT → PUBLISHED)
- Experience-as-Source RAG integration
- Citation type distinction (document vs experience)

### Phase 12-23 (Governance, Security, Testing, Deployment):
- Review & approval workflows
- Security hardening
- Complete test suite
- Performance optimization
- Backup/restore system
- Offline acceptance testing
- Windows installer (future phase)

---

## 11. AUDIT SCORES (Current State)

| Dimension | Score | Critical Issues |
|---|---|---|
| Security | 15/100 | Silent cloud fallback, no CSRF, no rate limiting, weak JWT default |
| AI / RAG | 10/100 | Fake embedding, no real LLM, no reranking, no hybrid search |
| Data Architecture | 30/100 | Good base but missing tables, no pgvector, no versioning |
| Feature Completeness | 20/100 | No experience module, no OCR, no job system |
| Performance | 15/100 | Unbounded memory query, no HNSW index, sync processing |
| Testing | 0/100 | Zero tests |
| UX | 20/100 | Not RTL, no Jalali dates, incomplete modules |
| Observability | 25/100 | Basic audit log exists but incomplete |
| Offline Capability | 5/100 | Claims offline but has cloud LLM fallback |
| Documentation | 5/100 | README_FREE_DEPLOYMENT.md only |
| **Overall** | **15/100** | **NOT PRODUCTION READY** |

---

*End of PHASE 0 — FORENSIC AUDIT*  
*Next: PHASE 1 — Architecture Hardening*
