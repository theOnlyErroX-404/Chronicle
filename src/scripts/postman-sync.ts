// Syncs postman/*.json to the account's Postman workspace via the Postman API.
// Requires Postman_API_KEY in the environment (.env is loaded via --env-file).
// Upserts by name: creates the collection/environment if absent, else updates.
import { readFile } from "node:fs/promises";
import path from "node:path";

const API = "https://api.getpostman.com";
const KEY = process.env.Postman_API_KEY ?? "";
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID ?? "";
const COLLECTION_PATH = path.join(process.cwd(), "postman", "Chronicle.postman_collection.json");
const ENVIRONMENT_PATH = path.join(process.cwd(), "postman", "Chronicle.postman_environment.json");

const fail = (message: string): never => {
  console.error(`[postman-sync] ${message}`);
  process.exit(1);
};

const apiCall = async (method: string, url: string, body?: unknown) => {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: { "X-Api-Key": KEY, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    fail(`${method} ${url} -> ${response.status}: ${detail}`);
  }
  return response.json();
};

const main = async () => {
  if (!KEY) fail("Postman_API_KEY is not set (add it to .env).");

  const [{ workspaces }, { collections }, { environments }] = await Promise.all([
    apiCall("GET", "/workspaces"),
    apiCall("GET", "/collections"),
    apiCall("GET", "/environments"),
  ]);

  const workspace = WORKSPACE_ID
    ? workspaces.find((w: { id: string }) => w.id === WORKSPACE_ID)
    : workspaces[0];
  if (!workspace) fail("no workspace found (set POSTMAN_WORKSPACE_ID).");

  const collectionRaw = JSON.parse(await readFile(COLLECTION_PATH, "utf8"));
  const environmentRaw = JSON.parse(await readFile(ENVIRONMENT_PATH, "utf8"));
  const collection = { ...collectionRaw, info: { ...collectionRaw.info, _postman_id: undefined } };
  const environment = { ...environmentRaw, id: undefined };

  const existingCollection = collections.find((c: { name: string }) => c.name === collection.info.name);
  const existingEnvironment = environments.find((e: { name: string }) => e.name === environment.name);

  if (existingCollection) {
    await apiCall("PUT", `/collections/${existingCollection.id}`, { collection });
    console.log(`[postman-sync] updated collection "${collection.info.name}" (${existingCollection.id})`);
  } else {
    const created = await apiCall("POST", "/collections", { collection });
    console.log(`[postman-sync] created collection "${collection.info.name}" (${created.collection.id})`);
  }

  if (existingEnvironment) {
    await apiCall("PUT", `/environments/${existingEnvironment.id}`, { environment });
    console.log(`[postman-sync] updated environment "${environment.name}" (${existingEnvironment.id})`);
  } else {
    const created = await apiCall("POST", "/environments", { environment });
    console.log(`[postman-sync] created environment "${environment.name}" (${created.environment.id})`);
  }

  console.log(`[postman-sync] done — workspace "${workspace.name}" (${workspace.id})`);
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
