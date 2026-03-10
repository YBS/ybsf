const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const formatXml = require("xml-formatter");

function parseXml(xmlText) {
  return new DOMParser({
    errorHandler: {
      warning: () => {},
      error: () => {},
      fatalError: () => {},
    },
  }).parseFromString(String(xmlText || ""), "application/xml");
}

function elementName(node) {
  return node.localName || node.nodeName;
}

function getDirectChildElementsByName(parentElement, childName) {
  const out = [];
  for (let child = parentElement.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) {
      continue;
    }
    if (elementName(child) === childName) {
      out.push(child);
    }
  }
  return out;
}

function getFirstChildText(parentElement, childName) {
  const children = getDirectChildElementsByName(parentElement, childName);
  if (children.length === 0) {
    return "";
  }
  return String(children[0].textContent || "").trim();
}

function sortDirectChildElements(parentElement, childName, keyFn) {
  const children = getDirectChildElementsByName(parentElement, childName);
  if (children.length < 2) {
    return;
  }

  const allNodes = [];
  for (let node = parentElement.firstChild; node; node = node.nextSibling) {
    allNodes.push(node);
  }

  const firstIndex = allNodes.findIndex((node) => node.nodeType === 1 && elementName(node) === childName);
  const lastIndex = (() => {
    for (let i = allNodes.length - 1; i >= 0; i -= 1) {
      const node = allNodes[i];
      if (node.nodeType === 1 && elementName(node) === childName) {
        return i;
      }
    }
    return -1;
  })();

  if (firstIndex < 0 || lastIndex < firstIndex) {
    return;
  }

  const before = allNodes.slice(0, firstIndex);
  const region = allNodes.slice(firstIndex, lastIndex + 1);
  const after = allNodes.slice(lastIndex + 1);

  const sortedElements = children
    .slice()
    .sort((a, b) => String(keyFn(a)).localeCompare(String(keyFn(b))));

  const rebuiltRegion = [];
  let sortedIndex = 0;
  for (const node of region) {
    if (node.nodeType === 1 && elementName(node) === childName) {
      rebuiltRegion.push(sortedElements[sortedIndex]);
      sortedIndex += 1;
    } else {
      rebuiltRegion.push(node);
    }
  }

  const rebuilt = [...before, ...rebuiltRegion, ...after];
  for (const node of allNodes) {
    parentElement.removeChild(node);
  }
  for (const node of rebuilt) {
    parentElement.appendChild(node);
  }
}

function serializeXml(doc) {
  const xml = new XMLSerializer().serializeToString(doc);
  const formatted = formatXml(xml, {
    collapseContent: true,
    indentation: "    ",
    lineSeparator: "\n",
  });
  return `${formatted.trim()}\n`;
}

module.exports = {
  parseXml,
  elementName,
  getFirstChildText,
  sortDirectChildElements,
  serializeXml,
};
