from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import URL, create_engine, engine_from_config, pool

from app.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


database_url_override = os.getenv("DATABASE_URL")
database_user = os.getenv("POSTGRES_USER")
database_password = os.getenv("POSTGRES_PASSWORD")
database_name = os.getenv("POSTGRES_DB")
if database_url_override:
    config.set_main_option("sqlalchemy.url", database_url_override.replace("%", "%%"))
elif database_user and database_password and database_name:
    database_url = URL.create(
        "postgresql+psycopg",
        username=database_user,
        password=database_password,
        host=os.getenv("DB_HOST", "database"),
        port=5432,
        database=database_name,
    ).render_as_string(hide_password=False)
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))


target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    database_url = config.get_main_option("sqlalchemy.url")
    connectable = create_engine(database_url, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
