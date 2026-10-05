export const KNOWLEDGE_QUEUE = 'knowledge';

export interface IndexSourceJob {
  sourceId: string;
  /** The source revision this job was queued for; a newer edit makes it stale. */
  revision: number;
}

export const KnowledgeEvents = {
  sourceUpdated: 'knowledge.source.updated',
} as const;

export interface KnowledgeSourceUpdatedEvent {
  organizationId: string;
  sourceId: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
}

/** A workspace's whole knowledge base is meant to be read by a model, not to be an archive. */
export const KNOWLEDGE_LIMITS = {
  sourcesPerWorkspace: 200,
  charsPerSource: 300_000,
  fileBytes: 10 * 1024 * 1024,
};
