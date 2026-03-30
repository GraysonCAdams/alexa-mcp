#!/usr/bin/env node

// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/tools.ts
import { z } from "zod";

// src/logger.ts
var server = null;
function setServer(s) {
  server = s;
}
function log(level, logger, data) {
  if (!server) return;
  try {
    server.sendLoggingMessage({ level, logger, data }).catch(() => {
    });
  } catch {
  }
}

// src/config.ts
import { homedir } from "os";
import { join } from "path";
var config = {
  amazonPage: process.env.AMAZON_PAGE || "amazon.com",
  proxyPort: parseInt(process.env.PROXY_PORT || "3001", 10),
  cookiePath: process.env.COOKIE_PATH || join(homedir(), ".alexa-mcp", "cookie.json"),
  serverName: "alexa-shopping-mcp",
  serverVersion: "1.0.0"
};
var config_default = config;

// src/auth.ts
import AlexaRemote from "alexa-remote2";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
var alexa = null;
var authenticated = false;
function isAuthenticated() {
  return authenticated && alexa !== null;
}
function getClient() {
  return alexa;
}
function loadCookie() {
  if (existsSync(config_default.cookiePath)) {
    try {
      const content = readFileSync(config_default.cookiePath, "utf-8");
      const data = JSON.parse(content);
      log("debug", "auth", "Loaded cookie from disk");
      return data;
    } catch {
      log("warning", "auth", "Failed to load cookie from disk");
    }
  }
  if (process.env.ALEXA_COOKIE) {
    try {
      const data = JSON.parse(process.env.ALEXA_COOKIE);
      log("debug", "auth", "Loaded cookie from ALEXA_COOKIE env var");
      return data;
    } catch {
      log("warning", "auth", "Failed to parse ALEXA_COOKIE env var");
    }
  }
  return null;
}
function saveCookieData(cookieData) {
  try {
    const dir = dirname(config_default.cookiePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(config_default.cookiePath, JSON.stringify(cookieData, null, 2));
    log("debug", "auth", "Cookie saved to disk");
  } catch (err) {
    log("warning", "auth", `Failed to save cookie: ${err}`);
  }
}
function saveCookieFromInstance(instance) {
  const cookieData = {
    cookie: instance.cookie,
    csrf: instance.csrf,
    macDms: instance.macDms,
    formerRegistrationData: instance.cookieData?.formerRegistrationData
  };
  if (cookieData.cookie) {
    saveCookieData(cookieData);
  }
}
async function startAuthentication() {
  const savedCookie = loadCookie();
  alexa = new AlexaRemote();
  if (savedCookie?.cookie) {
    return new Promise((resolve, reject) => {
      const options = {
        cookie: savedCookie.cookie,
        proxyOnly: false,
        proxyOwnIp: "localhost",
        proxyPort: config_default.proxyPort,
        proxyListenBind: "0.0.0.0",
        amazonPage: config_default.amazonPage,
        amazonPageProxyLanguage: "en_US",
        acceptLanguage: "en-US",
        useWsMqtt: false,
        cookieRefreshInterval: 7 * 24 * 60 * 60 * 1e3,
        formerRegistrationData: savedCookie.formerRegistrationData,
        macDms: savedCookie.macDms
      };
      alexa.init(options, (err) => {
        if (err) {
          log("warning", "auth", `Saved cookie failed: ${err.message}, will need re-auth`);
          authenticated = false;
          alexa = null;
          reject(new Error(`Saved cookie expired or invalid. Call authenticate again after clearing cookie, or delete ${config_default.cookiePath} and re-authenticate.`));
          return;
        }
        saveCookieFromInstance(alexa);
        authenticated = true;
        log("info", "auth", "Authenticated with saved cookie");
        resolve({ message: "Authenticated successfully using saved cookie." });
      });
      alexa.on("cookie", (cookie, csrf, macDms) => {
        const cookieData = {
          cookie,
          csrf,
          macDms,
          formerRegistrationData: alexa?.cookieData?.formerRegistrationData
        };
        saveCookieData(cookieData);
        log("debug", "auth", "Cookie refreshed and saved");
      });
    });
  }
  return new Promise((resolve) => {
    let initCallCount = 0;
    const options = {
      cookie: void 0,
      proxyOnly: true,
      proxyOwnIp: "localhost",
      proxyPort: config_default.proxyPort,
      proxyListenBind: "0.0.0.0",
      amazonPage: config_default.amazonPage,
      amazonPageProxyLanguage: "en_US",
      acceptLanguage: "en-US",
      useWsMqtt: false,
      cookieRefreshInterval: 7 * 24 * 60 * 60 * 1e3
    };
    alexa.init(options, (err) => {
      initCallCount++;
      if (initCallCount === 1) {
        const proxyUrl = `http://localhost:${config_default.proxyPort}`;
        log("info", "auth", `Proxy started at ${proxyUrl}`);
        resolve({
          message: `Authentication required. Please open the URL below in your browser and log in to your Amazon account.`,
          proxyUrl
        });
        return;
      }
      if (err) {
        log("error", "auth", `Auth failed after browser login: ${err.message}`);
        authenticated = false;
        return;
      }
      saveCookieFromInstance(alexa);
      authenticated = true;
      log("info", "auth", "Authenticated via browser login");
    });
    alexa.on("cookie", (cookie, csrf, macDms) => {
      const cookieData = {
        cookie,
        csrf,
        macDms,
        formerRegistrationData: alexa?.cookieData?.formerRegistrationData
      };
      saveCookieData(cookieData);
      authenticated = true;
      log("info", "auth", "Cookie received from browser login");
    });
  });
}

// src/alexa-client.ts
var shoppingListIdCache = null;
function getLists(alexa2) {
  return new Promise((resolve, reject) => {
    alexa2.getListsV2((err, result) => {
      if (err) {
        reject(err);
        return;
      }
      let listArray;
      if (Array.isArray(result)) {
        listArray = result;
      } else {
        const typed = result;
        listArray = typed?.listInfoList || typed?.lists || [];
      }
      const lists = listArray.map((list) => {
        let itemCount = 0;
        const totalActive = list.totalActiveItemsCount || list.aggregatedAttributes?.totalActiveItemsCount;
        if (typeof totalActive === "string") {
          try {
            const parsed = JSON.parse(totalActive);
            itemCount = parsed.count || 0;
          } catch {
          }
        } else if (typeof totalActive === "number") {
          itemCount = totalActive;
        }
        return {
          listId: String(list.listId || list.listInfoId || ""),
          name: String(list.listName || list.name || list.listType || ""),
          listType: String(list.listType || ""),
          defaultList: Boolean(list.defaultList),
          itemCount
        };
      });
      resolve(lists);
    });
  });
}
async function getShoppingListId(alexa2) {
  if (shoppingListIdCache) return shoppingListIdCache;
  const lists = await getLists(alexa2);
  log("debug", "alexa-client", `Available lists: ${lists.map((l) => `${l.name}(${l.listType})`).join(", ")}`);
  let shoppingList = lists.find((l) => l.listType === "SHOP");
  if (!shoppingList) {
    shoppingList = lists.find((l) => {
      const name = l.name.toLowerCase();
      return name === "shopping" || name === "shop" || name === "alexa shopping list" || name.includes("shopping") || name === "einkaufsliste" || name === "liste de courses" || name === "lista de compras" || name === "lista della spesa";
    });
  }
  if (!shoppingList) {
    throw new Error(`Shopping list not found. Available lists: ${lists.map((l) => l.name).join(", ")}`);
  }
  shoppingListIdCache = shoppingList.listId;
  return shoppingList.listId;
}
function parseItems(result) {
  let itemArray;
  if (Array.isArray(result)) {
    itemArray = result;
  } else {
    const typed = result;
    itemArray = typed?.itemInfoList || typed?.listItems || [];
  }
  return itemArray.map((item) => ({
    id: String(item.itemId || item.id || item.listItemId || ""),
    value: String(item.itemName || item.value || ""),
    completed: item.completed === true || item.completed === "true" || item.itemStatus === "COMPLETED",
    createdDateTime: item.createdDateTime || item.createAt ? String(item.createdDateTime || item.createAt) : null,
    updatedDateTime: item.updatedDateTime || item.updateAt ? String(item.updatedDateTime || item.updateAt) : null,
    version: Number(item.version || 1)
  }));
}
async function listItems(alexa2, includeCompleted) {
  const listId = await getShoppingListId(alexa2);
  return new Promise((resolve, reject) => {
    const options = {};
    if (!includeCompleted) {
      options.completed = "false";
    }
    alexa2.getListItemsV2(listId, options, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      const items = parseItems(result);
      const filtered = includeCompleted ? items : items.filter((i) => !i.completed);
      resolve(filtered);
    });
  });
}
async function addItem(alexa2, value) {
  const listId = await getShoppingListId(alexa2);
  return new Promise((resolve, reject) => {
    alexa2.addListItemV2(listId, { value }, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}
async function deleteItem(alexa2, listId, itemId, version) {
  return new Promise((resolve, reject) => {
    alexa2.deleteListItem(listId, itemId, { version: String(version) }, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}
async function updateItem(alexa2, listId, itemId, version, value, completed) {
  return new Promise((resolve, reject) => {
    alexa2.updateListItemV2(listId, itemId, {
      value,
      version: String(version),
      completed: completed ? "true" : "false"
    }, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}
async function deleteItemsByName(alexa2, names) {
  const listId = await getShoppingListId(alexa2);
  const items = await listItems(alexa2, true);
  const deleted = [];
  const not_found = [];
  for (const name of names) {
    const item = items.find((i) => i.value.toLowerCase() === name.toLowerCase());
    if (item) {
      await deleteItem(alexa2, listId, item.id, item.version);
      deleted.push(item.value);
    } else {
      not_found.push(name);
    }
  }
  return { deleted, not_found };
}
async function completeItemsByName(alexa2, names) {
  const listId = await getShoppingListId(alexa2);
  const items = await listItems(alexa2, false);
  const completed = [];
  const not_found = [];
  for (const name of names) {
    const item = items.find((i) => i.value.toLowerCase() === name.toLowerCase());
    if (item) {
      await updateItem(alexa2, listId, item.id, item.version, item.value, true);
      completed.push(item.value);
    } else {
      not_found.push(name);
    }
  }
  return { completed, not_found };
}
async function updateItemByName(alexa2, name, newName, completedStatus) {
  const listId = await getShoppingListId(alexa2);
  const items = await listItems(alexa2, true);
  const item = items.find((i) => i.value.toLowerCase() === name.toLowerCase());
  if (!item) {
    throw new Error(`Item "${name}" not found on shopping list.`);
  }
  const updatedValue = newName ?? item.value;
  const updatedCompleted = completedStatus ?? item.completed;
  await updateItem(alexa2, listId, item.id, item.version, updatedValue, updatedCompleted);
  return `Updated "${item.value}"${newName ? ` \u2192 "${newName}"` : ""}${completedStatus !== void 0 ? ` (completed: ${completedStatus})` : ""}`;
}

// src/tools.ts
function textResult(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}
function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
async function requireAuth() {
  if (!isAuthenticated()) {
    await startAuthentication();
  }
  if (!isAuthenticated()) {
    throw new Error("Not authenticated. No saved cookie available.");
  }
  const client = getClient();
  if (!client) {
    throw new Error("Alexa client not available.");
  }
  return client;
}
function registerTools(server3) {
  server3.registerTool(
    "authenticate",
    {
      title: "Authenticate with Amazon Alexa",
      description: "Authenticate with your Amazon account. If a saved cookie exists, uses it automatically. Otherwise starts a browser login proxy and returns a URL to open.",
      annotations: { readOnlyHint: false, openWorldHint: true }
    },
    async () => {
      try {
        const result = await startAuthentication();
        log("info", "tools.authenticate", result.message);
        return textResult(result);
      } catch (e) {
        log("error", "tools.authenticate", formatError(e));
        return errorResult(formatError(e));
      }
    }
  );
  server3.registerTool(
    "list_items",
    {
      title: "List Shopping Items",
      description: "Get items from your Alexa shopping list.",
      inputSchema: {
        include_completed: z.boolean().optional().describe("Include completed items (default: false)")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ include_completed }) => {
      try {
        const client = await requireAuth();
        const items = await listItems(client, include_completed ?? false);
        log("info", "tools.list_items", `Returned ${items.length} items`);
        return textResult(items);
      } catch (e) {
        log("error", "tools.list_items", formatError(e));
        return errorResult(formatError(e));
      }
    }
  );
  server3.registerTool(
    "add_items",
    {
      title: "Add Shopping Items",
      description: "Add one or more items to your Alexa shopping list.",
      inputSchema: {
        items: z.array(z.string()).describe('Items to add (e.g. ["milk", "eggs", "bread"])')
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },
    async ({ items }) => {
      try {
        const client = await requireAuth();
        const added = [];
        for (const item of items) {
          await addItem(client, item);
          added.push(item);
        }
        log("info", "tools.add_items", `Added ${added.length} items`);
        return textResult({ message: `Added ${added.length} item(s) to shopping list.`, added });
      } catch (e) {
        log("error", "tools.add_items", formatError(e));
        return errorResult(formatError(e));
      }
    }
  );
  server3.registerTool(
    "delete_items",
    {
      title: "Delete Shopping Items",
      description: "Delete items from your Alexa shopping list by name (case-insensitive match).",
      inputSchema: {
        names: z.array(z.string()).describe("Item names to delete")
      },
      annotations: { destructiveHint: true }
    },
    async ({ names }) => {
      try {
        const client = await requireAuth();
        const result = await deleteItemsByName(client, names);
        const msg = result.deleted.length > 0 ? `Deleted ${result.deleted.length} item(s).` : "No items deleted.";
        log("info", "tools.delete_items", msg);
        return textResult({ message: msg, ...result });
      } catch (e) {
        log("error", "tools.delete_items", formatError(e));
        return errorResult(formatError(e));
      }
    }
  );
  server3.registerTool(
    "update_item",
    {
      title: "Update Shopping Item",
      description: "Update an item on your Alexa shopping list by name (case-insensitive). Can rename and/or change completion status.",
      inputSchema: {
        name: z.string().describe("Current item name (case-insensitive)"),
        new_name: z.string().optional().describe("New name for the item"),
        completed: z.boolean().optional().describe("Set completion status")
      },
      annotations: { destructiveHint: false }
    },
    async ({ name, new_name, completed }) => {
      try {
        const client = await requireAuth();
        const msg = await updateItemByName(client, name, new_name, completed);
        log("info", "tools.update_item", msg);
        return textResult({ message: msg });
      } catch (e) {
        log("error", "tools.update_item", formatError(e));
        return errorResult(formatError(e));
      }
    }
  );
  server3.registerTool(
    "complete_items",
    {
      title: "Complete Shopping Items",
      description: "Mark items as completed on your Alexa shopping list by name (case-insensitive match).",
      inputSchema: {
        names: z.array(z.string()).describe("Item names to mark as completed")
      }
    },
    async ({ names }) => {
      try {
        const client = await requireAuth();
        const result = await completeItemsByName(client, names);
        const msg = result.completed.length > 0 ? `Completed ${result.completed.length} item(s).` : "No items completed.";
        log("info", "tools.complete_items", msg);
        return textResult({ message: msg, ...result });
      } catch (e) {
        log("error", "tools.complete_items", formatError(e));
        return errorResult(formatError(e));
      }
    }
  );
  server3.registerTool(
    "check_status",
    {
      title: "Check Alexa Connection Status",
      description: "Check whether the server is authenticated and show configuration.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      return textResult({
        authenticated: isAuthenticated(),
        cookie_path: config_default.cookiePath,
        amazon_page: config_default.amazonPage
      });
    }
  );
}

// src/index.ts
var server2 = new McpServer({
  name: config_default.serverName,
  version: config_default.serverVersion
}, {
  capabilities: {
    tools: {},
    logging: {}
  }
});
setServer(server2);
registerTools(server2);
var transport = new StdioServerTransport();
await server2.connect(transport);
