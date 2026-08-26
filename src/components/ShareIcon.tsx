// The familiar "share" glyph — a box with an arrow coming out the top. Colors
// follow currentColor so CSS drives it.
export default function ShareIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* arrow shaft + head, pointing up */}
      <path d="M12 15V4" />
      <path d="M8.5 7.5L12 4l3.5 3.5" />
      {/* the open-topped box */}
      <path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}
