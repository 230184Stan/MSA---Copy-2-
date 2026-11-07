import { useAuth } from '@/lib/auth';
import { Link } from 'react-router-dom';
import { Shield, Users, Flag, ChevronRight, Info, UserPlus } from 'lucide-react';

const roleLabels: Record<string, string> = {
  admin: 'Administrator',
  club_manager: 'Club Manager',
  referee: 'Referee',
  public: 'Public Viewer',
};

export default function DashboardPage() {
  const { profile } = useAuth();
  const role = profile?.role ?? 'public';
  const canManagePlayers = role === 'admin' || role === 'club_manager';

  const tools: { label: string; desc: string; icon: typeof Shield; to?: string }[] = [
    {
      label: 'Players',
      desc: 'Register players and assign them to your teams.',
      icon: UserPlus,
      to: canManagePlayers ? '/players' : undefined,
    },
    {
      label: 'Seasons & windows',
      desc: 'Create seasons and set transfer windows.',
      icon: Shield,
    },
    {
      label: 'Clubs & teams',
      desc: 'Manage clubs, teams, and competition entries.',
      icon: Users,
    },
    {
      label: 'Match results',
      desc: 'Enter scores and events for your assigned matches.',
      icon: Flag,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-pitch-600 text-white flex items-center justify-center font-bold text-lg shrink-0">
            {(profile?.full_name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-xl truncate">
              {profile?.full_name || 'Welcome'}
            </h1>
            <p className="text-sm text-pitch-600">
              Role: <span className="font-semibold">{roleLabels[role]}</span>
            </p>
          </div>
        </div>
      </section>

      {role === 'public' && (
        <div className="card p-4 border-gold-500 bg-gold-400/10 flex items-start gap-3">
          <Info className="w-5 h-5 text-gold-600 mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm text-pitch-800">
            Your account is a public viewer. An admin can upgrade you to a club
            manager or referee so you can manage teams and enter results.
          </p>
        </div>
      )}

      <section>
        <h2 className="font-display font-bold text-lg mb-3">Your tools</h2>
        <ul className="space-y-2">
          {tools.map((c) => {
            const Icon = c.icon;
            const isLink = !!c.to;
            const content = (
              <>
                <Icon className="w-7 h-7 text-pitch-600 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="font-semibold">{c.label}</p>
                  <p className="text-sm text-pitch-600">{c.desc}</p>
                </div>
                {isLink ? (
                  <ChevronRight className="w-5 h-5 ml-auto text-pitch-400" aria-hidden />
                ) : (
                  <span className="ml-auto text-xs badge bg-pitch-100 text-pitch-700">
                    Soon
                  </span>
                )}
              </>
            );
            return (
              <li key={c.label}>
                {isLink ? (
                  <Link
                    to={c.to!}
                    className="card p-4 flex items-center gap-3 hover:border-pitch-300 transition-colors"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="card p-4 flex items-center gap-3 opacity-70">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px]"
        >
          <ChevronRight className="w-4 h-4 rotate-180" aria-hidden /> Back to home
        </Link>
      </section>
    </div>
  );
}
