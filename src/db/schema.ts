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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Embeddings are stored as plain JSON number arrays (jsonb) instead of the
// PostgreSQL "vector" type so the project works out of the box without the
// pgvector extension installed. Similarity search is computed in application
// code (see src/lib/local-embeddings.ts and src/lib/vector-search.ts).
const vector = (name: string) => jsonb(name).$type<number[]>();

// ============================================================
// ORGANIZATIONS & DEPARTMENTS
// ============================================================
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  parentId: uuid("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ============================================================
// USERS & AUTH
// ============================================================
export const users = pgTable("users", {
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
  lastLogin: timestamp("last_login", { withTimezone: true }),
  preferences: jsonb("preferences").default({
    theme: "dark",
    language: "fa",
    calendar: "jalali",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  isSystem: boolean("is_system").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    roleId: uuid("role_id")
      .references(() => roles.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.roleId] }),
  })
);

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 100 }).unique().notNull(),
  description: text("description"),
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

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  refreshTokenHash: varchar("refresh_token_hash", { length: 255 })
    .unique()
    .notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ============================================================
// RESOURCES & DOCUMENTS
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
    organizationId: uuid("organization_id").references(() => organizations.id),
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
    status: varchar("status", { length: 30 }).default("UPLOADED"),
    processingProgress: integer("processing_progress").default(0),
    processingError: text("processing_error"),
    language: varchar("language", { length: 10 }),
    pageCount: integer("page_count"),
    visibility: varchar("visibility", { length: 20 }).default("private"),
    authorityScore: real("authority_score").default(0.8),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("documents_status_idx").on(table.status),
    ownerIdx: index("documents_owner_idx").on(table.ownerId),
  })
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    departmentId: uuid("department_id").references(() => departments.id),
    parentChunkId: uuid("parent_chunk_id"),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    contentNormalized: text("content_normalized"),
    pageNumber: integer("page_number"),
    section: varchar("section", { length: 500 }),
    heading: varchar("heading", { length: 500 }),
    sourceType: varchar("source_type", { length: 50 }),
    visibility: varchar("visibility", { length: 20 }),
    tokenCount: integer("token_count"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    documentIdx: index("chunks_document_idx").on(table.documentId),
  })
);

// ============================================================
// KNOWLEDGE BASE
// ============================================================
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    departmentId: uuid("department_id").references(() => departments.id),
    ownerId: uuid("owner_id").references(() => users.id),
    title: varchar("title", { length: 500 }).notNull(),
    subject: varchar("subject", { length: 255 }),
    problemDescription: text("problem_description").notNull(),
    actionTaken: text("action_taken").notNull(),
    result: varchar("result", { length: 20 }),
    lessonLearned: text("lesson_learned").notNull(),
    suggestion: text("suggestion"),
    embedding: vector("embedding"),
    visibility: varchar("visibility", { length: 20 }).default("department"),
    status: varchar("status", { length: 30 }).default("DRAFT"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("knowledge_status_idx").on(table.status),
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
// CONVERSATIONS & MESSAGES
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("conversations_user_idx").on(table.userId),
  })
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    scope: varchar("scope", { length: 50 }).default("all"),
    scopeId: uuid("scope_id"),
    confidenceScore: real("confidence_score"),
    responseTimeMs: integer("response_time_ms"),
    tokenCount: integer("token_count"),
    feedback: varchar("feedback", { length: 20 }),
    feedbackReason: text("feedback_reason"),
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
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  sourceId: uuid("source_id").notNull(),
  chunkId: uuid("chunk_id"),
  pageNumber: integer("page_number"),
  section: text("section"),
  heading: text("heading"),
  relevanceScore: real("relevance_score"),
  citationIndex: integer("citation_index"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ============================================================
// AUDIT LOGS
// ============================================================
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventCode: varchar("event_code", { length: 100 }).notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    actorName: varchar("actor_name", { length: 255 }),
    resourceType: varchar("resource_type", { length: 100 }),
    resourceId: uuid("resource_id"),
    resourceName: varchar("resource_name", { length: 500 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    actorIdx: index("audit_actor_idx").on(table.actorId),
    eventIdx: index("audit_event_idx").on(table.eventCode),
    createdIdx: index("audit_created_idx").on(table.createdAt),
  })
);

// ============================================================
// SYSTEM
// ============================================================
export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const setupStatus = pgTable("setup_status", {
  id: integer("id").primaryKey().default(1),
  completed: boolean("completed").default(false),
  currentStep: integer("current_step").default(1),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ============================================================
// RELATIONS
// ============================================================
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
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sources: many(messageSources),
}));

// Type exports
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
