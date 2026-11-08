import { AlertTriangle } from 'lucide-react';

export default function SetupNeeded() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-pitch-50">
      <div className="card p-6 max-w-lg w-full space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-8 h-8 text-gold-600 shrink-0" aria-hidden />
          <h1 className="font-display font-bold text-xl">Setup needed</h1>
        </div>
        <p className="text-pitch-800">
          The app cannot find your Supabase keys, so it cannot load any data yet.
        </p>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-pitch-800">
          <li>
            In the project's main folder (next to <code>package.json</code>), create a file named{' '}
            <code>.env</code>
          </li>
          <li>
            Add these two lines, with no quotes or spaces around the <code>=</code>:
            <pre className="mt-2 p-3 rounded-xl bg-pitch-900 text-pitch-50 text-xs overflow-x-auto">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}
            </pre>
          </li>
          <li>
            Stop the app (<kbd>Ctrl</kbd>+<kbd>C</kbd>) and run <code>npm run dev</code> again.
            The file is only read when the app starts.
          </li>
        </ol>
      </div>
    </div>
  );
}
