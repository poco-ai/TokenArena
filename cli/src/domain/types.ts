/**
 * Token usage entry - raw parsed result from a single message/event
 */
export interface TokenUsageEntry {
  sessionId?: string;
  source: string;
  model: string;
  project: string;
  timestamp: Date;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
}

export interface SessionModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

/**
 * 30-minute aggregation bucket from parsers before upload normalization
 */
export interface TokenBucket {
  source: string;
  model: string;
  project: string;
  bucketStart: string;
  hostname: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

/**
 * Canonical upload bucket for the v2 ingest API
 */
export interface UploadTokenBucket {
  source: string;
  model: string;
  projectKey: string;
  projectLabel: string;
  bucketStart: string;
  deviceId: string;
  hostname: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

/**
 * Session timing event for extracting session metadata
 */
export interface SessionEvent {
  sessionId: string;
  source: string;
  project: string;
  timestamp: Date;
  role: "user" | "assistant";
}

/**
 * Session metadata from parsers before upload normalization
 */
export interface SessionMetadata {
  source: string;
  project: string;
  sessionHash: string;
  hostname: string;
  firstMessageAt: string;
  lastMessageAt: string;
  durationSeconds: number;
  activeSeconds: number;
  messageCount: number;
  userMessageCount: number;
  userPromptHours: number[];
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  primaryModel: string;
  modelUsages: SessionModelUsage[];
}

/**
 * Canonical upload session metadata for the v2 ingest API
 */
export interface UploadSessionMetadata {
  source: string;
  projectKey: string;
  projectLabel: string;
  sessionHash: string;
  deviceId: string;
  hostname: string;
  firstMessageAt: string;
  lastMessageAt: string;
  durationSeconds: number;
  activeSeconds: number;
  messageCount: number;
  userMessageCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  primaryModel: string;
  modelUsages: SessionModelUsage[];
}

/**
 * Result from a parser
 */
export interface ParseResult {
  buckets: TokenBucket[];
  sessions: SessionMetadata[];
}

/**
 * API settings response
 */
export interface ApiSettings {
  schemaVersion: 2;
  projectMode: "hashed" | "raw" | "disabled";
  projectHashSalt: string;
  timezone: string;
}

export interface DeviceMetadata {
  deviceId: string;
  hostname: string;
}

/**
 * Ingest response from server
 */
export interface IngestResponse {
  ok?: boolean;
  bucketCount?: number;
  sessionCount?: number;
  deviceId?: string;
  ingested?: number;
  sessions?: number;
}
