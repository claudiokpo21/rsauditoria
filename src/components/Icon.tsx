/** Iconos de trazo (24×24) usados en el menú y la barra inferior del celular. */
const P: Record<string, string> = {
  panel: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  plan: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M8 14h4M8 17h7',
  audits: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 13l2 2 4-4',
  findings: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
  actions: 'M4 6h16M4 12h10M4 18h7M16 17l2 2 4-4',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  reports: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  templates: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3',
  companies: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6',
  users: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.6-4.8-4-5.6',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2',
  sync: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8',
  home: 'M4 11 12 4l8 7v9H4z',
  more: 'M4 7h16M4 12h16M4 17h16',
};
export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name] ?? P.panel} />
    </svg>
  );
}
