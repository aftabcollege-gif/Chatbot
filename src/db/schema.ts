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
  slug: varchar("slug", { length: 120 }).unique(),
  description: text("description"),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
  isActive: boolean("is_active").notNull().default(true),
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
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("departments_org_idx").on(t.organizationId)],
);

// ---------------------------------------------------------------------------
// Roles, Permissions, Users & Sessions (RBAC)
// ---------------------------------------------------------------------------

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 100 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 50 }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("permissions_code_idx").on(t.code)],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("roles_org_idx").on(t.organizationId)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_roles_user_role_idx").on(t.userId, t.roleId)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("role_permissions_role_perm_idx").on(t.roleId, t.permissionId)],
);

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
    username: varchar("username", { length: 100 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    isSuperadmin: boolean("is_superadmin").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lastLogin: timestamp("last_login", { withTimezone: true }),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_org_email_idx").on(t.organizationId, t.email),
    uniqueIndex("users_username_idx").on(t.username),
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
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfSecret: text("csrf_secret"),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),
    isRevoked: boolean("is_revoked").notNull().default(false),
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
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    subject: varchar("subject", { length: 255 }),
    problemDescription: text("problem_description").notNull(),
    rootCause: text("root_cause"),
    actionsTaken: text("actions_taken").notNull(),
    results: text("results"),
    lessonsLearned: text("lessons_learned").notNull(),
    suggestion: text("suggestion"),
    relatedEquipment: varchar("related_equipment", { length: 500 }),
    relatedProcess: varchar("related_process", { length: 500 }),
    importance: varchar("importance", { length: 20 }).notNull().default("MEDIUM"),
    visibility: varchar("visibility", { length: 20 }).notNull().default("department"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    embedding: jsonb("embedding").$type<number[]>(),
    version: integer("version").notNull().default(1),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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

export const experienceTags = pgTable(
  "experience_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    tag: varchar("tag", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("experience_tags_exp_idx").on(t.experienceId)],
);

// ---------------------------------------------------------------------------
// Knowledge items (curated organizational knowledge with review workflow)
// ---------------------------------------------------------------------------

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    subject: varchar("subject", { length: 255 }),
    content: text("content").notNull(),
    summary: text("summary"),
    visibility: varchar("visibility", { length: 20 }).notNull().default("department"),
    embedding: jsonb("embedding").$type<number[]>(),
    status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_items_org_idx").on(t.organizationId)],
);

export const knowledgeTags = pgTable(
  "knowledge_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    knowledgeId: uuid("knowledge_id")
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: "cascade" }),
    tag: varchar("tag", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_tags_knowledge_idx").on(t.knowledgeId)],
);

// ---------------------------------------------------------------------------
// Knowledge chunks: unified vector + keyword index for RAG
// (covers documents and experiences)
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
    messageCount: integer("message_count").notNull().default(0),
    isPinned: boolean("is_pinned").notNull().default(false),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(), // 'user' | 'assistant' | 'system'
    content: text("content").notNull(),
    confidenceScore: real("confidence_score"),
    responseTimeMs: integer("response_time_ms"),
    ragTrace: jsonb("rag_trace").$type<unknown>(),
    citations: jsonb("citations").$type<CitationRecord[]>().default([]),
    retrievalScore: real("retrieval_score"),
    tokensUsed: integer("tokens_used"),
    latencyMs: integer("latency_ms"),
    grounded: boolean("grounded").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

export const messageSources = pgTable(
  "message_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 20 }).notNull(),
    sourceId: uuid("source_id").notNull(),
    chunkId: uuid("chunk_id"),
    pageNumber: integer("page_number"),
    section: varchar("section", { length: 300 }),
    heading: varchar("heading", { length: 300 }),
    relevanceScore: real("relevance_score"),
    citationIndex: integer("citation_index").notNull(),
    excerpt: text("excerpt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_sources_message_idx").on(t.messageId)],
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
    actorId: uuid("actor_id"),
    actorName: varchar("actor_name", { length: 200 }),
    actorRole: varchar("actor_role", { length: 100 }),
    eventCode: varchar("event_code", { length: 100 }),
    action: varchar("action", { length: 100 }),
    resourceType: varchar("resource_type", { length: 50 }),
    resourceId: uuid("resource_id"),
    resourceName: varchar("resource_name", { length: 500 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    requestId: varchar("request_id", { length: 64 }),
    outcome: varchar("outcome", { length: 20 }).notNull().default("SUCCESS"),
    severity: varchar("severity", { length: 20 }).notNull().default("INFO"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_idx").on(t.organizationId),
    index("audit_logs_action_idx").on(t.eventCode, t.action),
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

// ---------------------------------------------------------------------------
// System settings (DB-backed runtime configuration)
// ---------------------------------------------------------------------------

export const systemSettings = pgTable(
  "system_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 100 }).notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    description: text("description"),
    category: varchar("category", { length: 50 }),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("system_settings_key_idx").on(t.key)],
);

// ---------------------------------------------------------------------------
// Setup status (initial setup wizard state)
// ---------------------------------------------------------------------------

export const setupStatus = pgTable("setup_status", {
  id: integer("id").primaryKey().default(1),
  completed: boolean("completed").notNull().default(false),
  currentStep: integer("current_step").notNull().default(1),
  organizationName: varchar("organization_name", { length: 255 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Rate limiting store (per-key sliding window, DB backed)
// ---------------------------------------------------------------------------

export const rateLimitAttempts = pgTable(
  "rate_limit_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 200 }).notNull(),
    action: varchar("action", { length: 50 }).notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_limit_attempts_key_action_idx").on(t.key, t.action)],
);
