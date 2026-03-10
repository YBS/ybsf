function normalizeActivityFieldName(fullFieldName) {
  const text = String(fullFieldName || "").trim();
  if (!text.includes(".")) {
    return text;
  }
  if (text.startsWith("Event.") || text.startsWith("Task.")) {
    const fieldName = text.split(".", 2)[1];
    return `Activity.${fieldName}`;
  }
  return text;
}

module.exports = {
  normalizeActivityFieldName,
};
