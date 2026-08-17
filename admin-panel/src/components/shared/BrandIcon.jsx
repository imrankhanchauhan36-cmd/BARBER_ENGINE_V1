//////////////////////////////////////////////////////
// admin-panel/src/components/shared/BrandIcon.jsx
// Shared ZEMISH icon mark — the finalized logo asset (public/logo-mark.png),
// reused as-is across Splash, Login, and Sidebar. Do not redraw or
// recolor here; swap the source file instead if the brand mark changes.
//
// `size` sets the width; height is derived from the asset's true pixel
// aspect ratio (512×444) rather than forcing a square box, so the mark
// can never render stretched/squashed regardless of caller size.
//////////////////////////////////////////////////////

const ASPECT_RATIO = 512 / 444

export default function BrandIcon({ size = 52, style = {} }) {
  return (
    <img
      src="/logo-mark.png"
      alt="Zemish"
      width={size}
      height={size / ASPECT_RATIO}
      style={{ objectFit: 'contain', ...style }}
    />
  )
}
