function parseListMetadataJson(rawJson) {
  const parsed = JSON.parse(rawJson);
  const result = parsed.result;
  const rows = Array.isArray(result)
    ? result
    : Array.isArray(result?.metadataObjects)
      ? result.metadataObjects
      : [];
  const names = [];
  for (const row of rows) {
    const fullName = row?.fullName || row?.FullName || row?.fileName || row?.FileName;
    if (typeof fullName === "string" && fullName.trim().length > 0) {
      names.push(fullName.trim());
    }
  }
  return names;
}

module.exports = {
  parseListMetadataJson,
};
