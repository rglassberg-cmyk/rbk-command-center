'use client';

interface Doc {
  id: string;
  title: string;
  url: string;
}

interface ImportantDocsPopupProps {
  importantDocs: Doc[];
  loadingDocs: boolean;
  editingImportantDocs: boolean;
  setEditingImportantDocs: (editing: boolean) => void;
  editingDocId: string | null;
  setEditingDocId: (id: string | null) => void;
  editingDocTitle: string;
  setEditingDocTitle: (title: string) => void;
  newDocTitle: string;
  setNewDocTitle: (title: string) => void;
  newDocUrl: string;
  setNewDocUrl: (url: string) => void;
  onAddDoc: (title: string, url: string) => Promise<void>;
  onDeleteDoc: (id: string) => Promise<void>;
  onUpdateDoc: (id: string, title: string) => Promise<void>;
  onClose: () => void;
}

export function ImportantDocsPopup({
  importantDocs, loadingDocs,
  editingImportantDocs, setEditingImportantDocs,
  editingDocId, setEditingDocId,
  editingDocTitle, setEditingDocTitle,
  newDocTitle, setNewDocTitle,
  newDocUrl, setNewDocUrl,
  onAddDoc, onDeleteDoc, onUpdateDoc,
  onClose,
}: ImportantDocsPopupProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-md mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Important Docs</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditingImportantDocs(!editingImportantDocs)}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              {editingImportantDocs ? 'Done' : 'Edit'}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&#10005;</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 space-y-2">
          {loadingDocs ? (
            <p className="text-slate-400 text-center py-4">Loading...</p>
          ) : importantDocs.length === 0 ? (
            <p className="text-slate-400 text-center py-4">No documents added yet</p>
          ) : (
            importantDocs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2">
                {editingDocId === doc.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={editingDocTitle}
                      onChange={(e) => setEditingDocTitle(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      autoFocus
                    />
                    <button onClick={() => onUpdateDoc(doc.id, editingDocTitle)} className="text-green-500 hover:text-green-700 p-1">
                      &#10003;
                    </button>
                    <button onClick={() => { setEditingDocId(null); setEditingDocTitle(''); }} className="text-slate-400 hover:text-slate-600 p-1">
                      &#10005;
                    </button>
                  </div>
                ) : (
                  <>
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-slate-50 hover:bg-slate-100 rounded-lg px-4 py-3 text-slate-700 font-medium transition-colors"
                    >
                      {doc.title}
                    </a>
                    {editingImportantDocs && (
                      <>
                        <button
                          onClick={() => { setEditingDocId(doc.id); setEditingDocTitle(doc.title); }}
                          className="text-slate-400 hover:text-slate-600 p-2 text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onDeleteDoc(doc.id)}
                          className="text-red-400 hover:text-red-600 p-2 text-sm"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
        {editingImportantDocs && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-sm font-medium text-slate-700 mb-2">Add New Document</p>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Title"
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <input
                type="url"
                placeholder="URL"
                value={newDocUrl}
                onChange={(e) => setNewDocUrl(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                onClick={async () => {
                  if (newDocTitle && newDocUrl) {
                    await onAddDoc(newDocTitle, newDocUrl);
                    setNewDocTitle('');
                    setNewDocUrl('');
                  }
                }}
                disabled={!newDocTitle || !newDocUrl}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Add Document
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportantDocsPopup;
