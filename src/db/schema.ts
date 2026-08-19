import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  vector,
  index,
  uniqueIndex,
  customType,
  real,
} from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";

// Postgres tsvector custom type used for BM25-like full text keyword search.
const tsVector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const EMBEDDING_DIMENSIONS = 1024; // bge-m3 output dimensionality

// ---------------------------------------------------------------------------
// Organizations & Departments (multi-tenant isolation root)
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("departments_org_idx").on(t.organizationId)],
);

// ---------------------------------------------------------------------------
// Users, Roles & Sessions
// ---------------------------------------------------------------------------

export const userRoleEnum = ["admin", "manager", "member"] as const;
export type UserRole = (typeof userRoleEnum)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_org_email_idx").on(t.organizationId, t.email),
    index("users_org_idx").on(t.organizationId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfSecret: text("csrf_secret").notNull(),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Documents (organizational knowledge sources)
// ---------------------------------------------------------------------------

export const documentStatusEnum = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type DocumentStatus = (typeof documentStatusEnum)[number];

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 150 }).notNull(),
    fileSize: integer("file_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    storagePath: text("storage_path").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    ocrUsed: boolean("ocr_used").notNull().default(false),
    pageCount: integer("page_count"),
    errorMessage: text("error_message"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_org_idx").on(t.organizationId),
    index("documents_org_status_idx").on(t.organizationId, t.status),
    index("documents_sha256_idx").on(t.organizationId, t.sha256),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    storagePath: text("storage_path").notNull(),
    fileSize: integer("file_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("document_versions_doc_idx").on(t.documentId)],
);

// ---------------------------------------------------------------------------
// Experiences (organizational lessons-learned knowledge)
// ---------------------------------------------------------------------------

export const experienceStatusEnum = [
  "draft",
  "pending_approval",
  "approved",
  "published",
  "rejected",
] as const;
export type ExperienceStatus = (typeof experienceStatusEnum)[number];

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    problem: text("problem").notNull(),
    action: text("action").notNull(),
    result: text("result").notNull(),
    lessonLearned: text("lesson_learned").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("experiences_org_idx").on(t.organizationId),
    index("experiences_org_status_idx").on(t.organizationId, t.status),
  ],
);

export const experienceAttachments = pgTable(
  "experience_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 150 }).notNull(),
    fileSize: integer("file_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    storagePath: text("storage_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("experience_attachments_exp_idx").on(t.experienceId)],
);

// ---------------------------------------------------------------------------
// Knowledge chunks: unified vector + keyword index for RAG
// (covers both documents and experiences)
// ---------------------------------------------------------------------------

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 20 }).notNull(), // 'document' | 'experience'
    sourceId: uuid("source_id").notNull(),
    sourceVersion: integer("source_version").notNull().default(1),
    sourceTitle: varchar("source_title", { length: 500 }).notNull(),
    section: varchar("section", { length: 300 }),
    page: integer("page"),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    contentTsv: tsVector("content_tsv").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', ${knowledgeChunks.content})`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("knowledge_chunks_org_idx").on(t.organizationId),
    index("knowledge_chunks_source_idx").on(t.sourceType, t.sourceId),
    index("knowledge_chunks_tsv_idx").using("gin", t.contentTsv),
    index("knowledge_chunks_embedding_hnsw_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

// ---------------------------------------------------------------------------
// Background Processing Jobs
// ---------------------------------------------------------------------------

export const jobStatusEnum = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type JobStatus = (typeof jobStatusEnum)[number];

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(), // 'document_ingest' | 'experience_ingest'
    resourceId: uuid("resource_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    progress: integer("progress").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    error: text("error"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("processing_jobs_org_idx").on(t.organizationId),
    index("processing_jobs_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Conversations & Messages (local-only chat memory)
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 300 }).notNull().default("گفتگوی جدید"),
    summary: text("summary"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_org_user_idx").on(t.organizationId, t.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(), // 'user' | 'assistant' | 'system'
    content: text("content").notNull(),
    citations: jsonb("citations").$type<CitationRecord[]>().default([]),
    retrievalScore: real("retrieval_score"),
    tokensUsed: integer("tokens_used"),
    latencyMs: integer("latency_ms"),
    grounded: boolean("grounded").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

export type CitationRecord = {
  sourceType: "document" | "experience";
  sourceId: string;
  sourceTitle: string;
  page?: number | null;
  section?: string | null;
  chunkId: string;
  relevanceScore: number;
};

// ---------------------------------------------------------------------------
// Audit Logging
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 50 }),
    resourceId: uuid("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    ipAddress: varchar("ip_address", { length: 64 }),
    requestId: varchar("request_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_idx").on(t.organizationId),
    index("audit_logs_action_idx").on(t.action),
  ],
);

// ---------------------------------------------------------------------------
// Local Model Registry (Model Manager admin page)
// ---------------------------------------------------------------------------

export const modelRegistry = pgTable("model_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: varchar("type", { length: 20 }).notNull(), // 'llm' | 'embedding'
  name: varchar("name", { length: 200 }).notNull(),
  version: varchar("version", { length: 50 }).notNull(),
  filePath: text("file_path").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  fileSize: integer("file_size").notNull(),
  quantization: varchar("quantization", { length: 30 }),
  contextSize: integer("context_size"),
  runtime: varchar("runtime", { length: 40 }).notNull().default("llama.cpp"),
  status: varchar("status", { length: 20 }).notNull().default("installed"),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
});

// Rate limiting store (per-user / per-ip sliding window, DB backed so it
// survives process restarts and works across multiple server instances).
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucketKey: varchar("bucket_key", { length: 200 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("rate_limit_bucket_key_idx").on(t.bucketKey, t.windowStart)],
);
