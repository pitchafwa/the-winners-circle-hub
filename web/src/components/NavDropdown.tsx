import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";

export interface DropdownLink {
  to: string;
  label: string;
  end?: boolean;
}

/** A submenu that opens as its own flyout to the RIGHT of its trigger row
 * (not below the parent menu) — for grouping several related tools under
 * one label without flattening them all into one long list. */
export interface DropdownGroup {
  label: string;
  children: DropdownLink[];
}

export type DropdownEntry = DropdownLink | DropdownGroup;

function isGroup(item: DropdownEntry): item is DropdownGroup {
  return "children" in item;
}

/** Hand-rolled nav dropdown — the project has no UI-primitive dependency
 * (no Radix/shadcn), so this stays a plain useState + click-outside-close
 * rather than pulling one in for a single menu.
 *
 * The menu portals to document.body and positions itself with `fixed`
 * coordinates read off the trigger button. It can't just be an absolutely
 * positioned child of the button (the obvious approach) because `.mainnav`
 * — the trigger's actual parent — has `overflow-x: auto` for the mobile
 * horizontal-scroll nav, and overflow-x:auto also clips the y axis, which
 * cut the menu off under the header instead of letting it drop over the
 * page.
 *
 * A `DropdownGroup` entry renders as its own row with a second, independent
 * portal — positioned off THAT row's rect (right edge, not the top-level
 * button's), so it opens as a flyout beside the row rather than another
 * menu stacked below the first. */
export default function NavDropdown({ label, items }: { label: string; items: DropdownEntry[] }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [groupCoords, setGroupCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const groupRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const location = useLocation();
  const allLinks = items.flatMap((i) => (isGroup(i) ? i.children : [i]));
  const active = allLinks.some((i) => location.pathname === i.to
    || (!i.end && location.pathname.startsWith(`${i.to}/`)));

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom + 10, left: rect.left });
    setOpen(true);
  };

  const toggleGroup = (groupLabel: string) => {
    if (openGroup === groupLabel) {
      setOpenGroup(null);
      return;
    }
    const rect = groupRowRefs.current.get(groupLabel)?.getBoundingClientRect();
    if (rect) setGroupCoords({ top: rect.top, left: rect.right + 6 });
    setOpenGroup(groupLabel);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)
          || groupMenuRef.current?.contains(target)) return;
      setOpen(false);
      setOpenGroup(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setOpenGroup(null); }
    };
    const onScroll = () => { setOpen(false); setOpenGroup(null); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => { setOpen(false); setOpenGroup(null); }, [location.pathname]);

  const openGroupEntry = openGroup ? items.find((i) => isGroup(i) && i.label === openGroup) as DropdownGroup | undefined : undefined;

  return (
    <div className="nav-dropdown">
      <button
        ref={buttonRef}
        type="button"
        className={active ? "navlink active" : "navlink"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {label} ▾
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="nav-dropdown-menu"
          role="menu"
          style={{ position: "fixed", top: coords.top, left: coords.left }}
        >
          {items.map((item) =>
            isGroup(item) ? (
              <button
                key={item.label}
                type="button"
                ref={(el) => { if (el) groupRowRefs.current.set(item.label, el); else groupRowRefs.current.delete(item.label); }}
                className={`nav-dropdown-item nav-dropdown-group-trigger${openGroup === item.label ? " active" : ""}`}
                aria-haspopup="true"
                aria-expanded={openGroup === item.label}
                onClick={() => toggleGroup(item.label)}
              >
                <span>{item.label}</span>
                <span aria-hidden="true">▸</span>
              </button>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                role="menuitem"
                className={({ isActive }) => (isActive ? "nav-dropdown-item active" : "nav-dropdown-item")}
              >
                {item.label}
              </NavLink>
            ),
          )}
        </div>,
        document.body,
      )}
      {open && openGroupEntry && createPortal(
        <div
          ref={groupMenuRef}
          className="nav-dropdown-menu"
          role="menu"
          style={{ position: "fixed", top: groupCoords.top, left: groupCoords.left }}
        >
          {openGroupEntry.children.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              end={c.end}
              role="menuitem"
              className={({ isActive }) => (isActive ? "nav-dropdown-item active" : "nav-dropdown-item")}
            >
              {c.label}
            </NavLink>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
