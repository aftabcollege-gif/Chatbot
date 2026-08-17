export interface Source {
  id: string;
  type: "document" | "web" | "knowledge";
  title: string;
  pageNumber?: number;
  section?: string;
  heading?: string;
  relevanceScore: number;
  snippet?: string;
  citationIndex?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidenceScore?: number;
  sources?: Source[];
  createdAt?: string;
}

export const SOURCE_TYPE_LABELS: Record<Source["type"], string> = {
  document: "سند",
  knowledge: "دانش سازمانی",
  web: "وب",
};

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  isPinned: boolean;
}
