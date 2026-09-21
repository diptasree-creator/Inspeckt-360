"""repair: shared product record (idempotent re-apply)

The previous migration (a1c9f5e0b2d4) got recorded as "applied" on at
least one real deployment without its table/columns actually landing —
most likely a deploy that crashed on an unrelated import error right
after Alembic finished, leaving things in an inconsistent state, or a
migration that ran but whose DDL didn't take for another reason. Either
way, `alembic upgrade head` alone won't fix it: Alembic thinks
a1c9f5e0b2d4 already ran, so it never re-attempts it.

This migration is the fix: it checks what's ACTUALLY in the database
(not what alembic_version claims) via SQLAlchemy's inspector, and only
creates/adds whatever is actually still missing. Safe to run against a
database that's fully caught up (does nothing), half-applied (finishes
the job), or never touched (does everything a1c9f5e0b2d4 would have).

Revision ID: e2f7a1b3c9d0
Revises: a1c9f5e0b2d4
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2f7a1b3c9d0'
down_revision: Union[str, None] = 'a1c9f5e0b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _has_column(inspector, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspector.get_columns(table))


def _has_index(inspector, table: str, index_name: str) -> bool:
    return any(ix["name"] == index_name for ix in inspector.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "products"):
        op.create_table(
            "products",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("product_name", sa.String(), nullable=False),
            sa.Column("description", sa.String(), nullable=True),
            sa.Column("category", sa.String(), nullable=True),
            sa.Column("sub_type", sa.String(), nullable=True),
            sa.Column("classification_state", sa.String(), nullable=False, server_default="NEED_INFORMATION"),
            sa.Column("classification_evidence_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        # Re-inspect: the table we just created needs to be visible before
        # we can safely check/create its index below.
        inspector = sa.inspect(bind)

    if _has_table(inspector, "products") and not _has_index(inspector, "products", "ix_products_user_id"):
        op.create_index("ix_products_user_id", "products", ["user_id"])

    if _has_table(inspector, "submissions") and not _has_column(inspector, "submissions", "product_id"):
        with op.batch_alter_table("submissions") as batch_op:
            batch_op.add_column(sa.Column("product_id", sa.String(), nullable=True))
            batch_op.create_foreign_key(
                "fk_submissions_product_id_products", "products", ["product_id"], ["id"], ondelete="SET NULL",
            )
        inspector = sa.inspect(bind)

    if _has_table(inspector, "submissions") and not _has_index(inspector, "submissions", "ix_submissions_product_id"):
        op.create_index("ix_submissions_product_id", "submissions", ["product_id"])

    if _has_table(inspector, "formulation_iterations") and not _has_column(inspector, "formulation_iterations", "product_id"):
        with op.batch_alter_table("formulation_iterations") as batch_op:
            batch_op.add_column(sa.Column("product_id", sa.String(), nullable=True))
            batch_op.create_foreign_key(
                "fk_formulation_iterations_product_id_products", "products", ["product_id"], ["id"], ondelete="SET NULL",
            )
        inspector = sa.inspect(bind)

    if _has_table(inspector, "formulation_iterations") and not _has_index(
        inspector, "formulation_iterations", "ix_formulation_iterations_product_id"
    ):
        op.create_index("ix_formulation_iterations_product_id", "formulation_iterations", ["product_id"])


def downgrade() -> None:
    # Deliberately a no-op: this migration only ever fills in gaps left by
    # a previous migration that's supposed to own this schema. Reversing
    # it would mean guessing which parts THIS run added versus which
    # already existed — the real teardown lives in a1c9f5e0b2d4's own
    # downgrade().
    pass
