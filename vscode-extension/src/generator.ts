import * as fs from "fs";
import * as path from "path";
import { CollectionInfo, Endpoint, QueryParam } from "./types";

const GROUP_PATH_INDEX = 2;
const ACTION_PREFIXES = ["get", "set", "check", "copy"] as const;
const WRITE_METHODS = new Set(["post", "put", "patch"]);
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

export function camelToSnake(name: string): string {
  const s1 = name.replace(/(.)([A-Z][a-z]+)/g, "$1_$2");
  return s1.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function segmentToSnake(name: string): string {
  const cleaned = name.replace(/^\{|\}$/g, "");
  if (/[A-Z]/.test(cleaned)) {
    return camelToSnake(cleaned);
  }

  for (const prefix of ACTION_PREFIXES) {
    if (cleaned.startsWith(prefix) && cleaned.length > prefix.length) {
      const rest = cleaned.slice(prefix.length);
      return `${prefix}_${segmentToSnake(rest)}`;
    }
  }

  return cleaned.toLowerCase();
}

function actionSegment(urlPath: string[]): string {
  for (let i = urlPath.length - 1; i >= 0; i--) {
    if (!/^\{.+\}$/.test(urlPath[i])) {
      return urlPath[i];
    }
  }
  return "unknown";
}

export function buildFuncName(method: string, urlPath: string[]): string {
  const action = segmentToSnake(actionSegment(urlPath));
  return `${method}_${action}`;
}

export function buildSuffixUrl(urlPath: string[]): string {
  const joined = urlPath.join("/");
  if (urlPath[0]?.toLowerCase() === "api") {
    return `/${joined}`;
  }
  return `/api/${joined}`;
}

export function groupFromPath(urlPath: string[]): string {
  if (urlPath.length > GROUP_PATH_INDEX) {
    return segmentToSnake(urlPath[GROUP_PATH_INDEX]).replace(/[{}]/g, "");
  }
  return "misc";
}

function pathParamsFromSegments(urlPath: string[]): string[] {
  const params: string[] = [];
  for (const segment of urlPath) {
    const match = /^\{([^}]+)\}$/.exec(segment);
    if (match) {
      params.push(match[1]);
    }
  }
  return params;
}

function collectionNameFromFile(filePath: string, infoName?: string): string {
  if (infoName && infoName.trim()) {
    return infoName.trim();
  }
  return path
    .basename(filePath)
    .replace(/\.postman_collection\.json$/i, "")
    .replace(/\.json$/i, "");
}

function extractQuery(url: unknown): QueryParam[] {
  if (!url || typeof url !== "object") {
    return [];
  }
  const query = (url as { query?: unknown }).query;
  if (!Array.isArray(query)) {
    return [];
  }
  return query
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .filter((item) => typeof item.key === "string" && !item.disabled)
    .map((item) => ({
      key: item.key as string,
      value: typeof item.value === "string" ? item.value : undefined,
      disabled: !!item.disabled,
    }));
}

function extractPath(url: unknown): string[] {
  if (!url || typeof url !== "object") {
    return [];
  }
  const urlPath = (url as { path?: unknown }).path;
  if (!Array.isArray(urlPath)) {
    return [];
  }
  return urlPath.map((segment) => String(segment));
}

function splitOpenApiPath(pathTemplate: string): string[] {
  return pathTemplate.split("/").filter((segment) => segment.length > 0);
}

function isOpenApiDocument(raw: Record<string, unknown>): boolean {
  return typeof raw.openapi === "string" || typeof raw.swagger === "string";
}

function isPostmanCollection(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.item);
}

function openApiParameters(rawParams: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rawParams)) {
    return [];
  }
  return rawParams.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

function parsePostmanCollection(filePath: string, raw: Record<string, unknown>): CollectionInfo {
  const info = (raw.info ?? {}) as { name?: string; _postman_id?: string };
  const collectionName = collectionNameFromFile(filePath, info.name);
  const collectionId = info._postman_id ?? filePath;
  const endpoints: Endpoint[] = [];

  const traverse = (items: unknown[]): void => {
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const node = item as { item?: unknown[]; request?: unknown; name?: string };
      if (Array.isArray(node.item) && !node.request) {
        traverse(node.item);
        continue;
      }
      if (!node.request || typeof node.request !== "object") {
        continue;
      }

      const request = node.request as { method?: string; url?: unknown };
      const method = (request.method ?? "get").toLowerCase();
      const urlPath = extractPath(request.url);
      const group = groupFromPath(urlPath);
      const name = node.name ?? buildFuncName(method, urlPath);
      const id = `${collectionId}::${method}::${urlPath.join("/")}`;

      endpoints.push({
        id,
        name,
        method,
        path: urlPath,
        group,
        query: extractQuery(request.url),
        pathParams: pathParamsFromSegments(urlPath),
        collectionId,
        collectionName,
        sourceFile: filePath,
      });
    }
  };

  if (Array.isArray(raw.item)) {
    traverse(raw.item);
  }

  return {
    id: collectionId,
    name: collectionName,
    sourceFile: filePath,
    endpoints,
  };
}

function parseOpenApiDocument(filePath: string, raw: Record<string, unknown>): CollectionInfo {
  const info = (raw.info ?? {}) as { title?: string; name?: string };
  const collectionName = collectionNameFromFile(filePath, info.title ?? info.name);
  const collectionId = `openapi:${filePath}`;
  const endpoints: Endpoint[] = [];
  const paths = raw.paths;

  if (!paths || typeof paths !== "object") {
    return { id: collectionId, name: collectionName, sourceFile: filePath, endpoints };
  }

  for (const [pathTemplate, pathItemRaw] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItemRaw || typeof pathItemRaw !== "object") {
      continue;
    }
    const pathItem = pathItemRaw as Record<string, unknown>;
    const sharedParams = openApiParameters(pathItem.parameters);
    const urlPath = splitOpenApiPath(pathTemplate);

    for (const [key, operationRaw] of Object.entries(pathItem)) {
      const method = key.toLowerCase();
      if (!HTTP_METHODS.has(method) || !operationRaw || typeof operationRaw !== "object") {
        continue;
      }

      const operation = operationRaw as Record<string, unknown>;
      const allParams = [...sharedParams, ...openApiParameters(operation.parameters)];
      const query: QueryParam[] = [];
      const declaredPathParams: string[] = [];

      for (const param of allParams) {
        const paramName = typeof param.name === "string" ? param.name : undefined;
        if (!paramName) {
          continue;
        }
        if (param.in === "query") {
          query.push({ key: paramName });
        } else if (param.in === "path") {
          declaredPathParams.push(paramName);
        }
      }

      const fromTemplate = pathParamsFromSegments(urlPath);
      const pathParams = [...new Set([...fromTemplate, ...declaredPathParams])];
      const group = groupFromPath(urlPath);
      const summary = typeof operation.summary === "string" ? operation.summary : undefined;
      const operationId = typeof operation.operationId === "string" ? operation.operationId : undefined;
      const name = summary ?? operationId ?? buildFuncName(method, urlPath);
      const id = `${collectionId}::${method}::${pathTemplate}`;

      endpoints.push({
        id,
        name,
        method,
        path: urlPath,
        group,
        query,
        pathParams,
        collectionId,
        collectionName,
        sourceFile: filePath,
      });
    }
  }

  return {
    id: collectionId,
    name: collectionName,
    sourceFile: filePath,
    endpoints,
  };
}

export function parseCollection(filePath: string): CollectionInfo {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;

  if (isOpenApiDocument(raw)) {
    return parseOpenApiDocument(filePath, raw);
  }
  if (isPostmanCollection(raw)) {
    return parsePostmanCollection(filePath, raw);
  }

  return {
    id: filePath,
    name: collectionNameFromFile(filePath),
    sourceFile: filePath,
    endpoints: [],
  };
}

export function listCollections(collectionsDir: string): CollectionInfo[] {
  if (!fs.existsSync(collectionsDir)) {
    return [];
  }

  return fs
    .readdirSync(collectionsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => parseCollection(path.join(collectionsDir, name)));
}

function buildSuffixUrlExpression(ep: Endpoint): string {
  let suffixUrl = buildSuffixUrl(ep.path);
  if (ep.pathParams.length === 0) {
    return `"${suffixUrl}"`;
  }
  for (const param of ep.pathParams) {
    const snake = camelToSnake(param);
    suffixUrl = suffixUrl.replaceAll(`{${param}}`, `{${snake}}`);
  }
  return `f"${suffixUrl}"`;
}

export function generateFunction(ep: Endpoint): string {
  const funcName = buildFuncName(ep.method, ep.path);
  const method = ep.method;
  const hasQuery = ep.query.length > 0;
  const hasBody = WRITE_METHODS.has(method);

  const args = ["client"];
  for (const pathParam of ep.pathParams) {
    args.push(`${camelToSnake(pathParam)}: str`);
  }
  for (const queryParam of ep.query) {
    args.push(`${camelToSnake(queryParam.key)}: str`);
  }
  if (hasBody) {
    args.push("json: dict = None");
  }

  const lines: string[] = [
    `def ${funcName}(${args.join(", ")}) -> dict:`,
    `    """${ep.name}`,
    "    :param client: клиент",
  ];

  for (const pathParam of ep.pathParams) {
    lines.push(`    :param ${camelToSnake(pathParam)}:`);
  }
  for (const queryParam of ep.query) {
    lines.push(`    :param ${camelToSnake(queryParam.key)}:`);
  }
  if (hasBody) {
    lines.push("    :param json: данные для запроса");
  }
  lines.push("    :return: ответ сервера");
  lines.push('    """');
  lines.push("");
  lines.push(`    suffix_url = ${buildSuffixUrlExpression(ep)}`);

  if (hasQuery) {
    lines.push("    params = {");
    for (const queryParam of ep.query) {
      const argName = camelToSnake(queryParam.key);
      lines.push(`        "${queryParam.key}": ${argName},`);
    }
    lines.push("    }");
  }

  if (method === "get") {
    lines.push(
      hasQuery
        ? "    response = client.get(url=suffix_url, params=params)"
        : "    response = client.get(url=suffix_url)"
    );
  } else if (method === "delete") {
    lines.push(
      hasQuery
        ? "    response = client.delete(url=suffix_url, params=params, json_response=False)"
        : "    response = client.delete(url=suffix_url, json_response=False)"
    );
  } else if (hasBody) {
    lines.push(
      hasQuery
        ? `    response = client.${method}(url=suffix_url, json=json, params=params)`
        : `    response = client.${method}(url=suffix_url, json=json)`
    );
  } else {
    lines.push(
      hasQuery
        ? `    response = client.${method}(url=suffix_url, params=params)`
        : `    response = client.${method}(url=suffix_url)`
    );
  }

  lines.push("    return response");
  return lines.join("\n");
}

export interface GenerateResult {
  writtenFiles: string[];
  endpointCount: number;
}

/**
 * Сохраняет выбранные методы в структуру:
 *   {outputDir}/{collectionName}/{group}_api.py
 */
export function generateSelected(endpoints: Endpoint[], outputDir: string): GenerateResult {
  const byCollection = new Map<string, Map<string, Endpoint[]>>();

  for (const ep of endpoints) {
    let byGroup = byCollection.get(ep.collectionName);
    if (!byGroup) {
      byGroup = new Map();
      byCollection.set(ep.collectionName, byGroup);
    }
    const list = byGroup.get(ep.group) ?? [];
    list.push(ep);
    byGroup.set(ep.group, list);
  }

  const writtenFiles: string[] = [];
  let endpointCount = 0;

  for (const [collectionName, byGroup] of byCollection) {
    const collectionDir = path.join(outputDir, collectionName);
    fs.mkdirSync(collectionDir, { recursive: true });

    for (const [group, groupEndpoints] of [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const filePath = path.join(collectionDir, `${group}_api.py`);
      const code = groupEndpoints.map(generateFunction).join("\n\n\n") + "\n";
      fs.writeFileSync(filePath, code, "utf-8");
      writtenFiles.push(filePath);
      endpointCount += groupEndpoints.length;
    }
  }

  return { writtenFiles, endpointCount };
}
