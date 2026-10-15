export const localClientId = (key: string | null | undefined): string | null =>
  typeof key === "string"
    ? (/^local:([A-Za-z0-9_-]{22})$/.exec(key)?.[1] ?? null)
    : null;

export const activityClientKey = (fragment: string): string => {
  const match = /^#mcp-client=([A-Za-z0-9_-]{22})$/.exec(fragment);
  return match ? `local:${match[1]}` : "";
};

export const usableClientName = (name: unknown): name is string =>
  typeof name === "string" &&
  name.length <= 64 &&
  !!name.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(name);
