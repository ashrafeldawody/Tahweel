export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0F766E" />
      <path
        d="M8 8h16a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 24 22h-8.5L10 26v-4H8a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 8 8z"
        fill="#ffffff"
      />
      <path d="M11.5 15h8m0 0-3-3m3 3-3 3" stroke="#0F766E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
