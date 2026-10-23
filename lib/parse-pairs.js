// "US|United States,CA|Canada" -> [{id, name}]
// Split only on commas that start a new "id|" token, so names may contain commas ("Tyler, the Creator").
export function parsePairs(s) {
  return String(s || '').split(/,(?=\s*[A-Za-z0-9]+\|)/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf('|');
    return i < 0 ? { id: x, name: x } : { id: x.slice(0, i).trim(), name: x.slice(i + 1).trim() };
  }).filter((x) => x.id);
}
