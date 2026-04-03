export const FILE_LINE_THRESHOLDS = {
  warning: 200,
  error: 400,
};

export const USE_STATE_THRESHOLDS = {
  warning: 8,
  error: 15,
};

export const USE_EFFECT_WARNING_THRESHOLD = 4;

export const COMPLEXITY_SCORE_THRESHOLDS = {
  warning: 300,
  error: 600,
};

export const COMPLEXITY_SCORE_WEIGHTS = {
  line: 0.5,
  useState: 10,
  useEffect: 15,
  handler: 8,
  import: 2,
};
