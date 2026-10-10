/* Eurocross İkame Filo - Hesap motoru (tarayıcıda ve Node'da çalışır) */
(function (root) {
    const SEGMENTS = ['B', 'C', 'C+', 'D', 'D+', 'E'];
    const FUELS = ['Benzin', 'Dizel', 'Elektrik'];
    const DEFAULT_HEADERS = ['Optimum Satış Yılı', 'Optimum Satış KM', '100 KM Yakıt Tüketimi (Litre)'];
    const DAY = 86400000;
    const YEAR_DAYS = 365;

    /* ---------- Tarih / dosya okuma ---------- */
    function parseDate(v) {
        if (v === null || v === undefined || v === '') return null;
        if (v instanceof Date) return isNaN(v) ? null : v.getTime();
        if (typeof v === 'number') { // Excel seri numarası
            const u = new Date(Math.round((v - 25569) * DAY / 60000) * 60000);
            return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes()).getTime();
        }
        const s = String(v).trim();
        let m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
        if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
        m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
        const t = Date.parse(s);
        return isNaN(t) ? null : t;
    }
    function formatDate(ms) {
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    function normSegment(s) {
        return String(s === undefined || s === null ? '' : s).trim().toUpperCase().replace(/\s*SEGMENT.*$/, '').replace(/\s+/g, '');
    }
    function parseCSV(text) {
        text = text.replace(/^﻿/, '');
        const first = text.split(/\r?\n/)[0] || '';
        const delim = [';', '\t', ','].reduce((a, d) => (first.split(d).length > first.split(a).length ? d : a), ',');
        const rows = []; let row = [], cur = '', q = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (q) {
                if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
            } else if (c === '"') q = true;
            else if (c === delim) { row.push(cur); cur = ''; }
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && text[i + 1] === '\n') i++;
                row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = [];
            } else cur += c;
        }
        row.push(cur); if (row.some(x => x !== '')) rows.push(row);
        return rows;
    }
    /* rows: [[no, segment, teslimat, iade], ...] -> {records, bad} */
    function rowsToRecords(rows) {
        const records = []; let bad = 0;
        rows.forEach(r => {
            const s = parseDate(r[2]), e = parseDate(r[3]), seg = normSegment(r[1]);
            if (!seg || s === null || e === null || e < s) { bad++; return; }
            records.push({ dosyaNo: String(r[0] === undefined ? '' : r[0]).trim(), segment: seg, teslimat: formatDate(s), iade: formatDate(e) });
        });
        return { records, bad };
    }
    /* Tabloda eksik olan zorunlu sütun başlıklarını döndürür */
    function missingHeaders(table) {
        const head = (table[0] || []).map(x => String(x === undefined ? '' : x).toLocaleLowerCase('tr-TR'));
        return [['Dosya Numarası', /dosya/], ['Segment', /segment/], ['Araç Teslimat Tarihi', /teslim/], ['Araç İade Tarihi', /iade/]]
            .filter(([, re]) => !head.some(h => re.test(h))).map(([n]) => n);
    }
    /* Başlık satırı olan tablo (dizi dizisi) -> 4 kolonlu satırlar */
    function tableToRows(table) {
        if (!table.length) return [];
        const low = x => String(x === undefined ? '' : x).toLocaleLowerCase('tr-TR');
        const head = table[0].map(low);
        const find = re => head.findIndex(h => re.test(h));
        let idx = [find(/dosya/), find(/segment/), find(/teslim/), find(/iade/)];
        let body = table.slice(1);
        if (idx.some(i => i < 0)) { // başlık yoksa sırayla 4 kolon varsay
            idx = [0, 1, 2, 3];
            if (parseDate(table[0][2]) !== null) body = table;
        }
        return body.map(r => idx.map(i => r[i]));
    }

    /* ---------- Maliyet ---------- */
    function sortedYears(settings) { return [...settings.enflasyonYillari].map(Number).sort((a, b) => a - b); }
    function inflationFactors(years, infl) {
        const f = {}; let cur = 1;
        years.forEach((y, i) => { if (i > 0) cur *= 1 + (+infl[y] || 0) / 100; f[y] = cur; });
        return f;
    }
    function num(x) { const n = Number(x); return isNaN(n) ? 0 : n; }
    /* Bir araç için yıl bazlı gider tablosu. Baz yıl (en düşük yıl) = girilen tutar. */
    function costTable(v, settings) {
        const years = sortedYears(settings), k = inflationFactors(years, settings.enflasyonOranlari || {});
        const g = v.giderler || {};
        const opt = Math.max(1, Math.floor(num(g[DEFAULT_HEADERS[0]])) || 1);
        const life = years.slice(0, opt);
        const rows = [];
        (settings.giderTanimlari || []).forEach(h => {
            const base = num(g[h.ad]), vals = {};
            life.forEach(y => { vals[y] = base * k[y]; });
            rows.push({ kalem: h.ad, kategori: h.kategori || 'Diğer', vals });
        });
        const km = num(g[DEFAULT_HEADERS[1]]) / opt, l = num(g[DEFAULT_HEADERS[2]]), prices = (settings.yakitFiyatlari || {})[v.yakitTuru] || {};
        const fv = {};
        life.forEach(y => { fv[y] = (km / 100) * l * num(prices[y]); });
        rows.push({ kalem: `${v.yakitTuru === 'Elektrik' ? 'Enerji' : 'Yakıt'} Gideri (${v.yakitTuru})`, kategori: 'Yakıt', vals: fv });
        const totals = {}; let total = 0;
        life.forEach(y => { totals[y] = rows.reduce((s, r) => s + r.vals[y], 0); total += totals[y]; });
        return { opt, life, rows, totals, total };
    }
    /* Zorunlu alanlar: marka model + optimum satış yılı + optimum satış km + 100 km yakıt tüketimi */
    function isVehicleComplete(v) {
        const g = v.giderler || {};
        return !!v.markaModel && DEFAULT_HEADERS.every(n => g[n] !== null && g[n] !== undefined && g[n] !== '');
    }

    /* ---------- Simülasyon ---------- */
    /* Kural: tam 24 saatlik günler sayılır; kalan süre 3 saatten fazlaysa +1 gün (en az 1 gün). */
    function rentDays(s, e) {
        const ms = Math.max(0, e - s), full = Math.floor(ms / DAY), rem = ms - full * DAY;
        return Math.max(1, full + (rem > 3 * 3600000 ? 1 : 0));
    }
    function plateFor(vIndex, n) {
        const a = String.fromCharCode(65 + (Math.floor(vIndex / 26) % 26)), b = String.fromCharCode(65 + (vIndex % 26));
        return `34 ${a}${b} ${100 + n + 1}`;
    }
    /* files: [{no, seg, s, e}], units: [{id, seg}], cutHour: 0-23 */
    function simulate(files, units, cutHour) {
        const pools = {}, byUnit = {};
        units.forEach(u => {
            const st = { id: u.id, freeAt: -Infinity, days: 0, files: 0, mDays: Array(12).fill(0), mFiles: Array(12).fill(0) };
            byUnit[u.id] = st; (pools[u.seg] = pools[u.seg] || []).push(st);
        });
        const sorted = files.slice().sort((a, b) => a.s - b.s || a.e - b.e);
        const segStats = {};
        const stat = seg => segStats[seg] || (segStats[seg] = { total: 0, handled: 0, days: 0, m: Array.from({ length: 12 }, () => ({ total: 0, handled: 0, days: 0 })) });
        let minS = Infinity, maxE = -Infinity;
        sorted.forEach(f => {
            if (f.s < minS) minS = f.s; if (f.e > maxE) maxE = f.e;
            const ss = stat(f.seg), mi = new Date(f.s).getMonth(); ss.total++; ss.m[mi].total++;
            const pool = pools[f.seg]; let best = null;
            // İlk uygun (boşta) araca verilir.
            if (pool) for (const st of pool) if (st.freeAt <= f.s) { best = st; break; }
            if (!best) return;
            const rd = rentDays(f.s, f.e); ss.handled++; ss.days += rd; ss.m[mi].handled++; ss.m[mi].days += rd; best.files++; best.days += rd; best.mDays[mi] += rd; best.mFiles[mi]++;
            const end = new Date(f.e);
            // Kural: iade saati >= sınır ise araç o gün yeni dosya alamaz, ertesi gün 00:00'da boşa çıkar.
            best.freeAt = end.getHours() >= cutHour ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime() : f.e;
        });
        const spanDays = sorted.length ? Math.max(1, (maxE - minS) / DAY) : 0;
        return { byUnit, segStats, spanDays, totalFiles: sorted.length, dataYear: sorted.length ? new Date(minS).getFullYear() : null };
    }

    /* Personel giderleri: kişi başı yıllık tutar x personel sayısı, enflasyonla artar (filo geneli sabit gider) */
    function personnelTable(settings, years) {
        const k = inflationFactors(years, settings.enflasyonOranlari || {});
        const count = Math.max(0, num(settings.personelSayisi));
        const rows = (settings.personelTanimlari || []).map(h => {
            const vals = {}; years.forEach(y => { vals[y] = num(h.tutar) * count * k[y]; });
            return { kalem: h.ad, kategori: h.kategori || 'Diğer', vals };
        });
        const totals = {}; years.forEach(y => { totals[y] = rows.reduce((a, r) => a + r.vals[y], 0); });
        return { count, rows, totals };
    }

    function buildReport({ vehicles, files, settings, cutHour }) {
        const years = sortedYears(settings);
        const vehicleCosts = {}, units = [];
        vehicles.forEach((v, vi) => {
            vehicleCosts[v.id] = costTable(v, settings);
            for (let n = 0; n < (v.count || 0); n++) units.push({ id: v.id + ':' + n, plate: plateFor(vi, n), seg: v.segment, v });
        });
        const sim = simulate(files, units, cutHour);
        // Tarihçe 1 yıllıksa (≥355 gün) dönem 365 gün; kısaysa gerçek süre. Gerçek veri oranlanmaz; yalnızca 370 günden uzun veri yıllık ortalamaya çevrilir.
        const span = sim.spanDays, period = span >= 355 ? YEAR_DAYS : Math.max(1, Math.round(span));
        const scale = span > 370 ? YEAR_DAYS / span : 1;
        const rate = (seg, y) => num(((settings.gunlukTutar || {})[seg] || {})[y]);
        const missingRates = new Set(), unsold = new Set();
        const plates = units.map(u => {
            const st = sim.byUnit[u.id], ct = vehicleCosts[u.v.id];
            const work = Math.min(period, Math.round(st.days * scale)), idle = period - work;
            const byYear = {}, soldYear = ct.life.length === ct.opt ? ct.life[ct.life.length - 1] : null;
            if (soldYear === null) unsold.add(u.v.markaModel);
            ct.life.forEach(y => {
                const r = rate(u.seg, y); if (!r) missingRates.add(`${u.seg} / ${y}`);
                const revenue = work * r, sale = y === soldYear ? num(u.v.satisTutari) : 0, cost = ct.totals[y];
                byYear[y] = { work, idle, rate: r, revenue, sale, cost, pers: 0, persShare: 0, net: revenue + sale - cost };
            });
            const months = st.mDays.map((d, i) => ({ work: Math.round(d * scale), files: st.mFiles[i] * scale }));
            return { id: u.id, plate: u.plate, seg: u.seg, vid: u.v.id, model: u.v.markaModel, life: ct.life, work, idle, files: st.files * scale, months, byYear };
        });
        // Personel gideri: filo geneli sabit gider; o yıl aktif araçlara, aldıkları dosya sayısı oranında dağıtılır
        const pers = personnelTable(settings, years);
        years.forEach(y => {
            const act = plates.filter(p => p.byYear[y]);
            if (!act.length || !pers.totals[y]) return;
            const totF = act.reduce((a, p) => a + p.files, 0);
            act.forEach(p => {
                const share = totF > 0 ? p.files / totF : 1 / act.length, r = p.byYear[y];
                r.persShare = share; r.pers = pers.totals[y] * share; r.net -= r.pers;
            });
        });
        return { years, plates, vehicleCosts, pers, sim, missingRates: [...missingRates], unsold: [...unsold], period, dataYear: sim.dataYear };
    }

    const api = { SEGMENTS, FUELS, DEFAULT_HEADERS, parseDate, formatDate, normSegment, parseCSV, rowsToRecords, tableToRows, missingHeaders,
        sortedYears, inflationFactors, costTable, personnelTable, isVehicleComplete, simulate, buildReport, rentDays };
    if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
