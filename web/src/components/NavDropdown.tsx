import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";

interface DropdownItem {
  to: string;
  label: string;
  end?: boolean;
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
 * page. */
export default function NavDropdown({ label, items }: { label: string; items: DropdownItem[] }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const active = items.some((i) => location.pathname === i.to
    || (!i.end && location.pathname.startsWith(`${i.to}/`)));

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom + 10, left: rect.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => setOpen(false);
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

  useEffect(() => setOpen(false), [location.pathname]);

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
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              role="menuitem"
              className={({ isActive }) => (isActive ? "nav-dropdown-item active" : "nav-dropdown-item")}
            >
              {i.label}
            </NavLink>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
