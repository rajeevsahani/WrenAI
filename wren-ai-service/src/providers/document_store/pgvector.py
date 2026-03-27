"""
src/providers/document_store/pgvector.py

PGVector-backed DocumentStore provider for WrenAI.
Drop-in replacement for the Qdrant provider — same Haystack Document contract,
same provider registration pattern, same async / sync split.

Dependencies (add to pyproject.toml / requirements.txt):
    asyncpg>=0.29.0
    psycopg[binary,pool]>=3.1.0
    pgvector>=0.3.0
    haystack-ai>=2.0.0

config.yaml example:
    type: document_store
    provider: pgvector
    dsn: postgresql://user:pass@localhost:5432/wrenai
    embedding_model_dim: 1024
    recreate_index: false
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager, contextmanager
from typing import Any, Dict, List, Optional

import asyncpg
import numpy as np
import psycopg
import psycopg_pool
from haystack import Document, component
from haystack.document_stores.types import DuplicatePolicy

from src.core.provider import DocumentStoreProvider
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_VALID_INDEX_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"
)

_KNOWN_DATASETS = (
    "table_descriptions",
    "view_questions",
    "sql_pairs",
    "instructions",
    "project_meta",
)


# ---------------------------------------------------------------------------
# Document <-> row helpers
# ---------------------------------------------------------------------------

def _document_to_row(doc: Document) -> Dict[str, Any]:
    """Flatten a Haystack Document into a dict suitable for a DB row."""
    payload = doc.to_dict(flatten=True)
    doc_id: str = payload.pop("id", None) or str(uuid.uuid4())
    embedding: Optional[List[float]] = payload.pop("embedding", None)
    score: Optional[float] = payload.pop("score", None)
    content: Optional[str] = payload.pop("content", None)
    meta: Dict[str, Any] = payload
    return {
        "id": doc_id,
        "content": content,
        "embedding": embedding,
        "score": score,
        "meta": meta,
    }


def _row_to_document(
    row: Dict[str, Any],
    *,
    score_override: Optional[float] = None,
    scale_score: bool = True,
    similarity: str = "cosine",
) -> Document:
    """Reconstruct a Haystack Document from a DB row dict."""
    meta: Dict[str, Any] = row.get("meta") or {}
    raw_score: Optional[float] = (
        score_override if score_override is not None else row.get("score")
    )

    if raw_score is not None and scale_score:
        if similarity == "cosine":
            raw_score = (raw_score + 1.0) / 2.0
        else:
            raw_score = float(1.0 / (1.0 + np.exp(-raw_score / 100)))

    return Document(
        id=str(row["id"]),
        content=row.get("content"),
        score=raw_score,
        **{k: v for k, v in meta.items() if k not in {"id", "content", "score"}},
    )


# ---------------------------------------------------------------------------
# DDL helpers (sync, used at startup)
# ---------------------------------------------------------------------------

def _ddl_for_index(table: str, embedding_dim: int) -> List[str]:
    """Return DDL statements to create the table + indexes for one dataset."""
    logger.info(f"Table is {table} and embedding dim is {embedding_dim}")
    return [
        f"""
        CREATE TABLE IF NOT EXISTS {table} (
            id          TEXT    PRIMARY KEY,
            content     TEXT,
            embedding   vector({embedding_dim}),
            score       FLOAT,
            project_id  TEXT    GENERATED ALWAYS AS (meta->>'project_id') STORED,
            meta        JSONB   NOT NULL DEFAULT '{{}}'::jsonb
        )
        """,
        f"""
        CREATE INDEX IF NOT EXISTS {table}_embedding_idx
            ON {table}
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100)
        """,
        f"CREATE INDEX IF NOT EXISTS {table}_project_id_idx ON {table} (project_id)",
    ]


def _drop_table(table: str) -> str:
    return f"DROP TABLE IF EXISTS {table} CASCADE"


# ---------------------------------------------------------------------------
# Sync connection pool  (DDL + blocking writes)
# ---------------------------------------------------------------------------

class _SyncPool:
    """Thin wrapper around psycopg3 ConnectionPool."""

    def __init__(self, dsn: str, min_size: int = 2, max_size: int = 10):
        self._pool = psycopg_pool.ConnectionPool(
            conninfo=dsn,
            min_size=min_size,
            max_size=max_size,
            open=True,
        )
        logger.info(
            "pgvector: sync pool opened (min=%d max=%d)", min_size, max_size
        )

    @contextmanager
    def connection(self):
        with self._pool.connection() as conn:
            yield conn

    def close(self):
        self._pool.close()
        logger.info("pgvector: sync pool closed")


# ---------------------------------------------------------------------------
# asyncpg per-connection init — must be a module-level function, not a method,
# so asyncpg can pickle/reference it correctly across pool connections.
# ---------------------------------------------------------------------------

async def _init_asyncpg_connection(conn: asyncpg.Connection) -> None:
    """
    Register the pgvector 'vector' type codec for every asyncpg connection.

    WHY NOT schema="pg_catalog":
        asyncpg's set_type_codec(schema=...) does a pg_type lookup restricted
        to that schema.  The 'vector' type is NOT in pg_catalog — it is
        installed by pgvector into the 'public' schema.  Passing the wrong
        schema raises:
            ValueError: unknown type: pg_catalog.vector

    FIX:
        Look up the OID ourselves from pg_type (no schema restriction),
        then pass oid= directly.  When oid= is supplied, asyncpg skips
        the schema-based introspection entirely.
    """
    row = await conn.fetchrow(
        "SELECT oid FROM pg_type WHERE typname = $1 LIMIT 1", "vector"
    )
    if row is None:
        raise RuntimeError(
            "pgvector: 'vector' type not found in pg_type.\n"
            "The pgvector extension must be installed AND enabled in this database:\n"
            "  psql -d <your-db> -c 'CREATE EXTENSION IF NOT EXISTS vector;'"
        )

    await conn.set_type_codec(
        "vector",
        encoder=lambda v: "[" + ",".join(str(x) for x in v) + "]",
        decoder=lambda s: [float(x) for x in s.strip("[]").split(",")],
        schema="public",  # ignored when oid= is supplied
        format="text",
    )


# ---------------------------------------------------------------------------
# Async connection pool  (retrieval + async writes)
# ---------------------------------------------------------------------------

class _AsyncPool:
    """Thin wrapper around asyncpg Pool with pgvector codec registration."""

    def __init__(self, dsn: str, min_size: int = 2, max_size: int = 10):
        self._dsn = dsn
        self._min = min_size
        self._max = max_size
        self._pool: Optional[asyncpg.Pool] = None

    async def _ensure(self) -> None:
        if self._pool is not None:
            return
        self._pool = await asyncpg.create_pool(
            dsn=self._dsn,
            min_size=self._min,
            max_size=self._max,
            # statement_cache_size=0 required for PgBouncer; harmless otherwise.
            statement_cache_size=0,
            init=_init_asyncpg_connection,
        )
        logger.info(
            "pgvector: async pool opened (min=%d max=%d)", self._min, self._max
        )

    @asynccontextmanager
    async def acquire(self):
        await self._ensure()
        async with self._pool.acquire() as conn:
            yield conn

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()
            self._pool = None
            logger.info("pgvector: async pool closed")


# ---------------------------------------------------------------------------
# Singleton pools — shared across all store instances for the same DSN
# ---------------------------------------------------------------------------

_sync_pools: Dict[str, _SyncPool] = {}
_async_pools: Dict[str, _AsyncPool] = {}
_extension_bootstrapped: set = set()


def _get_sync_pool(dsn: str) -> _SyncPool:
    if dsn not in _sync_pools:
        _sync_pools[dsn] = _SyncPool(dsn)
    return _sync_pools[dsn]


def _get_async_pool(dsn: str) -> _AsyncPool:
    if dsn not in _async_pools:
        _async_pools[dsn] = _AsyncPool(dsn)
    return _async_pools[dsn]


def _bootstrap_extension(dsn: str, sync_pool: _SyncPool) -> None:
    """
    Run CREATE EXTENSION IF NOT EXISTS vector exactly once per database.
    Raises a clear, actionable error when pgvector is missing from the server.
    """
    if dsn in _extension_bootstrapped:
        return

    try:
        with sync_pool.connection() as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            conn.commit()
        _extension_bootstrapped.add(dsn)
        logger.info("pgvector: extension 'vector' enabled")
    except psycopg.Error as exc:
        msg = str(exc)
        if "vector.control" in msg or "UndefinedFile" in msg:
            raise RuntimeError(
                "pgvector extension is not installed on the PostgreSQL server.\n\n"
                "Fix for Homebrew PostgreSQL 14 on macOS:\n"
                "  cd /tmp\n"
                "  git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git\n"
                "  cd pgvector\n"
                "  export PG_CONFIG=/opt/homebrew/opt/postgresql@14/bin/pg_config\n"
                "  make && make install\n"
                "  brew services restart postgresql@14\n\n"
                f"Original error: {exc}"
            ) from exc
        raise RuntimeError(
            f"pgvector: unexpected error enabling vector extension: {exc}"
        ) from exc


# ---------------------------------------------------------------------------
# PGVectorDocumentStore
# ---------------------------------------------------------------------------

class PGVectorDocumentStore:
    """
    Haystack-compatible async DocumentStore backed by PostgreSQL + pgvector.
    Public API mirrors AsyncQdrantDocumentStore so pipelines need no changes.
    """

    def __init__(
        self,
        dsn: str,
        index: str = "view_questions",
        embedding_dim: int = 1024,
        similarity: str = "cosine",
        recreate_index: bool = False,
        return_embedding: bool = False,
        progress_bar: bool = True,
        write_batch_size: int = 100,
    ):
        if not dsn:
            raise ValueError(
                "pgvector: 'dsn' must not be empty. "
                "Set it in config.yaml or via the PGVECTOR_DSN env-var."
            )

        self._dsn = dsn
        self.index = index        # logical name used by WrenAI (e.g. "table_descriptions")
        self._table = index       # used directly as the PG table name
        self.embedding_dim = embedding_dim
        self.similarity = similarity
        self.return_embedding = return_embedding
        self.progress_bar = progress_bar
        self.write_batch_size = write_batch_size

        self._sync_pool = _get_sync_pool(dsn)
        self._async_pool = _get_async_pool(dsn)

        self._ensure_schema(recreate_index=recreate_index)
        logger.info(
            "pgvector: store ready — table=%s dim=%d similarity=%s",
            self._table,
            embedding_dim,
            similarity,
        )

    # ------------------------------------------------------------------
    # Haystack / WrenAI compatibility shim
    # ------------------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """
        Mirror the shape Haystack's QdrantDocumentStore.to_dict() produces.

        WrenAI's DocumentCleaner reads:
            store.to_dict().get("init_parameters", {}).get("index", "unknown")
        """
        return {
            "type": f"{self.__class__.__module__}.{self.__class__.__name__}",
            "init_parameters": {
                "index": self.index,
                "embedding_dim": self.embedding_dim,
                "similarity": self.similarity,
            },
        }

    # ------------------------------------------------------------------
    # Schema bootstrap (sync, once per store instance at startup)
    # ------------------------------------------------------------------

    def _ensure_schema(self, *, recreate_index: bool = False) -> None:
        # Step 1 — enable pgvector extension (once per DSN).
        _bootstrap_extension(self._dsn, self._sync_pool)

        # Step 2 — create / recreate this index's table.
        try:
            with self._sync_pool.connection() as conn:
                if recreate_index:
                    logger.warning(
                        "pgvector: dropping table %s (recreate_index=True)",
                        self._table,
                    )
                    conn.execute(_drop_table(self._table))
                    conn.commit()

                for stmt in _ddl_for_index(self._table, self.embedding_dim):
                    conn.execute(stmt)
                conn.commit()
        except psycopg.Error as exc:
            logger.exception(
                "pgvector: schema init failed for table %s", self._table
            )
            raise RuntimeError(
                f"pgvector: schema init failed for '{self._table}': {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Count
    # ------------------------------------------------------------------

    async def count_documents(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> int:
        where, params = _build_where(filters)
        sql = f"SELECT COUNT(*) FROM {self._table}{where}"
        try:
            async with self._async_pool.acquire() as conn:
                row = await conn.fetchrow(sql, *params)
                return row[0] if row else 0
        except asyncpg.PostgresError as exc:
            logger.exception("pgvector: count_documents failed on %s", self._table)
            raise RuntimeError("pgvector: count_documents failed") from exc

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    async def write_documents(
        self,
        documents: List[Document],
        policy: DuplicatePolicy = DuplicatePolicy.OVERWRITE,
    ) -> int:
        if not documents:
            logger.warning("pgvector: write_documents called with empty list — no-op")
            return 0

        for doc in documents:
            if not isinstance(doc, Document):
                raise ValueError(
                    f"pgvector: expected Document, got {type(doc).__name__}"
                )

        rows = [_document_to_row(doc) for doc in documents]
        written = 0
        try:
            async with self._async_pool.acquire() as conn:
                for start in range(0, len(rows), self.write_batch_size):
                    batch = rows[start : start + self.write_batch_size]
                    written += await self._upsert_batch(conn, batch, policy)
        except asyncpg.PostgresError as exc:
            logger.exception(
                "pgvector: write_documents failed on table %s", self._table
            )
            raise RuntimeError("pgvector: write_documents failed") from exc

        logger.debug("pgvector: wrote %d docs to %s", written, self._table)
        return written

    async def _upsert_batch(
        self,
        conn: asyncpg.Connection,
        batch: List[Dict[str, Any]],
        policy: DuplicatePolicy,
    ) -> int:
        if policy == DuplicatePolicy.FAIL:
            sql = f"""
                INSERT INTO {self._table} (id, content, embedding, score, meta)
                VALUES ($1, $2, $3, $4, $5)
            """
        else:
            on_conflict = (
                "DO NOTHING"
                if policy == DuplicatePolicy.SKIP
                else """DO UPDATE SET
                    content   = EXCLUDED.content,
                    embedding = EXCLUDED.embedding,
                    score     = EXCLUDED.score,
                    meta      = EXCLUDED.meta"""
            )
            sql = f"""
                INSERT INTO {self._table} (id, content, embedding, score, meta)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) {on_conflict}
            """

        records = [
            (
                row["id"],
                row["content"],
                row["embedding"],
                row["score"],
                json.dumps(row["meta"]),
            )
            for row in batch
        ]
        await conn.executemany(sql, records)
        return len(records)

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete_documents(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> None:
        where, params = _build_where(filters)
        sql = f"DELETE FROM {self._table}{where}"
        try:
            async with self._async_pool.acquire() as conn:
                result = await conn.execute(sql, *params)
            deleted = int(result.split()[-1]) if result else 0
            logger.debug(
                "pgvector: deleted %d docs from %s (filters=%s)",
                deleted,
                self._table,
                filters,
            )
        except asyncpg.PostgresError as exc:
            logger.exception(
                "pgvector: delete_documents failed on table %s", self._table
            )
            raise RuntimeError("pgvector: delete_documents failed") from exc

    # ------------------------------------------------------------------
    # Embedding search
    # ------------------------------------------------------------------

    async def _query_by_embedding(
        self,
        query_embedding: List[float],
        filters: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        scale_score: bool = True,
        return_embedding: bool = False,
    ) -> List[Document]:
        vec_literal = "[" + ",".join(str(x) for x in query_embedding) + "]"
        where, params = _build_where(filters)

        vec_idx = len(params) + 1
        params.append(vec_literal)
        params.append(top_k)

        emb_col = ", embedding::text AS embedding_text" if return_embedding else ""
        sql = f"""
            SELECT
                id,
                content,
                meta,
                (1 - (embedding <=> ${vec_idx}::vector)) AS raw_score
                {emb_col}
            FROM {self._table}
            {where}
            ORDER BY embedding <=> ${vec_idx}::vector
            LIMIT ${vec_idx + 1}
        """

        try:
            async with self._async_pool.acquire() as conn:
                rows = await conn.fetch(sql, *params)
        except asyncpg.PostgresError as exc:
            logger.exception(
                "pgvector: _query_by_embedding failed on %s", self._table
            )
            raise RuntimeError("pgvector: embedding query failed") from exc

        docs = []
        for row in rows:
            row_dict = dict(row)
            raw_score = row_dict.pop("raw_score", None)
            meta = row_dict.get("meta")
            if isinstance(meta, str):
                try:
                    row_dict["meta"] = json.loads(meta)
                except json.JSONDecodeError:
                    row_dict["meta"] = {}
            docs.append(
                _row_to_document(
                    row_dict,
                    score_override=raw_score,
                    scale_score=scale_score,
                    similarity=self.similarity,
                )
            )
        return docs

    # ------------------------------------------------------------------
    # Filter-only scroll (mirrors Qdrant scroll)
    # ------------------------------------------------------------------

    async def _query_by_filters(
        self,
        filters: Optional[Dict[str, Any]] = None,
        top_k: Optional[int] = None,
    ) -> List[Document]:
        where, params = _build_where(filters)
        limit_clause = ""
        if top_k is not None:
            params.append(top_k)
            limit_clause = f"LIMIT ${len(params)}"

        sql = f"""
            SELECT id, content, meta
            FROM {self._table}
            {where}
            ORDER BY id
            {limit_clause}
        """

        try:
            async with self._async_pool.acquire() as conn:
                rows = await conn.fetch(sql, *params)
        except asyncpg.PostgresError as exc:
            logger.exception(
                "pgvector: _query_by_filters failed on %s", self._table
            )
            raise RuntimeError("pgvector: filter query failed") from exc

        docs = []
        for row in rows:
            row_dict = dict(row)
            meta = row_dict.get("meta")
            if isinstance(meta, str):
                try:
                    row_dict["meta"] = json.loads(meta)
                except json.JSONDecodeError:
                    row_dict["meta"] = {}
            docs.append(_row_to_document(row_dict, scale_score=False))
        return docs


# ---------------------------------------------------------------------------
# Filter builder
# ---------------------------------------------------------------------------

def _build_where(
    filters: Optional[Dict[str, Any]],
) -> tuple[str, List[Any]]:
    """
    Convert a Haystack-style filter dict into a parameterised WHERE clause.

    Supported shapes:
        {"field": "project_id", "operator": "==", "value": "abc"}
        {"operator": "AND", "conditions": [...]}
        {"operator": "OR",  "conditions": [...]}

    Top-level columns (id, content, project_id) are addressed directly;
    everything else goes through the meta JSONB column.
    """
    if not filters:
        return "", []

    params: List[Any] = []
    clause = _build_condition(filters, params)
    return f" WHERE {clause}", params


def _build_condition(node: Dict[str, Any], params: List[Any]) -> str:
    op = node.get("operator", "==")

    if op in ("AND", "OR"):
        conditions = node.get("conditions", [])
        if not conditions:
            return "TRUE"
        parts = [_build_condition(c, params) for c in conditions]
        joiner = " AND " if op == "AND" else " OR "
        return "(" + joiner.join(parts) + ")"

    field: str = node.get("field", "")
    value = node.get("value")

    _TOP_LEVEL = {"id", "content", "project_id"}
    col = field if field in _TOP_LEVEL else f"meta->>{_pg_literal(field)}"

    params.append(value)
    idx = len(params)

    _OP_MAP = {
        "==":  "=",
        "!=":  "!=",
        ">":   ">",
        ">=":  ">=",
        "<":   "<",
        "<=":  "<=",
        "in":  "= ANY",
        "nin": "!= ALL",
    }
    pg_op = _OP_MAP.get(op, "=")

    if op in ("in", "nin"):
        return f"{col} {pg_op}(${idx})"
    return f"{col} {pg_op} ${idx}"


def _pg_literal(s: str) -> str:
    """Single-quote a string for inline SQL (not a bind parameter)."""
    return "'" + s.replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# Retriever
# ---------------------------------------------------------------------------

class PGVectorEmbeddingRetriever:
    """
    Async Haystack retriever backed by PGVectorDocumentStore.
    Interface mirrors AsyncQdrantEmbeddingRetriever exactly.
    """

    def __init__(
        self,
        document_store: PGVectorDocumentStore,
        filters: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        scale_score: bool = True,
        return_embedding: bool = False,
    ):
        self._document_store = document_store
        self._filters = filters or {}
        self._top_k = top_k
        self._scale_score = scale_score
        self._return_embedding = return_embedding

    @component.output_types(documents=List[Document])
    async def run(
        self,
        query_embedding: List[float],
        filters: Optional[Dict[str, Any]] = None,
        top_k: Optional[int] = None,
        scale_score: Optional[bool] = None,
        return_embedding: Optional[bool] = None,
    ) -> Dict[str, List[Document]]:
        f = filters if filters is not None else self._filters
        k = top_k if top_k is not None else self._top_k
        ss = scale_score if scale_score is not None else self._scale_score
        re = return_embedding if return_embedding is not None else self._return_embedding

        if query_embedding:
            docs = await self._document_store._query_by_embedding(
                query_embedding=query_embedding,
                filters=f,
                top_k=k,
                scale_score=ss,
                return_embedding=re,
            )
        else:
            docs = await self._document_store._query_by_filters(
                filters=f,
                top_k=k,
            )

        return {"documents": docs}


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

@provider("pgvector")
class PGVectorProvider(DocumentStoreProvider):
    """
    WrenAI DocumentStoreProvider for PostgreSQL + pgvector.

    config.yaml:
        type: document_store
        provider: pgvector
        dsn: postgresql://user:pass@localhost:5432/wren-ui
        embedding_model_dim: 1024
        recreate_index: false
    """

    def __init__(
        self,
        dsn: str = os.getenv("DSN", ""),
        embedding_model_dim: int = (
            int(os.getenv("EMBEDDING_MODEL_DIMENSION", "0"))
            if os.getenv("EMBEDDING_MODEL_DIMENSION")
            else 0
        ),
        recreate_index: bool = bool(os.getenv("SHOULD_FORCE_DEPLOY", "")),
        **_,
    ):
        if not dsn:
            raise ValueError(
                "pgvector: 'dsn' is required. "
                "Set it in config.yaml or via the PGVECTOR_DSN env-var."
            )
        if not embedding_model_dim:
            raise ValueError(
                "pgvector: 'embedding_model_dim' must be a positive integer. "
                "Set EMBEDDING_MODEL_DIMENSION or embedding_model_dim in config.yaml."
            )

        self._dsn = dsn
        self._embedding_model_dim = embedding_model_dim

        logger.info(
            "pgvector: provider init (dim=%d recreate=%s)",
            embedding_model_dim,
            recreate_index,
        )
        self._reset_document_store(recreate_index)

    def _reset_document_store(self, recreate_index: bool) -> None:
        """Pre-warm all known dataset tables — mirrors QdrantProvider."""
        self.get_store(recreate_index=recreate_index)
        self.get_store(dataset_name="table_descriptions", recreate_index=recreate_index)
        self.get_store(dataset_name="view_questions", recreate_index=recreate_index)
        self.get_store(dataset_name="sql_pairs", recreate_index=recreate_index)
        self.get_store(dataset_name="instructions", recreate_index=recreate_index)
        self.get_store(dataset_name="project_meta", recreate_index=recreate_index)

    def get_store(
        self,
        dataset_name: Optional[str] = None,
        recreate_index: bool = False,
    ) -> PGVectorDocumentStore:
        return PGVectorDocumentStore(
            dsn=self._dsn,
            index=dataset_name or "view_questions",
            embedding_dim=self._embedding_model_dim,
            recreate_index=recreate_index,
        )

    def get_retriever(
        self,
        document_store: PGVectorDocumentStore,
        top_k: int = 10,
    ) -> PGVectorEmbeddingRetriever:
        return PGVectorEmbeddingRetriever(
            document_store=document_store,
            top_k=top_k,
        )
