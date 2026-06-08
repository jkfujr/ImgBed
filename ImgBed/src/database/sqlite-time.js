function buildLocalDayStartUtcExpression(dayOffset = 0) {
  const offset = Number(dayOffset);
  if (!Number.isInteger(offset)) {
    throw new Error('本地自然日偏移必须是整数');
  }

  const modifiers = ["'localtime'", "'start of day'"];
  if (offset !== 0) {
    const sign = offset > 0 ? '+' : '';
    const unit = Math.abs(offset) === 1 ? 'day' : 'days';
    modifiers.push(`'${sign}${offset} ${unit}'`);
  }
  modifiers.push("'utc'");

  return `datetime('now', ${modifiers.join(', ')})`;
}

function buildLocalDayUtcRangeCondition(columnName, {
  startDayOffset = 0,
  endDayOffset = 1,
} = {}) {
  return `${columnName} >= ${buildLocalDayStartUtcExpression(startDayOffset)}
      AND ${columnName} < ${buildLocalDayStartUtcExpression(endDayOffset)}`;
}

export {
  buildLocalDayUtcRangeCondition,
};
