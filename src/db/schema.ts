import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  real,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================
// ORGANIZATIONS & DEPARTMENTS
// ============================================================
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  settings: jsonb("settings").default({}),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    parentId: uuid("parent_id"),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    orgIdx: index("departments_org_idx").on(table.organizationId),
  })
);

// ============================================================
// USERS, ROLES & PERMISSIONS (RBAC)
// ============================================================
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    departmentId: uuid("department_id").references(() => departments.id),
    username: varchar("username", { length: 100 }).unique().notNull(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    avatarUrl: text("avatar_url"),
    isActive: boolean("is_active").default(true),
    isSuperadmin: boolean("is_superadmin").default(false),
    failedLoginAttempts: integer("failed_login_attempts").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLogin: timestamp("last_login", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    preferences: jsonb("preferences").default({
      theme: "dark",
      language: "fa",
      calendar: "jalali",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    orgIdx: index("users_org_idx").on(table.organizationId),
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  })
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    isSystem: boolean("is_system").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    orgNameIdx: index("roles_org_name_idx").on(table.organizationId, table.name),
  })
);

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 100 }).unique().notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .references(() => roles.id, { onDelete: "cascade" })
      .notNull(),
    permissionId: uuid("permission_id")
      .references(() => permissions.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
  })
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    roleId: uuid("role_id")
      .references(() => roles.id, { onDelete: "cascade" })
      .notNull(),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.roleId] }),
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: varchar("token_hash", { length: 255 }).unique().notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    isRevoked: boolean("is_revoked").default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("sessions_user_idx").on(table.userId),
    expiresIdx: index("sessions_expires_idx").on(table.expiresAt),
  })
);

// ============================================================
// DOCUMENTS
// ============================================================
export const resourceFolders = pgTable("resource_folders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  departmentId: uuid("department_id").references(() => departments.id),
  parentId: uuid("parent_id"),
  name: varchar("name", { length: 255 }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  visibility: varchar("visibility", { length: 20 }).default("private"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    departmentId: uuid("department_id").references(() => departments.id),
    folderId: uuid("folder_id").references(() => resourceFolders.id),
    ownerId: uuid("owner_id").references(() => users.id),
    title: varchar("title", { length: 500 }).notNull(),
    originalFilename: varchar("original_filename", { length: 500 }).notNull(),
    fileType: varchar("file_type", { length: 50 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    fileHash: varchar("file_hash", { length: 64 }),
    storagePath: text("storage_path").notNull(),
    currentVersion: integer("current_version").default(1),
    // Status: UPLOADED | QUEUED | PROCESSING | OCR | CHUNKING | EMBEDDING | INDEXING | READY | FAILED | CANCELLED | ARCHIVED
    status: varchar("status", { length: 30 }).default("UPLOADED"),
    processingProgress: integer("processing_progress").default(0),
    processingError: text("processing_error"),
    language: varchar("language", { length: 10 }),
    pageCount: integer("page_count"),
    wordCount: integer("word_count"),
    chunkCount: integer("chunk_count").default(0),
    // Visibility: private | department | organization
    visibility: varchar("visibility", { length: 20 }).default("department"),
    authorityScore: real("authority_score").default(0.8),
    classification: varchar("classification", { length: 30 }).default("INTERNAL"),
    tags: jsonb("tags").default([]),
    metadata: jsonb("metadata").default({}),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("documents_status_idx").on(table.status),
    ownerIdx: index("documents_owner_idx").on(table.ownerId),
    orgStatusIdx: index("documents_org_status_idx").on(table.organizationId, table.status),
    hashIdx: index("documents_hash_idx").on(table.fileHash),
  })
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").notNull(),
    storagePath: text("storage_path").notNull(),
    fileHash: varchar("file_hash", { length: 64 }),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    changeNotes: text("change_notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    documentVersionIdx: uniqueIndex("doc_version_unique_idx").on(table.documentId, table.version),
  })
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    departmentId: uuid("department_id").references(() => departments.id),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentNormalized: text("content_normalized"),
    // Embedding stored as jsonb number array (application-level cosine similarity)
    embedding: jsonb("embedding").$type<number[]>(),
    pageNumber: integer("page_number"),
    section: varchar("section", { length: 500 }),
    heading: varchar("heading", { length: 500 }),
    // source_type: document | knowledge | experience
    sourceType: varchar("source_type", { length: 50 }).default("document"),
    language: varchar("language", { length: 10 }),
    tokenCount: integer("token_count"),
    authorityScore: real("authority_score").default(0.8),
    // Status: ACTIVE | ARCHIVED | DELETED
    status: varchar("status", { length: 20 }).default("ACTIVE"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    documentIdx: index("chunks_document_idx").on(table.documentId),
    orgIdx: index("chunks_org_idx").on(table.organizationId),
    statusIdx: index("chunks_status_idx").on(table.status),
    orgStatusIdx: index("chunks_org_status_idx").on(table.organizationId, table.status),
  })
);

// ============================================================
// KNOWLEDGE BASE
// ============================================================
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    departmentId: uuid("department_id").references(() => departments.id),
    ownerId: uuid("owner_id").references(() => users.id),
    title: varchar("title", { length: 500 }).notNull(),
    subject: varchar("subject", { length: 255 }),
    content: text("content").notNull(),
    summary: text("summary"),
    embedding: jsonb("embedding").$type<number[]>(),
    visibility: varchar("visibility", { length: 20 }).default("department"),
    // Status: DRAFT | UNDER_REVIEW | APPROVED | PUBLISHED | ARCHIVED
    status: varchar("status", { length: 30 }).default("DRAFT"),
    authorityScore: real("authority_score").default(0.7),
    confidenceScore: real("confidence_score").default(0.5),
    usageCount: integer("usage_count").default(0),
    feedbackScore: real("feedback_score"),
    classification: varchar("classification", { length: 30 }).default("INTERNAL"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("knowledge_status_idx").on(table.status),
    orgStatusIdx: index("knowledge_org_status_idx").on(table.organizationId, table.status),
  })
);

export const knowledgeTags = pgTable(
  "knowledge_tags",
  {
    knowledgeId: uuid("knowledge_id")
      .references(() => knowledgeItems.id, { onDelete: "cascade" })
      .notNull(),
    tag: varchar("tag", { length: 100 }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.knowledgeId, table.tag] }),
  })
);

// ============================================================
// ORGANIZATIONAL EXPERIENCE MODULE
// ============================================================
export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    departmentId: uuid("department_id").references(() => departments.id),
    ownerId: uuid("owner_id")
      .references(() => users.id)
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    subject: varchar("subject", { length: 255 }),
    // Core fields per directive §31
    problemDescription: text("problem_description").notNull(),
    rootCause: text("root_cause"),
    actionsTaken: text("actions_taken").notNull(),
    results: text("results"),
    lessonsLearned: text("lessons_learned").notNull(),
    suggestion: text("suggestion"),
    relatedEquipment: text("related_equipment"),
    relatedProcess: text("related_process"),
    experienceDate: timestamp("experience_date", { withTimezone: true }),
    // Importance: LOW | MEDIUM | HIGH | CRITICAL
    importance: varchar("importance", { length: 20 }).default("MEDIUM"),
    // AI-assisted fields (AI assists but does NOT approve)
    aiSummary: text("ai_summary"),
    aiKeywords: jsonb("ai_keywords").default([]),
    aiSuggestedTags: jsonb("ai_suggested_tags").default([]),
    aiSuggestedTitle: text("ai_suggested_title"),
    aiSuggestedLessons: text("ai_suggested_lessons"),
    // Embedding for RAG integration
    embedding: jsonb("embedding").$type<number[]>(),
    // Status: DRAFT | SUBMITTED | UNDER_REVIEW | CHANGES_REQUESTED | APPROVED | PUBLISHED | ARCHIVED
    status: varchar("status", { length: 30 }).default("DRAFT"),
    visibility: varchar("visibility", { length: 20 }).default("department"),
    classification: varchar("classification", { length: 30 }).default("INTERNAL"),
    // Review/approval workflow
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => users.id),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("experiences_status_idx").on(table.status),
    orgStatusIdx: index("experiences_org_status_idx").on(table.organizationId, table.status),
    ownerIdx: index("experiences_owner_idx").on(table.ownerId),
  })
);

export const experienceTags = pgTable(
  "experience_tags",
  {
    experienceId: uuid("experience_id")
      .references(() => experiences.id, { onDelete: "cascade" })
      .notNull(),
    tag: varchar("tag", { length: 100 }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.experienceId, table.tag] }),
  })
);

export const experienceAttachments = pgTable("experience_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  experienceId: uuid("experience_id")
    .references(() => experiences.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  filename: varchar("filename", { length: 500 }).notNull(),
  originalFilename: varchar("original_filename", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  storagePath: text("storage_path").notNull(),
  fileHash: varchar("file_hash", { length: 64 }),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ============================================================
// CONVERSATIONS & MESSAGES (CHAT)
// ============================================================
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    title: varchar("title", { length: 500 }),
    isPinned: boolean("is_pinned").default(false),
    // Scope: all | department | document
    scope: varchar("scope", { length: 50 }).default("all"),
    scopeId: uuid("scope_id"),
    messageCount: integer("message_count").default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("conversations_user_idx").on(table.userId),
    orgIdx: index("conversations_org_idx").on(table.organizationId),
  })
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    // role: user | assistant | system
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    confidenceScore: real("confidence_score"),
    responseTimeMs: integer("response_time_ms"),
    tokenCount: integer("token_count"),
    // RAG trace metadata
    ragTrace: jsonb("rag_trace").default({}),
    // feedback: positive | negative
    feedback: varchar("feedback", { length: 20 }),
    feedbackReason: text("feedback_reason"),
    isStreamed: boolean("is_streamed").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    conversationIdx: index("messages_conversation_idx").on(table.conversationId),
  })
);

export const messageSources = pgTable("message_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id")
    .references(() => messages.id, { onDelete: "cascade" })
    .notNull(),
  // source_type: document | knowledge | experience
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  sourceId: uuid("source_id").notNull(),
  chunkId: uuid("chunk_id"),
  pageNumber: integer("page_number"),
  section: text("section"),
  heading: text("heading"),
  relevanceScore: real("relevance_score"),
  citationIndex: integer("citation_index"),
  excerpt: text("excerpt"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ============================================================
// PROCESSING JOBS (Background Queue)
// ============================================================
export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    // type: DOCUMENT_PROCESS | OCR | EMBED | REINDEX | EXPERIENCE_EMBED | KNOWLEDGE_EMBED
    type: varchar("type", { length: 50 }).notNull(),
    // status: PENDING | RUNNING | DONE | FAILED | CANCELLED
    status: varchar("status", { length: 20 }).default("PENDING"),
    resourceType: varchar("resource_type", { length: 50 }),
    resourceId: uuid("resource_id"),
    priority: integer("priority").default(5),
    attempts: integer("attempts").default(0),
    maxAttempts: integer("max_attempts").default(3),
    progress: integer("progress").default(0),
    errorMessage: text("error_message"),
    payload: jsonb("payload").default({}),
    result: jsonb("result").default({}),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("jobs_status_idx").on(table.status),
    typeIdx: index("jobs_type_idx").on(table.type),
    resourceIdx: index("jobs_resource_idx").on(table.resourceType, table.resourceId),
    scheduledIdx: index("jobs_scheduled_idx").on(table.scheduledAt),
  })
);

// ============================================================
// AUDIT LOGS (Immutable)
// ============================================================
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventCode: varchar("event_code", { length: 100 }).notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    actorName: varchar("actor_name", { length: 255 }),
    actorRole: varchar("actor_role", { length: 100 }),
    organizationId: uuid("organization_id").references(() => organizations.id),
    resourceType: varchar("resource_type", { length: 100 }),
    resourceId: uuid("resource_id"),
    resourceName: varchar("resource_name", { length: 500 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    // outcome: SUCCESS | FAILURE | PARTIAL
    outcome: varchar("outcome", { length: 20 }).default("SUCCESS"),
    severity: varchar("severity", { length: 20 }).default("INFO"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    actorIdx: index("audit_actor_idx").on(table.actorId),
    eventIdx: index("audit_event_idx").on(table.eventCode),
    createdIdx: index("audit_created_idx").on(table.createdAt),
    orgIdx: index("audit_org_idx").on(table.organizationId),
  })
);

// ============================================================
// SYSTEM SETTINGS & SETUP
// ============================================================
export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const setupStatus = pgTable("setup_status", {
  id: integer("id").primaryKey().default(1),
  completed: boolean("completed").default(false),
  currentStep: integer("current_step").default(1),
  organizationName: varchar("organization_name", { length: 255 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ============================================================
// RATE LIMITING (for in-DB rate limiting)
// ============================================================
export const rateLimitAttempts = pgTable(
  "rate_limit_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 255 }).notNull(),
    action: varchar("action", { length: 50 }).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    keyActionIdx: index("rate_limit_key_action_idx").on(table.key, table.action),
    createdIdx: index("rate_limit_created_idx").on(table.createdAt),
  })
);

// ============================================================
// RELATIONS
// ============================================================
export const organizationsRelations = relations(organizations, ({ many }) => ({
  departments: many(departments),
  users: many(users),
  documents: many(documents),
  knowledgeItems: many(knowledgeItems),
  experiences: many(experiences),
  conversations: many(conversations),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [departments.organizationId],
    references: [organizations.id],
  }),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  department: one(departments, {
    fields: [users.departmentId],
    references: [departments.id],
  }),
  userRoles: many(userRoles),
  conversations: many(conversations),
  documents: many(documents),
  experiences: many(experiences),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sources: many(messageSources),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [documents.organizationId],
    references: [organizations.id],
  }),
  department: one(departments, {
    fields: [documents.departmentId],
    references: [departments.id],
  }),
  owner: one(users, { fields: [documents.ownerId], references: [users.id] }),
  chunks: many(documentChunks),
  versions: many(documentVersions),
}));

export const experiencesRelations = relations(experiences, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [experiences.organizationId],
    references: [organizations.id],
  }),
  department: one(departments, {
    fields: [experiences.departmentId],
    references: [departments.id],
  }),
  owner: one(users, { fields: [experiences.ownerId], references: [users.id] }),
  tags: many(experienceTags),
  attachments: many(experienceAttachments),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type NewKnowledgeItem = typeof knowledgeItems.$inferInsert;
export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageSource = typeof messageSources.$inferSelect;
export type ProcessingJob = typeof processingJobs.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type SystemSetting = typeof systemSettings.$inferSelect;
