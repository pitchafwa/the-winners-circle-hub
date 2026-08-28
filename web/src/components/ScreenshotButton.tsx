import { useState } from "react";
import type { RefObject } from "react";

// Mobile-only "save this as a photo" icon button — camera emoji, CSS-hidden
// above 640px (global.css) since desktop already shows everything without
// scrolling. Reusable across any block (tables, matchup cards, ...): the
// caller supplies a ref to the DOM node to capture and a filename.
//
// The trick that makes this actually capture the FULL content (not just
// whatever's currently scrolled into view): html-to-image renders straight
// from the DOM tree, reading the target element's own natural width
// (offsetWidth), not the viewport's clipped visible area. An element inside
// an `overflow-x: auto` ancestor still lays out at its own full natural
// content width — only the ANCESTOR clips/scrolls it — so pointing the ref
// at the actual content element (never at the scrolling wrapper around it)
// is what gets the whole thing, no scrolling or stitching required.
//
// html-to-image is dynamically imported so it only ever loads into the
// bundle if someone actually taps the button — no cost to everyone else's
// page weight for a mobile-only, occasionally-used feature.

/** "contend-rebuild" -> "Contend Rebuild" — a decent default heading for
 * any call site that doesn't bother passing an explicit `title`. */
function titleCase(filename: string): string {
  return filename.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ScreenshotButton({
  targetRef, filename, title, prepareCapture, cleanupCapture,
}: {
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
  /** Heading baked into the captured image itself. Defaults to a
   * title-cased version of `filename` when omitted. */
  title?: string;
  /** Optional hook to mutate the DOM into a different visual state right
   * before capture — e.g. MatchupCard uses this to force its desktop
   * side-by-side layout instead of the mobile stacked one, regardless of
   * the real viewport width. `cleanupCapture` (if given) undoes it
   * afterward, success or failure. */
  prepareCapture?: () => void;
  cleanupCapture?: () => void;
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
    let stage: HTMLDivElement | null = null;
    try {
      prepareCapture?.();
      const node = targetRef.current;

      // A bare table or chart cropped right at its own edge, with no
      // label, reads as an accidental screen-clip, not something worth
      // sending on. Build a frame — this block's title plus real
      // padding — around a CLONE of the target (never touching the live
      // page), and capture that instead.
      //
      // The frame has to stay invisible to the user without ever having
      // a NEGATIVE position — confirmed live that `left:-9999px` breaks
      // html-to-image's coordinate math and silently produces a fully
      // transparent capture (the content gets positioned outside the
      // exported SVG's viewBox instead of clipped into it). Nesting the
      // real frame (`top:0;left:0`) inside a zero-size,
      // `overflow:hidden` stage does the same "invisible to the user"
      // job with no negative coordinates anywhere: the stage clips it
      // to nothing on screen, while the frame itself still gets real
      // layout (offsetWidth/Height) for html-to-image to read, same
      // principle as `.table-wrap`'s own overflow-x clipping.
      stage = document.createElement("div");
      stage.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;";
      const frame = document.createElement("div");
      frame.style.cssText =
        "position:absolute;top:0;left:0;display:inline-block;" +
        "background:#FAF3E1;padding:1.25rem 1.5rem 1.5rem;";
      const heading = document.createElement("div");
      heading.textContent = title ?? titleCase(filename);
      heading.style.cssText =
        'font-family:"Trebuchet MS","Segoe UI",-apple-system,sans-serif;' +
        "font-weight:800;font-size:1.15rem;color:#12213D;margin-bottom:0.9rem;";
      frame.appendChild(heading);
      const clone = node.cloneNode(true) as HTMLElement;
      // Percentage-widthed descendants (recharts' ResponsiveContainer in
      // particular, width:100%) resolve against whatever they're
      // actually mounted in — reparenting the clone into this synthetic
      // frame breaks that resolution, since the frame has no real width
      // of its own to measure against (confirmed live: a chart capture
      // came out squashed to ~246px instead of its real ~335px). Freeze
      // every percentage-width element in the clone to the ORIGINAL
      // element's real measured pixel width, walking both trees in
      // parallel, so nothing in the capture depends on the new parent's
      // layout.
      const freezeWidths = (original: Element, cloned: Element) => {
        // getComputedStyle().width is always a resolved PIXEL value, even
        // when the source rule is a percentage — has to be the element's
        // own inline/specified style (what recharts' ResponsiveContainer
        // actually sets: style="width: 100%") to catch this at all.
        if (original instanceof HTMLElement && cloned instanceof HTMLElement
          && original.style.width.endsWith("%")) {
          cloned.style.width = `${original.offsetWidth}px`;
        }
        for (let i = 0; i < original.children.length; i++) {
          freezeWidths(original.children[i], cloned.children[i]);
        }
      };
      freezeWidths(node, clone);
      frame.appendChild(clone);
      stage.appendChild(frame);
      document.body.appendChild(stage);

      const { toSvg } = await import("html-to-image");
      const svgDataUrl = await toSvg(frame, {
        backgroundColor: "#FAF3E1", // --paper — canvas has no CSS var access of its own
        // html-to-image's default font-embedding step walks EVERY stylesheet
        // on the page (not just what the target subtree uses) and re-fetches
        // every @font-face src to inline as base64 — for this app's ~30
        // IBM Plex Mono weight/subset files that's slow, and can be
        // avoided entirely: the captured block only needs its own text
        // legible, not exact kerning, so a system-font fallback is the
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
      canvas.width = frame.offsetWidth * pixelRatio;
      canvas.height = frame.offsetHeight * pixelRatio;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas context");
      ctx.scale(pixelRatio, pixelRatio);
      ctx.drawImage(img, 0, 0, frame.offsetWidth, frame.offsetHeight);

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
      stage?.remove();
      cleanupCapture?.();
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="screenshot-btn"
        onClick={capture}
        disabled={busy}
        aria-label="Save as image"
        title="Save as image"
      >
        {busy ? "⏳" : "📷"}
      </button>
      {error && <span className="screenshot-error">{error}</span>}
      {previewUrl && (
        <div className="screenshot-overlay" onClick={closePreview}>
          <div className="screenshot-preview" onClick={(e) => e.stopPropagation()}>
            <p className="screenshot-hint">Long-press the image to save or share it</p>
            <img src={previewUrl} alt={`${filename} — captured`} />
            <button type="button" className="control" onClick={closePreview}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
