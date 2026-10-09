import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

import { loadConfigFromFile } from "vite";

test("dev config passes the CLI Solution binding to the app SDK", async () => {
  const previous = {
    BIFROST_API_URL: process.env.BIFROST_API_URL,
    BIFROST_ACCESS_TOKEN: process.env.BIFROST_ACCESS_TOKEN,
    BIFROST_SOLUTION_ID: process.env.BIFROST_SOLUTION_ID,
  };
  process.env.BIFROST_API_URL = "http://127.0.0.1:8000";
  process.env.BIFROST_ACCESS_TOKEN = "test-token";
  process.env.BIFROST_SOLUTION_ID = "solution-under-test";
  try {
    const loaded = await loadConfigFromFile(
      { command: "serve", mode: "development" },
      resolve("vite.config.ts"),
    );
    assert.equal(
      loaded?.config.define?.["import.meta.env.VITE_SOLUTION_ID"],
      JSON.stringify("solution-under-test"),
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
