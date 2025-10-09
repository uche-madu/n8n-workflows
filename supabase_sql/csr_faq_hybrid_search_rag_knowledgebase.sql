-- Create table for FAQ documents
-- This is for the RAG ingestion phase
CREATE TABLE IF NOT EXISTS csr_faq_knowledgebase (
  id BIGSERIAL PRIMARY KEY,
  content TEXT,
  metadata jsonb,
  fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding VECTOR(1536)  -- using openai text-embedding-3-small with 1536. Change this depending on your embedding model

);

-- Indexes to speed up database search during retrieval
CREATE INDEX ON csr_faq_knowledgebase USING GIN (fts);
CREATE INDEX ON csr_faq_knowledgebase USING HNSW (embedding vector_cosine_ops);

-- Reciprocal Rank Fusion (RRF) helper
-- RRF reranks the retrieved documents based on their relevance to improve RAG responses
CREATE OR REPLACE FUNCTION rrf_score(rank bigint, rrf_k int DEFAULT 50)
RETURNS numeric LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(1.0 / ($1 + $2), 0.0);
$$;

-- Hybrid search function with scores + metadata
-- This uses key word search in addition to basic semantic retrieval to improve responses
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text text,
  query_embedding vector(1536), -- use same embedding model as in the ingestion phase above
  match_count int,
  full_text_weight float = 1,
  semantic_weight float = 1,
  rrf_k int = 50
)
RETURNS TABLE (
  id bigint,
  content text,
  metadata jsonb,
  full_text_rank int,
  semantic_rank int,
  combined_score float
)
LANGUAGE sql
AS $$
WITH full_text AS (
  SELECT
    d.id,
    row_number() OVER (
      ORDER BY ts_rank_cd(d.fts, websearch_to_tsquery(query_text)) DESC
    ) AS rank_ix
  FROM csr_faq_knowledgebase d
  WHERE d.fts @@ websearch_to_tsquery(query_text)
  ORDER BY rank_ix
  LIMIT LEAST(match_count, 30) * 2
),
semantic AS (
  SELECT
    d.id,
    row_number() OVER (
      ORDER BY d.embedding <#> query_embedding
    ) AS rank_ix
  FROM csr_faq_knowledgebase d
  ORDER BY rank_ix
  LIMIT LEAST(match_count, 30) * 2
)
SELECT
  d.id,
  d.content,
  d.metadata,
  full_text.rank_ix AS full_text_rank,
  semantic.rank_ix AS semantic_rank,
  COALESCE(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
  COALESCE(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight AS combined_score
FROM
  full_text
  FULL OUTER JOIN semantic
    ON full_text.id = semantic.id
  JOIN csr_faq_knowledgebase d
    ON COALESCE(full_text.id, semantic.id) = d.id
ORDER BY
  combined_score DESC
LIMIT LEAST(match_count, 30);
$$;
