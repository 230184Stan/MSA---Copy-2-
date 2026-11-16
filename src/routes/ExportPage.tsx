import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2, Printer } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import { PageHeader, ErrorNote, SuccessNote } from '@/components/ui';
import { errMsg } from '@/lib/util';
import { buildZip, fetchBundle } from '@/lib/exportData';
import { countSummary } from '@/lib/exportBuild';
import { buildXlsx } from '@/lib/exportXlsx';

export default function ExportPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [clubId, setClubId] = useState<string>(''); // '' = all clubs (admin)
  const [photos, setPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('club')
      .select('id, name')
      .order('name')
      .then(({ data }) => setClubs((data ?? []) as { id: string; name: string }[]));
  }, []);

  const effectiveClub = isAdmin ? clubId : (profile?.club_id ?? '');
  const clubName = clubs.find((c) => c.id === effectiveClub)?.name;

  async function onDownload(excelOnly = false) {
    setError(null);
    setOk(null);
    if (!isAdmin && !effectiveClub) {
      setError('Your account is not linked to a club yet, so there is nothing to export.');
      return;
    }
    setBusy(true);
    try {
      setStatus('Collecting data…');
      const bundle = await fetchBundle({
        clubId: effectiveClub || null,
        scopeLabel: effectiveClub ? `Club: ${clubName ?? effectiveClub}` : 'All clubs',
      });
      const n = countSummary(bundle);
      setStatus(excelOnly ? 'Building workbook…' : 'Packing files…');
      const stamp = new Date().toISOString().slice(0, 10);
      const slug = (clubName ?? 'all-clubs').replace(/[^\w-]+/g, '_');
      let blob: Blob;
      let photosSaved = 0;
      let photosFailed = 0;
      let fileName: string;
      if (excelOnly) {
        const bytes = await buildXlsx(bundle);
        blob = new Blob([bytes as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        fileName = `MSA_player_records_${slug}_${stamp}.xlsx`;
      } else {
        ({ blob, photosSaved, photosFailed } = await buildZip(bundle, photos, (d, t) =>
          setStatus(`Adding photos… ${d} of ${t}`)
        ));
        fileName = `msa-export_${slug}_${stamp}.zip`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setOk(
        `Downloaded ${n.players} player${n.players === 1 ? '' : 's'}, ${n.games} game record${n.games === 1 ? '' : 's'}, ` +
          `${n.events} goal/card event${n.events === 1 ? '' : 's'}, ${n.suspensions} suspension${n.suspensions === 1 ? '' : 's'}` +
          (photos && !excelOnly ? `, ${photosSaved} photo${photosSaved === 1 ? '' : 's'}` : '') +
          (photosFailed ? ` (${photosFailed} photo${photosFailed === 1 ? '' : 's'} could not be read)` : '') +
          '.'
      );
    } catch (err) {
      setError(errMsg(err as { message?: string }, 'The export failed. Check your connection and try again.'));
    }
    setStatus(null);
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Download}
        title="Export & print"
        intro="Take player details, records and photos out of the system, or print them."
      />
      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      <section className="card p-5 space-y-4">
        <h2 className="font-display font-bold text-lg">Download everything</h2>
        <p className="text-sm text-pitch-700">
          One zip file with a formatted Excel workbook (summary, players, game-by-game log, goals and
          cards, suspensions), the same tables as CSV, an <strong>import.sql</strong> file that loads
          it all into another MSA database, a JSON copy and the player photos.
        </p>

        {isAdmin ? (
          <label className="block text-sm">
            <span className="font-semibold text-pitch-800">Which players</span>
            <select
              className="input mt-1"
              value={clubId}
              onChange={(e) => setClubId(e.target.value)}
              disabled={busy}
            >
              <option value="">All clubs</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-pitch-700">
            You will receive the players of your own club{clubName ? `, ${clubName}` : ''}.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm min-h-[44px]">
          <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} disabled={busy} />
          Include photos (makes the file larger)
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => onDownload(false)} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}
            {busy ? (status ?? 'Working…') : 'Download zip (everything)'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => onDownload(true)} disabled={busy}>
            <Download className="w-4 h-4" aria-hidden /> Download Excel only
          </button>
        </div>
        <p className="text-sm text-pitch-600">
          The files contain personal details of players, some of them children. Keep them safe and
          share them only with people who should have them.
        </p>
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-display font-bold text-lg">Print</h2>
        <p className="text-sm text-pitch-700">
          To print one player with their photo, details and full record, open the player and press
          <strong> Print</strong>. To print a whole squad with photos, open the club and press
          <strong> Print squad</strong>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/players" className="btn-secondary">
            <Printer className="w-4 h-4" aria-hidden /> Choose a player
          </Link>
          <Link to="/admin/clubs" className="btn-secondary">
            <Printer className="w-4 h-4" aria-hidden /> Choose a club
          </Link>
        </div>
      </section>
    </div>
  );
}
