// Monday.com write-back actions invoked by Buzz's conversational handler.
//
// `markMondayItemDone` is the Phase 2.5 write-back: Buzz asks Claude to
// emit a <monday_action> marker when the user says "mark X as done"; the
// conversational handler parses the marker and calls this helper.
//
// Design notes:
// - Never throws. Always returns { success, error? } so the calling
//   handler can append a friendly confirmation/failure line to the
//   Slack reply without try/catching here.
// - First attempt uses the canonical "Done" label. If Monday rejects
//   that with a label-not-found-style error, retry once with
//   "Completed" — different boards use different label text and the
//   GraphQL mutation requires an exact match.
// - Auth header matches the existing Monday read path
//   (`Authorization: <apiKey>`, no Bearer prefix). The Monday v2 API
//   accepts both forms; keeping the conventions identical avoids
//   accidental divergence.
//
// GraphQL mutation shape:
//   change_column_value(board_id: <int>, item_id: <int>,
//     column_id: "<string>", value: "<json string>") { id }
// The `value` argument is a JSON string (escaped) like {"label":"Done"}.

const MONDAY_API_URL = 'https://api.monday.com/v2';

interface MondayMutationResponse {
  data?: { change_column_value?: { id?: string } | null };
  errors?: Array<{ message?: string }> | unknown;
  error_message?: string;
}

async function mutateLabel(
  boardId: string,
  itemId: string,
  statusColumnId: string,
  apiKey: string,
  label: string,
): Promise<{ ok: boolean; body: MondayMutationResponse }> {
  const valueArg = JSON.stringify(JSON.stringify({ label }));
  // Item ids on Monday are numeric but transit as strings; coerce
  // explicitly so the GraphQL `Int` arg is unambiguous.
  const query = `mutation {
    change_column_value(
      board_id: ${parseInt(boardId, 10)},
      item_id: ${parseInt(itemId, 10)},
      column_id: "${statusColumnId}",
      value: ${valueArg}
    ) { id }
  }`;
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({} as MondayMutationResponse));
  return { ok: res.ok, body };
}

function errorString(body: MondayMutationResponse): string {
  if (body.errors) return JSON.stringify(body.errors).slice(0, 300);
  if (body.error_message) return body.error_message.slice(0, 300);
  return JSON.stringify(body).slice(0, 300);
}

export async function markMondayItemDone(
  boardId: string,
  itemId: string,
  statusColumnId: string,
  apiKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!boardId || !itemId || !statusColumnId) {
      return { success: false, error: 'missing boardId/itemId/statusColumnId' };
    }
    if (!apiKey) {
      return { success: false, error: 'missing MONDAY_API_KEY' };
    }

    const first = await mutateLabel(boardId, itemId, statusColumnId, apiKey, 'Done');
    const firstErrors = JSON.stringify(first.body.errors ?? '').toLowerCase();
    const firstOk = first.ok && !first.body.errors && first.body.data?.change_column_value?.id;
    if (firstOk) return { success: true };

    // Retry path — labels vary board-to-board (some boards use
    // "Completed" instead of "Done"). Monday returns a 200 with an
    // errors array referencing the label, so we sniff for "label".
    if (firstErrors.includes('label') || firstErrors.includes('value')) {
      const second = await mutateLabel(boardId, itemId, statusColumnId, apiKey, 'Completed');
      const secondOk = second.ok && !second.body.errors && second.body.data?.change_column_value?.id;
      if (secondOk) return { success: true };
      return { success: false, error: errorString(second.body) };
    }

    return { success: false, error: errorString(first.body) };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
