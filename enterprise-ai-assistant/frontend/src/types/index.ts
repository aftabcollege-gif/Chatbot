export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar_url?: string | null;
  is_superadmin: boolean;
  roles: string[];
  department?: { id: string; name: string } | null;
  organization?: { id: string; name: string } | null;
  permissions: string[];
  preferences?: Record<string, unknown>;
  last_login?: string | null;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface MessageSource {
  citation_index: number;
  source_type: string;
  source_id: string;
  chunk_id?: string;
  title: string;
  page_number?: number | null;
  section?: string | null;
  heading?: string | null;
  relevance_score: number;
  snippet?: string;
}

export interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  scope?: string;
  confidence_score?: number;
  feedback?: string | null;
  created_at?: string;
  sources?: MessageSource[];
  streaming?: boolean;
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  title: string;
  original_filename: string;
  file_type: string;
  file_size_bytes: number;
  status: "UPLOADED" | "EXTRACTING" | "CHUNKING" | "EMBEDDING" | "INDEXING" | "READY" | "ERROR";
  processing_progress: number;
  processing_error?: string | null;
  language?: string;
  page_count?: number;
  visibility: string;
  folder_id?: string | null;
  owner_id?: string;
  created_at: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  subject?: string;
  problem_description: string;
  action_taken: string;
  result?: string;
  lesson_learned: string;
  suggestion?: string;
  tags: string[];
  status: "DRAFT" | "UNDER_REVIEW" | "PUBLISHED" | "REJECTED" | "ARCHIVED";
  visibility: string;
  department_id?: string;
  owner_id?: string;
  created_at: string;
  updated_at: string;
  owner?: { name: string; avatar_path?: string };
}

export interface SearchResult {
  type: string;
  id: string;
  title: string;
  snippet: string;
  document_id?: string;
  page_number?: number;
  heading?: string;
  section?: string;
}
