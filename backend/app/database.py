import os
from collections.abc import Generator

from sqlalchemy import Engine, URL, create_engine
from sqlalchemy.orm import Session, sessionmaker


def make_engine() -> Engine | None:
    user = os.getenv("POSTGRES_USER")
    password = os.getenv("POSTGRES_PASSWORD")
    database = os.getenv("POSTGRES_DB")
    if not (user and password and database):
        return None
    return create_engine(
        URL.create(
            "postgresql+psycopg",
            username=user,
            password=password,
            host=os.getenv("DB_HOST", "database"),
            port=5432,
            database=database,
        ),
        pool_pre_ping=True,
    )


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False) if engine else None


def get_session() -> Generator[Session, None, None]:
    if SessionLocal is None:
        raise RuntimeError("Database is not configured")
    with SessionLocal() as session:
        yield session