import { useState } from "react";
import { triggerRefresh } from "../lib/refresh";

// Manual companion to the automatic 30s poll (lib/refresh.ts) — Tommy,
// 2026-09-14: wanted a way to force scores current right now rather than
// wait out the auto-poll or reload the page. Both routes through the same
// `triggerRefresh()`, so there's only one refresh mechanism to trust, not
// two that could disagree. Lives in the masthead, not gated to mobile —
// unlike ScreenshotButton this isn't a "smaller screen needs a shortcut for
// something desktop already shows" feature, it's a real action anyone might want.
export default function RefreshButton() {
  const [spinning, setSpinning] = useState(false);

  const handleClick = () => {
    triggerRefresh();
    // Every useFetch call resolves independently and asynchronously, so
    // there's no single "the refresh is done" moment to key a spinner off
    // of — a fixed, brief spin is simply feedback that the tap registered,
    // not a status of the underlying fetches themselves.
    setSpinning(true);
    setTimeout(() => setSpinning(false), 700);
  };

  return (
    <button
      type="button"
      className="refresh-btn"
      onClick={handleClick}
      aria-label="Refresh scores"
      title="Refresh scores"
    >
      <span className={spinning ? "refresh-icon spinning" : "refresh-icon"}>⟳</span>
    </button>
  );
}
