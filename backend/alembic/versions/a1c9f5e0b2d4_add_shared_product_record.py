"""add shared product record (Phase 1 foundation)

Adds the `products` table described in WHOLE_APP_SPEC.md §6 — the one
shared record New Submission, Formulation Lab, and (later) Lab Testing /
Label Check / Claims Review are meant to attach to instead of each module
keeping its own disconnected copy of "the product" — plus a nullable,
additive `product_id` link column on `submissions` and
`formulation_iterations`.

This migration is purely additive: it creates one new table and adds two
nullable foreign-key columns to existing tables. It does not touch,
rename, or drop any existing column, and it does not guess/backfill links
for existing rows — WHOLE_APP_SPEC.md §22/§51 are explicit that gaps
should be left visible rather than silently filled. Existing submissions
and formulation iterations simply keep `product_id = NULL` until a future
change (the New Submission redesign) starts creating/attaching real
Product rows.

Revision ID: a1c9f5e0b2d4
Revises: de4815dad49b
Create Date: 2026-09-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c9f5e0b2d4'
down_revision: Union[str, None] = 'de4815dad49b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
    op.create_index("ix_products_user_id", "products", ["user_id"])

    # batch_alter_table (not a bare op.add_column) so this also works on
    # SQLite (local dev / the test suite's default DATABASE_URL) — SQLite
    # can't ALTER a table to add a column with an inline foreign-key
    # constraint directly; Alembic's batch mode does a copy-and-move
    # instead. On Postgres (the real deployment target) this still emits a
    # plain, fast ALTER TABLE ADD COLUMN.
    with op.batch_alter_table("submissions") as batch_op:
        batch_op.add_column(sa.Column("product_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_submissions_product_id_products", "products", ["product_id"], ["id"], ondelete="SET NULL",
        )
    op.create_index("ix_submissions_product_id", "submissions", ["product_id"])

    with op.batch_alter_table("formulation_iterations") as batch_op:
        batch_op.add_column(sa.Column("product_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_formulation_iterations_product_id_products", "products", ["product_id"], ["id"], ondelete="SET NULL",
        )
    op.create_index("ix_formulation_iterations_product_id", "formulation_iterations", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_formulation_iterations_product_id", table_name="formulation_iterations")
    with op.batch_alter_table("formulation_iterations") as batch_op:
        batch_op.drop_constraint("fk_formulation_iterations_product_id_products", type_="foreignkey")
        batch_op.drop_column("product_id")

    op.drop_index("ix_submissions_product_id", table_name="submissions")
    with op.batch_alter_table("submissions") as batch_op:
        batch_op.drop_constraint("fk_submissions_product_id_products", type_="foreignkey")
        batch_op.drop_column("product_id")

    op.drop_index("ix_products_user_id", table_name="products")
    op.drop_table("products")
