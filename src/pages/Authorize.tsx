import { useState, useEffect } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { Shield, CheckCircle, XCircle } from 'lucide-react';

export default function Authorize({ user }: { user: any }) {
  const searchParams: any = useSearch({ strict: false });
  const navigate = useNavigate();
  const [clientInfo, setClientInfo] = useState<any>(null);
  const [error, setError] = useState('');

  const clientId = searchParams.client_id;
  const redirectUri = searchParams.redirect_uri;
  const responseType = searchParams.response_type;
  const state = searchParams.state;
  const scope = searchParams.scope;

  useEffect(() => {
    if (!clientId || !redirectUri || !responseType) {
      setError('Missing required OAuth parameters');
      return;
    }

    fetch(`/api/oidc/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=${responseType}&state=${state}&scope=${scope}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setClientInfo(data);
      });
  }, [clientId, redirectUri, responseType, state, scope]);

  const handleAuthorize = async (approved: boolean) => {
    if (!approved) {
      if (redirectUri) {
        const url = new URL(redirectUri);
        url.searchParams.append('error', 'access_denied');
        if (state) url.searchParams.append('state', state);
        window.location.href = url.toString();
      } else {
        navigate({ to: '/' });
      }
      return;
    }

    const res = await fetch('/api/oidc/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: responseType,
        state
      })
    });

    const data = await res.json();
    if (res.ok && data.redirect_url) {
      window.location.href = data.redirect_url;
    } else {
      setError(data.error || 'Authorization failed');
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 text-center">
          <XCircle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-2 text-lg font-medium text-zinc-900">Authorization Error</h3>
          <p className="mt-1 text-sm text-zinc-500">{error}</p>
          <button onClick={() => navigate({ to: '/' })} className="mt-6 w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!clientInfo) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-indigo-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900">
          Authorize Application
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="text-center">
            <p className="text-sm text-zinc-600">
              <strong className="text-zinc-900">{clientInfo.client_name}</strong> wants to access your account.
            </p>
            
            <div className="mt-4 bg-zinc-50 rounded-md p-4 text-left">
              <h4 className="text-sm font-medium text-zinc-900">This application will be able to:</h4>
              <ul className="mt-2 text-sm text-zinc-600 list-disc list-inside space-y-1">
                <li>View your basic profile info (username, email)</li>
                {clientInfo.scopes?.split(' ').map((s: string) => (
                  <li key={s}>Access scope: {s}</li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-xs text-zinc-500">
              Signed in as <strong className="text-zinc-900">{user.username}</strong> ({user.email}).
            </p>

            <div className="mt-6 flex gap-4">
              <button
                onClick={() => handleAuthorize(false)}
                className="flex-1 py-2 px-4 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAuthorize(true)}
                className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Authorize
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
