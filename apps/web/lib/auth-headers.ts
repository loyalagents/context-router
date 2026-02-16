export function getAuthHeaders(): Record<string, string> {
  const apiKey = localStorage.getItem("workshopApiKey");
  const userId = localStorage.getItem("workshopUserId");
  return {
    authorization: apiKey ? `Bearer ${apiKey}` : "",
    "x-user-id": userId || "",
  };
}
