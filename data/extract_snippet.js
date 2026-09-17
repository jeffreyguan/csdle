/* Paste into the browser console on an HLTV per-year stats page.
   Copies JSON to clipboard. Save as data/raw/hltv_stats/<year>.json

   URL pattern:
   https://www.hltv.org/stats/players?startDate=YYYY-01-01&endDate=YYYY-12-31&minMapCount=20
*/
copy(JSON.stringify((() => {
  const p = new URLSearchParams(location.search);
  const year = (p.get('startDate') || '').slice(0, 4);

  // biggest table on the page = the stats table, regardless of class churn
  const t = [...document.querySelectorAll('table')]
    .sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!t) throw new Error('no table found');

  const head = [...(t.tHead || t).rows[0].cells].map(c => c.innerText.trim());

  const rows = [...t.tBodies[0].rows].map(r => {
    const o = {};
    [...r.cells].forEach((c, i) => { o[head[i] || `col${i}`] = c.innerText.trim(); });
    // stable identity: /stats/players/<id>/<nick>
    const m = [...r.querySelectorAll('a')]
      .map(a => a.getAttribute('href') || '')
      .map(h => h.match(/\/stats\/players\/(\d+)\//))
      .find(Boolean);
    o.playerId = m ? m[1] : null;
    return o;
  });

  return { year, minMapCount: p.get('minMapCount'), columns: head, count: rows.length, rows };
})(), null, 2));
console.log('copied to clipboard');
