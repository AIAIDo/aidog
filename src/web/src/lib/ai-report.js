function normalizeSeverity(value) {
  const severity = String(value || '').toLowerCase();
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  if (severity === 'low') return 'low';
  return 'low';
}

function normalizeSteps(issue) {
  const items = Array.isArray(issue?.actions)
    ? issue.actions
    : Array.isArray(issue?.recommendations)
      ? issue.recommendations
      : [];

  return items
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return null;

      const configText = typeof item.config === 'string'
        ? item.config
        : item.config?.content
          ? JSON.stringify(item.config.content, null, 2)
          : null;
      const baseText = item.description
        || item.detail
        || item.action
        || item.summary
        || configText;
      if (!baseText) return null;

      const savings = item.savingsEstimate || item.expectedSaving;
      return savings ? `${baseText} (${savings})` : baseText;
    })
    .filter(Boolean);
}

function deriveTitle(issue, t) {
  if (issue?.title) return issue.title;
  if (issue?.rule) return issue.rule;
  if (Array.isArray(issue?.rules) && issue.rules.length > 0) {
    return issue.rules.join(', ');
  }
  if (issue?.headline) return issue.headline;
  if (issue?.name) return issue.name;
  return t('optimizationOpportunity');
}

function deriveDescription(issue, t) {
  return issue?.rootCause
    || issue?.explanation
    || issue?.impact
    || issue?.description
    || issue?.summary
    || t('noDetailedExplanation');
}

function deriveCategory(issue) {
  if (issue?.rule) return issue.rule;
  if (Array.isArray(issue?.rules) && issue.rules.length > 0) {
    return issue.rules.join(', ');
  }
  if (issue?.category) return issue.category;
  return 'AI';
}

function deriveImpact(issue) {
  if (typeof issue?.estimatedWastedTokens === 'number') {
    return issue.estimatedWastedTokens;
  }
  if (typeof issue?.impact?.estimatedTokenSavings === 'number') {
    return issue.impact.estimatedTokenSavings;
  }
  if (typeof issue?.impactTokens === 'number') {
    return issue.impactTokens;
  }
  return 0;
}

export function normalizeReportToRecommendations(report, t) {
  const issues = Array.isArray(report?.issues) ? report.issues : [];

  return issues.map((issue, idx) => ({
    id: issue.id || `issue-${idx}`,
    title: deriveTitle(issue, t),
    description: deriveDescription(issue, t),
    priority: normalizeSeverity(issue.severity),
    impact: deriveImpact(issue),
    category: deriveCategory(issue),
    steps: normalizeSteps(issue),
  }));
}
