import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { authFetch } from '../../utils/fetch';

const ACTION_OPTIONS = [
  '', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'REGISTER',
  'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_SUCCESS',
  'OTP_ENABLED', 'OTP_DISABLED', 'PROFILE_UPDATED',
  'ACCOUNT_BANNED', 'ACCOUNT_UNBANNED', 'TOKEN_CLEANUP',
];

const PAGE_SIZE = 20;

export default function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [filters, setFilters] = useState({
    action: '',
    user_id: '',
    start_date: '',
    end_date: '',
  });

  const fetchLogs = useCallback(async (currentPage: number, currentFilters: typeof filters) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(currentPage));
    params.set('pageSize', String(PAGE_SIZE));
    if (currentFilters.action) params.set('action', currentFilters.action);
    if (currentFilters.user_id) params.set('user_id', currentFilters.user_id);
    if (currentFilters.start_date) params.set('start_date', currentFilters.start_date);
    if (currentFilters.end_date) params.set('end_date', currentFilters.end_date);

    const res = await authFetch(`/api/admin/audit?${params}`);
    if (res.ok) {
      const { data } = await res.json();
      // Support both array response (legacy) and paginated { data, pagination }
      if (Array.isArray(data)) {
        setLogs(data);
        setTotal(data.length);
      } else {
        setLogs(data.logs || []);
        setTotal(data.pagination?.total ?? data.total ?? (data.data ?? data.logs ?? []).length);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs(page, filters);
  }, [page, fetchLogs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchLogs(1, filters);
  };

  const handleReset = () => {
    const cleared = { action: '', user_id: '', start_date: '', end_date: '' };
    setFilters(cleared);
    setPage(1);
    fetchLogs(1, cleared);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="bg-white dark:bg-zinc-900 shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-zinc-900 dark:text-white">Audit Logs</h3>
      </div>

      {/* Filters */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-4 sm:px-6 bg-zinc-50 dark:bg-zinc-800">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Action</label>
            <select
              value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
              className="border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white rounded-md shadow-sm py-1.5 px-2 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">All actions</option>
              {ACTION_OPTIONS.filter(Boolean).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">User ID</label>
            <input
              type="text"
              placeholder="User ID..."
              value={filters.user_id}
              onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))}
              className="border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white rounded-md shadow-sm py-1.5 px-2 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 w-44"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">From</label>
            <input
              type="date"
              value={filters.start_date}
              onChange={e => setFilters(f => ({ ...f, start_date: e.target.value }))}
              className="border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white rounded-md shadow-sm py-1.5 px-2 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">To</label>
            <input
              type="date"
              value={filters.end_date}
              onChange={e => setFilters(f => ({ ...f, end_date: e.target.value }))}
              className="border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white rounded-md shadow-sm py-1.5 px-2 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <button type="submit"
            className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
            <Search className="h-4 w-4 mr-1" /> Search
          </button>
          <button type="button" onClick={handleReset}
            className="inline-flex items-center px-3 py-1.5 border border-zinc-300 dark:border-zinc-700 text-sm font-medium rounded-md text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700">
            Reset
          </button>
        </form>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-700">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Timestamp</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Action</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">IP Address</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-700">
            {loading ? (
              <tr><td colSpan={5} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No logs found</td></tr>
            ) : logs.map((log) => (
              <tr key={log.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                  {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-white">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    log.action.includes('SUCCESS') ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                    log.action.includes('FAILED') ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300'
                  }`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                  {log.username || log.user_id || 'System/Anonymous'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400 font-mono text-xs">
                  {log.ip_address}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400">{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3 flex items-center justify-between sm:px-6">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {total > 0
            ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`
            : 'No results'}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="inline-flex items-center px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded-md text-sm text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="inline-flex items-center px-3 py-1 text-sm text-zinc-700 dark:text-zinc-300">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="inline-flex items-center px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded-md text-sm text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
