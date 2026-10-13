/* Eurocross İkame Filo - Hesap motoru (tarayıcıda ve Node'da çalışır) */
(function (root) {
    const SEGMENTS = ['B', 'C', 'C+', 'D', 'D+', 'E', 'E+'];
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
    /* Müşteri adı: baştaki/sondaki boşluklar atılır, aradaki çoklu boşluk teke iner */
    function normCustomer(s) {
        return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
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
    /* rows: [[no, segment, teslimat, iade, müşteri], ...] -> {records, bad}
       Aynı müşteri farklı yazılmışsa (büyük/küçük harf, fazla boşluk) ilk görülen yazılışla tek müşteri olarak kaydedilir. */
    function rowsToRecords(rows) {
        const records = [], canon = new Map(); let bad = 0;
        rows.forEach(r => {
            const s = parseDate(r[2]), e = parseDate(r[3]), seg = normSegment(r[1]);
            if (!seg || s === null || e === null || e < s) { bad++; return; }
            const rec = { dosyaNo: String(r[0] === undefined ? '' : r[0]).trim(), segment: seg, teslimat: formatDate(s), iade: formatDate(e) };
            const c = normCustomer(r[4]);
            if (c) { const k = c.toLocaleUpperCase('tr-TR'); if (!canon.has(k)) canon.set(k, c); rec.musteri = canon.get(k); }
            records.push(rec);
        });
        return { records, bad };
    }
    /* Tabloda eksik olan zorunlu sütun başlıklarını döndürür */
    function missingHeaders(table) {
        const head = (table[0] || []).map(x => String(x === undefined ? '' : x).toLocaleLowerCase('tr-TR'));
        return [['Dosya Numarası', /dosya/], ['Segment', /segment/], ['Araç Teslimat Tarihi', /teslim/], ['Araç İade Tarihi', /iade/]]
            .filter(([, re]) => !head.some(h => re.test(h))).map(([n]) => n);
    }
    const CUSTOMER_RE = /m[üu][şs]ter[iı]|customer|firma/;
    /* Tabloda Müşteri sütunu var mı (isteğe bağlı sütun) */
    function hasCustomerColumn(table) {
        const head = (table[0] || []).map(x => String(x === undefined ? '' : x).toLocaleLowerCase('tr-TR'));
        return head.some(h => CUSTOMER_RE.test(h));
    }
    /* Başlık satırı olan tablo (dizi dizisi) -> 5 kolonlu satırlar (no, segment, teslimat, iade, müşteri) */
    function tableToRows(table) {
        if (!table.length) return [];
        const low = x => String(x === undefined ? '' : x).toLocaleLowerCase('tr-TR');
        const head = table[0].map(low);
        const find = re => head.findIndex(h => re.test(h));
        let idx = [find(/dosya/), find(/segment/), find(/teslim/), find(/iade/), find(CUSTOMER_RE)];
        let body = table.slice(1);
        if (idx.slice(0, 4).some(i => i < 0)) { // başlık yoksa sırayla kolon varsay (5. kolon müşteri)
            idx = [0, 1, 2, 3, 4];
            if (parseDate(table[0][2]) !== null) body = table;
        }
        return body.map(r => idx.map(i => (i < 0 ? '' : r[i])));
    }

    /* ---------- Günlük tutarlar ----------
       Tutarlar yalnızca müşteri bazında girilir (varsayılan tutar yoktur); girilmeyen hücre 0 sayılır.
       Müşterisi belirtilmemiş dosyalar NONE_KEY anahtarıyla ayrı bir "müşteri" olarak fiyatlanır.
       settings.musteriTutar = { 'Müşteri Adı': { gunluk: {seg: {yıl: tutar}}, tedarikci: {seg: {yıl: tutar}} } } */
    const NONE_KEY = '__musterisiz__';
    function makeRates(settings) {
        const mt = (settings && settings.musteriTutar) || {};
        const cache = new Map();
        const cell = (kind, c, sg, y) => { const o = mt[c || NONE_KEY]; return o && o[kind] && o[kind][sg] ? o[kind][sg][y] : null; };
        const pick = (kind, c, sg, y) => {
            const k = kind + '\t' + c + '\t' + sg + '\t' + y;
            let v = cache.get(k);
            if (v === undefined) { const t = cell(kind, c, sg, y); v = filled(t) ? num(t) : 0; cache.set(k, v); }
            return v;
        };
        // Tedarikçi hesabı kullanılmıyor: yalnızca kendi filomuzla karşılanan dosyalar hesaplanır (tedarikçi tutarı her zaman 0)
        return { rate: (c, sg, y) => pick('gunluk', c || '', sg, y), sup: () => 0,
            own: (c, sg, y) => filled(cell('gunluk', c, sg, y)), ownSup: () => false };
    }
    const KEY_SEP = '\t';
    const priceKey = (sg, c) => sg + KEY_SEP + (c || '');
    const splitKey = k => { const i = k.indexOf(KEY_SEP); return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 1)]; };

    /* ---------- Maliyet ---------- */
    function sortedYears(settings) { return [...settings.enflasyonYillari].map(Number).sort((a, b) => a - b); }
    function inflationFactors(years, infl) {
        const f = {}; let cur = 1;
        years.forEach((y, i) => { if (i > 0) cur *= 1 + (+infl[y] || 0) / 100; f[y] = cur; });
        return f;
    }
    function num(x) { const n = Number(x); return isNaN(n) ? 0 : n; }
    const filled = x => x !== null && x !== undefined && x !== '';

    /* Kredi: eşit taksitli (anüite) ödeme planı. faiz = yıllık %, aylık oran = yıllık / 12 */
    function loanSchedule(P, months, annualRate) {
        P = num(P); const n = Math.max(0, Math.floor(num(months))), r = num(annualRate) / 100 / 12;
        if (!n || !P) return { payment: 0, n: 0, totalInterest: 0, total: P, months: [] };
        const pay = r ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
        let bal = P; const list = [];
        for (let i = 0; i < n; i++) {
            const it = bal * r; let pr = pay - it; if (i === n - 1) pr = bal;
            bal -= pr; list.push({ principal: pr, interest: it });
        }
        const totalInterest = list.reduce((a, m) => a + m.interest, 0);
        return { payment: pay, n, totalInterest, total: P + totalInterest, months: list };
    }

    /* Gider başlığı tipleri. "n" olan tiplerde araç formunda ikinci bir sayı (adet / km aralığı) girilir. */
    const COST_TYPES = {
        yillik: { ad: 'Yıllık tutar', tutar: 'Yıllık tutar (₺)' },
        km: { ad: 'Km bazlı (bakım gibi)', tutar: 'İşlem başı tutar (₺)', n: 'Kaç km\'de bir' },
        omur: { ad: 'Ömür boyu adet (lastik gibi)', tutar: 'Değişim başı tutar (₺)', n: 'Ömür boyunca kaç kez' },
        yillikAdet: { ad: 'Yılda adet × birim fiyat (temizlik gibi)', tutar: 'Birim tutar (₺)', n: 'Yılda kaç kez' },
        tek: { ad: 'Tek seferlik (sabit gider)', tutar: 'Tek seferlik tutar (₺)' },
        yakit: { ad: 'Yakıt km', tutar: 'Yıllık km' }
    };
    const costType = h => (h && COST_TYPES[h.tip] ? h.tip : (h && h.yakitKm ? 'yakit' : 'yillik'));
    const fmtN = x => Number(x).toLocaleString('tr-TR', { maximumFractionDigits: 2 });

    /* Bir araç için yıl bazlı gider tablosu. Baz yıl (en düşük yıl) girilen tutardır, sonraki yıllar enflasyonla artar.
       - yillik: tutar × enflasyon katsayısı
       - km: işlem sayısı = optimum satış km ÷ kaç km'de bir (aşağı yuvarlanır); yıllık = işlem sayısı ÷ optimum satış yılı × tutar × enflasyon
       - omur: n değişim ömre eşit aralıkla yayılır; 1. değişim ilk yıl, i. değişim (i-1) × (optimum yıl ÷ n). yılda, o yılın fiyatıyla
       - yillikAdet: yılda adet × birim tutar × enflasyon
       - tek: yalnızca ilk kullanım yılında, enflasyonsuz
       - yakit: yıllık km ÷ 100 × 100 km tüketim × o yılın yakıt fiyatı
       - Alış: peşin ise ilk yıl; kredili ise anapara ve faiz ödendiği yıllara ayrı kalem olarak yazılır.
         Kredi araç ömründen uzunsa kalan anapara satış yılında kapatılır (kalan faiz doğmaz). */
    function costTable(v, settings) {
        const years = sortedYears(settings), k = inflationFactors(years, settings.enflasyonOranlari || {});
        const g = v.giderler || {}, ga = v.giderAdet || {};
        const opt = Math.max(1, Math.floor(num(g[DEFAULT_HEADERS[0]])) || 1), optKm = num(g[DEFAULT_HEADERS[1]]);
        const life = years.slice(0, opt);
        const rows = [];
        const lt = num(g[DEFAULT_HEADERS[2]]), prices = (settings.yakitFiyatlari || {})[v.yakitTuru] || {};
        const fuelName = v.yakitTuru === 'Elektrik' ? 'Enerji Gideri' : 'Yakıt Gideri';
        (settings.giderTanimlari || []).forEach(h => {
            const base = num(g[h.ad]), n = num(ga[h.ad]), vals = {}, tip = costType(h);
            life.forEach(y => { vals[y] = 0; });
            let kalem = h.ad, kategori = h.kategori || 'Diğer', aciklama = '';
            if (tip === 'yakit') {
                life.forEach(y => { vals[y] = (base / 100) * lt * num(prices[y]); });
                kalem = `${fuelName} (${h.ad})`; kategori = 'Yakıt';
                aciklama = `${fmtN(base)} km/yıl ÷ 100 × ${fmtN(lt)} L × yakıt fiyatı`;
            } else if (tip === 'km') {
                const cnt = n > 0 ? Math.floor(optKm / n) : 0, perYear = cnt / opt;
                life.forEach(y => { vals[y] = perYear * base * k[y]; });
                aciklama = `${fmtN(optKm)} km ÷ ${fmtN(n)} km = ${cnt} işlem ÷ ${opt} yıl = ${fmtN(perYear)}/yıl × ₺${fmtN(base)}`;
            } else if (tip === 'omur') {
                const cnt = Math.max(0, Math.floor(n)), step = cnt ? opt / cnt : 0;
                for (let i = 0; i < cnt; i++) {
                    const yi = Math.floor(i * step + 1e-9);
                    if (yi < life.length) vals[life[yi]] += base * k[life[yi]];
                }
                aciklama = cnt ? `${cnt} değişim, ${fmtN(step)} yılda bir (1. değişim ilk yıl) × o yılın fiyatı` : 'değişim yok';
            } else if (tip === 'yillikAdet') {
                life.forEach(y => { vals[y] = n * base * k[y]; });
                aciklama = `yılda ${fmtN(n)} × ₺${fmtN(base)} (birim fiyat enflasyonla artar)`;
            } else if (tip === 'tek') {
                if (life.length) vals[life[0]] = base;
                aciklama = 'tek seferlik, ilk yıl';
            } else {
                life.forEach(y => { vals[y] = base * k[y]; });
            }
            rows.push({ kalem, kategori, grup: 'isletme', tip, aciklama, vals });
        });
        const P = num(v.alisBedeli), buy = {}, intr = {};
        life.forEach(y => { buy[y] = 0; intr[y] = 0; });
        const credit = !!(v.kredili && num(v.vade) > 0 && P > 0);
        const loan = credit ? loanSchedule(P, v.vade, v.faiz) : loanSchedule(0, 0, 0);
        if (life.length) {
            if (credit) {
                loan.months.forEach((m, i) => {
                    const yi = Math.floor(i / 12);
                    if (yi < life.length) { buy[life[yi]] += m.principal; intr[life[yi]] += m.interest; }
                    else buy[life[life.length - 1]] += m.principal; // erken kapama
                });
            } else buy[life[0]] = P;
        }
        rows.push({ kalem: 'Araç Alış Bedeli' + (credit ? ' (kredi anapara)' : ''), kategori: 'Araç Alışı', grup: 'alis', vals: buy });
        if (credit) rows.push({ kalem: 'Kredi Faizi', kategori: 'Finansman (Faiz)', grup: 'faiz', vals: intr });
        const sumG = (gr, y) => rows.filter(r => r.grup === gr).reduce((s, r) => s + r.vals[y], 0);
        const totals = {}, opTotals = {}, buyTotals = {}, intTotals = {}; let total = 0;
        life.forEach(y => {
            opTotals[y] = sumG('isletme', y); buyTotals[y] = sumG('alis', y); intTotals[y] = sumG('faiz', y);
            totals[y] = opTotals[y] + buyTotals[y] + intTotals[y]; total += totals[y];
        });
        const sold = life.length === opt, sale = sold ? num(v.satisTutari) : 0;
        const netTotal = total - sale;
        const paidInterest = Object.values(intr).reduce((a, b) => a + b, 0);
        return {
            opt, life, rows, totals, opTotals, buyTotals, intTotals, total, sold, sale, netTotal,
            annualNet: netTotal / Math.max(1, life.length),
            loan: { credit, payment: loan.payment, n: loan.n, totalInterest: loan.totalInterest, paidInterest, creditTotal: P + paidInterest }
        };
    }
    /* Tüm alanlar zorunlu: marka model, alış bedeli, satış tutarı, tüm gider başlıkları (ve ikinci sayıları); kredili ise vade ve faiz */
    function missingFields(v, settings) {
        const g = v.giderler || {}, ga = v.giderAdet || {}, miss = [];
        if (!v.markaModel || !String(v.markaModel).trim()) miss.push('Marka Model');
        if (!filled(v.alisBedeli)) miss.push('Araç Alış Bedeli');
        if (!filled(v.satisTutari)) miss.push('Araç Satış Tutarı');
        if (v.kredili) { if (!filled(v.vade)) miss.push('Vade'); if (!filled(v.faiz)) miss.push('Faiz'); }
        DEFAULT_HEADERS.forEach(h => { if (!filled(g[h])) miss.push(h); });
        ((settings && settings.giderTanimlari) || []).forEach(h => {
            if (!filled(g[h.ad])) miss.push(h.ad);
            else if (COST_TYPES[costType(h)].n && !filled(ga[h.ad])) miss.push(h.ad + ' (' + COST_TYPES[costType(h)].n.toLocaleLowerCase('tr') + ')');
        });
        if (filled(g[DEFAULT_HEADERS[0]]) && num(g[DEFAULT_HEADERS[0]]) < 1) miss.push(DEFAULT_HEADERS[0]);
        return miss;
    }
    function isVehicleComplete(v, settings) { return missingFields(v, settings).length === 0; }

    /* ---------- Simülasyon ---------- */
    /* Kural: tam 24 saatlik günler sayılır; kalan süre 3 saatten fazlaysa +1 gün (en az 1 gün). */
    function rentDays(s, e) {
        const ms = Math.max(0, e - s), full = Math.floor(ms / DAY), rem = ms - full * DAY;
        return Math.max(1, full + (rem > 3 * 3600000 ? 1 : 0));
    }
    /* İade saati sınırı: iade saati >= sınır ise araç ertesi gün 00:00'da boşa çıkar */
    function freeAtOf(e, cutHour) {
        const d = new Date(e);
        return d.getHours() >= cutHour ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() : e;
    }
    function plateFor(vIndex, n) {
        const a = String.fromCharCode(65 + (Math.floor(vIndex / 26) % 26)), b = String.fromCharCode(65 + (vIndex % 26));
        return `34 ${a}${b} ${100 + n + 1}`;
    }
    const sortFiles = files => files.slice().sort((a, b) => a.s - b.s || a.e - b.e);
    /* Verinin kapsadığı dönem: ilk teslimat gününden son teslimat gününe (iki gün dahil).
       İade tarihi sayılmaz: Aralık'ta başlayıp Ocak'ta dönen kiralamalar dönemi uzatmaz. */
    function deliverySpan(files) {
        if (!files.length) return { days: 0, minS: null, maxS: null };
        let lo = Infinity, hi = -Infinity;
        files.forEach(f => { if (f.s < lo) lo = f.s; if (f.s > hi) hi = f.s; });
        const d0 = new Date(lo), d1 = new Date(hi);
        const days = Math.round((Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate()) - Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate())) / DAY) + 1;
        return { days, minS: lo, maxS: hi };
    }
    const segIdx = s => SEGMENTS.indexOf(s);

    /* Bir segmentin talebi, sınırsız araçla "en küçük sıradaki boş araca ver" kuralıyla dağıtılır.
       Bu kuralla ilk N aracın aldığı işler, filoda yalnızca N araç olsaydı alacaklarıyla aynıdır.
       Böylece tek geçişte her N için karşılanan dosya / çalışma günü bulunur. Dizi uzunluğu = pik eşzamanlı ihtiyaç. */
    function fleetCurve(files, cutHour) {
        const units = [];
        sortFiles(files).forEach(f => {
            let u = null;
            for (const x of units) if (x.freeAt <= f.s) { u = x; break; }
            if (!u) { u = { freeAt: 0, files: 0, days: 0 }; units.push(u); }
            u.files++; u.days += rentDays(f.s, f.e); u.freeAt = freeAtOf(f.e, cutHour);
        });
        return units.map(u => ({ files: u.files, days: u.days }));
    }

    /* files: [{no, seg, s, e}], units: [{id, seg}] (segment içinde gider sırasına göre dizili)
       1. aşama: her dosya kendi segmentindeki, gideri en düşük boş araca verilir (kendi segmenti önceliklidir).
       2. aşama (opts.up / opts.down açıksa): karşılanamayan dosyalar, diğer segment araçlarının 1. aşamadan sonra
          gerçekten boş kalan zamanlarına yerleştirilir; böylece bir araç kendi segmentinin dosyasını asla kaçırmaz.
          Önce en yakın alt segmentler, sonra en yakın üst segmentler denenir.
       Fiyatlama: üst segment verilirse talep edilen segmentin, alt segment verilirse verilen segmentin günlük tutarı. */
    function simulate(files, units, cutHour, opts) {
        opts = opts || {};
        const pools = {}, byUnit = {};
        units.forEach(u => {
            const st = { id: u.id, seg: u.seg, freeAt: -Infinity, iv: [], days: 0, files: 0, price: {}, cross: {}, occ: Array(12).fill(0),
                m: Array.from({ length: 12 }, () => ({ days: 0, files: 0, price: {}, cf: {} })) };
            byUnit[u.id] = st; (pools[u.seg] = pools[u.seg] || []).push(st);
        });
        const sorted = sortFiles(files);
        const segStats = {};
        const blank = () => ({ total: 0, handled: 0, own: 0, up: 0, down: 0, days: 0 });
        const stat = seg => segStats[seg] || (segStats[seg] = { ...blank(), m: Array.from({ length: 12 }, blank), c: {} });
        const statC = (seg, c) => { const s = stat(seg); return s.c[c] || (s.c[c] = { ...blank(), m: Array.from({ length: 12 }, blank) }); };
        let minS = Infinity, maxE = -Infinity;
        const assign = sorted.map(f => {
            if (f.s < minS) minS = f.s; if (f.e > maxE) maxE = f.e;
            const a = { no: f.no, seg: f.seg, c: f.c || '', s: f.s, e: f.e, fr: freeAtOf(f.e, cutHour), mi: new Date(f.s).getMonth(), days: rentDays(f.s, f.e), unit: null, given: null, kind: null };
            const ss = stat(f.seg); ss.total++; ss.m[a.mi].total++;
            const sc = statC(f.seg, a.c); sc.total++; sc.m[a.mi].total++;
            return a;
        });
        const book = (a, st, kind) => {
            const ss = stat(a.seg), sm = ss.m[a.mi], rd = a.days, pk = priceKey(kind === 'down' ? st.seg : a.seg, a.c);
            const sc = statC(a.seg, a.c), scm = sc.m[a.mi];
            a.unit = st.id; a.given = st.seg; a.kind = kind;
            ss.handled++; ss.days += rd; ss[kind]++; sm.handled++; sm.days += rd; sm[kind]++;
            sc.handled++; sc.days += rd; sc[kind]++; scm.handled++; scm.days += rd; scm[kind]++;
            st.files++; st.days += rd; st.price[pk] = (st.price[pk] || 0) + rd;
            // Doluluk için kiralama günleri takvimdeki gerçek aylarına bölüştürülür (ay sonuna taşan kiralama)
            if (a.e > a.s) {
                let t = a.s; const tot = a.e - a.s;
                while (t < a.e) { const d = new Date(t), nx = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), e2 = Math.min(a.e, nx); st.occ[d.getMonth()] += rd * (e2 - t) / tot; t = e2; }
            } else st.occ[a.mi] += rd;
            const bm = st.m[a.mi]; bm.files++; bm.days += rd; bm.price[pk] = (bm.price[pk] || 0) + rd; bm.cf[a.c] = (bm.cf[a.c] || 0) + 1;
            if (kind !== 'own') {
                const key = kind + '|' + a.seg + '|' + st.seg + '|' + a.c;
                const c = st.cross[key] || (st.cross[key] = { kind, req: a.seg, given: st.seg, c: a.c, files: 0, days: 0, m: Array.from({ length: 12 }, () => ({ files: 0, days: 0 })) });
                c.files++; c.days += rd; c.m[a.mi].files++; c.m[a.mi].days += rd;
            }
        };
        // 1. aşama: kendi segmenti
        assign.forEach(a => {
            const pool = pools[a.seg]; if (!pool) return;
            for (const st of pool) if (st.freeAt <= a.s) { book(a, st, 'own'); st.iv.push([a.s, a.fr]); st.freeAt = a.fr; break; }
        });
        // 2. aşama: üst / alt segment (yalnızca boş zaman aralıklarına)
        if (opts.up || opts.down) {
            const fits = (iv, s, fr) => { // iv: başlangıca göre sıralı, çakışmayan aralıklar
                let lo = 0, hi = iv.length;
                while (lo < hi) { const md = (lo + hi) >> 1; if (iv[md][0] < s) lo = md + 1; else hi = md; }
                if (lo > 0 && iv[lo - 1][1] > s) return -1;
                if (lo < iv.length && iv[lo][0] < fr) return -1;
                return lo;
            };
            assign.forEach(a => {
                if (a.unit) return;
                const i = segIdx(a.seg); if (i < 0) return;
                const cands = [];
                if (opts.down) for (let j = i - 1; j >= 0; j--) cands.push([SEGMENTS[j], 'down']);
                if (opts.up) for (let j = i + 1; j < SEGMENTS.length; j++) cands.push([SEGMENTS[j], 'up']);
                for (const [sg, kd] of cands) {
                    const pool = pools[sg]; if (!pool) continue;
                    for (const st of pool) {
                        const at = fits(st.iv, a.s, a.fr);
                        if (at >= 0) { book(a, st, kd); st.iv.splice(at, 0, [a.s, a.fr]); return; }
                    }
                }
            });
        }
        const ds = deliverySpan(sorted);
        return { byUnit, segStats, assign, spanDays: ds.days, totalFiles: sorted.length, minS, maxS: ds.maxS, maxE, dataYear: sorted.length ? new Date(minS).getFullYear() : null };
    }

    /* Hizmet sayısı değişimi (%): her segmentin dosyaları teslim zamanına göre sıralanır ve
       %p oranındaki dosyalar zamana eşit aralıklarla seçilir (ör. %10 → her 10 dosyadan 1'i).
       Azalışta seçilen dosyalar çıkarılır, artışta aynı tarih/saatle bir kopyası eklenir.
       Böylece segment dağılımı, mevsimsellik ve gün içi saatler korunur. */
    function adjustFiles(files, pct) {
        pct = num(pct); if (!pct) return files;
        const p = Math.min(1, Math.abs(pct) / 100), out = [], bySeg = {};
        files.forEach(f => { (bySeg[f.seg] = bySeg[f.seg] || []).push(f); });
        Object.values(bySeg).forEach(list => {
            sortFiles(list).forEach((f, i) => {
                const pick = Math.floor((i + 1) * p) - Math.floor(i * p) >= 1;
                if (pct < 0) { if (!pick) out.push(f); }
                else { out.push(f); if (pick) out.push({ ...f, no: String(f.no) + ' (ek)', ek: true }); }
            });
        });
        return out;
    }

    /* Gün gün en yüksek eşzamanlı sayı. intervals: [[başlangıç, bitiş], ...] */
    function dailyPeaks(intervals) {
        if (!intervals.length) return { start: null, peaks: [] };
        const ev = [];
        let lo = Infinity, hi = -Infinity;
        intervals.forEach(([a, b]) => { ev.push([a, 1], [b, -1]); if (a < lo) lo = a; if (b > hi) hi = b; });
        ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
        const d0 = new Date(lo); d0.setHours(0, 0, 0, 0);
        const start = d0.getTime(), n = Math.floor((hi - start) / DAY) + 1;
        const peaks = Array(n).fill(0); let cur = 0, di = 0;
        ev.forEach(([t, d]) => {
            const day = Math.min(n - 1, Math.floor((t - start) / DAY));
            while (di < day) { di++; peaks[di] = Math.max(peaks[di], cur); }
            cur += d; if (cur > peaks[day]) peaks[day] = cur;
        });
        return { start, peaks };
    }

    /* ---------- Döviz (Euro) ----------
       fx = { K(yıl, ay) → 1 € kaç ₺, hk(yıl) → (1/12) Σ 1/K } . TL tutarlar, paranın el değiştirdiği ayın kuruyla çevrilir:
       • yıllık giderler (işletme, yakıt, personel) her aya eşit dağıtılır → yıl içindeki aylık kurlarla (hk)
       • tek seferlik gider ve peşin alış → ilk kullanım yılının Ocak kuru; kredi taksitleri → taksitin ayı
       • araç satışı ve erken kapanan kredi anaparası → ömrün son ayı (Aralık); dosya geliri → teslimat ayı */
    function makeFx(table, years) {
        const ys = [...years].map(Number).sort((a, b) => a - b), pts = [];
        ys.forEach((y, yi) => { const row = (table || {})[y] || []; for (let m = 0; m < 12; m++) { const v = row[m]; if (filled(v) && num(v) > 0) pts.push([yi * 12 + m, num(v)]); } });
        const missingYears = ys.filter(y => !((table || {})[y] || []).some(v => filled(v) && num(v) > 0));
        const grid = {}, est = {};
        ys.forEach((y, yi) => {
            grid[y] = []; est[y] = [];
            for (let m = 0; m < 12; m++) {
                const t = yi * 12 + m, own = (table || {})[y] && (table[y][m]);
                if (filled(own) && num(own) > 0) { grid[y][m] = num(own); est[y][m] = false; continue; }
                let v = null;
                if (pts.length) {
                    let lo = null, hi = null;
                    for (const p of pts) { if (p[0] <= t) lo = p; if (p[0] >= t && !hi) hi = p; }
                    if (lo && hi) v = hi[0] === lo[0] ? lo[1] : lo[1] + (hi[1] - lo[1]) * (t - lo[0]) / (hi[0] - lo[0]);
                    else v = (lo || hi)[1];
                }
                grid[y][m] = v; est[y][m] = true;
            }
        });
        const K = (y, m) => { const r = grid[y]; const v = r ? r[m] : null; return v > 0 ? v : 1; };
        const hkc = {}; ys.forEach(y => { hkc[y] = grid[y].reduce((a, v) => a + (v > 0 ? 1 / v : 1), 0) / 12; });
        const avg = y => { const r = grid[y] || []; const v = r.filter(x => x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
        return { K, hk: y => (hkc[y] === undefined ? 1 : hkc[y]), grid, est, avg, ok: pts.length > 0 && !missingYears.length, missingYears };
    }
    /* TL gider tablosunu Euro'ya çevirir (her kalem ödendiği ayın kuruyla) */
    function convertCostTable(ct, v, fx) {
        const L = ct.life, first = L[0], last = L[L.length - 1];
        const rows = ct.rows.map(r => {
            const vals = {}; L.forEach(y => { vals[y] = 0; });
            if (r.grup === 'isletme') L.forEach(y => { vals[y] = r.tip === 'tek' ? r.vals[y] / fx.K(y, 0) : r.vals[y] * fx.hk(y); });
            return { ...r, vals };
        });
        const buyRow = rows.find(r => r.grup === 'alis'), intRow = rows.find(r => r.grup === 'faiz');
        if (L.length && buyRow) {
            if (ct.loan.credit) {
                loanSchedule(v.alisBedeli, v.vade, v.faiz).months.forEach((m, i) => {
                    const yi = Math.floor(i / 12);
                    if (yi < L.length) { const y = L[yi], k = fx.K(y, i % 12); buyRow.vals[y] += m.principal / k; if (intRow) intRow.vals[y] += m.interest / k; }
                    else buyRow.vals[last] += m.principal / fx.K(last, 11); // erken kapama: satış ayında
                });
            } else buyRow.vals[first] = num(v.alisBedeli) / fx.K(first, 0);
        }
        const sumG = (gr, y) => rows.filter(r => r.grup === gr).reduce((s, r) => s + r.vals[y], 0);
        const totals = {}, opTotals = {}, buyTotals = {}, intTotals = {}; let total = 0;
        L.forEach(y => { opTotals[y] = sumG('isletme', y); buyTotals[y] = sumG('alis', y); intTotals[y] = sumG('faiz', y); totals[y] = opTotals[y] + buyTotals[y] + intTotals[y]; total += totals[y]; });
        const sale = ct.sale ? ct.sale / fx.K(last, 11) : 0, netTotal = total - sale;
        const paidInterest = intRow ? Object.values(intRow.vals).reduce((a, b) => a + b, 0) : 0;
        return { ...ct, rows, totals, opTotals, buyTotals, intTotals, total, sale, netTotal, annualNet: netTotal / Math.max(1, L.length),
            loan: { ...ct.loan, paidInterest, creditTotal: (buyRow ? Object.values(buyRow.vals).reduce((a, b) => a + b, 0) : 0) + paidInterest, tl: true }, eur: true };
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

    /* sim: { target: 'manual' | 50..100 | 'best', up: bool, down: bool }
       countsOverride: { vehicleId: adet } verilirse araç adetleri yerine kullanılır (senaryo karşılaştırma) */
    function buildReport({ vehicles, files, settings, cutHour, sim: simOpt, countsOverride, fx }) {
        fx = fx || null; // Euro görünümü: simülasyon (dosya dağıtımı, adetler) TL ile yapılır, parasal sonuçlar ayın kuruyla çevrilir
        simOpt = simOpt || settings.sim || {};
        const target = simOpt.target === undefined || simOpt.target === null ? 'manual' : simOpt.target;
        const years = sortedYears(settings);
        const vehicleCosts = {}, vcTL = {};
        vehicles.forEach(v => { vcTL[v.id] = costTable(v, settings); vehicleCosts[v.id] = fx ? convertCostTable(vcTL[v.id], v, fx) : vcTL[v.id]; });
        const complete = vehicles.filter(v => isVehicleComplete(v, settings));
        const incomplete = vehicles.filter(v => !isVehicleComplete(v, settings));
        const vIndex = v => vehicles.indexOf(v);
        const baseCount = v => Math.max(0, Math.floor(num(countsOverride ? countsOverride[v.id] : v.count)));

        // Dönem: teslimat tarihlerinin kapsadığı gün (ilk teslimat → son teslimat). 1 yıllıksa (≥355 gün) 365 gün;
        // kısaysa gerçek süre. 370 günden uzun teslimat dönemi yıllığa çevrilir.
        const span = files.length ? Math.max(1, deliverySpan(files).days) : 0;
        const period = span >= 355 ? YEAR_DAYS : Math.max(1, Math.round(span));
        const scale = span > 370 ? YEAR_DAYS / span : 1;
        const RT = makeRates(settings);
        // Segment başına modeller: aracın yıllık ortalama net maliyetine göre ucuzdan pahalıya
        const bySeg = {}, segW = {}; // segW: segment → müşteri → kiralama günü (ortalama tutar ağırlığı)
        files.forEach(f => {
            (bySeg[f.seg] = bySeg[f.seg] || []).push(f);
            const w = segW[f.seg] || (segW[f.seg] = {}), c = f.c || ''; w[c] = (w[c] || 0) + rentDays(f.s, f.e);
        });
        /* Filo eğrisi segment düzeyinde çalışır: müşteri tutarları, o segmentteki talebin müşteri dağılımıyla (kiralama günü) ağırlıklandırılır */
        const segAvg = {};
        const avgOf = (seg, y) => {
            const k = seg + KEY_SEP + y; if (segAvg[k]) return segAvg[k];
            const w = segW[seg] || { '': 1 };
            let tw = 0, r = 0, m = 0, sw = 0, sv = 0;
            Object.keys(w).forEach(c => {
                const x = w[c], rr = RT.rate(c, seg, y), ss = RT.sup(c, seg, y);
                tw += x; r += x * rr; if (ss > 0) { m += x * (rr - ss); sw += x; sv += x * ss; }
            });
            return (segAvg[k] = { rate: tw ? r / tw : 0, mg: tw ? m / tw : 0, sup: sw ? sv / sw : 0, hasSup: sw > 0 });
        };
        const rate = (seg, y) => avgOf(seg, y).rate;
        const segModels = {};
        complete.forEach(v => { (segModels[v.segment] = segModels[v.segment] || []).push(v); });
        Object.values(segModels).forEach(list => list.sort((a, b) => vcTL[a.id].annualNet - vcTL[b.id].annualNet || vIndex(a) - vIndex(b)));

        // Filo eğrisi: her segment için araç sayısına göre karşılama ve (personel hariç) net
        const curves = {}, counts = {}, noModel = [], marginal = {};
        complete.forEach(v => { counts[v.id] = baseCount(v); });
        // Personel kilidi açıksa personel sayısı = araç ÷ (kaç araca 1 personel); her araç personel maliyetinin 1/oran'ını getirir
        const pRatio = num(settings.personelOrani), autoPers = !settings.personelKilit && pRatio > 0;
        const pk = inflationFactors(years, settings.enflasyonOranlari || {}), pPer = (settings.personelTanimlari || []).reduce((a, h) => a + num(h.tutar), 0);
        const persOf = v => (autoPers ? vcTL[v.id].life.reduce((a, y) => a + pPer * pk[y], 0) / pRatio : 0);
        const allSegs = [...new Set([...SEGMENTS, ...Object.keys(bySeg)])];
        allSegs.forEach(seg => {
            const demand = bySeg[seg] || [], models = segModels[seg] || [];
            const curve = demand.length ? fleetCurve(demand, cutHour) : [];
            const existing = [];
            models.forEach(v => { for (let n = 0; n < baseCount(v); n++) existing.push(v); });
            const cheapest = models[0] || null, E0 = existing.length;
            // Bileşim: N ≤ mevcut ise mevcut araçların en ucuz N tanesi; fazlası en ucuz modelden eklenir.
            // Mevcut liste ucuzdan pahalıya sıralı olduğundan: [en ucuz model × (k0 + ek)] + diğer modeller.
            const k0 = existing.filter(v => v === cheapest).length, rest = existing.filter(v => v !== cheapest);
            const comp = N => (N <= E0 ? existing.slice(0, N) : [...Array(k0 + N - E0).fill(cheapest), ...rest]);
            // Tedarikçi: kendi aracımız olmayan dosya tedarikçiye verilir; marj = müşteri tutarı − tedarikçi tutarı
            // (tedarikçi tutarı girilmemiş yılda dosya kaybedilmiş sayılır, marj 0)
            const mg = y => avgOf(seg, y).mg;
            const rs = {}, ms = {}; // aracın ömrü boyunca günlük tutar ve tedarikçi marjı toplamları
            models.forEach(v => { const L = vcTL[v.id].life; rs[v.id] = L.reduce((x, y) => x + rate(seg, y), 0); ms[v.id] = L.reduce((x, y) => x + mg(y), 0); });
            const wk = k => Math.min(period, Math.round((curve[k] ? curve[k].days : 0) * scale));
            const fNet = (k, v) => wk(k) * rs[v.id] - vcTL[v.id].netTotal;
            const fTot = (k, v) => fNet(k, v) - wk(k) * ms[v.id] - persOf(v); // aracın işi için tedarikçi marjından vazgeçilir; personel payı eklenir
            const allMg = years.reduce((x, y) => x + mg(y), 0);
            const base = curve.reduce((x, c, k) => x + wk(k) * allMg, 0); // hiç araç yokken tedarikçi marjı
            const maxN = Math.max(curve.length, E0);
            const total = demand.length, points = [];
            const series = fn => { // N = 0..maxN için Σ fn(k, k. araç)
                const out = [], pc = [0];
                if (!cheapest) return null;
                for (let k = 0; k < k0 + maxN; k++) pc.push(pc[k] + fn(k, cheapest));
                let acc = 0;
                for (let N = 0; N <= maxN; N++) {
                    if (N <= E0) { out.push(acc); if (N < E0) acc += fn(N, existing[N]); }
                    else { const m = k0 + N - E0; let x = pc[m]; rest.forEach((v, j) => { x += fn(m + j, v); }); out.push(x); }
                }
                return out;
            };
            const sNet = series(fNet), sTot = series(fTot);
            // Euro görünümünde eğrinin net değerleri Euro ile; hedef seçimi TL üzerinden yapılır
            let sNetD = sNet, sTotD = sTot;
            if (fx) {
                const rsE = {}; models.forEach(v => { rsE[v.id] = vcTL[v.id].life.reduce((x, y) => x + rate(seg, y) * fx.hk(y), 0); });
                const persE = v => (autoPers ? vcTL[v.id].life.reduce((a, y) => a + pPer * pk[y] * fx.hk(y), 0) / pRatio : 0);
                const fNetE = (k, v) => wk(k) * rsE[v.id] - vehicleCosts[v.id].netTotal;
                sNetD = series(fNetE); sTotD = series((k, v) => fNetE(k, v) - persE(v));
            }
            let cumF = 0;
            for (let N = 0; N <= maxN; N++) {
                if (N > 0) cumF += (curve[N - 1] || { files: 0 }).files;
                points.push({ n: N, coverage: total ? cumF / total * 100 : 0, handled: cumF, net: sNetD ? sNetD[N] : null, total: sTotD ? sTotD[N] + base : null, sel: sTot ? sTot[N] + base : null });
            }
            const hasSup = years.some(y => avgOf(seg, y).hasSup);
            // +1 araç etkisi: bu modelden bir araç daha eklenirse (ucuzdan pahalıya sıraya girer) şirket neti ne kadar değişir
            if (cheapest) {
                const baseTot = existing.reduce((a, v, k) => a + fTot(k, v), 0);
                models.forEach(v => {
                    const c = vcTL[v.id].annualNet;
                    let pos = existing.findIndex(x => vcTL[x.id].annualNet > c); if (pos < 0) pos = existing.length;
                    const arr = [...existing.slice(0, pos), v, ...existing.slice(pos)];
                    marginal[v.id] = arr.reduce((a, u, k) => a + fTot(k, u), 0) - baseTot;
                });
            }
            curves[seg] = { total, peak: curve.length, existing: E0, points, hasModel: !!cheapest, hasSup, autoPers };
            if (target === 'manual') return;
            let N = 0;
            if (target === 'best') {
                if (cheapest) { let bestV = points[0].sel; points.forEach(p => { if (p.sel > bestV + 1e-6) { bestV = p.sel; N = p.n; } }); } // filo neti + tedarikçi marjı en yüksek
            } else {
                const need = Number(target) / 100 * total;
                N = points.findIndex(p => p.handled >= need - 1e-9); if (N < 0) N = maxN;
            }
            if (N > 0 && !cheapest) { noModel.push(seg); N = 0; }
            models.forEach(v => { counts[v.id] = 0; });
            comp(N).forEach(v => { counts[v.id]++; });
        });

        // Araç birimleri (plakalar): segment içinde ucuzdan pahalıya
        const units = [];
        allSegs.forEach(seg => (segModels[seg] || []).forEach(v => {
            for (let n = 0; n < (counts[v.id] || 0); n++) units.push({ id: v.id + ':' + n, plate: plateFor(vIndex(v), n), seg, v });
        }));
        const sim = simulate(files, units, cutHour, { up: !!simOpt.up, down: !!simOpt.down });

        const missingRates = new Set(), unsold = new Set();
        const revOf = (price, y) => Object.keys(price).reduce((a, k) => {
            const [sg, c] = splitKey(k), r = RT.rate(c, sg, y);
            if (!r) missingRates.add(`${c || 'Müşterisi belirtilmemiş'} · ${sg} / ${y}`);
            return a + price[k] * scale * r;
        }, 0);
        const plates = units.map(u => {
            const st = sim.byUnit[u.id], ct = vehicleCosts[u.v.id];
            const raw = st.days * scale, work = Math.min(period, Math.round(raw)), idle = period - work, cap = raw > 0 ? work / raw : 0;
            const byYear = {}, soldYear = ct.sold ? ct.life[ct.life.length - 1] : null;
            if (soldYear === null) unsold.add(u.v.markaModel);
            ct.life.forEach(y => {
                // Gelir: her dosyanın tüm kiralama günü (24 saat + 3 saat kuralıyla tam gün), dosyanın başladığı yılın tutarıyla.
                // Yıl sonuna sarkan dosya (ör. 25 Aralık – 2 Ocak) da tamamen başladığı yıla ve teslimat ayına yazılır; 365 günle kırpılmaz.
                const mRev = st.m.map((m, i) => revOf(m.price, y) / (fx ? fx.K(y, i) : 1)); // dosya geliri teslimat ayının kuruyla
                const revenue = fx ? mRev.reduce((a, b) => a + b, 0) : revOf(st.price, y), sale = y === soldYear ? ct.sale : 0;
                const op = ct.opTotals[y], buy = ct.buyTotals[y], int = ct.intTotals[y], cost = op + buy + int;
                byYear[y] = { work, idle, revenue, sale, op, buy, int, cost, pers: 0, persShare: 0, net: revenue + sale - cost, mRev };
            });
            const months = st.m.map((m, i) => ({ work: Math.round(m.days * scale), occ: st.occ[i] * scale, files: m.files * scale }));
            return { id: u.id, plate: u.plate, seg: u.seg, vid: u.v.id, model: u.v.markaModel, life: ct.life, work, idle, cap, files: st.files * scale,
                months, byYear, cross: Object.values(st.cross), price: st.price, mPrice: st.m.map(m => m.price), mCf: st.m.map(m => m.cf) };
        });
        // Personel gideri: filo geneli sabit gider; o yıl aktif araçlara, aldıkları dosya sayısı oranında dağıtılır
        const pers = personnelTable(settings, years);
        if (fx) { pers.rows.forEach(r => years.forEach(y => { r.vals[y] *= fx.hk(y); })); years.forEach(y => { pers.totals[y] *= fx.hk(y); }); pers.eur = true; }
        years.forEach(y => {
            const act = plates.filter(p => p.byYear[y]);
            if (!act.length || !pers.totals[y]) return;
            const totF = act.reduce((a, p) => a + p.files, 0);
            act.forEach(p => {
                const share = totF > 0 ? p.files / totF : 1 / act.length, r = p.byYear[y];
                r.persShare = share; r.pers = pers.totals[y] * share; r.net -= r.pers;
            });
        });
        const customers = [...new Set(files.map(f => f.c || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
        const rates = { ...RT, rateM: (c, sg, y, m) => RT.rate(c, sg, y) / (fx ? fx.K(y, m) : 1) }; // ayın kuruyla günlük tutar
        return { years, plates, vehicleCosts, pers, sim, curves, counts, noModel, incomplete, segModels, marginal, rates, segAvg: avgOf, customers, fx,
            missingRates: [...missingRates], unsold: [...unsold], period, scale, dataYear: sim.dataYear, target };
    }

    const api = { SEGMENTS, FUELS, DEFAULT_HEADERS, parseDate, formatDate, normSegment, normCustomer, parseCSV, rowsToRecords, tableToRows, missingHeaders, hasCustomerColumn,
        makeRates, priceKey, splitKey, NONE_KEY, makeFx, convertCostTable,
        sortedYears, inflationFactors, loanSchedule, costTable, COST_TYPES, costType, personnelTable, missingFields, isVehicleComplete, simulate, fleetCurve, dailyPeaks,
        freeAtOf, buildReport, rentDays, adjustFiles };
    if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
