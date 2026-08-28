import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env";

export const esClient = new Client({
  node: env.elasticsearchNode,
  auth: env.elasticsearchApiKey ? { apiKey: env.elasticsearchApiKey } : undefined,
});

let indexReady = false;

export async function ensureEmailIndex(): Promise<void> {
  try {
    const exists = await esClient.indices.exists({ index: env.elasticsearchIndex });
    if (!exists) {
      await esClient.indices.create({
        index: env.elasticsearchIndex,
        mappings: {
          properties: {
            userId: { type: "keyword" },
            senderId: { type: "keyword" },
            senderEmail: { type: "keyword" },
            recipient: { type: "keyword" },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
          },
        },
      });
    }
    indexReady = true;
    console.log("[elasticsearch] index ready");
  } catch (err) {
    // Elasticsearch is a "must be searchable" requirement, not a "must be
    // up or the app is down" requirement — scheduling/sending should keep
    // working even if ES is unreachable, just without search results.
    indexReady = false;
    console.error("[elasticsearch] unavailable, search will be degraded:", (err as Error).message);
  }
}

export interface EmailDoc {
  userId: string;
  senderId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
}

export async function indexEmailDoc(id: string, doc: EmailDoc): Promise<void> {
  if (!indexReady) return;
  try {
    await esClient.index({ index: env.elasticsearchIndex, id, document: doc, refresh: "wait_for" });
  } catch (err) {
    console.error("[elasticsearch] index failed", (err as Error).message);
  }
}

export async function indexEmailDocsBulk(docs: Array<{ id: string; doc: EmailDoc }>): Promise<void> {
  if (!indexReady || docs.length === 0) return;
  try {
    const operations = docs.flatMap(({ id, doc }) => [
      { index: { _index: env.elasticsearchIndex, _id: id } },
      doc,
    ]);
    await esClient.bulk({ operations, refresh: "wait_for" });
  } catch (err) {
    console.error("[elasticsearch] bulk index failed", (err as Error).message);
  }
}

export async function searchEmailDocs(userId: string, query: string) {
  if (!indexReady) return { hits: [], degraded: true };
  try {
    const result = await esClient.search({
      index: env.elasticsearchIndex,
      query: {
        bool: {
          filter: [{ term: { userId } }],
          must: query
            ? [
                {
                  multi_match: {
                    query,
                    fields: ["subject^2", "body", "recipient"],
                  },
                },
              ]
            : [{ match_all: {} }],
        },
      },
      size: 50,
      sort: [{ scheduledAt: { order: "desc" } }],
    });
    return { hits: result.hits.hits.map((h) => ({ id: h._id, ...(h._source as EmailDoc) })), degraded: false };
  } catch (err) {
    console.error("[elasticsearch] search failed", (err as Error).message);
    return { hits: [], degraded: true };
  }
}
