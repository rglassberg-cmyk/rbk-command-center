'use client';

import { useState, useEffect, useCallback } from 'react';

interface Doc {
  id: string;
  title: string;
  url: string;
}

export function useImportantDocs() {
  const [importantDocs, setImportantDocs] = useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [editingImportantDocs, setEditingImportantDocs] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocTitle, setEditingDocTitle] = useState('');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocUrl, setNewDocUrl] = useState('');

  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch('/api/important-docs');
        if (res.ok) {
          const data = await res.json();
          setImportantDocs(data.docs || []);
        }
      } catch (e) {
        console.error('Failed to load important docs:', e);
      }
      setLoadingDocs(false);
    };
    fetchDocs();
  }, []);

  const addImportantDoc = useCallback(async (title: string, url: string) => {
    try {
      const res = await fetch('/api/important-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url }),
      });
      if (res.ok) {
        const data = await res.json();
        setImportantDocs(prev => [...prev, data.doc]);
      }
    } catch (e) {
      console.error('Failed to add doc:', e);
    }
  }, []);

  const deleteImportantDoc = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/important-docs?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setImportantDocs(prev => prev.filter(d => d.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete doc:', e);
    }
  }, []);

  const updateImportantDoc = useCallback(async (id: string, title: string) => {
    try {
      const res = await fetch('/api/important-docs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title }),
      });
      if (res.ok) {
        setImportantDocs(prev => prev.map(d => d.id === id ? { ...d, title } : d));
        setEditingDocId(null);
        setEditingDocTitle('');
      }
    } catch (e) {
      console.error('Failed to update doc:', e);
    }
  }, []);

  return {
    importantDocs,
    loadingDocs,
    editingImportantDocs, setEditingImportantDocs,
    editingDocId, setEditingDocId,
    editingDocTitle, setEditingDocTitle,
    newDocTitle, setNewDocTitle,
    newDocUrl, setNewDocUrl,
    addImportantDoc,
    deleteImportantDoc,
    updateImportantDoc,
  };
}
