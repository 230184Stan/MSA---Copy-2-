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
  draftFromRow,
  perGame,
  rowFromDraft,
  type Foot,
  type InjuryRow,
  type ScoutingDraft,
  type ScoutingRow,
} from "@/lib/scouting";

interface Props {
  playerId: string;
  dob: string;
  position: PlayingPosition | null;
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

export default function ScoutingSection({
  playerId,
  dob,
  position,
  gameDays,
  totals,
  banMatchesLeft,
}: Props) {
  const [row, setRow] = useState<ScoutingRow | null>(null);
  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ScoutingDraft>(draftFromRow(null));
  const [inj, setInj] = useState(EMPTY_INJURY);
  const [addingInjury, setAddingInjury] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, i] = await Promise.all([
      supabase
        .from("player_scouting")
        .select("*")
        .eq("player_id", playerId)
        .maybeSingle(),
      supabase
        .from("player_injury")
        .select("*")
        .eq("player_id", playerId)
        .order("injured_on", { ascending: false }),
    ]);
    if (s.error || i.error) {
      setFailed(true);
    } else {
      setRow((s.data as ScoutingRow | null) ?? null);
      setInjuries((i.data ?? []) as InjuryRow[]);
      setFailed(false);
    }
    setLoaded(true);
  }, [playerId]);

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
  const set = <K extends keyof ScoutingDraft>(k: K, v: ScoutingDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function onSave() {
    setError(null);
    setOk(null);
    const res = rowFromDraft(playerId, draft);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setBusy(true);
    const { error: err } = await supabase
      .from("player_scouting")
      .upsert(res.row, { onConflict: "player_id" });
    setBusy(false);
    if (err) {
      setError("Could not save. Has migration 018 been run in Supabase?");
      return;
    }
    setEditing(false);
    setOk("Scouting profile saved.");
    load();
  }

  async function onAddInjury() {
    setError(null);
    setOk(null);
    if (!inj.injury.trim() || !inj.injured_on) {
      setError("Enter what the injury was and the date it happened.");
      return;
    }
    if (inj.returned_on && inj.returned_on < inj.injured_on) {
      setError("The return date cannot be before the injury date.");
      return;
    }
    const missed =
      inj.games_missed.trim() === "" ? null : Number(inj.games_missed);
    if (missed !== null && (!Number.isInteger(missed) || missed < 0)) {
      setError("Games missed must be a whole number, 0 or more.");
      return;
    }
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
    if (err) {
      setError(
        "Could not add the injury. Has migration 018 been run in Supabase?",
      );
      return;
    }
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
    if (err) setError("Could not delete the injury record.");
    else load();
  }

  if (!loaded) return null;
  if (failed) {
    return (
      <section className="card p-5 text-sm text-pitch-700 print:hidden">
        The scouting profile could not be loaded. Run migration 018 (scouting
        profile) in Supabase, then refresh.
      </section>
    );
  }

  const heightWeight = [
    row?.height_cm ? `${row.height_cm} cm` : null,
    row?.weight_kg ? `${row.weight_kg} kg` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display font-bold text-xl">
            Scouting &amp; age groups
          </h2>
          {!editing && (
            <button
              type="button"
              className="btn-secondary print:hidden"
              onClick={() => {
                setDraft(draftFromRow(row));
                setEditing(true);
                setOk(null);
              }}
            >
              <Pencil className="w-4 h-4" aria-hidden />{" "}
              {row ? "Edit" : "Add details"}
            </button>
          )}
        </div>
        <p className="text-xs text-pitch-600 print:hidden">
          Visible to administrators only.
        </p>
      </div>
      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {editing ? (
        <section className="card p-5 space-y-5">
          <fieldset className="space-y-3">
            <legend className="font-semibold text-pitch-800">Origin</legend>
            <FormField label="Place of birth / home village">
              <input
                className="input"
                value={draft.birthplace}
                onChange={(e) => set("birthplace", e.target.value)}
              />
            </FormField>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="font-semibold text-pitch-800">
              Role &amp; fit
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Secondary position">
                <select
                  className="input"
                  value={draft.secondary_position}
                  onChange={(e) =>
                    set(
                      "secondary_position",
                      e.target.value as ScoutingDraft["secondary_position"],
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
                  value={draft.preferred_foot}
                  onChange={(e) =>
                    set(
                      "preferred_foot",
                      e.target.value as ScoutingDraft["preferred_foot"],
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
              <FormField label="Height (cm)">
                <input
                  className="input"
                  inputMode="numeric"
                  value={draft.height_cm}
                  onChange={(e) => set("height_cm", e.target.value)}
                />
              </FormField>
              <FormField label="Weight (kg)">
                <input
                  className="input"
                  inputMode="numeric"
                  value={draft.weight_kg}
                  onChange={(e) => set("weight_kg", e.target.value)}
                />
              </FormField>
            </div>
            <FormField label="System fit (e.g. can tuck in as a third centre-back, suits a high press)">
              <textarea
                className="input"
                rows={2}
                value={draft.system_fit_notes}
                onChange={(e) => set("system_fit_notes", e.target.value)}
              />
            </FormField>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="font-semibold text-pitch-800">
              Intangibles
            </legend>
            <FormField label="Captaincy experience">
              <input
                className="input"
                value={draft.captaincy}
                onChange={(e) => set("captaincy", e.target.value)}
                placeholder="e.g. Club captain 2025–26"
              />
            </FormField>
            <FormField label="Leadership, character, coachability">
              <textarea
                className="input"
                rows={2}
                value={draft.leadership_notes}
                onChange={(e) => set("leadership_notes", e.target.value)}
              />
            </FormField>
            <FormField label="Big-game experience (finals, knockout, relegation or title races)">
              <textarea
                className="input"
                rows={2}
                value={draft.big_game_notes}
                onChange={(e) => set("big_game_notes", e.target.value)}
              />
            </FormField>
            <FormField label="Scouting notes">
              <textarea
                className="input"
                rows={3}
                value={draft.scouting_notes}
                onChange={(e) => set("scouting_notes", e.target.value)}
              />
            </FormField>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={onSave}
              disabled={busy}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}{" "}
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : (
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
                {row?.birthplace}
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
                {positionLabel(row?.secondary_position) ?? ""}
              </Fact>
              <Fact label="Preferred foot">
                {row?.preferred_foot ? FOOT_LABEL[row.preferred_foot] : ""}
              </Fact>
              <Fact label="Height / weight">{heightWeight}</Fact>
            </dl>
            <dl>
              <Notes label="System fit" text={row?.system_fit_notes} />
            </dl>
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

          <section className="card p-5 space-y-3">
            <h3 className="font-semibold text-pitch-800">Intangibles</h3>
            <dl className="space-y-3">
              <Notes label="Captaincy" text={row?.captaincy} />
              <Notes
                label="Leadership & character"
                text={row?.leadership_notes}
              />
              <Notes label="Big-game experience" text={row?.big_game_notes} />
              <Notes label="Scouting notes" text={row?.scouting_notes} />
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
