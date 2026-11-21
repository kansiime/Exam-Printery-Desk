// Small line icons (24×24, stroke = currentColor) so the app needs no icon library.
const paths: Record<string, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-6h4v6" /></>,
  shield: <><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  printer: <><path d="M7 8V3h10v5" /><rect x="3" y="8" width="18" height="9" rx="2" /><path d="M7 14h10v7H7z" /></>,
  box: <><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  school: <><path d="m2 9 10-5 10 5-10 5L2 9Z" /><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" /></>,
  coins: <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3.1 2.6 3.5 5.2" /></>,
  route: <><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  chevron: <><path d="m6 9 6 6 6-6" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5 5h14l2 8v6H3v-6l2-8Z" /></>,
  check: <><path d="m5 12 4.5 4.5L19 7" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.2-6.5 8-6.5s7 2.5 8 6.5" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7h-4M14 18v3" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5L6 16Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  volume: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  mute: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="m17 9 5 6M22 9l-5 6" /></>,
  alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17.5v.5" /></>,
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? paths.box}
    </svg>
  );
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="6" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="M11 1v20M1 11h20" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}
