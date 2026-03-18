import React, { useState, useEffect } from 'react';
import { Users, Building, Key, Activity, Clock, TrendingUp, LogIn, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';
import { authFetch } from '../../utils/fetch';

interface Stats {
  users: number;
  tenants: number;
  clients: number;
  activeTokens: number;
  activeSessions: number;
  last24h: {
    logins: number;
    registrations: number;
  };
}

export default function DashboardStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const res = await authFetch('/api/admin/stats');
      if (res.ok) {
        const result = await res.json();
        setStats(result.data || result);
      }
    } catch (err) {
      console.error('Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white overflow-hidden shadow rounded-lg animate-pulse">
            <div className="p-5">
              <div className="h-4 bg-zinc-200 rounded w-1/2 mb-4"></div>
              <div className="h-8 bg-zinc-200 rounded w-3/4"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      name: 'Total Users',
      value: stats?.users || 0,
      icon: Users,
      color: 'bg-blue-500',
      href: '/admin/users'
    },
    {
      name: 'Tenants',
      value: stats?.tenants || 0,
      icon: Building,
      color: 'bg-purple-500',
      href: '/admin/tenants'
    },
    {
      name: 'OAuth Clients',
      value: stats?.clients || 0,
      icon: Key,
      color: 'bg-yellow-500',
      href: '/admin/clients'
    },
    {
      name: 'Active Tokens',
      value: stats?.activeTokens || 0,
      icon: Activity,
      color: 'bg-green-500',
      href: null
    },
    {
      name: 'Active Sessions',
      value: stats?.activeSessions || 0,
      icon: Clock,
      color: 'bg-indigo-500',
      href: null
    },
    {
      name: 'Last 24h Logins',
      value: stats?.last24h?.logins || 0,
      icon: LogIn,
      color: 'bg-teal-500',
      href: '/admin/audit'
    }
  ];

  return (
    <div>
      <h2 className="text-lg font-medium text-zinc-900 mb-4">System Overview</h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((card, index) => (
          <motion.div
            key={card.name}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.28, delay: index * 0.06, ease: 'easeOut' }}
            className="bg-white overflow-hidden shadow rounded-lg"
          >
            <div className="p-5">
              <div className="flex items-center">
                <div className={`flex-shrink-0 rounded-md p-3 ${card.color}`}>
                  <card.icon className="h-6 w-6 text-white" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-zinc-500 truncate">{card.name}</dt>
                    <dd className="flex items-baseline">
                      <div className="text-2xl font-semibold text-zinc-900">{card.value.toLocaleString()}</div>
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            {card.href && (
              <div className="bg-zinc-50 px-5 py-3">
                <div className="text-sm">
                  <a href={card.href} className="font-medium text-indigo-700 hover:text-indigo-900">
                    View all
                  </a>
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Activity Summary */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.42, ease: 'easeOut' }}
        className="mt-8 bg-white shadow rounded-lg p-6"
      >
        <h3 className="text-lg font-medium text-zinc-900 mb-4">
          <TrendingUp className="inline h-5 w-5 mr-2" />
          Last 24 Hours Activity
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-zinc-200 rounded-lg p-4">
            <div className="flex items-center">
              <LogIn className="h-8 w-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-zinc-500">Successful Logins</p>
                <p className="text-2xl font-semibold text-zinc-900">{stats?.last24h?.logins || 0}</p>
              </div>
            </div>
          </div>
          <div className="border border-zinc-200 rounded-lg p-4">
            <div className="flex items-center">
              <UserPlus className="h-8 w-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-zinc-500">New Registrations</p>
                <p className="text-2xl font-semibold text-zinc-900">{stats?.last24h?.registrations || 0}</p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
