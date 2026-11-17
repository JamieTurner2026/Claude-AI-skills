// Interface only. No embedding model is chosen or bundled in this cut; that choice is Jay's.
// A later step adds an implementation, stores vectors next to documents.id, and fuses its ranking
// with the FTS5 score (for example reciprocal rank fusion). Nothing imports this file yet.
export interface Embedder {
  /** Stable id of the model, stored with every vector so a model change forces a re-embed. */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

export interface VectorHit { documentId: number; score: number }

export interface VectorStore {
  upsert(documentId: number, vector: Float32Array): void;
  nearest(vector: Float32Array, limit: number): VectorHit[];
}
