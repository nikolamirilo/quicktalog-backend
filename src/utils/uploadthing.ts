const UPLOADTHING_API_URL = "https://api.uploadthing.com";

// Matches both legacy and subdomain UploadThing URLs:
//   https://utfs.io/f/<KEY>
//   https://<appId>.ufs.sh/f/<KEY>
const UPLOADTHING_URL_REGEX =
  /https?:\/\/(?:utfs\.io|[a-zA-Z0-9-]+\.ufs\.sh)\/f\/([a-zA-Z0-9]+)/g;

export type UploadthingFile = {
  key: string;
  id: string;
  customId: string | null;
  name: string;
  status: string;
  size: number;
  uploadedAt: number;
};

export function extractUploadthingKeysFromValue(value: unknown): string[] {
  if (value == null) return [];
  const str = typeof value === "string" ? value : JSON.stringify(value);
  const keys: string[] = [];
  for (const match of str.matchAll(UPLOADTHING_URL_REGEX)) {
    keys.push(match[1]);
  }
  return keys;
}

// UPLOADTHING_TOKEN in the v7 SDK is a base64-encoded JSON containing
// `{ apiKey, appId, regions }`. The management API still expects the raw
// `sk_live_*` api key in the `X-Uploadthing-Api-Key` header.
function resolveApiKey(token: string): string {
  if (token.startsWith("sk_")) return token;
  try {
    const decoded = JSON.parse(atob(token));
    if (decoded?.apiKey) return decoded.apiKey as string;
  } catch {
    // not a base64 JSON token; fall through
  }
  return token;
}

export async function listUploadthingFiles(
  token: string,
  pageSize = 500,
): Promise<UploadthingFile[]> {
  const apiKey = resolveApiKey(token);
  const all: UploadthingFile[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${UPLOADTHING_API_URL}/v6/listFiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Uploadthing-Api-Key": apiKey,
      },
      body: JSON.stringify({ limit: pageSize, offset }),
    });
    if (!res.ok) {
      throw new Error(
        `UploadThing listFiles failed: ${res.status} ${await res.text()}`,
      );
    }
    const data = (await res.json()) as {
      files: UploadthingFile[];
      hasMore?: boolean;
    };
    all.push(...data.files);
    if (data.files.length < pageSize || data.hasMore === false) break;
    offset += data.files.length;
  }
  return all;
}

export async function deleteUploadthingFiles(
  token: string,
  fileKeys: string[],
): Promise<void> {
  if (fileKeys.length === 0) return;
  const apiKey = resolveApiKey(token);
  // UploadThing accepts up to 1000 keys per request; chunk to be safe.
  const chunkSize = 500;
  for (let i = 0; i < fileKeys.length; i += chunkSize) {
    const chunk = fileKeys.slice(i, i + chunkSize);
    const res = await fetch(`${UPLOADTHING_API_URL}/v6/deleteFiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Uploadthing-Api-Key": apiKey,
      },
      body: JSON.stringify({ fileKeys: chunk }),
    });
    if (!res.ok) {
      throw new Error(
        `UploadThing deleteFiles failed: ${res.status} ${await res.text()}`,
      );
    }
  }
}
