import json
from pathlib import Path

import yaml


def test_solution_package_declares_portable_halo_connection_and_platform_sdk():
    root = Path(__file__).resolve().parents[1]
    descriptor = yaml.safe_load((root / "bifrost.solution.yaml").read_text())
    assert descriptor["allow_outbound_access"] is False
    assert descriptor["allow_inbound_access"] is True
    assert "global_repo_access" not in descriptor

    connections = yaml.safe_load(
        (root / ".bifrost/connections.yaml").read_text()
    )["connections"]
    template = connections["HaloPSA"]["template"]
    base_url = next(item for item in template["config_schema"] if item["key"] == "base_url")
    assert base_url["type"] == "string"
    assert base_url["required"] is True
    assert template["oauth"]["oauth_flow_type"] == "authorization_code"

    package_dir = root / "apps/halo-dispatch-portal"
    package = json.loads((package_dir / "package.json").read_text())
    lock = json.loads((package_dir / "package-lock.json").read_text())
    assert "bifrost" not in package["dependencies"]
    assert "bifrost" not in lock["packages"][""].get("dependencies", {})
    assert "node_modules/bifrost" not in lock["packages"]


def test_solution_access_and_event_dependencies_are_closed():
    root = Path(__file__).resolve().parents[1]
    app = next(iter(yaml.safe_load((root / ".bifrost/apps.yaml").read_text())["apps"].values()))
    workflows = yaml.safe_load((root / ".bifrost/workflows.yaml").read_text())["workflows"]
    tables = yaml.safe_load((root / ".bifrost/tables.yaml").read_text())["tables"]
    event = next(iter(yaml.safe_load((root / ".bifrost/events.yaml").read_text())["events"].values()))

    assert app["role_names"] == ["PSA Users"]
    for workflow in workflows.values():
        assert workflow["role_names"] == ["PSA Users"]
        assert (root / workflow["path"]).is_file()
    for table in tables.values():
        policies = table["policies"]
        assert any(policy["name"] == "halo_dispatch_psa_users" for policy in policies)
    assert event["subscriptions"][0]["workflow_id"] in workflows
