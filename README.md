# Halo Dispatch Portal

Halo Dispatch Portal is a portable Bifrost Solution for triaging HaloPSA tickets
and scheduling service work. Its browser app calls Solution-owned workflows; Halo
OAuth credentials and API traffic stay on the server.

## Install

Install the repository with a Bifrost CLI matched to your platform instance:

```bash
bifrost solution install-repo https://github.com/gobifrost/halo-dispatch-portal
```

Repository installs are Git-connected. Use the platform Solution Git lifecycle to
review and apply updates; merging repository changes does not update an installed
Solution by itself.

## Access

The app, its workflows, and its cache-table policies require the Bifrost **PSA
Users** role. This is an access role for people who should use the portal; it is
not a HaloPSA user type. Assign it to the intended Bifrost people, then refresh
the cache so each caller can be matched to a Halo agent by email.

Halo API operations use the configured server OAuth identity. People granted
this role share that connection's Halo permissions; matching their Bifrost email
selects their Halo agent identity.

If you rename or replace this role, update the app entry in
`.bifrost/apps.yaml`, every workflow entry in `.bifrost/workflows.yaml`, and the
cache-table policies in `.bifrost/tables.yaml` together. Those declarations form
one access boundary.

## HaloPSA connection and first refresh

Solution Setup declares a required **HaloPSA** connection. Configure the shared
integration in the platform with:

For a global Solution install, configure a global HaloPSA connection. The daily
cache refresh runs in that global default context, so an organization-only
connection is not available to it.

- `base_url`: the Halo API resource base, including `/api`, such as
  `https://your-tenant.halopsa.com/api`.
- OAuth: configure the Halo authorization-code client and complete the platform
  connection flow. Client credentials, token URLs, and secrets are environment
  data and are never stored in this repository.

After the connection is ready, run the registered `halo_dispatch_refresh_cache`
workflow once with its default `cache_type` of `all`. The daily schedule keeps
reference data fresh afterwards. The portal also refreshes an unresolved
reference type before continuing, but that does not replace the initial refresh.

## Local validation

Run Python checks against the actual Bifrost SDK in Docker:

```bash
docker run --rm --entrypoint sh \
  -v "$PWD":/solution:ro \
  -v "${BIFROST_API_DIR:?set this to your Bifrost api directory}":/sdk:ro \
  -w /solution \
  -e PYTHONPATH=/sdk:/solution \
  "${BIFROST_TEST_IMAGE:?set this to your Bifrost test image}" \
  -lc 'pytest -q tests'
```

Use `bifrost solution start` for connected local development. The platform
injects the web SDK while building a Solution app; the SDK is intentionally not
a committed npm dependency.
