import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const entry = new URL("./main.tsx", import.meta.url).pathname;

async function loadAppModule(dev = false) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    define: {
      "import.meta.env.DEV": dev ? "true" : "false",
      "import.meta.env.VITE_BIFROST_API_URL": '"https://dev.example"',
      "import.meta.env.VITE_BIFROST_TOKEN": '"dev-token"',
      "import.meta.env.VITE_BIFROST_ORG_ID": "null",
      "import.meta.env.VITE_BIFROST_APP_ID": "null",
      "import.meta.env.VITE_SOLUTION_ID": '"dev-solution-id"',
    },
    plugins: [{
      name: "lifecycle-stubs",
      setup(build) {
        build.onResolve({ filter: /^(react|react-dom\/client|react-router-dom|bifrost|react\/jsx-runtime)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        build.onResolve({ filter: /^\.\/App$/ }, () => ({ path: "app", namespace: "stub" }));
        build.onResolve({ filter: /^\.\/index\.css$/ }, () => ({ path: "css", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
          const contents = {
            react: "export const StrictMode = ({ children }) => children;",
            "react-dom/client": "export const createRoot = (mountEl) => { const root = { mountEl, renders: [], unmounted: false, render(value) { this.renders.push(value); }, unmount() { this.unmounted = true; } }; globalThis.__roots.push(root); return root; };",
            "react-router-dom": "export const BrowserRouter = ({ children }) => children;",
            bifrost: "export const BifrostProvider = ({ children }) => children;",
            "react/jsx-runtime": "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;",
            app: "export default function App() { return null; }",
            css: "",
          }[args.path];
          return { contents, loader: "js" };
        });
      },
    }],
  });
  const source = Buffer.from(result.outputFiles[0].contents).toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

test("mount creates independent roots and each teardown unmounts its root", async () => {
  globalThis.__roots = [];
  globalThis.window = { __BIFROST_APP_MODULES__: new Map(), location: { assign() {} } };
  globalThis.document = { documentElement: { classList: { contains: () => false } } };

  const app = await loadAppModule();
  assert.equal(typeof app.mount, "function");

  const firstTeardown = app.mount({}, { basename: "/", baseUrl: "https://one.example", token: "one", orgScope: null, appId: "one", onLogout() {}, theme: "light" });
  const secondTeardown = app.mount({}, { basename: "/", baseUrl: "https://two.example", token: "two", orgScope: null, appId: "two", onLogout() {}, theme: "dark" });

  assert.equal(globalThis.__roots.length, 2);
  firstTeardown();
  assert.equal(globalThis.__roots[0].unmounted, true);
  assert.equal(globalThis.__roots[1].unmounted, false);
  secondTeardown();
  assert.equal(globalThis.__roots[1].unmounted, true);
});

test("development mount supplies the solution binding to the SDK", async () => {
  globalThis.__roots = [];
  globalThis.window = { __BIFROST_APP_MODULES__: new Map(), location: { assign() {} } };
  globalThis.document = {
    documentElement: { classList: { contains: () => false } },
    getElementById: () => ({}),
  };

  await loadAppModule(true);

  const renderedTree = globalThis.__roots[0].renders[0];
  assert.equal(renderedTree.props.children.props.solutionId, "dev-solution-id");
});
