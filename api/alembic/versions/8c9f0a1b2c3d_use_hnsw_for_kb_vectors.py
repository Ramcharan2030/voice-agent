"""use hnsw for kb vectors

Revision ID: 8c9f0a1b2c3d
Revises: 37d0a90fccba
Create Date: 2026-05-22 18:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c9f0a1b2c3d"
down_revision: Union[str, None] = "37d0a90fccba"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("DROP INDEX IF EXISTS ix_kb_chunks_embedding_ivfflat")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_kb_chunks_embedding_hnsw
        ON knowledge_base_chunks
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_kb_chunks_embedding_hnsw")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_kb_chunks_embedding_ivfflat
        ON knowledge_base_chunks
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
        """
    )
