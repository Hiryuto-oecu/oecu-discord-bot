function truncate(text, maxLength) {
  const value = text || '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

module.exports = { truncate };
