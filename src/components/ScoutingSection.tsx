import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ErrorNote, SuccessNote } from "@/components/ui";
import {
  POSITIONS,
  positionLabel,
  type PlayingPosition,
} from "@/lib/positions";
import { formatDay } from "@/lib/util";
import {
  FOOT_LABEL,
  ageGroupStatus,
  availability,
  detailsDraft,
  detailsRow,
  notesDraft,
  notesRow,
  perGame,
  type DetailsDraft,
  type DetailsRow,
  type Foot,
  type InjuryRow,
  type NotesDraft,
  type NotesRow,
} from "@/lib/scouting";

interface Props {
  playerId: string;
  dob: string;
  position: PlayingPosition | null;
  /** Administrators see and edit everything; a club manager sees and edits facts and injuries only. */
  isAdmin: boolean;
  /** yyyy-mm-dd of every game on record */
  gameDays: string[];
  totals: { goals: number; yellow: number; red: number };
  /** Matches left on a ban that is running now (0 if none). */
  banMatchesLeft: number;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-pitch-500">
        {label}
      </dt>
      <dd className="text-sm text-pitch-900 break-words">
        {children || <span className="text-pitch-400">Not recorded</span>}
      </dd>
    </div>
  );
}

function Notes({
  label,
  text,
}: {
  label: string;
  text: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-pitch-500">
        {label}
      </dt>
      <dd className="text-sm text-pitch-900 whitespace-pre-line">
        {text || <span className="text-pitch-400">Not recorded</span>}
      </dd>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-semibold text-pitch-800">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const EMPTY_INJURY = {
  injury: "",
  body_area: "",
  injured_on: "",
  returned_on: "",
  games_missed: "",
  notes: "",
};
const NOT_ALLOWED =
  "Not allowed. You can only change details of players currently registered to your club.";

export default function ScoutingSection({
  playerId,
  dob,
  position,
  isAdmin,
  gameDays,
  totals,
  banMatchesLeft,
}: Props) {
  const [details, setDetails] = useState<DetailsRow | null>(null);
  const [notes, setNotes] = useState<NotesRow | null>(null);
  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<"details" | "notes" | null>(null);
  const [dDraft, setDDraft] = useState<DetailsDraft>(detailsDraft(null));
  const [nDraft, setNDraft] = useState<NotesDraft>(notesDraft(null));
  const [inj, setInj] = useState(EMPTY_INJURY);
  const [addingInjury, setAddingInjury] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, i, n] = await Promise.all([
      supabase
        .from("player_details")
        .select("*")
        .eq("player_id", playerId)
        .maybeSingle(),
      supabase
        .from("player_injury")
        .select("*")
        .eq("player_id", playerId)
        .order("injured_on", { ascending: false }),
      isAdmin
        ? supabase
            .from("player_scouting")
            .select("*")
            .eq("player_id", playerId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (d.error || i.error || n.error) {
      setFailed(true);
    } else {
      setDetails((d.data as DetailsRow | null) ?? null);
      setInjuries((i.data ?? []) as InjuryRow[]);
      setNotes((n.data as NotesRow | null) ?? null);
      setFailed(false);
    }
    setLoaded(true);
  }, [playerId, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => ageGroupStatus(dob), [dob]);
  const avail = useMemo(
    () => availability(gameDays, injuries),
    [gameDays, injuries],
  );
  const games = gameDays.length;
  const cards = totals.yellow + totals.red;
  const setD = <K extends keyof DetailsDraft>(k: K, v: DetailsDraft[K]) =>
    setDDraft((d) => ({ ...d, [k]: v }));
  const setN = <K extends keyof NotesDraft>(k: K, v: NotesDraft[K]) =>
    setNDraft((d) => ({ ...d, [k]: v }));

  function failMessage(
    err: { code?: string; message?: string },
    fallback: string,
  ) {
    return err.code === "42501" || /row-level security/i.test(err.message ?? "")
      ? NOT_ALLOWED
      : fallback;
  }

  async function onSaveDetails() {
    setError(null);
    setOk(null);
    const res = detailsRow(playerId, dDraft);
    if ("error" in res) return setError(res.error);
    setBusy(true);
    const { error: err } = await supabase
      .from("player_details")
      .upsert(res.row, { onConflict: "player_id" });
    setBusy(false);
    if (err)
      return setError(
        failMessage(
          err,
          "Could not save. Has migration 020 been run in Supabase?",
        ),
      );
    setEditing(null);
    setOk("Details saved.");
    load();
  }

  async function onSaveNotes() {
    setError(null);
    setOk(null);
    setBusy(true);
    const { error: err } = await supabase
      .from("player_scouting")
      .upsert(notesRow(playerId, nDraft), { onConflict: "player_id" });
    setBusy(false);
    if (err)
      return setError(
        failMessage(
          err,
          "Could not save. Has migration 020 been run in Supabase?",
        ),
      );
    setEditing(null);
    setOk("Scouting notes saved.");
    load();
  }

  async function onAddInjury() {
    setError(null);
    setOk(null);
    if (!inj.injury.trim() || !inj.injured_on)
      return setError("Enter what the injury was and the date it happened.");
    if (inj.returned_on && inj.returned_on < inj.injured_on)
      return setError("The return date cannot be before the injury date.");
    const missed =
      inj.games_missed.trim() === "" ? null : Number(inj.games_missed);
    if (missed !== null && (!Number.isInteger(missed) || missed < 0))
      return setError("Games missed must be a whole number, 0 or more.");
    setBusy(true);
    const { error: err } = await supabase.from("player_injury").insert({
      player_id: playerId,
      injury: inj.injury.trim(),
      body_area: inj.body_area.trim() || null,
      injured_on: inj.injured_on,
      returned_on: inj.returned_on || null,
      games_missed: missed,
      notes: inj.notes.trim() || null,
    });
    setBusy(false);
    if (err)
      return setError(
        failMessage(
          err,
          "Could not add the injury. Has migration 020 been run in Supabase?",
        ),
      );
    setInj(EMPTY_INJURY);
    setAddingInjury(false);
    load();
  }

  async function onDeleteInjury(id: string) {
    if (!window.confirm("Delete this injury record?")) return;
    const { error: err } = await supabase
      .from("player_injury")
      .delete()
      .eq("id", id);
    if (err) setError(failMessage(err, "Could not delete the injury record."));
    else load();
  }

  if (!loaded) return null;
  if (failed) {
    return (
      <section className="card p-5 text-sm text-pitch-700 print:hidden">
        The extra player details could not be loaded. Run migration 020 in
        Supabase, then refresh.
      </section>
    );
  }

  const heightWeight = [
    details?.height_cm ? `${details.height_cm} cm` : null,
    details?.weight_kg ? `${details.weight_kg} kg` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display font-bold text-xl">
            {isAdmin ? "Scouting & age groups" : "Player details & fitness"}
          </h2>
          {!editing && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDDraft(detailsDraft(details));
                  setEditing("details");
                  setOk(null);
                  setError(null);
                }}
              >
                <Pencil className="w-4 h-4" aria-hidden /> Edit details
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setNDraft(notesDraft(notes));
                    setEditing("notes");
                    setOk(null);
                    setError(null);
                  }}
                >
                  <Pencil className="w-4 h-4" aria-hidden /> Edit scouting notes
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-pitch-600 mt-1 print:hidden">
          {isAdmin
            ? "Details and injuries can also be filled in by the manager of the player’s club. Scouting notes are visible to administrators only."
            : "Visible to administrators and to you as this player’s club manager."}
        </p>
      </div>
      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {editing === "details" && (
        <section className="card p-5 space-y-4">
          <h3 className="font-semibold text-pitch-800">Edit details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Place of birth / home village">
              <input
                className="input"
                value={dDraft.birthplace}
                onChange={(e) => setD("birthplace", e.target.value)}
              />
            </FormField>
            <FormField label="Secondary position">
              <select
                className="input"
                value={dDraft.secondary_position}
                onChange={(e) =>
                  setD(
                    "secondary_position",
                    e.target.value as DetailsDraft["secondary_position"],
                  )
                }
              >
                <option value="">None</option>
                {POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Preferred foot">
              <select
                className="input"
                value={dDraft.preferred_foot}
                onChange={(e) =>
                  setD(
                    "preferred_foot",
                    e.target.value as DetailsDraft["preferred_foot"],
                  )
                }
              >
                <option value="">Not recorded</option>
                {(Object.keys(FOOT_LABEL) as Foot[]).map((f) => (
                  <option key={f} value={f}>
                    {FOOT_LABEL[f]}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Height (cm)">
                <input
                  className="input"
                  inputMode="numeric"
                  value={dDraft.height_cm}
                  onChange={(e) => setD("height_cm", e.target.value)}
                />
              </FormField>
              <FormField label="Weight (kg)">
                <input
                  className="input"
                  inputMode="numeric"
                  value={dDraft.weight_kg}
                  onChange={(e) => setD("weight_kg", e.target.value)}
                />
              </FormField>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={onSaveDetails}
              disabled={busy}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}{" "}
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {editing === "notes" && isAdmin && (
        <section className="card p-5 space-y-4">
          <h3 className="font-semibold text-pitch-800">
            Edit scouting notes (administrators only)
          </h3>
          <FormField label="System fit (e.g. can tuck in as a third centre-back, suits a high press)">
            <textarea
              className="input"
              rows={2}
              value={nDraft.system_fit_notes}
              onChange={(e) => setN("system_fit_notes", e.target.value)}
            />
          </FormField>
          <FormField label="Captaincy experience">
            <input
              className="input"
              value={nDraft.captaincy}
              onChange={(e) => setN("captaincy", e.target.value)}
              placeholder="e.g. Club captain 2025–26"
            />
          </FormField>
          <FormField label="Leadership, character, coachability">
            <textarea
              className="input"
              rows={2}
              value={nDraft.leadership_notes}
              onChange={(e) => setN("leadership_notes", e.target.value)}
            />
          </FormField>
          <FormField label="Big-game experience (finals, knockout, relegation or title races)">
            <textarea
              className="input"
              rows={2}
              value={nDraft.big_game_notes}
              onChange={(e) => setN("big_game_notes", e.target.value)}
            />
          </FormField>
          <FormField label="Scouting notes">
            <textarea
              className="input"
              rows={3}
              value={nDraft.scouting_notes}
              onChange={(e) => setN("scouting_notes", e.target.value)}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={onSaveNotes}
              disabled={busy}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}{" "}
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {!editing && (
        <>
          <section className="card p-5 space-y-4">
            <h3 className="font-semibold text-pitch-800">
              Age groups &amp; origin
            </h3>
            <div
              className="flex flex-wrap gap-2"
              aria-label="Age-group eligibility"
            >
              {groups.map((g) => (
                <span
                  key={g.label}
                  className={`badge text-sm ${g.eligible ? "bg-pitch-100 text-pitch-800" : "bg-gray-100 text-gray-500 line-through"}`}
                >
                  {g.label}{" "}
                  {g.eligible ? `until ${g.lastYear}` : `ended ${g.lastYear}`}
                </span>
              ))}
            </div>
            <p className="text-xs text-pitch-600">
              Age groups are worked out from the birth year (born{" "}
              {dob.slice(0, 4)}). Each competition&rsquo;s own rules decide.
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Fact label="Date of birth">{formatDay(dob)}</Fact>
              <Fact label="Place of birth / home village">
                {details?.birthplace}
              </Fact>
            </dl>
          </section>

          <section className="card p-5 space-y-4">
            <h3 className="font-semibold text-pitch-800">
              Availability &amp; durability
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[
                ["Games on record", avail.gamesTotal],
                ["Games, last 12 months", avail.gamesLast12Months],
                ["Injuries, last 24 months", avail.injuriesLast24Months],
                ["Games missed (injury)", avail.gamesMissedLast24Months],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-pitch-50 p-2">
                  <p className="text-xl font-display font-bold">{v}</p>
                  <p className="text-xs text-pitch-600">{l}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {avail.currentlyInjured ? (
                <span className="badge text-xs bg-ember-500/10 text-ember-700">
                  Injured now: {avail.currentlyInjured.injury}
                </span>
              ) : (
                <span className="badge text-xs bg-pitch-100 text-pitch-700">
                  No open injury
                </span>
              )}
              {banMatchesLeft > 0 && (
                <span className="badge text-xs bg-ember-500/10 text-ember-700">
                  Suspended: {banMatchesLeft}{" "}
                  {banMatchesLeft === 1 ? "match" : "matches"} left
                </span>
              )}
              {avail.recurringAreas.map((a) => (
                <span
                  key={a}
                  className="badge text-xs bg-gold-400/30 text-gold-600"
                >
                  Recurring: {a}
                </span>
              ))}
            </div>
            <p className="text-xs text-pitch-600">
              Minutes played and starting rate are not recorded; games are
              counted from team matches while the player was registered.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-pitch-800">
                  Injury history
                </h4>
                {!addingInjury && (
                  <button
                    type="button"
                    className="btn-secondary !min-h-[36px] !py-1 !px-3 text-sm print:hidden"
                    onClick={() => setAddingInjury(true)}
                  >
                    <Plus className="w-4 h-4" aria-hidden /> Add injury
                  </button>
                )}
              </div>
              {addingInjury && (
                <div className="rounded-xl border border-pitch-200 p-3 space-y-3 print:hidden">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="Injury">
                      <input
                        className="input"
                        value={inj.injury}
                        onChange={(e) =>
                          setInj({ ...inj, injury: e.target.value })
                        }
                        placeholder="e.g. Hamstring strain"
                      />
                    </FormField>
                    <FormField label="Body area">
                      <input
                        className="input"
                        value={inj.body_area}
                        onChange={(e) =>
                          setInj({ ...inj, body_area: e.target.value })
                        }
                        placeholder="e.g. hamstring, groin, ankle"
                      />
                    </FormField>
                    <FormField label="Injured on">
                      <input
                        className="input"
                        type="date"
                        value={inj.injured_on}
                        onChange={(e) =>
                          setInj({ ...inj, injured_on: e.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="Back in training / played on (blank if still out)">
                      <input
                        className="input"
                        type="date"
                        value={inj.returned_on}
                        onChange={(e) =>
                          setInj({ ...inj, returned_on: e.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="Games missed">
                      <input
                        className="input"
                        inputMode="numeric"
                        value={inj.games_missed}
                        onChange={(e) =>
                          setInj({ ...inj, games_missed: e.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="Notes">
                      <input
                        className="input"
                        value={inj.notes}
                        onChange={(e) =>
                          setInj({ ...inj, notes: e.target.value })
                        }
                      />
                    </FormField>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={onAddInjury}
                      disabled={busy}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setAddingInjury(false);
                        setInj(EMPTY_INJURY);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {injuries.length === 0 ? (
                <p className="text-sm text-pitch-600">No injuries recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {injuries.map((i) => (
                    <li
                      key={i.id}
                      className="rounded-xl border border-pitch-100 p-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 text-sm">
                        <p className="font-semibold">
                          {i.injury}
                          {i.body_area ? (
                            <span className="font-normal text-pitch-600">
                              {" "}
                              · {i.body_area}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-pitch-700">
                          {formatDay(i.injured_on)} →{" "}
                          {i.returned_on
                            ? formatDay(i.returned_on)
                            : "still out"}
                          {i.games_missed !== null
                            ? ` · ${i.games_missed} game${i.games_missed === 1 ? "" : "s"} missed`
                            : ""}
                        </p>
                        {i.notes && <p className="text-pitch-600">{i.notes}</p>}
                      </div>
                      <button
                        type="button"
                        className="text-pitch-500 hover:text-ember-700 p-2 -m-2 print:hidden"
                        onClick={() => onDeleteInjury(i.id)}
                        aria-label="Delete injury record"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card p-5 space-y-4">
            <h3 className="font-semibold text-pitch-800">Role &amp; fit</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Fact label="Primary position">
                {positionLabel(position) ?? ""}
              </Fact>
              <Fact label="Secondary position">
                {positionLabel(details?.secondary_position) ?? ""}
              </Fact>
              <Fact label="Preferred foot">
                {details?.preferred_foot
                  ? FOOT_LABEL[details.preferred_foot]
                  : ""}
              </Fact>
              <Fact label="Height / weight">{heightWeight}</Fact>
            </dl>
            {isAdmin && (
              <dl>
                <Notes label="System fit" text={notes?.system_fit_notes} />
              </dl>
            )}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Goals per game", perGame(games, totals.goals)],
                ["Cards per game", perGame(games, cards)],
                ["Goals, all games", totals.goals],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-pitch-50 p-2">
                  <p className="text-xl font-display font-bold">{v}</p>
                  <p className="text-xs text-pitch-600">{l}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-pitch-600">
              Advanced per-90 measures (expected goals, progressive passes, duel
              win rates) need match tracking data that this system does not
              collect, so they are not shown.
            </p>
          </section>

          {isAdmin && (
            <section className="card p-5 space-y-3">
              <h3 className="font-semibold text-pitch-800">Intangibles</h3>
              <dl className="space-y-3">
                <Notes label="Captaincy" text={notes?.captaincy} />
                <Notes
                  label="Leadership & character"
                  text={notes?.leadership_notes}
                />
                <Notes
                  label="Big-game experience"
                  text={notes?.big_game_notes}
                />
                <Notes label="Scouting notes" text={notes?.scouting_notes} />
              </dl>
            </section>
          )}
        </>
      )}
    </div>
  );
}
