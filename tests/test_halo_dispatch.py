import asyncio
from types import SimpleNamespace
from pathlib import Path

import pytest
import yaml

from functions import halo_dispatch


def test_replace_agent_cache_removes_stale_rows_and_normalizes_email(monkeypatch):
    calls: dict[str, object] = {}

    async def query(table, **kwargs):
        assert table == "halo_dispatch_agents"
        return SimpleNamespace(documents=[SimpleNamespace(id="stale-agent")])

    async def delete_batch(table, ids):
        calls["deleted"] = (table, ids)

    async def upsert_batch(table, documents):
        calls["upserted"] = (table, documents)

    async def upsert(table, doc_id, data):
        calls["state"] = (table, doc_id, data)

    monkeypatch.setattr(halo_dispatch.tables, "query", query)
    monkeypatch.setattr(halo_dispatch.tables, "delete_batch", delete_batch)
    monkeypatch.setattr(halo_dispatch.tables, "upsert_batch", upsert_batch)
    monkeypatch.setattr(halo_dispatch.tables, "upsert", upsert)

    count = asyncio.run(
        halo_dispatch._replace_cache(
            "agents",
            [{"id": 42, "name": "Ada", "email": " Ada@Example.COM "}],
        )
    )

    assert count == 1
    _, documents = calls["upserted"]
    assert documents[0]["id"] == "42"
    assert documents[0]["data"]["email_lower"] == "ada@example.com"
    assert calls["deleted"] == ("halo_dispatch_agents", ["stale-agent"])
    assert calls["state"][0:2] == ("halo_dispatch_cache_state", "agents")


def test_actor_cache_miss_refreshes_agents_then_matches_email(monkeypatch):
    queries = 0
    refreshed: list[str] = []

    async def query(table, **kwargs):
        nonlocal queries
        queries += 1
        assert table == "halo_dispatch_agents"
        assert kwargs["where"] == {"email_lower": "dispatcher@example.com"}
        if queries == 1:
            return SimpleNamespace(documents=[])
        return SimpleNamespace(
            documents=[SimpleNamespace(data={"id": 9, "email": "dispatcher@example.com"})]
        )

    async def refresh_one(cache_type):
        refreshed.append(cache_type)
        return 1

    monkeypatch.setattr(
        halo_dispatch,
        "context",
        SimpleNamespace(email="Dispatcher@Example.com"),
    )
    monkeypatch.setattr(halo_dispatch.tables, "query", query)
    monkeypatch.setattr(halo_dispatch, "_refresh_one", refresh_one)

    actor = asyncio.run(halo_dispatch._resolve_actor())

    assert actor["id"] == 9
    assert refreshed == ["agents"]
    assert queries == 2


def test_daily_schedule_targets_registered_refresh_workflow():
    root = Path(__file__).resolve().parents[1]
    workflows = yaml.safe_load((root / ".bifrost/workflows.yaml").read_text())["workflows"]
    events = yaml.safe_load((root / ".bifrost/events.yaml").read_text())["events"]

    refresh_id = next(
        workflow_id
        for workflow_id, item in workflows.items()
        if item["function_name"] == "refresh_cache"
    )
    schedule = next(iter(events.values()))

    assert schedule["cron_expression"] == "17 3 * * *"
    assert schedule["timezone"] == "America/New_York"
    assert schedule["subscriptions"][0]["workflow_id"] == refresh_id


def test_solution_declares_halopsa_connection():
    root = Path(__file__).resolve().parents[1]
    connections = yaml.safe_load((root / ".bifrost/connections.yaml").read_text())["connections"]
    assert connections["HaloPSA"]["integration_name"] == "HaloPSA"


def test_environment_explains_unavailable_bifrost_connection(monkeypatch):
    async def get_integration(name):
        assert name == "HaloPSA"
        return None

    monkeypatch.setattr(halo_dispatch.integrations, "get", get_integration)

    with pytest.raises(RuntimeError, match="restart `bifrost solution start`"):
        asyncio.run(halo_dispatch.environment())


def test_environment_explains_unconfigured_halo_oauth(monkeypatch):
    async def get_integration(name):
        assert name == "HaloPSA"
        return SimpleNamespace(config={"base_url": "https://halo.example.test/api"})

    async def resolve_actor():
        raise RuntimeError("OAuth not configured or access token missing")

    monkeypatch.setattr(halo_dispatch.integrations, "get", get_integration)
    monkeypatch.setattr(halo_dispatch, "_resolve_actor", resolve_actor)

    with pytest.raises(RuntimeError, match="Configure the HaloPSA OAuth connection"):
        asyncio.run(halo_dispatch.environment())
