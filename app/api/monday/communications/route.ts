import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = 4035548140;

interface MondayItem {
  id: string;
  name: string;
  url: string;
  column_values: Array<{ id: string; text: string; value: string | null }>;
}

interface CommunicationsItem {
  id: string;
  name: string;
  url: string;
  status: string;
  commType: string;
  notes: string;
  draftLink: string;
  file: string;
  requester: string;
  audience: string;
  dueDate: string;
}

async function mondayQuery(query: string, variables?: Record<string, unknown>) {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) throw new Error('MONDAY_API_KEY not configured');

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Monday API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (data.errors?.length) {
    throw new Error(`Monday GraphQL error: ${JSON.stringify(data.errors)}`);
  }
  return data;
}

function parseItem(item: MondayItem): CommunicationsItem {
  const cols = Object.fromEntries(item.column_values.map(c => [c.id, c]));

  let fileUrl = '';
  try {
    const fileVal = cols.file?.value;
    if (fileVal) {
      const parsed = JSON.parse(fileVal);
      fileUrl = parsed?.files?.[0]?.url || '';
    }
  } catch { /* ignore */ }

  let draftLink = '';
  try {
    const linkVal = cols.link_mkt2dyf7?.value;
    if (linkVal) {
      const parsed = JSON.parse(linkVal);
      draftLink = parsed?.url || cols.link_mkt2dyf7?.text || '';
    } else {
      draftLink = cols.link_mkt2dyf7?.text || '';
    }
  } catch {
    draftLink = cols.link_mkt2dyf7?.text || '';
  }

  return {
    id: item.id,
    name: item.name,
    url: item.url,
    status: cols.status_126?.text || '',
    commType: cols.dropdown_mkt3j6xf?.text || '',
    notes: cols.long_text_mkx4p0sh?.text || '',
    draftLink,
    file: fileUrl,
    requester: cols.people5?.text || '',
    audience: cols.text?.text || '',
    dueDate: cols.date4?.text || '',
  };
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Use query_params to filter server-side by status column
    const firstPageQuery = `
      query {
        boards(ids: [${BOARD_ID}]) {
          items_page(limit: 100, query_params: { rules: [{ column_id: "status_126", compare_value: [8] }] }) {
            cursor
            items {
              id
              name
              url
              column_values(ids: ["status_126", "dropdown_mkt3j6xf", "long_text_mkx4p0sh", "file", "link_mkt2dyf7", "people5", "text", "date4"]) {
                id
                text
                value
              }
            }
          }
        }
      }
    `;

    const firstData = await mondayQuery(firstPageQuery);
    const firstPage = firstData.data?.boards?.[0]?.items_page;
    let allItems: MondayItem[] = firstPage?.items || [];
    let cursor: string | null = firstPage?.cursor || null;

    // Paginate if there are more results
    while (cursor) {
      const nextPageQuery = `
        query {
          next_items_page(limit: 100, cursor: "${cursor}") {
            cursor
            items {
              id
              name
              url
              column_values(ids: ["status_126", "dropdown_mkt3j6xf", "long_text_mkx4p0sh", "file", "link_mkt2dyf7", "people5", "text", "date4"]) {
                id
                text
                value
              }
            }
          }
        }
      `;
      const nextData = await mondayQuery(nextPageQuery);
      const nextPage = nextData.data?.next_items_page;
      allItems = allItems.concat(nextPage?.items || []);
      cursor = nextPage?.cursor || null;
    }

    const pending = allItems.map(parseItem);

    return NextResponse.json({ items: pending });
  } catch (err) {
    console.error('Monday communications GET error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { itemId, action, note } = await request.json();
    if (!itemId || !action) {
      return NextResponse.json({ error: 'itemId and action required' }, { status: 400 });
    }

    if (action === 'approve') {
      const mutation = `
        mutation {
          change_column_value(board_id: ${BOARD_ID}, item_id: ${itemId}, column_id: "status_126", value: "{\\"label\\":\\"Approved\\"}") { id }
        }
      `;
      await mondayQuery(mutation);
      return NextResponse.json({ success: true });
    }

    if (action === 'request_changes') {
      const statusMutation = `
        mutation {
          change_column_value(board_id: ${BOARD_ID}, item_id: ${itemId}, column_id: "status_126", value: "{\\"label\\":\\"To discuss\\"}") { id }
        }
      `;
      await mondayQuery(statusMutation);

      if (note) {
        const safeNote = note.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        const updateMutation = `
          mutation {
            create_update(item_id: ${itemId}, body: "RBK feedback: ${safeNote}") { id }
          }
        `;
        await mondayQuery(updateMutation);
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Monday communications PATCH error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
