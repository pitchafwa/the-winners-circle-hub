export interface TeamRefLite {
  id: number;
  name: string;
  nickname: string | null;
}

/** Free-text team-mention input with live resolved-match status — shared by
 * the trade and draft admin tools. */
export default function TeamPicker({ value, teams, resolvedId, onChange }: {
  value: string;
  teams: TeamRefLite[];
  resolvedId: number | null;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <input className="control" style={{ width: "8rem" }} value={value} onChange={(e) => onChange(e.target.value)} />
      {teams.length > 0 && (
        resolvedId !== null
          ? <span className="pos" style={{ marginLeft: "0.4rem", fontSize: "0.75rem" }}>
              ✓ {teams.find((t) => t.id === resolvedId)?.nickname ?? teams.find((t) => t.id === resolvedId)?.name}
            </span>
          : <span className="neg" style={{ marginLeft: "0.4rem", fontSize: "0.75rem" }}>no match</span>
      )}
    </div>
  );
}
