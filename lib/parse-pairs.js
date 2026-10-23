// "US|United States,CA|Canada" -> [{id, name}]
// Split only on commas that start a new "id|" token, so names may contain commas ("Tyler, the Creator").
// Input with no "|" at all (bare codes like "US,CA") splits on every comma, as before.
export function parsePairs(s) {
  const str = String(s || '');
  const parts = str.includes('|') ? str.split(/,(?=\s*[A-Za-z0-9]+\|)/) : str.split(',');
  return parts.map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf('|');
    return i < 0 ? { id: x, name: x } : { id: x.slice(0, i).trim(), name: x.slice(i + 1).trim() };
  }).filter((x) => x.id);
}
