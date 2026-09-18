import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from '../../lib/apiError';
import {
  Megaphone,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  EyeOff,
  Eye,
  Pencil,
  X,
  Check,
  Clock,
  AlertTriangle,
  Newspaper,
  Upload,
  Link as LinkIcon,
  Star,
  Briefcase,
  CalendarDays,
  FileWarning,
  Sparkles,
} from 'lucide-react';
import api from '../../lib/axios';
import useAuthStore from '../../store/auth';
import {
  Card,
  Btn,
  Input,
  EmptyState,
  Spinner,
  ConfirmationModal,
} from '../../components/ui';
import CustomSelect from '../../components/CustomSelect';
import { useRouteInitialLoading } from '../../components/loading/RouteInitialLoading';

const CATEGORIES = [
  'GENERAL',
  'REMINDER',
  'ALERT',
  'NEWS',
  'INTERNSHIP',
  'ANNOUNCEMENT',
  'EVENT',
  'IMPORTANT',
  'DEADLINE',
];

const CATEGORY_STYLES = {
  GENERAL:
    'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-900/60',
  REMINDER:
    'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-900/60',
  ALERT:
    'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-900/60',
  NEWS: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/60',
  INTERNSHIP:
    'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-100 dark:border-purple-900/60',
  ANNOUNCEMENT:
    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-900/60',
  EVENT:
    'bg-fuchsia-50 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-100 dark:border-fuchsia-900/60',
  IMPORTANT:
    'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-100 dark:border-red-900/60',
  DEADLINE:
    'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-900/60',
};

const CATEGORY_META = {
  GENERAL: { Icon: Megaphone, color: 'text-indigo-500', label: 'General' },
  REMINDER: { Icon: Clock, color: 'text-amber-500', label: 'Reminder' },
  ALERT: { Icon: AlertTriangle, color: 'text-rose-500', label: 'Alert' },
  NEWS: { Icon: Newspaper, color: 'text-emerald-500', label: 'News' },
  INTERNSHIP: {
    Icon: Briefcase,
    color: 'text-purple-500',
    label: 'Internship',
  },
  ANNOUNCEMENT: {
    Icon: Megaphone,
    color: 'text-blue-500',
    label: 'Announcement',
  },
  EVENT: { Icon: CalendarDays, color: 'text-fuchsia-500', label: 'Event' },
  IMPORTANT: { Icon: FileWarning, color: 'text-red-500', label: 'Important' },
  DEADLINE: { Icon: Clock, color: 'text-orange-500', label: 'Deadline' },
};

const CATEGORY_OPTIONS = CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_META[category]?.label || category,
}));

/* ── Custom UI Components ── */
function CategoryBadge({ category }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.GENERAL;
  const { Icon } = meta;

  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border ${
        CATEGORY_STYLES[category] ?? CATEGORY_STYLES.GENERAL
      }`}
    >
      <Icon className={`w-3 h-3 ${meta.color}`} />
      {meta.label}
    </span>
  );
}

function NoticeForm({
  initial = {},
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
}) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [content, setContent] = useState(initial.content ?? '');
  const [category, setCategory] = useState(initial.category ?? 'GENERAL');
  const [image_url, setImageUrl] = useState(initial.image_url ?? '');
  const [action_button_text, setActionButtonText] = useState(
    initial.action_button_text ?? ''
  );
  const [action_button_link, setActionButtonLink] = useState(
    initial.action_button_link ?? ''
  );
  const [is_featured, setIsFeatured] = useState(initial.is_featured ?? false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);

  const handleAiAnalyze = async () => {
    if (!content.trim()) return;
    setIsAiLoading(true);
    setUploadError('');
    try {
      const res = await api.post('/notices/ai-analyze', {
        content: content.trim(),
      });
      const data = res.data.data;
      if (data.title && !title) setTitle(data.title);
      if (data.category) setCategory(data.category);
      if (data.action_button_text && !action_button_text)
        setActionButtonText(data.action_button_text);
      setAiAnalysis(data);
    } catch (err) {
      setUploadError(
        err.response?.data?.error ||
          err.message ||
          'Failed to analyze notice with AI'
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image size must be less than 5MB');
      return;
    }

    setIsUploading(true);
    setUploadError('');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/uploads/notice-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImageUrl(res.data.image_url);
    } catch (err) {
      setUploadError(getApiErrorMessage(err, 'Failed to upload image'));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {uploadError && (
        <div className="text-sm text-red-500 p-2 bg-red-50 rounded-lg">
          {uploadError}
        </div>
      )}

      <div className="flex items-center gap-4">
        {image_url && (
          <img
            src={image_url}
            alt="Notice Preview"
            className="h-16 w-32 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
          />
        )}
        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700/80 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 text-slate-500" />
          )}
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {image_url ? 'Change Image' : 'Upload Image (Optional)'}
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
            disabled={isPending || isUploading}
          />
        </label>
        {image_url && (
          <button
            type="button"
            onClick={() => setImageUrl('')}
            className="text-rose-500 text-sm hover:underline"
          >
            Remove
          </button>
        )}
      </div>

      <Input
        placeholder="Notice title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={isPending}
        className="dark:!border-slate-700 dark:!bg-slate-800/70"
      />

      <textarea
        placeholder="Notice content…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        disabled={isPending || isAiLoading}
        className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700/80 px-4 py-3 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 resize-none transition disabled:opacity-60 disabled:cursor-not-allowed"
      />

      <div className="flex justify-end -mt-1 mb-2">
        <button
          type="button"
          disabled={!content.trim() || isAiLoading || isPending}
          onClick={handleAiAnalyze}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAiLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          AI Assistant
        </button>
      </div>

      {aiAnalysis && (
        <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-4 text-sm mb-2 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-indigo-400 dark:bg-indigo-600"></div>
          <h4 className="font-semibold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5 mb-2">
            <Sparkles className="w-4 h-4 text-indigo-500" /> AI Insights
          </h4>
          <p className="text-slate-700 dark:text-slate-300 mb-3 leading-relaxed">
            <strong>Summary:</strong> {aiAnalysis.summary}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mb-4">
            {aiAnalysis.deadline && (
              <div className="text-slate-600 dark:text-slate-400">
                <strong className="text-slate-700 dark:text-slate-300">
                  Deadline:
                </strong>{' '}
                {aiAnalysis.deadline}
              </div>
            )}
            {aiAnalysis.date_time && (
              <div className="text-slate-600 dark:text-slate-400">
                <strong className="text-slate-700 dark:text-slate-300">
                  Date/Time:
                </strong>{' '}
                {aiAnalysis.date_time}
              </div>
            )}
            {aiAnalysis.eligibility && (
              <div className="text-slate-600 dark:text-slate-400 col-span-full">
                <strong className="text-slate-700 dark:text-slate-300">
                  Eligibility:
                </strong>{' '}
                {aiAnalysis.eligibility}
              </div>
            )}
          </div>
          {aiAnalysis.improved_content && (
            <div className="border-t border-indigo-100 dark:border-indigo-900/50 pt-3 flex flex-col gap-2">
              <p className="text-xs text-indigo-700 dark:text-indigo-400 font-medium uppercase tracking-wide">
                Suggested Content Revision
              </p>
              <p className="text-slate-600 dark:text-slate-400 italic bg-white/50 dark:bg-black/20 p-2 rounded-lg border border-indigo-50 dark:border-indigo-900/30 whitespace-pre-wrap">
                {aiAnalysis.improved_content}
              </p>
              <button
                type="button"
                onClick={() => setContent(aiAnalysis.improved_content)}
                className="self-start mt-1 text-xs font-semibold px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm transition-colors"
              >
                Use Suggested Content
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <Input
            placeholder="Action Button Text (e.g. Apply Now)"
            value={action_button_text}
            onChange={(e) => setActionButtonText(e.target.value)}
            disabled={isPending}
            className="h-[52px] min-w-0 rounded-2xl text-sm dark:!border-slate-700 dark:!bg-slate-800/70"
          />
        </div>
        <div className="relative min-w-0">
          <LinkIcon className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="url"
            placeholder="Action Button Link (https://...)"
            value={action_button_link}
            onChange={(e) => setActionButtonLink(e.target.value)}
            disabled={isPending}
            className="h-[52px] w-full min-w-0 rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-700/80 dark:text-slate-200 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="ml-1 mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          id="is_featured"
          checked={is_featured}
          onChange={(e) => setIsFeatured(e.target.checked)}
          
