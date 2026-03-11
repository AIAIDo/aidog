import React from 'react';

function getGrade(score) {
  if (score >= 90) return { letter: 'A', label: 'Excellent', color: '#22c55e' };
  if (score >= 80) return { letter: 'B', label: 'Good', color: '#3b82f6' };
  if (score >= 70) return { letter: 'C', label: 'Fair', color: '#eab308' };
  if (score >= 60) return { letter: 'D', label: 'Poor', color: '#f97316' };
  return { letter: 'F', label: 'Critical', color: '#ef4444' };
}

function getTrendArrow(delta) {
  if (delta > 0) return { arrow: '\u2197', label: 'improving', color: 'text-green-400' };
  if (delta < 0) return { arrow: '\u2198', label: 'declining', color: 'text-red-400' };
  return { arrow: '\u2192', label: 'stable', color: 'text-slate-400' };
}

export default function HealthScoreGauge({ score = 0, delta = 0, size = 180 }) {
  const grade = getGrade(score);
  const trend = getTrendArrow(delta);

  const center = size / 2;
  const radius = (size - 20) / 2;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (score / 100) * circumference;
  const bgArcLength = circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#334155"
            strokeWidth={strokeWidth}
            strokeDasharray={bgArcLength}
            strokeLinecap="round"
          />
          {/* Score arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={grade.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference - arcLength}`}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
            style={{
              filter: `drop-shadow(0 0 6px ${grade.color}40)`,
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-mono font-bold leading-none"
            style={{ fontSize: size * 0.28, color: grade.color }}
          >
            {score}
          </span>
          <span className="text-slate-500 text-xs mt-1">/ 100</span>
        </div>
      </div>

      {/* Grade and trend */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <span
            className="font-mono font-bold text-xl"
            style={{ color: grade.color }}
          >
            {grade.letter}
          </span>
          <span className="text-slate-400 text-sm">{grade.label}</span>
        </div>
        <div className={`flex items-center gap-1 text-sm ${trend.color}`}>
          <span className="text-lg leading-none">{trend.arrow}</span>
          <span className="font-mono">
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
          <span className="text-slate-500 text-xs">({trend.label})</span>
        </div>
      </div>
    </div>
  );
}
