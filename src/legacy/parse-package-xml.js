function getTagValues(block, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
  const values = [];
  let match = null;
  while ((match = regex.exec(block)) != null) {
    values.push(match[1].trim());
  }
  return values;
}

function parsePackageXml(xml) {
  const map = new Map();
  const typesRegex = /<types>([\s\S]*?)<\/types>/g;
  let match = null;
  while ((match = typesRegex.exec(xml)) != null) {
    const block = match[1];
    const names = getTagValues(block, "name");
    if (names.length !== 1) {
      continue;
    }
    const metadataType = names[0];
    const members = getTagValues(block, "members");
    map.set(metadataType, members);
  }
  return map;
}

module.exports = {
  parsePackageXml,
};
