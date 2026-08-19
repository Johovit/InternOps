import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import api from '../../lib/axios';
import { Btn, Card, Spinner } from '../ui';
import { createPortal } from 'react-dom';

const SUMMARY_LABELS = {
  attendanceSheets: 'Attendance sheets',
  ignoredSheets: 'Ignored sheets',
  skippedSheets: 'Skipped sheets',
  uniqueInterns: 'Unique interns',
  attendanceRecords: 'Attendance records',
  reviewRequired: 'Review required',
  warnings: 'Warnings',
};

const STATUS_STYLES = {
  ACTIVE:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  COMPLETED:
    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  TERMINATED:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300',
  DISCONTINUED:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value) {
  if (!value) return 'Blank';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function StatusBadge({ value }) {
  const status = value || 'UNKNOWN';
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
        STATUS_STYLES[status] ||
        'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      {status}
    </span>
  );
}

function AttendanceBadge({ value }) {
  const isLeave = value === 'LEAVE';
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-extrabold ${
        isLeave
          ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
          : 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      }`}
    >
      {value}
    </span>
  );
}

export default function WorkbookImportModal({ open, onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleRows, setVisibleRows] = useState(20);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const unresolvedCount = useMemo(() => {
    if (!preview) return 0;
    return preview.conflicts.filter((conflict) => !resolutions[conflict.id])
      .length;
  }, [preview, resolutions]);

  const filteredInterns = useMemo(() => {
    if (!preview) return [];
    const query = search.trim().toLowerCase();
    if (!query) return preview.interns;
    return preview.interns.filter((intern) =>
      [intern.name, intern.code, intern.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [preview, search]);

  if (!open) return null;

  const clearFile = () => {
    setFile(null);
    setPreview(null);
    setResolutions({});
    setSearch('');
    setVisibleRows(20);
    setError('');
  };

  const runPreview = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    setPreview(null);
    setResolutions({});
    setSearch('');
    setVisibleRows(20);
    try {
      const form = new FormData();
      form.append('workbook', file);
      const response = await api.post('/workbook-imports/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
        _suppressGlobalError: true,
      });
      setPreview(response.data);
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          requestError.message ||
          'Preview failed'
      );
    } finally {
      setLoading(false);
    }
  };

  const chooseResolution = (conflictId, value) => {
    setResolutions((current) => ({ ...current, [conflictId]: value }));
  };
  const modal = (
    <div className="fixed inset-0 z-[9999] bg-black/20 dark:bg-black/40">
      <div className="flex h-full w-full items-center justify-center overflow-y-auto p-4">
        <section
          aria-modal="true"
          role="dialog"
          aria-labelledby="workbook-import-title"
          className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/25"
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-7 sm:py-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h2
                  id="workbook-import-title"
                  className="truncate text-xl font-extrabold text-slate-950 dark:text-white"
                >
                  Preview Intern Workbook
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Review only. This screen cannot change Neon database records.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close workbook preview"
              className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7">
            <div className="space-y-5">
              <Card className="p-4 sm:p-5">
                {!file ? (
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center transition hover:border-emerald-500 hover:bg-emerald-50/50 dark:border-slate-700 dark:bg-slate-950/40 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/20">
                    <Upload className="mb-3 h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-extrabold text-slate-900 dark:text-white">
                      Choose an Excel workbook
                    </span>
                    <span className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      .xlsx only, maximum 10 MB
                    </span>
                    <input
                      type="file"
                      accept=".xlsx"
                      className="sr-only"
                      onChange={(event) => {
                        setFile(event.target.files?.[0] || null);
                        setPreview(null);
                        setResolutions({});
                        setError('');
                      }}
                    />
                  </label>
                ) : (
                  <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileSpreadsheet className="h-8 w-8 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-slate-950 dark:text-white">
                          {file.name}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          {formatBytes(file.size)} · XLSX workbook
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
                        <RefreshCw className="h-4 w-4" />
                        Replace
                        <input
                          type="file"
                          accept=".xlsx"
                          className="sr-only"
                          onChange={(event) => {
                            setFile(event.target.files?.[0] || null);
                            setPreview(null);
                            setResolutions({});
                            setError('');
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={clearFile}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={runPreview}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:text-white dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                      >
                        <Upload className="h-4 w-4" />
                        {loading
                          ? 'Parsing...'
                          : preview
                            ? 'Preview again'
                            : 'Preview workbook'}
                      </button>
                    </div>
                  </div>
                )}
              </Card>

              {loading && <Spinner label="Parsing workbook safely..." />}
              {error && (
                <div className="flex gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  {error}
                </div>
              )}

              {preview && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {Object.entries(preview.summary).map(([key, value]) => (
                      <Card key={key} className="p-4">
                        <div className="text-2xl font-extrabold text-slate-950 dark:text-white">
                          {value.toLocaleString()}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {SUMMARY_LABELS[key] || key}
                        </div>
                      </Card>
                    ))}
                  </div>

                  <Card className="overflow-hidden">
                    <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                      <h3 className="font-extrabold text-slate-950 dark:text-white">
                        Workbook sheets
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-[760px] w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                          <tr>
                            <th className="px-5 py-3">Sheet</th>
                            <th className="px-5 py-3 text-right">Rows</th>
                            <th className="px-5 py-3 text-right">
                              Date columns
                            </th>
                            <th className="px-5 py-3">Handling</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.sheets.map((sheet) => (
                            <tr
                              key={sheet.sheet}
                              className="border-t border-slate-200 dark:border-slate-700"
                            >
                              <td className="whitespace-nowrap px-5 py-3 font-semibold text-slate-900 dark:text-white">
                                {sheet.sheet}
                              </td>
                              <td className="px-5 py-3 text-right tabular-nums">
                                {sheet.internRows}
                              </td>
                              <td className="px-5 py-3 text-right tabular-nums">
                                {sheet.dateColumns || 0}
                              </td>
                              <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                                {sheet.ignored
                                  ? `Ignored: ${sheet.ignoreReason}`
                                  : sheet.skipped
                                    ? `Skipped: ${sheet.skipReason}`
                                    : `${sheet.warnings?.length || 0} warnings`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  {preview.conflicts.length > 0 && (
                    <Card className="border-amber-300 dark:border-amber-700">
                      <div className="flex items-start gap-3 border-b border-amber-200 px-5 py-4 dark:border-amber-800">
                        <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div>
                          <h3 className="font-extrabold text-slate-950 dark:text-white">
                            Review required
                          </h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            Resolve each attendance conflict. Completion-date
                            differences are shown separately and are not
                            resolved by the attendance selection.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4 p-4 sm:p-5">
                        {preview.conflicts.map((conflict) => (
                          <div
                            key={conflict.id}
                            className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
                          >
                            <div className="mb-4 flex flex-wrap items-center gap-2">
                              <span className="font-extrabold text-slate-950 dark:text-white">
                                {conflict.name || conflict.intern}
                              </span>
                              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                                {conflict.code || conflict.intern}
                              </span>
                              <span className="text-sm text-slate-500 dark:text-slate-400">
                                {conflict.phone || 'No phone'}
                              </span>
                              <span className="ml-auto text-sm font-bold text-slate-700 dark:text-slate-200">
                                {formatDate(conflict.date)}
                              </span>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                                  Existing source
                                </div>
                                <AttendanceBadge value={conflict.existing} />
                                <div className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                  {conflict.existingSource}
                                </div>
                                <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                  Completion date:{' '}
                                  {formatDate(conflict.existingCompletionDate)}
                                </div>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                                  Incoming source
                                </div>
                                <AttendanceBadge value={conflict.incoming} />
                                <div className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                  {conflict.incomingSource}
                                </div>
                                <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                  Completion date:{' '}
                                  {formatDate(conflict.incomingCompletionDate)}
                                </div>
                              </div>
                            </div>

                            {conflict.existingCompletionDate !==
                              conflict.incomingCompletionDate && (
                              <div className="mt-3 flex gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300">
                                <AlertTriangle className="h-5 w-5 shrink-0" />
                                Completion dates also differ. The attendance
                                choice below does not resolve that separate
                                discrepancy.
                              </div>
                            )}

                            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Preview resolution
                            </label>
                            <select
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                              value={resolutions[conflict.id] || ''}
                              onChange={(event) =>
                                chooseResolution(
                                  conflict.id,
                                  event.target.value
                                )
                              }
                            >
                              <option value="">Select a resolution</option>
                              {conflict.allowedResolutions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  <Card className="overflow-hidden">
                    <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-extrabold text-slate-950 dark:text-white">
                          Intern reconciliation
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Showing{' '}
                          {Math.min(visibleRows, filteredInterns.length)} of{' '}
                          {filteredInterns.length} matching interns
                        </p>
                      </div>
                      <label className="relative block w-full sm:w-72">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="search"
                          value={search}
                          onChange={(event) => {
                            setSearch(event.target.value);
                            setVisibleRows(20);
                          }}
                          placeholder="Search name, code, or phone"
                          className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="max-h-[430px] overflow-auto">
                      <table className="min-w-[900px] w-full table-fixed text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                          <tr>
                            <th className="w-44 px-5 py-3">Name</th>
                            <th className="w-36 px-5 py-3">Code</th>
                            <th className="w-36 px-5 py-3">Status</th>
                            <th className="w-28 px-5 py-3 text-right">
                              Attendance
                            </th>
                            <th className="px-5 py-3">Sources</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredInterns
                            .slice(0, visibleRows)
                            .map((intern) => (
                              <tr
                                key={intern.key}
                                className="border-t border-slate-200 dark:border-slate-700"
                              >
                                <td className="truncate px-5 py-3 font-semibold text-slate-950 dark:text-white">
                                  {intern.name}
                                </td>
                                <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                                  {intern.code || 'Review'}
                                </td>
                                <td className="px-5 py-3">
                                  <StatusBadge
                                    value={
                                      intern.lifecycle?.status ||
                                      intern.workbookStatus ||
                                      'UNKNOWN'
                                    }
                                  />
                                </td>
                                <td className="px-5 py-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">
                                  {intern.attendanceCount}
                                </td>
                                <td className="px-5 py-3">
                                  <div
                                    className="truncate text-slate-600 dark:text-slate-300"
                                    title={intern.sources.join(', ')}
                                  >
                                    {intern.sources.join(', ')}
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>

                    {visibleRows < filteredInterns.length && (
                      <div className="border-t border-slate-200 p-4 text-center dark:border-slate-700">
                        <button
                          type="button"
                          onClick={() =>
                            setVisibleRows((current) => current + 20)
                          }
                          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        >
                          Show 20 more
                        </button>
                      </div>
                    )}
                  </Card>
                </>
              )}
            </div>
          </div>

          <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            {preview ? (
              <div
                className={`flex min-w-0 items-start gap-3 ${
                  unresolvedCount > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {unresolvedCount > 0 ? (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-bold">
                    {unresolvedCount > 0
                      ? `${unresolvedCount} conflict${unresolvedCount === 1 ? '' : 's'} unresolved`
                      : 'All preview attendance conflicts resolved'}
                  </div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    Preview fingerprint:{' '}
                    {preview.previewFingerprint.slice(0, 12)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Choose a workbook to begin preview validation.
              </div>
            )}

            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Close
              </button>
              <button
                type="button"
                disabled
                title="Database import will be enabled after preview validation is complete"
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-300 px-4 py-2.5 text-sm font-extrabold text-slate-600 opacity-80 dark:bg-slate-700 dark:text-slate-300"
              >
                <LockKeyhole className="h-4 w-4" />
                Import Not Enabled Yet
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
