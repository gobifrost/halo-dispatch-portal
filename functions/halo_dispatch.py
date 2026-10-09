"""HaloPSA reads, writes, and reference-cache maintenance for Dispatch Portal."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bifrost import context, integrations, tables, workflow
from modules import halopsa


CACHE_TABLES = {
    "agents": "halo_dispatch_agents",
    "teams": "halo_dispatch_teams",
    "ticket_areas": "halo_dispatch_ticket_areas",
    "ticket_types": "halo_dispatch_ticket_types",
    "statuses": "halo_dispatch_statuses",
    "view_lists": "halo_dispatch_view_lists",
    "categories": "halo_dispatch_categories",
    "appointment_types": "halo_dispatch_appointment_types",
}


def _plain(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


def _items(value: Any, *keys: str) -> list[dict[str, Any]]:
    data = _plain(value)
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        for key in keys:
            candidate = data.get(key)
            if isinstance(candidate, list):
                return [item for item in candidate if isinstance(item, dict)]
    return []


def _document_id(cache_type: str, row: dict[str, Any]) -> str:
    halo_id = row.get("id")
    if halo_id is None:
        halo_id = row.get("guid") or row.get("name")
    if halo_id is None:
        raise ValueError(f"{cache_type} cache row has no stable identifier")
    if cache_type == "view_lists":
        return f"{row.get('ticket_area_id', 0)}:{halo_id}"
    return str(halo_id)


async def _replace_cache(cache_type: str, rows: list[dict[str, Any]]) -> int:
    table_name = CACHE_TABLES[cache_type]
    current = await tables.query(table_name, limit=1000)
    documents = []
    for row in rows:
        normalized = _plain(row)
        if cache_type == "agents":
            normalized["email_lower"] = str(normalized.get("email") or "").strip().lower()
        documents.append({"id": _document_id(cache_type, normalized), "data": normalized})

    if documents:
        await tables.upsert_batch(table_name, documents)

    new_ids = {document["id"] for document in documents}
    stale_ids = [row.id for row in current.documents if row.id not in new_ids]
    if stale_ids:
        await tables.delete_batch(table_name, stale_ids)

    refreshed_at = datetime.now(timezone.utc).isoformat()
    await tables.upsert(
        "halo_dispatch_cache_state",
        cache_type,
        {
            "cache_type": cache_type,
            "refreshed_at": refreshed_at,
            "record_count": len(documents),
            "status": "ready",
        },
    )
    return len(documents)


async def _client_cache() -> dict[str, Any]:
    result = _plain(await halopsa.list_client_caches(iscachebuild=True))
    return result if isinstance(result, dict) else {}


async def _refresh_client_cache_types(cache_types: set[str]) -> dict[str, int]:
    cache = await _client_cache()
    counts: dict[str, int] = {}
    source_keys = {
        "agents": "agents",
        "ticket_areas": "ticketareas",
        "ticket_types": "tickettypes",
        "statuses": "statuses",
    }
    for cache_type, source_key in source_keys.items():
        if cache_type in cache_types:
            counts[cache_type] = await _replace_cache(
                cache_type, _items(cache.get(source_key), source_key)
            )
    return counts


async def _refresh_one(cache_type: str) -> int:
    if cache_type in {"agents", "ticket_areas", "ticket_types", "statuses"}:
        result = await _refresh_client_cache_types({cache_type})
        return result.get(cache_type, 0)

    if cache_type == "teams":
        rows = _items(await halopsa.list_teams_1(), "teams")
        rows = [row for row in rows if row.get("forrequests") and not row.get("inactive")]
        return await _replace_cache(cache_type, rows)

    if cache_type == "appointment_types":
        rows = _items(
            await halopsa.list_lookups(lookupid=63, unameaprestriction=True),
            "lookups",
        )
        return await _replace_cache(cache_type, rows)

    if cache_type == "categories":
        rows = _items(
            await halopsa.list_categories(tickettype_id=0, client_id=0, type_id=1),
            "categories",
        )
        return await _replace_cache(cache_type, rows)

    if cache_type == "view_lists":
        area_result = await tables.query("halo_dispatch_ticket_areas", limit=1000)
        if not area_result.documents:
            await _refresh_one("ticket_areas")
            area_result = await tables.query("halo_dispatch_ticket_areas", limit=1000)
        rows: list[dict[str, Any]] = []
        for area in area_result.documents:
            area_id = int(area.data.get("id") or 0)
            area_rows = _items(
                await halopsa.list_view_lists(
                    showcounts=True,
                    domain="reqs",
                    type="reqs",
                    ticketarea_id=area_id,
                    utcoffset=0,
                ),
                "viewlists",
                "lists",
            )
            for row in area_rows:
                row["ticket_area_id"] = area_id
            rows.extend(area_rows)
        return await _replace_cache(cache_type, rows)

    raise ValueError(f"Unsupported cache type: {cache_type}")


@workflow(category="Halo Dispatch Portal")
async def refresh_cache(
    cache_type: str = "all",
    reason: str = "daily",
    ids: list[int] | None = None,
) -> dict[str, Any]:
    """Refresh one Halo reference cache or all caches."""
    requested = list(CACHE_TABLES) if cache_type == "all" else [cache_type]
    unknown = [name for name in requested if name not in CACHE_TABLES]
    if unknown:
        raise ValueError(f"Unsupported cache type: {', '.join(unknown)}")

    # ClientCache supplies four cache types in one Halo request.
    client_types = set(requested) & {"agents", "ticket_areas", "ticket_types", "statuses"}
    counts = await _refresh_client_cache_types(client_types) if client_types else {}
    for name in requested:
        if name not in client_types:
            counts[name] = await _refresh_one(name)

    return {
        "cache_type": cache_type,
        "reason": reason,
        "requested_ids": ids or [],
        "counts": counts,
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
    }


async def _resolve_actor() -> dict[str, Any]:
    email = str(getattr(context, "email", None) or "").strip().lower()
    if not email:
        raise RuntimeError("The calling Bifrost user does not have an email address")
    result = await tables.query(
        "halo_dispatch_agents",
        where={"email_lower": email},
        limit=2,
    )
    if not result.documents:
        await _refresh_one("agents")
        result = await tables.query(
            "halo_dispatch_agents",
            where={"email_lower": email},
            limit=2,
        )
    if not result.documents:
        raise RuntimeError(f"No Halo agent matches Bifrost user {email}")
    return result.documents[0].data


@workflow(category="Halo Dispatch Portal")
async def environment() -> dict[str, Any]:
    """Return non-secret Halo environment details and the calling Halo agent."""
    integration = await integrations.get("HaloPSA")
    if not integration:
        raise RuntimeError(
            "Bifrost could not load the HaloPSA connection. Verify the Solution "
            "connection and retry; during local development, restart "
            "`bifrost solution start` if the CLI session has expired."
        )
    try:
        actor = await _resolve_actor()
    except RuntimeError as error:
        if str(error) in {
            "OAuth not configured or access token missing",
            "base_url not configured for integration 'HaloPSA'",
        }:
            raise RuntimeError(
                "Configure the HaloPSA OAuth connection and API base URL in the "
                "Solution connection settings, then retry."
            ) from error
        raise
    return {
        "halo_base_url": str((integration.config or {}).get("base_url") or "").rstrip("/").removesuffix("/api"),
        "agent": actor,
    }


@workflow(category="Halo Dispatch Portal")
async def list_tickets(
    list_id: int,
    ticket_area_id: int,
    page_no: int = 1,
    page_size: int = 100,
    columns_id: int | None = None,
    utc_offset: int = 0,
) -> dict[str, Any]:
    """Load current Halo tickets for one saved view list."""
    params: dict[str, Any] = {
        "pageinate": True,
        "page_size": page_size,
        "page_no": page_no,
        "ticketarea_id": ticket_area_id,
        "list_id": list_id,
        "utcoffset": utc_offset,
        "includelastnote": True,
        "includehoversummary": True,
        "includechildread": True,
        "fetchgrandchildren": False,
        "cf_display_values_only": True,
        "view_id": 0,
    }
    if columns_id is not None:
        params.update({"columns_id": columns_id, "includecolumns": True})
    result = _plain(await halopsa.list_tickets(**params))
    return result if isinstance(result, dict) else {"tickets": result or []}


@workflow(category="Halo Dispatch Portal")
async def list_appointments(
    start_date: str,
    end_date: str,
    agent_ids: list[int] | None = None,
    utc_offset: int = 0,
) -> list[dict[str, Any]]:
    """Load current Halo appointments for a date range and agent selection."""
    selected = ",".join(str(value) for value in (agent_ids or []))
    result = await halopsa.list_appointments(
        selectedAgents=selected,
        selectedStatuses="0,1",
        alllocations=True,
        showholidays=True,
        showappointments=True,
        showchanges=True,
        workhoursonly=True,
        showprojects=True,
        isrecurringmaster=False,
        showtasks=False,
        showscheduledtickets=True,
        utcoffset=utc_offset,
        start_date=start_date,
        end_date=end_date,
        agents=selected,
        appointmentsonly=True,
        excluderecurringmaster=True,
        showshifts=False,
    )
    return _items(result, "appointments")


@workflow(category="Halo Dispatch Portal")
async def search_users(search: str = "", count: int = 50) -> dict[str, Any]:
    """Search current Halo users by name, company, or email."""
    result = _plain(
        await halopsa.list_users(
            search=search,
            count=count,
            includeserviceaccount=False,
            onlyprospects=False,
            onlyusers=True,
        )
    )
    return result if isinstance(result, dict) else {"record_count": len(result or []), "users": result or []}


@workflow(category="Halo Dispatch Portal")
async def search_sites(search: str = "", page_no: int = 1, page_size: int = 100) -> dict[str, Any]:
    """Search current Halo sites."""
    result = _plain(
        await halopsa.list_sites(
            search=search,
            pageinate=True,
            page_no=page_no,
            page_size=page_size,
        )
    )
    return result if isinstance(result, dict) else {"record_count": len(result or []), "sites": result or []}


@workflow(category="Halo Dispatch Portal")
async def search_companies(search: str = "", page_no: int = 1, page_size: int = 100) -> dict[str, Any]:
    """Search current Halo companies/clients."""
    result = _plain(
        await halopsa.list_clients(
            search=search,
            pageinate=True,
            page_no=page_no,
            page_size=page_size,
        )
    )
    return result if isinstance(result, dict) else {"record_count": len(result or []), "clients": result or []}


@workflow(category="Halo Dispatch Portal")
async def save_ticket(ticket: dict[str, Any]) -> list[dict[str, Any]]:
    """Create or update a Halo ticket as the calling Bifrost user."""
    actor = await _resolve_actor()
    payload = {key: value for key, value in ticket.items() if value is not None}
    payload.setdefault("agent_id", actor.get("id"))
    return _items(await halopsa.create_tickets(data=[payload]), "tickets")


@workflow(category="Halo Dispatch Portal")
async def save_appointment(appointment: dict[str, Any]) -> list[dict[str, Any]]:
    """Create or update a Halo appointment as the calling Bifrost user."""
    actor = await _resolve_actor()
    payload = {key: value for key, value in appointment.items() if value is not None}
    payload.setdefault("agent_id", actor.get("id"))
    return _items(await halopsa.create_appointment(data=[payload]), "appointments")


@workflow(category="Halo Dispatch Portal")
async def remove_appointment(appointment_id: int) -> dict[str, Any]:
    """Delete a Halo appointment after resolving the calling Halo agent."""
    actor = await _resolve_actor()
    result = _plain(await halopsa.delete_appointment(str(appointment_id)))
    return {"deleted": True, "appointment_id": appointment_id, "actor_agent_id": actor.get("id"), "result": result}
