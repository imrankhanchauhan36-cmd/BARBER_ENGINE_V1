//////////////////////////////////////////////////////
// admin-panel/src/components/shared/BrandIcon.jsx
// Shared ZEMISH icon mark — the finalized logo asset (public/logo-mark.png),
// reused as-is across Splash, Login, and Sidebar. Do not redraw or
// recolor here; swap the source file instead if the brand mark changes.
//////////////////////////////////////////////////////

export default function BrandIcon({ size = 52, style = {} }) {
  return (
    <img
      src="/logo-mark.png"
      alt="Zemish"
      width={size}
      height={size}
      style={{ objectFit: 'contain', ...style }}
    />
  )
}
