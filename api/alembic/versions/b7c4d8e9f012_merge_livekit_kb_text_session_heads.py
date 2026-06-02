"""merge livekit kb and text session heads

Revision ID: b7c4d8e9f012
Revises: 2f638891cbb6, 8c9f0a1b2c3d
Create Date: 2026-06-02 06:30:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "b7c4d8e9f012"
down_revision: Union[str, Sequence[str], None] = (
    "2f638891cbb6",
    "8c9f0a1b2c3d",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
