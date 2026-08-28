import { useState } from "react";
import type { RefObject } from "react";

// Mobile-only "save this table as a photo" button. Renders nothing on
// desktop (hidden via CSS, .table-capture-bar in global.css) since the
// whole point is standing in for the horizontal scroll a phone screen
// forces on wide tables — desktop already shows everything at once.
//
// The trick that makes this actually capture the FULL table (not just
// whatever's currently scrolled into view): html-to-image renders straight
// from the DOM tree, reading the target element's own natural width
// (offsetWidth), not the viewport's clipped visible area. A <table> inside
// a `.table-wrap { overflow-x: auto }` ancestor still lays out at its own
// full natural content width — only the ANCESTOR clips/scrolls it — so
// pointing the ref at the <table> itself (never at .table-wrap) is what
// gets the whole thing, no scrolling or stitching required.
//
// html-to-image is dynamically imported so it only ever loads into the
// bundle if someone actually taps the button — no cost to everyone else's
// page weight for a mobile-only, occasionally-used feature.
export default function TableScreenshotButton({
  targetRef, filename,
}: {
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const capture = async () => {
    if (!targetRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const node = targetRef.current;
      const { toSvg } = await import("html-to-image");
      const svgDataUrl = await toSvg(node, {
        backgroundColor: "#FAF3E1", // --paper — canvas has no CSS var access of its own
        // html-to-image's default font-embedding step walks EVERY stylesheet
        // on the page (not just what the target subtree uses) and re-fetches
        // every @font-face src to inline as base64 — for this app's ~30
        // IBM Plex Mono weight/subset files that's slow, and can be
        // avoided entirely: the table only needs its own text legible, not
        // exact kerning, so a system-font fallback in the capture is the
        // right trade.
        skipFonts: true,
      });

      // Deliberately NOT using html-to-image's own toPng/toBlob here: those
      // resolve the loaded image inside a requestAnimationFrame callback,
      // which only ever fires while the tab is actively compositing —
      // fine for a normal foreground tap, but a real (if rare) way this
      // could hang forever if the tab loses visibility mid-capture (e.g.
      // the OS share sheet or another app steals focus right as this
      // resolves). Loading the SVG into an Image and drawing it to a
      // canvas by hand skips that dependency — same rendering, one fewer
      // way to get stuck.
      const img = new Image();
      img.decoding = "async";
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image failed to decode"));
      });
      img.src = svgDataUrl;
      await loaded;

      const pixelRatio = 2; // sharp enough to hold up once shared/re-compressed by a group chat app
      const canvas = document.createElement("canvas");
      canvas.width = node.offsetWidth * pixelRatio;
      canvas.height = node.offsetHeight * pixelRatio;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas context");
      ctx.scale(pixelRatio, pixelRatio);
      ctx.drawImage(img, 0, 0, node.offsetWidth, node.offsetHeight);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("empty image");
      const file = new File([blob], `${filename}.png`, { type: "image/png" });

      // Where supported (iOS Safari, Android Chrome), this opens the native
      // share sheet directly — pick a group chat or Save to Photos in one
      // tap, which is the actual thing being asked for here.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (shareErr) {
          if ((shareErr as Error).name === "AbortError") return; // user backed out of the share sheet
          // any other share failure falls through to the preview below
        }
      }

      // Fallback (also covers every desktop browser and anywhere share
      // isn't wired up): show the captured image in-page rather than
      // window.open() — a popup opened after an `await` loses the
      // browser's "this came from a real tap" flag and gets silently
      // blocked on most mobile browsers, so a new tab is not reliable
      // here. A long-press on the <img> below opens the OS's own
      // save/share menu just as well.
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setError("Couldn't create image — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="table-screenshot-btn"
        onClick={capture}
        disabled={busy}
        aria-label="Save table as image"
      >
        {busy ? "Capturing…" : "📷 Save as image"}
      </button>
      {error && <span className="table-screenshot-error">{error}</span>}
      {previewUrl && (
        <div className="table-screenshot-overlay" onClick={closePreview}>
          <div className="table-screenshot-preview" onClick={(e) => e.stopPropagation()}>
            <p className="table-screenshot-hint">Long-press the image to save or share it</p>
            <img src={previewUrl} alt={`${filename} — captured table`} />
            <button type="button" className="table-screenshot-btn" onClick={closePreview}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
