"use client";

import { supabase } from "@/lib/supabase";
import { isFileLikeResponseType, labelForResponseType } from "@/lib/question-response";
import { useCallback, useEffect, useMemo, useState } from "react";

type Gender = "MALE" | "FEMALE";

type ResponseMode = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "FILE";

type QuestionRow = {
  id: string;
  question: string;
  gender: Gender;
  sort_order: number;
  response_type?: ResponseMode | string | null;
  min_file_count?: number | null;
  created_at?: string;
};

type FormState = {
  question: string;
  gender: Gender;
  sort_order: number;
  response_type: ResponseMode;
  /** For file-like types: minimum separate uploads (SMS may take several messages). */
  min_file_count: number;
};

const initialForm: FormState = {
  question: "",
  gender: "MALE",
  sort_order: 1,
  response_type: "TEXT",
  min_file_count: 5,
};

export default function QuestionsManager() {
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setError("You are not authenticated. Please sign in again.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/admin/questions", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      data?: QuestionRow[];
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Failed to load questions.");
      setRows([]);
      setLoading(false);
      return;
    }

    const list = payload.data ?? [];
    setRows(list);
    setLoading(false);

    if (!editingId) {
      const nextSort = list.length > 0 ? Math.max(...list.map((r) => r.sort_order || 0)) + 1 : 1;
      setForm((prev) => ({ ...prev, sort_order: nextSort, response_type: "TEXT", min_file_count: 5 }));
    }
  }, [editingId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  async function authHeaders() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not authenticated.");
    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!form.question.trim()) {
      setError("Question is required.");
      return;
    }
    if (!Number.isInteger(form.sort_order) || form.sort_order < 1) {
      setError("Sort order must be a positive integer.");
      return;
    }

    setSaving(true);
    try {
      const headers = await authHeaders();
      const url = editingId ? `/api/admin/questions/${editingId}` : "/api/admin/questions";
      const method = editingId ? "PATCH" : "POST";

      const payloadBody: Record<string, unknown> = {
        question: form.question.trim(),
        gender: form.gender,
        sort_order: form.sort_order,
        response_type: form.response_type,
      };
      if (isFileLikeResponseType(form.response_type)) {
        payloadBody.min_file_count = form.min_file_count;
      } else {
        payloadBody.min_file_count = null;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payloadBody),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Failed to save question.");
        setSaving(false);
        return;
      }

      setEditingId(null);
      setForm(initialForm);
      await fetchRows();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save question.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: QuestionRow) {
    setEditingId(row.id);
    const rt: ResponseMode = (() => {
      const r = String(row.response_type ?? "TEXT").toUpperCase();
      if (r === "PHOTOS_4") return "IMAGE";
      if (r === "IMAGE" || r === "AUDIO" || r === "VIDEO" || r === "FILE") return r as ResponseMode;
      return "TEXT";
    })();
    const mc = (() => {
      if (!isFileLikeResponseType(String(row.response_type ?? ""))) return 5;
      if (typeof row.min_file_count === "number" && row.min_file_count >= 1) {
        return Math.min(20, row.min_file_count);
      }
      return 1;
    })();
    setForm({
      question: row.question,
      gender: row.gender,
      sort_order: row.sort_order,
      response_type: rt,
      min_file_count: mc,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    const nextSort = rows.length > 0 ? Math.max(...rows.map((r) => r.sort_order || 0)) + 1 : 1;
    setForm({ ...initialForm, sort_order: nextSort, response_type: "TEXT", min_file_count: 5 });
    setError(null);
  }

  async function removeQuestion(id: string) {
    if (!confirm("Delete this question?")) return;
    setError(null);

    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/admin/questions/${id}`, {
        method: "DELETE",
        headers,
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Failed to delete question.");
        return;
      }
      if (editingId === id) cancelEdit();
      await fetchRows();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete question.";
      setError(message);
    }
  }

  async function persistReorder(updatedRows: QuestionRow[]) {
    const headers = await authHeaders();
    const response = await fetch("/api/admin/questions/reorder", {
      method: "POST",
      headers,
      body: JSON.stringify({
        updates: updatedRows.map((row) => ({
          id: row.id,
          sort_order: row.sort_order,
        })),
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to persist question order.");
    }
  }

  async function handleDropWithinGender(targetRow: QuestionRow) {
    if (!draggingId || draggingId === targetRow.id) return;

    const dragged = rows.find((r) => r.id === draggingId);
    if (!dragged || dragged.gender !== targetRow.gender) {
      setDraggingId(null);
      setDropTargetId(null);
      return;
    }

    const groupRows = rows
      .filter((r) => r.gender === targetRow.gender)
      .sort((a, b) => a.sort_order - b.sort_order);

    const fromIndex = groupRows.findIndex((r) => r.id === draggingId);
    const toIndex = groupRows.findIndex((r) => r.id === targetRow.id);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingId(null);
      setDropTargetId(null);
      return;
    }

    const reordered = [...groupRows];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const reorderedWithSort = reordered.map((row, idx) => ({
      ...row,
      sort_order: idx + 1,
    }));

    const untouched = rows.filter((r) => r.gender !== targetRow.gender);
    const optimistic = [...untouched, ...reorderedWithSort];
    setRows(optimistic);
    setDraggingId(null);
    setDropTargetId(null);

    try {
      await persistReorder(reorderedWithSort);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to persist question order.";
      setError(message);
      await fetchRows();
    }
  }

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) =>
        a.sort_order === b.sort_order
          ? a.question.localeCompare(b.question)
          : a.sort_order - b.sort_order
      ),
    [rows]
  );

  const maleRows = useMemo(
    () => sortedRows.filter((row) => row.gender === "MALE"),
    [sortedRows]
  );
  const femaleRows = useMemo(
    () => sortedRows.filter((row) => row.gender === "FEMALE"),
    [sortedRows]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.02]">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          {editingId ? "Edit Question" : "Create Question"}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage onboarding by track and order. Use sort <span className="font-semibold">1</span> for the intro
          (text) on each track. Before a track is known, the app shows one of the sort-1 questions (MALE or
          FEMALE) at random per profile. For <span className="font-medium">image, audio, video, or file</span>{" "}
          questions, the participant form shows file pickers, optional extra slots, and uploads to Cloudinary.
        </p>

        <form className="mt-5 grid gap-4 md:grid-cols-12" onSubmit={handleSubmit}>
          <div className="md:col-span-7">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Question
            </label>
            <input
              value={form.question}
              onChange={(e) => setForm((p) => ({ ...p, question: e.target.value }))}
              placeholder="Enter question text"
              className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Gender
            </label>
            <select
              value={form.gender}
              onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value as Gender }))}
              className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            >
              <option value="MALE">MALE</option>
              <option value="FEMALE">FEMALE</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Answer type
            </label>
            <select
              value={form.response_type}
              onChange={(e) => {
                const v = e.target.value as ResponseMode;
                setForm((p) => ({
                  ...p,
                  response_type: v,
                  min_file_count:
                    isFileLikeResponseType(v) && !isFileLikeResponseType(p.response_type) ? 5 : p.min_file_count,
                }));
              }}
              className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            >
              <option value="TEXT">Text</option>
              <option value="IMAGE">Image (file(s))</option>
              <option value="AUDIO">Audio</option>
              <option value="VIDEO">Video</option>
              <option value="FILE">File(s) — any type</option>
            </select>
          </div>

          <div className="md:col-span-1">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Sort order
            </label>
            <input
              type="number"
              min={1}
              value={form.sort_order}
              onChange={(e) =>
                setForm((p) => ({ ...p, sort_order: Number(e.target.value || 1) }))
              }
              className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            />
          </div>

          {isFileLikeResponseType(form.response_type) && (
            <div className="md:col-span-12 lg:col-span-3">
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Min uploads (SMS)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={form.min_file_count}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    min_file_count: Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  }))
                }
                className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Participant must send this many separate files (multiple MMS ok). Default legacy questions
                without a value behave as 1 until you set this.
              </p>
            </div>
          )}

          <div className="md:col-span-12 flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
            >
              {saving ? "Saving..." : editingId ? "Update Question" : "Create Question"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {error && <p className="mt-3 text-sm text-error-500">{error}</p>}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Questions List
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {rows.length} question{rows.length === 1 ? "" : "s"}
          </p>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-sm text-gray-500 dark:text-gray-400">Loading questions...</div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-gray-500 dark:text-gray-400">No questions yet.</div>
        ) : (
          <div className="space-y-6 p-5">
            {[
              { label: "MALE", rows: maleRows },
              { label: "FEMALE", rows: femaleRows },
            ].map((group) => (
              <div
                key={group.label}
                className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
              >
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold tracking-wide text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                    {group.label}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {group.rows.length} question{group.rows.length === 1 ? "" : "s"}
                  </span>
                </div>

                {group.rows.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                    No {group.label.toLowerCase()} questions yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-800">
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Order
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Type
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Min files
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Question
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr
                            key={row.id}
                            draggable
                            onDragStart={() => {
                              setDraggingId(row.id);
                              setDropTargetId(null);
                            }}
                            onDragOver={(e) => {
                              if (draggingId && draggingId !== row.id) {
                                e.preventDefault();
                                setDropTargetId(row.id);
                              }
                            }}
                            onDragLeave={() => {
                              if (dropTargetId === row.id) setDropTargetId(null);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              void handleDropWithinGender(row);
                            }}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setDropTargetId(null);
                            }}
                            className={`border-b border-gray-100 last:border-b-0 dark:border-gray-800 ${
                              draggingId === row.id ? "opacity-60" : ""
                            } ${
                              dropTargetId === row.id
                                ? "bg-brand-50/50 dark:bg-brand-500/10"
                                : ""
                            }`}
                          >
                            <td className="px-4 py-4 text-sm text-gray-700 dark:text-gray-200">
                              <span className="inline-flex items-center gap-2">
                                <span className="cursor-grab text-gray-400" title="Drag to reorder">
                                  ⋮⋮
                                </span>
                                {row.sort_order}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-xs text-gray-600 dark:text-gray-300">
                              {labelForResponseType(String(row.response_type ?? "TEXT"))}
                            </td>
                            <td className="px-4 py-4 text-xs text-gray-600 dark:text-gray-300">
                              {isFileLikeResponseType(String(row.response_type ?? ""))
                                ? typeof row.min_file_count === "number" && row.min_file_count >= 1
                                  ? row.min_file_count
                                  : "1"
                                : "—"}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-700 dark:text-gray-200">
                              {row.question}
                            </td>
                            <td className="px-4 py-4 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEdit(row)}
                                  className="inline-flex h-8 items-center justify-center rounded-md bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeQuestion(row.id)}
                                  className="inline-flex h-8 items-center justify-center rounded-md bg-error-50 px-3 text-xs font-medium text-error-700 transition hover:bg-error-100 dark:bg-error-500/20 dark:text-error-300"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
