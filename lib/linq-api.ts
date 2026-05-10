const LINQ_API_BASE = "https://api.linqapp.com/api/partner";

export type LinqMessagePart =
  | { type: "text"; value: string }
  | { type: "media"; url: string }
  | { type: "link"; value: string };

type CreateChatResponse = {
  chat: {
    id: string;
    is_group: boolean;
    message: { id: string };
  };
};

type SendMessageResponse = {
  message: { id: string };
};

function linqHeaders() {
  const token = process.env.LINQ_API_TOKEN?.trim();
  if (!token) throw new Error("Missing LINQ_API_TOKEN");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function linqRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${LINQ_API_BASE}${path}`, {
    method: "POST",
    headers: linqHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as T & { error?: { message?: string }; message?: string };
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } }).error?.message ??
      (json as { message?: string }).message ??
      `Linq API error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/**
 * Creates a new 1:1 or group chat and sends the first message.
 * Pass multiple phones in `to` for a group chat.
 * First message cannot contain a URL (Linq deliverability rule).
 * Pass `from` to use a specific Linq number; defaults to LINQ_FROM_NUMBER.
 */
export async function createLinqChat(
  to: string[],
  parts: LinqMessagePart[],
  name?: string,
  from?: string,
): Promise<{ chatId: string; messageId: string }> {
  const resolvedFrom = from ?? process.env.LINQ_FROM_NUMBER?.trim();
  if (!resolvedFrom) throw new Error("Missing LINQ_FROM_NUMBER");

  const body: Record<string, unknown> = { from: resolvedFrom, to, message: { parts } };
  if (name) body.display_name = name;

  const data = await linqRequest<CreateChatResponse>("/v3/chats", body);

  return {
    chatId: data.chat.id,
    messageId: data.chat.message.id,
  };
}

/**
 * Sends a follow-up message into an existing chat.
 */
export async function sendLinqChatMessage(
  chatId: string,
  parts: LinqMessagePart[],
): Promise<{ messageId: string }> {
  const data = await linqRequest<SendMessageResponse>(`/v3/chats/${chatId}/messages`, {
    message: { parts },
  });

  return { messageId: data.message.id };
}
