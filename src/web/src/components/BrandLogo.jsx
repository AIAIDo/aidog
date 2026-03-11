import React from 'react';

export function BrandMark({ className = 'w-8 h-8', title = 'AIDog logo' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      shapeRendering="crispEdges"
    >
      {/* Ears */}
      <rect x="4" y="3" width="4" height="5" fill="#D97757" />
      <rect x="16" y="3" width="4" height="5" fill="#D97757" />
      <rect x="5" y="4" width="2" height="2" fill="#E8A87C" />
      <rect x="17" y="4" width="2" height="2" fill="#E8A87C" />

      {/* Head */}
      <rect x="3" y="7" width="18" height="14" rx="1" fill="#D97757" />

      {/* Face */}
      <rect x="5" y="10" width="14" height="9" fill="#FAE8DE" />

      {/* Eyes */}
      <rect x="7" y="12" width="2" height="2" fill="#2D1B14" />
      <rect x="15" y="12" width="2" height="2" fill="#2D1B14" />
      {/* Cyan eye glint */}
      <rect x="7" y="12" width="1" height="1" fill="#67E8F9" />
      <rect x="15" y="12" width="1" height="1" fill="#67E8F9" />

      {/* Nose */}
      <rect x="11" y="15" width="2" height="2" fill="#2D1B14" />

      {/* Blush */}
      <rect x="4" y="14" width="2" height="2" fill="#E8A87C" />
      <rect x="18" y="14" width="2" height="2" fill="#E8A87C" />
    </svg>
  );
}

export default BrandMark;
