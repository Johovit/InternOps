import { ROLE_LABEL } from '../constants/roles';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import api from '../lib/axios';
import useAuthStore from '../store/auth';
import { QUERY_KEYS } from '../constants/queryKeys';
import { Card, StatCard, ApiErrorState } from '../components/ui';
import AssessmentSection from '../components/AssessmentSection';

function attendancePct(m) {
  const total = Number(m.attendance_total) || 0;
  if (!total) return null;

  const score = Number(m.present_count) + Number(m.half_day_count) * 0.5;
  return Math.round((score / total) * 100);
}

function QuickAction({ to, icon, label, tint, description }) {
  return (
    <Link
      to={to}
      className={`group flex items-center gap-3 p-4 rounded-2xl text-sm font-bold transition-all hover:-translate-y-0.5 hover:shadow-md ${tint}`}
    >
      <span className="w-10 h-10 rounded-2xl bg-white/70 dark:bg-slate-900/40 flex items-center justify-center text-xl shadow-sm">
        {icon}
      </span>

      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {description && (
          <span className="block text-xs font-medium opacity-70 mt-0.5 truncate">
            {description}
          </span>
        )}
      </span>
    </Link>
  );
}

/* ─── Excel Import Modal ─────────────────────────────────────── */
function ExcelImportModal({ onClose, onApply }) {
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const REQUIRED_COLS = ['Name', 'Attendance%', 'Rating'];

  async function parseFile(file) {
    setError('');
    setPreview(null);
    setFileName(file.name);
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'csv') {
        const text = await file.text();
        const Papa = (await import('papaparse')).default;
        const { data, errors } = Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
        });
        if (errors.length) throw new Error(errors[0].message);
        validate(data);
      } else if (ext === 'xlsx' || ext === 'xls') {
        const buf = await file.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        validate(data);
      } else {
        throw new Error('Unsupported format. Please upload .xlsx or .csv');
      }
    } catch (e) {
      setError(e.message);
    }
  }

  function validate(rows) {
    if (!rows.length) throw new Error('File is empty.');
    const cols = Object.keys(rows[0]);
    const missing = REQUIRED_COLS.filter((c) => !cols.includes(c));
    if (missing.length)
      throw new Error(
        `Missing columns: ${missing.join(', ')}. Download the template to see the correct format.`
      );
    const parsed = rows.map((r, i) => {
      const name = String(r['Name'] || '').trim();
      const att = parseFloat(r['Attendance%']);
      const rat = parseFloat(r['Rating']);
      if (!name) throw new Error(`Row ${i + 2}: Name is empty.`);
      if (isNaN(att) || att < 0 || att > 100)
        throw new Error(`Row ${i + 2}: Attendance% must be 0–100.`);
      if (isNaN(rat) || rat < 0 || rat > 10)
        throw new Error(`Row ${i + 2}: Rating must be 0–10.`);
      return { name, attendance: att, rating: rat };
    });
    setPreview(parsed);
  }

  function downloadTemplate() {
    const csv =
      'Name,Attendance%,Rating\nJohn Smith,85,7.5\nJane Doe,92,8.2\nRaj Patel,78,6.8\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'team_performance_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
              Import Excel / CSV
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload team performance data to visualise in the chart.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <button
            onClick={downloadTemplate}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 text-sm font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
          >
            <span className="text-xl">📋</span>
            <span className="flex-1 text-left">
              Download Template
              <span className="block text-xs font-normal text-indigo-500 dark:text-indigo-400">
                Columns: Name, Attendance%, Rating
              </span>
            </span>
            <span className="text-xs bg-indigo-200 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">
              .csv
            </span>
          </button>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('excel-file-input').click()}
            className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 py-8 px-4 text-center ${
              dragOver
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <input
              id="excel-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) =>
                e.target.files[0] && parseFile(e.target.files[0])
              }
            />
            <div className="text-3xl mb-2">{dragOver ? '📂' : '📁'}</div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {fileName || 'Drag & drop your file here'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              or click to browse · .xlsx · .xls · .csv
            </p>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 px-4 py-3 text-sm text-rose-700 dark:text-rose-300 font-medium">
              ⚠️ {error}
            </div>
          )}

          {preview && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
                Preview — {preview.length} rows
              </p>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto max-h-44">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800 text-left">
                        <th className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                          Name
                        </th>
                        <th className="px-4 py-2 text-xs font-bold text-indigo-500 uppercase tracking-wide">
                          Attendance %
                        </th>
                        <th className="px-4 py-2 text-xs font-bold text-amber-500 uppercase tracking-wide">
                          Rating /10
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-200">
                            {row.name}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`font-extrabold ${row.attendance < 60 ? 'text-rose-500' : 'text-indigo-600 dark:text-indigo-400'}`}
                            >
                              {row.attendance}%
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`font-extrabold ${row.rating < 5 ? 'text-rose-500' : 'text-amber-500'}`}
                            >
                              {row.rating}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!preview}
            onClick={() => {
              onApply(preview);
              onClose();
            }}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-indigo-500/30"
          >
            Apply to Chart ✓
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Team Performance Card ──────────────────────────────────── */
function TeamPerformanceCard({ team, isLoading }) {
  const [mode, setMode] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [importedData, setImportedData] = useState(null);

  const isAttendance = mode === 'attendance';
  const isRatings = mode === 'ratings';
  const unit = isAttendance ? '%' : '/10';
  const accentColor = isAttendance ? '#6366f1' : '#f59e0b';
  const lowColor = '#f43f5e';

  const dataSource = importedData
    ? importedData.map((r) => ({
        full_name: r.name,
        email: r.name,
        attendance_total: 100,
        present_count: r.attendance,
        half_day_count: 0,
        avg_rating: r.rating,
      }))
    : team;

  const attData = dataSource.map((m) => {
    const name = (m.full_name || m.email || '').split(' ')[0];
    const pct = importedData ? Number(m.present_count) : attendancePct(m);
    return { name, value: pct ?? 0, raw: pct };
  });

  const ratData = dataSource.map((m) => {
    const name = (m.full_name || m.email || '').split(' ')[0];
    const r = m.avg_rating != null ? Number(m.avg_rating) : null;
    return { name, value: r ?? 0, raw: r };
  });

  const chartData = isAttendance ? attData : ratData;

  const validValues = chartData.map((d) => d.raw).filter((v) => v !== null);
  const avg = validValues.length
    ? (validValues.reduce((a, b) => a + b, 0) / validValues.length).toFixed(
        isAttendance ? 0 : 1
      )
    : null;
  const highest = validValues.length ? Math.max(...validValues) : null;
  const lowest = validValues.length ? Math.min(...validValues) : null;
  const highMember = chartData.find((d) => d.raw === highest);
  const lowMember = chartData.find((d) => d.raw === lowest);

  const attValues = attData.map((d) => d.raw).filter((v) => v !== null);
  const ratValues = ratData.map((d) => d.raw).filter((v) => v !== null);
  const avgAttPct = attValues.length
    ? attValues.reduce((a, b) => a + b, 0) / attValues.length
    : null;
  const avgRatPct = ratValues.length
    ? (ratValues.reduce((a, b) => a + b, 0) / ratValues.length) * 10
    : null;
  const overallScore =
    avgAttPct !== null && avgRatPct !== null
      ? Math.round((avgAttPct + avgRatPct) / 2)
      : avgAttPct !== null
        ? Math.round(avgAttPct)
        : avgRatPct !== null
          ? Math.round(avgRatPct)
          : null;

  const scoreColor =
    overallScore === null
      ? 'text-slate-400'
      : overallScore >= 75
        ? 'text-emerald-500'
        : overallScore >= 50
          ? 'text-amber-500'
          : 'text-rose-500';

  const scoreBg =
    overallScore === null
      ? 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
      : overallScore >= 75
        ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
        : overallScore >= 50
          ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
          : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800';

  const scoreLabel =
    overallScore === null
      ? 'No data yet'
      : overallScore >= 75
        ? 'Excellent 🚀'
        : overallScore >= 50
          ? 'Good 👍'
          : 'Needs Attention ⚠️';

  const hasData = dataSource.length > 0;

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs shadow-xl">
          <p className="text-white font-bold">{d.name}</p>
          <p className="text-indigo-300 font-semibold mt-0.5">
            {d.raw !== null ? `${d.raw}${unit}` : 'N/A'}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <>
      {showImport && (
        <ExcelImportModal
          onClose={() => setShowImport(false)}
          onApply={(rows) => {
            setImportedData(rows);
            setMode('attendance');
          }}
        />
      )}

      <Card className="p-6 md:p-7 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_14px_35px_rgba(15,23,42,0.06)] dark:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5 pb-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="font-extrabold text-xl text-slate-900 dark:text-white flex items-center gap-2">
              📊 Team Performance
              {importedData && (
                <span className="text-xs font-bold bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-full">
                  Imported
                </span>
              )}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {importedData
                ? `Showing ${importedData.length} imported rows.`
                : "Select a metric to view your team's data."}
            </p>
          </div>

          {/* Import / Clear buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {importedData && (
              <button
                onClick={() => {
                  setImportedData(null);
                  setMode(null);
                }}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 transition-colors"
              >
                ✕ Clear
              </button>
            )}
            <button
              id="perf-btn-import"
              onClick={() => setShowImport(true)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors"
            >
              Import Excel
            </button>
          </div>
        </div>

        {/* Toggle Buttons */}
        <div className="flex gap-3 mb-5">
          <button
            id="perf-btn-attendance"
            onClick={() => setMode(isAttendance ? null : 'attendance')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 border ${
              isAttendance
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-500/30 scale-[1.03]'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:border-indigo-300'
            }`}
          >
            📅 Attendance
          </button>
          <button
            id="perf-btn-ratings"
            onClick={() => setMode(isRatings ? null : 'ratings')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 border ${
              isRatings
                ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-400/30 scale-[1.03]'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:border-amber-300'
            }`}
          >
            ⭐ Ratings
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            Loading performance data...
          </div>
        ) : mode === null ? (
          <div
            className={`rounded-2xl border px-6 py-5 ${scoreBg} transition-all duration-300`}
          >
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
              Overall Performance Score
            </p>
            {!hasData ? (
              <>
                <p className="text-slate-700 dark:text-slate-200 font-extrabold text-lg">
                  No team data yet
                </p>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                  Add team members or import a file using the button above.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-end gap-3">
                  <span className={`text-5xl font-black ${scoreColor}`}>
                    {overallScore !== null ? `${overallScore}%` : '—'}
                  </span>
                  <span className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">
                    {scoreLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Combined avg. of attendance &amp; ratings across{' '}
                  {dataSource.length} member{dataSource.length !== 1 ? 's' : ''}
                  .
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white/60 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 px-3 py-2">
                    <p className="text-xs text-slate-400 font-semibold">
                      Avg Attendance
                    </p>
                    <p className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400">
                      {avgAttPct !== null ? `${Math.round(avgAttPct)}%` : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/60 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 px-3 py-2">
                    <p className="text-xs text-slate-400 font-semibold">
                      Avg Rating
                    </p>
                    <p className="text-lg font-extrabold text-amber-500 dark:text-amber-400">
                      {ratValues.length
                        ? `${(ratValues.reduce((a, b) => a + b, 0) / ratValues.length).toFixed(1)}/10`
                        : '—'}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : !hasData ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-center py-8 px-4">
            <p className="text-slate-800 dark:text-white font-extrabold">
              No data
            </p>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
              Add team members or import a file using the button above.
            </p>
          </div>
        ) : (
          <div style={{ animation: 'fadeSlideIn 0.25s ease' }}>
            <style>{`@keyframes fadeSlideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(148,163,184,0.15)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    domain={isAttendance ? [0, 100] : [0, 10]}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: 'rgba(99,102,241,0.06)' }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.raw === null
                            ? '#475569'
                            : isAttendance && entry.raw < 60
                              ? lowColor
                              : !isAttendance && entry.raw < 5
                                ? lowColor
                                : accentColor
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-1">
                  Average
                </p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                  {avg !== null ? `${avg}${unit}` : '—'}
                </p>
              </div>
              <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 px-4 py-3 text-center">
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide mb-1">
                  Highest
                </p>
                <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">
                  {highest !== null ? `${highest}${unit}` : '—'}
                </p>
                {highMember && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 truncate mt-0.5">
                    {highMember.name}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50 px-4 py-3 text-center">
                <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold uppercase tracking-wide mb-1">
                  Lowest
                </p>
                <p className="text-2xl font-extrabold text-rose-700 dark:text-rose-300">
                  {lowest !== null ? `${lowest}${unit}` : '—'}
                </p>
                {lowMember && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 truncate mt-0.5">
                    {lowMember.name}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function ManagerHome({ user }) {
  const {
    data: team = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.TEAM_MEMBERS,
    queryFn: () => api.get('/team/members').then((res) => res.data),
    staleTime: 5 * 60 * 1000,
  });

  if (isError && team.length === 0) {
    return (
      <ApiErrorState
        error={error}
        title="Failed to load dashboard data"
        fallback="Unable to load your team dashboard. Please try again."
        onRetry={refetch}
      />
    );
  }

  const isFetchingFirstTime = isLoading && team.length === 0;

  const active = team.filter(
    (m) => !m.suspended && (m.internship_status || 'ACTIVE') === 'ACTIVE'
  ).length;

  const pcts = team.map(attendancePct).filter((p) => p !== null);

  const avgAtt = pcts.length
    ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
    : null;

  const ratings = team
    .map((m) => m.avg_rating)
    .filter((r) => r != null)
    .map(Number);

  const avgRating = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : '—';

  return (
    <div className="animate-fade-in-up text-slate-900 dark:text-white">
      {/* Welcome Header */}
      <div className="mb-7">
        <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300 font-extrabold mb-2">
          {ROLE_LABEL[user?.role]} Dashboard
        </p>

        <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Welcome, {user?.full_name || user?.email}
        </h1>

        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 mt-2 max-w-2xl">
          Here is a quick overview of your team activity, performance, and
          pending actions.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Team members"
          value={isFetchingFirstTime ? '...' : team.length}
          icon="👥"
          gradient="from-indigo-500 to-blue-600"
        />

        <StatCard
          label="Active"
          value={isFetchingFirstTime ? '...' : active}
          icon="✅"
          gradient="from-emerald-400 to-teal-500"
        />

        <StatCard
          label="Avg attendance"
          value={
            isFetchingFirstTime ? '...' : avgAtt === null ? '—' : `${avgAtt}%`
          }
          icon="📅"
          gradient="from-sky-400 to-blue-500"
        />

        <StatCard
          label="Avg rating"
          value={isFetchingFirstTime ? '...' : avgRating}
          sub="out of 10"
          icon="⭐"
          gradient="from-amber-400 to-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Team Performance */}
        <TeamPerformanceCard team={team} isLoading={isFetchingFirstTime} />

        {/* Quick Actions */}
        <Card className="p-6 md:p-7 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_14px_35px_rgba(15,23,42,0.06)] dark:shadow-none">
          <div className="mb-5 pb-4 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-extrabold text-xl text-slate-900 dark:text-white flex items-center gap-2">
              ⚡ Quick actions
            </h3>

            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Jump into common team management tasks.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <QuickAction
              to="/team"
              icon="👥"
              label="Manage team"
              description="View members"
              tint="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/60"
            />

            <QuickAction
              to="/notices"
              icon="📢"
              label="Make announcement"
              description="Post announcements"
              tint="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-900/60"
            />

            <QuickAction
              to="/ratings"
              icon="⭐"
              label="Rate members"
              description="Performance"
              tint="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-900/60"
            />

            <QuickAction
              to="/tasks"
              icon="🎯"
              label="Social tasks"
              description="Track tasks"
              tint="bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border border-violet-100 dark:border-violet-900/60"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function InternHome({ user }) {
  const now = new Date();

  const {
    data: stats,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['internHome', user?.id],
    queryFn: async () => {
      const [attResult, ratingsResult] = await Promise.allSettled([
        api
          .get(
            `/attendance/${user.id}/stats?month=${
              now.getMonth() + 1
            }&year=${now.getFullYear()}`
          )
          .then((r) => r.data),
        api.get(`/ratings/${user.id}`).then((r) => r.data),
      ]);

      const att = attResult.status === 'fulfilled' ? attResult.value : null;
      const attError =
        attResult.status === 'rejected' ? attResult.reason : null;

      const ratings =
        ratingsResult.status === 'fulfilled' ? ratingsResult.value : null;
      const ratingsError =
        ratingsResult.status === 'rejected' ? ratingsResult.reason : null;

      return { att, attError, ratings, ratingsError };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (isError && !stats) {
    return (
      <ApiErrorState
        error={error}
        title="Failed to load dashboard data"
        fallback="Unable to load your dashboard. Please try again."
        onRetry={refetch}
      />
    );
  }

  const isFetchingFirstTime = isLoading && !stats;

  const att = stats?.att;
  const attError = stats?.attError;
  const ratings = stats?.ratings;
  const attData = Array.isArray(att) ? att : [];
  const ratingsData = Array.isArray(ratings) ? ratings : [];

  const avg = ratingsData.length
    ? (
        ratingsData.reduce((a, r) => a + r.score, 0) / ratingsData.length
      ).toFixed(1)
    : '—';

  const present = att
    ? attData.find((s) => s.status === 'PRESENT')?.count || 0
    : '—';

  return (
    <div className="animate-fade-in-up text-slate-900 dark:text-white">
      {/* Welcome Header */}
      <div className="mb-7">
        <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300 font-extrabold mb-2">
          Intern Dashboard
        </p>

        <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Welcome, {user?.full_name || user?.email}
        </h1>

        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 mt-2 max-w-2xl">
          Track your attendance, ratings, and important shortcuts from one
          place.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Present this month"
          value={isFetchingFirstTime ? '...' : present}
          sub="days"
          icon="📅"
          gradient="from-emerald-400 to-teal-500"
        />

        <StatCard
          label="My avg rating"
          value={isFetchingFirstTime ? '...' : ratings !== null ? avg : '—'}
          sub="out of 10"
          icon="⭐"
          gradient="from-amber-400 to-orange-500"
        />

        <StatCard
          label="Total ratings"
          value={
            isFetchingFirstTime
              ? '...'
              : ratings !== null
                ? ratingsData.length
                : '—'
          }
          icon="📊"
          gradient="from-indigo-500 to-blue-600"
        />
      </div>

      {/* AI Assessment Section */}
      <div className="mb-6">
        <AssessmentSection userId={user?.id} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Attendance Summary */}
        <Card className="p-6 md:p-7 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_14px_35px_rgba(15,23,42,0.06)] dark:shadow-none">
          <div className="mb-5 pb-4 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-extrabold text-xl text-slate-900 dark:text-white flex items-center gap-2">
              📅 This month's attendance
            </h3>

            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Attendance status records for the current month.
            </p>
          </div>

          {isFetchingFirstTime ? (
            <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
              Loading attendance data...
            </div>
          ) : attError ? (
            <ApiErrorState
              error={attError}
              title="Failed to load attendance records"
              fallback="Unable to load attendance records. Please try again."
            />
          ) : attData.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-center py-8 px-4">
              <p className="text-slate-800 dark:text-white font-extrabold">
                No records yet
              </p>

              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                Attendance records will appear here once available.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {attData.map((s) => (
                <div
                  key={s.status}
                  className="flex justify-between items-center text-sm py-3 px-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70"
                >
                  <span className="text-slate-600 dark:text-slate-300 font-semibold">
                    {s.status}
                  </span>

                  <span className="font-extrabold text-slate-900 dark:text-white">
                    {s.count} days
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Quick Actions */}
        <Card className="p-6 md:p-7 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_14px_35px_rgba(15,23,42,0.06)] dark:shadow-none">
          <div className="mb-5 pb-4 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-extrabold text-xl text-slate-900 dark:text-white flex items-center gap-2">
              ⚡ Quick actions
            </h3>

            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Quickly access your daily InternOps tools.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <QuickAction
              to="/tasks"
              icon="🎯"
              label="My tasks"
              description="View assignments"
              tint="bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border border-violet-100 dark:border-violet-900/60"
            />

            <QuickAction
              to="/attendance"
              icon="📅"
              label="My attendance"
              description="Track presence"
              tint="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/60"
            />

            <QuickAction
              to="/ratings"
              icon="⭐"
              label="My ratings"
              description="Performance"
              tint="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-900/60"
            />

            <QuickAction
              to="/profile"
              icon="👤"
              label="My profile"
              description="Account details"
              tint="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/60"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function Home() {
  const user = useAuthStore((s) => s.user);

  const {
    data: me,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.USER_PROFILE,
    queryFn: () => api.get('/users/me').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  if (isError && !user && !me) {
    return (
      <ApiErrorState
        error={error}
        title="Failed to load profile"
        fallback="Unable to load your profile. Please try again."
        onRetry={refetch}
      />
    );
  }

  const u = { ...user, ...me };

  const isManager = ['ADMIN', 'SENIOR_TL', 'TL', 'CAPTAIN'].includes(u?.role);

  return isManager ? <ManagerHome user={u} /> : <InternHome user={u} />;
}
