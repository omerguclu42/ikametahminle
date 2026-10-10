const { createApp } = Vue;
const E = window.Engine;

const SEGMENTS = E.SEGMENTS;
const FUELS = E.FUELS;
const DEFAULT_HEADERS = E.DEFAULT_HEADERS;
const STORAGE_KEY = 'eurocross_ikame_data';
const SETTINGS_VERSION = 2;
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#f1f3f5"/><text x="150" y="82" font-family="Arial" font-size="14" fill="#adb5bd" text-anchor="middle">Görsel yok</text></svg>');
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const TARGETS = [50, 60, 70, 80, 90, 95, 100];
const EMPTY_FILTERS = () => ({ year: 'all', month: 'all', seg: 'all', vid: 'all' });
const DEFAULT_SIM = () => ({ target: 'manual', up: false, down: false, preset: 'manual' });

/* Eski sürümde hazır gelen başlıklar; tek seferlik temizlenir */
const OLD_SEEDED = ['Yıllık Kasko Maliyeti', 'Yıllık Trafik Sigortası', 'Yıllık MTV', 'Yıllık Bakım Maliyeti (Ort.)', 'Lastik Gideri (Yıllık)'];

/* ---- Yerel kayıt + bulut senkronizasyonu için tek giriş noktası ---- */
const Store = {
    load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; } },
    save(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
        catch (e) { console.error('Kayıt hatası (depolama dolu olabilir)', e); }
        if (window.CloudSync && window.CloudSync.push) window.CloudSync.push(data);
    }
};

function defaultSettings() {
    return {
        v: SETTINGS_VERSION,
        giderTanimlari: [],
        personelTanimlari: [],
        personelSayisi: null,
        personelKilit: false,
        personelOrani: null,
        enflasyonYillari: [2026, 2027, 2028, 2029],
        enflasyonOranlari: { 2026: 0, 2027: 35, 2028: 28, 2029: 25 },
        yakitFiyatlari: {
            Benzin: { 2026: 45, 2027: 60, 2028: 80, 2029: 100 },
            Dizel: { 2026: 45, 2027: 60, 2028: 80, 2029: 100 },
            Elektrik: { 2026: 5, 2027: 8, 2028: 12, 2029: 15 }
        },
        gunlukTutar: {},
        tedarikciTutar: {},
        sim: DEFAULT_SIM(),
        scenarios: []
    };
}
/* Eski sürümden gelen veriyi yeni yapıya çevirir ve eksik alanları tamamlar */
function normalizeSettings(s) {
    const d = defaultSettings();
    s = s || {};
    if (!Array.isArray(s.giderTanimlari)) {
        const old = Array.isArray(s.giderBasliklari) ? s.giderBasliklari : [];
        s.giderTanimlari = old.filter(n => !DEFAULT_HEADERS.includes(n)).map(n => ({ ad: n, kategori: 'Diğer' }));
    }
    delete s.giderBasliklari;
    if (s.v !== SETTINGS_VERSION) { // tek seferlik: hazır gelen başlıkları temizle
        s.giderTanimlari = s.giderTanimlari.filter(h => !OLD_SEEDED.includes(h.ad));
        s.v = SETTINGS_VERSION;
    }
    s.giderTanimlari.forEach(h => { h.tip = E.costType(h); delete h.yakitKm; });
    if (!Array.isArray(s.personelTanimlari)) s.personelTanimlari = [];
    if (s.personelSayisi === undefined) s.personelSayisi = null;
    if (s.personelKilit === undefined) s.personelKilit = s.personelSayisi !== null; // önceden elle girilmiş sayı korunur
    s.personelKilit = !!s.personelKilit;
    if (s.personelOrani === undefined) s.personelOrani = null;
    s.enflasyonYillari = (s.enflasyonYillari && s.enflasyonYillari.length ? s.enflasyonYillari : d.enflasyonYillari).map(Number);
    s.enflasyonOranlari = s.enflasyonOranlari || {};
    s.yakitFiyatlari = s.yakitFiyatlari || {};
    s.gunlukTutar = s.gunlukTutar || {};
    s.tedarikciTutar = s.tedarikciTutar || {};
    FUELS.forEach(f => { s.yakitFiyatlari[f] = s.yakitFiyatlari[f] || { ...(d.yakitFiyatlari[f]) }; });
    delete s.yakitFiyatlari.Hibrit;
    SEGMENTS.forEach(sg => { s.gunlukTutar[sg] = s.gunlukTutar[sg] || {}; s.tedarikciTutar[sg] = s.tedarikciTutar[sg] || {}; });
    s.enflasyonYillari.forEach(y => {
        if (s.enflasyonOranlari[y] === undefined) s.enflasyonOranlari[y] = 0;
        FUELS.forEach(f => { if (s.yakitFiyatlari[f][y] === undefined) s.yakitFiyatlari[f][y] = 0; });
        SEGMENTS.forEach(sg => { if (s.gunlukTutar[sg][y] === undefined) s.gunlukTutar[sg][y] = null; if (s.tedarikciTutar[sg][y] === undefined) s.tedarikciTutar[sg][y] = null; });
    });
    s.sim = { ...DEFAULT_SIM(), ...(s.sim || {}) };
    if (s.sim.target !== 'manual' && s.sim.target !== 'best') s.sim.target = TARGETS.includes(Number(s.sim.target)) ? Number(s.sim.target) : 'manual';
    s.sim.up = !!s.sim.up; s.sim.down = !!s.sim.down;
    if (s.sim.preset !== 'manual' && s.sim.preset !== 'best' && !TARGETS.includes(Number(s.sim.preset))) s.sim.preset = 'manual';
    s.scenarios = Array.isArray(s.scenarios) ? s.scenarios.filter(x => x && x.ad) : [];
    return s;
}
function normalizeVehicle(v) {
    v.giderler = v.giderler || {};
    v.giderAdet = v.giderAdet || {};
    if (!FUELS.includes(v.yakitTuru)) v.yakitTuru = 'Benzin';
    if (!SEGMENTS.includes(v.segment)) v.segment = 'B';
    if (v.satisTutari === undefined) v.satisTutari = null;
    if (v.alisBedeli === undefined) v.alisBedeli = null;
    v.kredili = !!v.kredili;
    if (v.vade === undefined) v.vade = null;
    if (v.faiz === undefined) v.faiz = null;
    if (v.giderler['Yıllık Kullanılacak KM'] !== undefined) { // eski alan adı -> Optimum Satış KM
        if (v.giderler['Optimum Satış KM'] === undefined) v.giderler['Optimum Satış KM'] = v.giderler['Yıllık Kullanılacak KM'];
        delete v.giderler['Yıllık Kullanılacak KM'];
    }
    v.count = v.count || 0;
    return v;
}

/* ---- Sayı alanı: binlik ayraç + ok ile 1'er artırma/azaltma ---- */
const NumInput = {
    props: { modelValue: { default: null }, step: { type: Number, default: 1 }, decimals: { type: Boolean, default: false }, min: { type: Number, default: 0 }, invalid: Boolean, disabled: Boolean },
    emits: ['update:modelValue'],
    data() { return { text: this.fmt(this.modelValue) }; },
    watch: {
        modelValue(v) {
            const cur = this.parse(this.text), nv = (v === '' || v === undefined) ? null : v;
            if (cur !== nv) this.text = this.fmt(v);
        }
    },
    methods: {
        fmt(v) {
            if (v === null || v === undefined || v === '') return '';
            const n = Number(v); if (isNaN(n)) return '';
            return n.toLocaleString('tr-TR', { maximumFractionDigits: this.decimals ? 2 : 0 });
        },
        parse(t) {
            if (!t) return null;
            const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
            return isNaN(n) ? null : n;
        },
        onInput(e) {
            const el = e.target, caret = el.selectionStart;
            const sig = (el.value.slice(0, caret).match(/[\d,]/g) || []).length;
            let clean = el.value.replace(/[^\d,]/g, '');
            if (!this.decimals) clean = clean.replace(/,/g, '');
            const parts = clean.split(',');
            const ip = parts[0].replace(/^0+(?=\d)/, '');
            let t = ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
            if (parts.length > 1) t += ',' + parts.slice(1).join('').slice(0, 2);
            this.text = t; el.value = t;
            let pos = 0, cnt = 0;
            while (pos < t.length && cnt < sig) { if (/[\d,]/.test(t[pos])) cnt++; pos++; }
            try { el.setSelectionRange(pos, pos); } catch (x) { /* yoksay */ }
            this.$emit('update:modelValue', this.parse(t));
        },
        bump(d) {
            if (this.disabled) return;
            let n = Math.round(((this.parse(this.text) || 0) + d * this.step) * 100) / 100;
            if (n < this.min) n = this.min;
            this.text = this.fmt(n);
            this.$emit('update:modelValue', n);
        }
    },
    template: `
    <div class="input-group input-group-sm num-input" :class="{'is-invalid-group': invalid}">
        <input type="text" inputmode="decimal" class="form-control" :class="{'is-invalid': invalid}" :value="text" :disabled="disabled"
               @input="onInput" @keydown.up.prevent="bump(1)" @keydown.down.prevent="bump(-1)">
        <span class="input-group-text p-0 spin">
            <button type="button" tabindex="-1" @click="bump(1)" :disabled="disabled"><i class="bi bi-caret-up-fill"></i></button>
            <button type="button" tabindex="-1" @click="bump(-1)" :disabled="disabled"><i class="bi bi-caret-down-fill"></i></button>
        </span>
    </div>`
};

const PAGE_META = {
    tahminleme: ['Tahminleme Simülatörü', 'Filo büyüklüğünü ve kuralları değiştirerek gelir, gider ve karşılama oranını anlık görün.'],
    raporlama: ['Raporlama', 'Grafiklerle detaylı analiz, senaryo karşılaştırması ve filtrelenebilir veri seti.'],
    giderBasliklari: ['Araç Gider Başlıkları', 'Araç formunda doldurulacak yıllık gider kalemlerini yönetin.'],
    personelGider: ['Personel Gider Başlıkları', 'Personel sayısını ve kişi başı yıllık maliyet kalemlerini yönetin.'],
    aracGiris: ['Araç Veri Girişi', 'Filoda kullanılabilecek araç modellerini, alış/satış bedellerini ve giderlerini tanımlayın.'],
    yakitVeEnflasyon: ['Yakıt & Enflasyon', 'Tahminleme yıllarını, enflasyon oranlarını ve yakıt fiyatlarını girin.'],
    tarihce: ['Tarihçe (Dosyalar)', 'Simülasyonun dayandığı dosya teslim / iade verisini yükleyin.'],
    iadeSaati: ['İade Dönüş Saati', 'Geç iade edilen aracın ertesi güne kalacağı saat sınırını belirleyin.'],
    gunlukTutar: ['Günlük Tutar', 'Segment ve yıla göre müşteriye yansıtılan araç başı günlük kira tutarı.']
};
const C = { orange: '#ff6600', orangeL: '#ffa94d', dark: '#343a40', grey: '#adb5bd', green: '#2b8a3e', red: '#e03131', blue: '#1c7ed6', purple: '#7048e8', amber: '#f59f00' };

const app = createApp({
    data() {
        return {
            activeTab: 'tahminleme',
            tabs: [
                { id: 'giderBasliklari', label: 'Araç Gider Başlıkları', icon: 'bi-tags' },
                { id: 'personelGider', label: 'Personel Gider Başlıkları', icon: 'bi-people' },
                { id: 'aracGiris', label: 'Araç Veri Girişi', icon: 'bi-car-front' },
                { id: 'yakitVeEnflasyon', label: 'Yakıt & Enflasyon', icon: 'bi-graph-up-arrow' },
                { id: 'tarihce', label: 'Tarihçe (Dosyalar)', icon: 'bi-file-earmark-spreadsheet' },
                { id: 'iadeSaati', label: 'İade Dönüş Saati', icon: 'bi-clock-history' },
                { id: 'gunlukTutar', label: 'Günlük Tutar', icon: 'bi-cash-coin' }
            ],
            segments: SEGMENTS,
            fuels: FUELS,
            defaultHeaders: DEFAULT_HEADERS,
            placeholder: PLACEHOLDER,
            targets: TARGETS,
            months: MONTHS,

            newHeader: '', newCategory: '', newAmount: null, newTip: 'yillik', headerError: '', dragIndex: -1,
            newYear: null,
            timeRule: 15,
            settings: defaultSettings(),
            vehicles: [],
            historicalData: [],
            importMsg: '', pasteText: '', showPaste: false,
            histPage: 1, histSize: 100,

            auth: { state: 'loading', error: '', busy: false, email: '', password: '', user: null },
            sync: { status: 'idle', msg: '', loaded: false, online: true },
            costClip: null, // kopyalanan gider ve performans verileri
            tip: { show: false, text: '', x: 0, y: 0, up: false },
            showPass: false, photoKey: 0, costTypes: E.COST_TYPES,
            toast: { show: false, text: '' },

            tempVehicle: null, editingVehicleIndex: -1, editingVehicleId: null, vehicleModal: null, submitted: false,
            costModal: null, activeCostVehicle: null,
            plateModal: null, activePlate: null,
            confirmModal: null, confirmText: '', confirmInfo: false, confirmResolve: null,
            scenarioModal: null, scenarioName: '', scenarioNote: '', scenarioError: '', scenarioEditId: null,
            headerModal: null, hdrEdit: { isP: false, index: -1, ad: '', kategori: '', error: '' },

            filters: EMPTY_FILTERS(),
            detailTab: 'yillik', plateSearch: '', plateLimit: 100,

            // Raporlama
            reportSeg: null,
            ds: { type: 'dosya', status: 'all', search: '', page: 1, size: 50 }
        };
    },
    computed: {
        authed() { return this.auth.state === 'in' && this.sync.loaded; },
        syncLabel() {
            if (this.sync.status === 'local') return 'Yerel mod (bulut kapalı)';
            if (!this.sync.online) return 'Çevrimdışı';
            return { saving: 'Kaydediliyor…', ok: 'Buluta kaydedildi', connecting: 'Bağlanıyor…', error: 'Bağlantı hatası' }[this.sync.status] || '';
        },
        syncClass() { return 'sync-' + (this.sync.status === 'local' ? 'local' : (this.sync.online ? this.sync.status : 'offline')); },
        pageMeta() { return PAGE_META[this.activeTab] || ['', '']; },
        years() { return E.sortedYears(this.settings); },
        isP() { return this.activeTab === 'personelGider'; },
        hdrList() { return this.isP ? this.settings.personelTanimlari : this.settings.giderTanimlari; },
        allHeaders() { return [...DEFAULT_HEADERS, ...this.settings.giderTanimlari.map(h => h.ad)]; },
        fuelHeaders() { return this.settings.giderTanimlari.filter(h => h.tip === 'yakit').map(h => h.ad); },
        hdrByName() { const o = {}; this.settings.giderTanimlari.forEach(h => { o[h.ad] = h; }); return o; },
        hasSupplier() { return SEGMENTS.some(sg => this.years.some(y => Number((this.settings.tedarikciTutar[sg] || {})[y]) > 0)); },
        categories() { return [...new Set(this.hdrList.map(h => h.kategori).filter(Boolean))]; },
        sortedVehicles() {
            return [...this.vehicles].sort((a, b) => SEGMENTS.indexOf(a.segment) - SEGMENTS.indexOf(b.segment) || a.markaModel.localeCompare(b.markaModel, 'tr'));
        },
        /* Simülatör şeridi: segment, sonra atama önceliği (en düşük giderli önce) */
        stripVehicles() {
            const ann = v => { const c = this.report.vehicleCosts[v.id]; return c ? c.annualNet : 0; };
            return [...this.vehicles].sort((a, b) => SEGMENTS.indexOf(a.segment) - SEGMENTS.indexOf(b.segment)
                || (this.isComplete(b) - this.isComplete(a)) || ann(a) - ann(b) || a.markaModel.localeCompare(b.markaModel, 'tr'));
        },
        parsedFiles() {
            const out = [];
            this.historicalData.forEach(d => {
                const s = E.parseDate(d.teslimat), e = E.parseDate(d.iade);
                if (s !== null && e !== null) out.push({ no: d.dosyaNo, seg: E.normSegment(d.segment), s, e });
            });
            return out;
        },
        report() {
            return E.buildReport({ vehicles: this.vehicles, files: this.parsedFiles, settings: this.settings, cutHour: this.timeRule, sim: this.settings.sim });
        },
        isAuto() { return false; },
        incompleteVehicles() { return this.vehicles.filter(v => !this.isComplete(v)); },
        totalPlates() { return this.report.plates.length; },
        rankOf() { // segment içindeki atama önceliği
            const out = {};
            Object.values(this.report.segModels).forEach(list => list.forEach((v, i) => { out[v.id] = i + 1; }));
            return out;
        },
        tabStatus() {
            const s = this.settings, yrs = this.years, cv = this.vehicles.filter(v => this.isComplete(v));
            const fuels = [...new Set(cv.map(v => v.yakitTuru))];
            const segs = [...new Set(cv.map(v => v.segment))];
            return {
                giderBasliklari: s.giderTanimlari.length > 0,
                personelGider: s.personelTanimlari.length > 0 && Number(s.personelSayisi) > 0,
                aracGiris: this.vehicles.length > 0 && !this.incompleteVehicles.length,
                yakitVeEnflasyon: yrs.every(y => s.enflasyonOranlari[y] !== null && s.enflasyonOranlari[y] !== '' && s.enflasyonOranlari[y] !== undefined)
                    && (!this.fuelHeaders.length || (fuels.length ? fuels : FUELS).every(f => yrs.every(y => Number(s.yakitFiyatlari[f][y]) > 0))),
                tarihce: this.historicalData.length > 0,
                iadeSaati: true,
                gunlukTutar: segs.length > 0 && segs.every(sg => yrs.every(y => Number((s.gunlukTutar[sg] || {})[y]) > 0))
            };
        },

        /* Personel sayfası: yıllık özet + öneri */
        persSummary() {
            const k = E.inflationFactors(this.years, this.settings.enflasyonOranlari || {});
            const base = this.settings.personelTanimlari.reduce((a, h) => a + (Number(h.tutar) || 0), 0), count = Number(this.settings.personelSayisi) || 0;
            const perPerson = {}, totals = {};
            this.years.forEach(y => { perPerson[y] = base * k[y]; totals[y] = base * k[y] * count; });
            const ratio = Number(this.settings.personelOrani) || 0;
            return { count, perPerson, totals, fleet: this.totalPlates, suggested: ratio > 0 ? Math.ceil(this.totalPlates / ratio) : null };
        },

        brandOptions() {
            return this.sortedVehicles.filter(v => (this.report.counts[v.id] || 0) > 0 && (this.filters.seg === 'all' || v.segment === this.filters.seg));
        },
        filtersActive() { const f = this.filters; return f.year !== 'all' || f.month !== 'all' || f.seg !== 'all' || f.vid !== 'all'; },
        activeScenarioId() {
            const cur = this.snapshot();
            const sc = this.settings.scenarios.find(s => !!s.sim.up === cur.sim.up && !!s.sim.down === cur.sim.down && (s.sim.target || 'manual') === 'manual'
                && this.vehicles.every(v => (Number(s.counts[v.id]) || 0) === (Number(cur.counts[v.id]) || 0)));
            return sc ? sc.id : null;
        },
        horizonIssues() {
            const n = this.years.length;
            return this.vehicles.filter(v => this.isComplete(v) && Number(v.giderler[DEFAULT_HEADERS[0]]) !== n)
                .map(v => ({ ad: v.markaModel, opt: Number(v.giderler[DEFAULT_HEADERS[0]]) }));
        },

        /* Tarihçe sayfalama */
        histPages() { return Math.max(1, Math.ceil(this.historicalData.length / this.histSize)); },
        histRows() { const s = (this.histPage - 1) * this.histSize; return this.historicalData.slice(s, s + this.histSize); },
        pageButtons() { return this.pager(this.histPage, this.histPages); },

        /* Filtrelere göre tüm özetler (simülatör + raporlama) */
        view() {
            const R = this.report, F = this.filters, sc = R.scale || 1;
            const mi = F.month === 'all' ? null : Number(F.month);
            const dim = mi === null ? 0 : new Date(R.dataYear || 2026, mi + 1, 0).getDate();
            const mf = mi === null ? 1 : dim / 365; // ay seçiliyken yıllık giderler gün sayısına oranlanır
            const rate = (sg, y) => Number(((this.settings.gunlukTutar || {})[sg] || {})[y]) || 0;
            const segOk = p => (F.seg === 'all' || p.seg === F.seg) && (F.vid === 'all' || p.vid === F.vid);
            const yOk = y => F.year === 'all' || String(y) === String(F.year);
            const z = () => ({ work: 0, idle: 0, revenue: 0, sale: 0, op: 0, buy: 0, int: 0, cost: 0, pers: 0, net: 0, plates: 0, files: 0 });
            const add = (a, r) => { a.work += r.work; a.idle += r.idle; a.revenue += r.revenue; a.sale += r.sale; a.op += r.op; a.buy += r.buy; a.int += r.int; a.cost += r.cost; a.pers += r.pers; a.net += r.net; a.files += r.f; };
            // Ay seçiliyse: o ay teslim edilen dosyaların çalışma günü ve geliri; araç satışı hariç
            const rec = (p, y) => {
                const r = p.byYear[y];
                if (mi === null) return { ...r, f: p.files };
                const m = p.months[mi], revenue = r.mRev[mi], op = r.op * mf, buy = r.buy * mf, int = r.int * mf, pers = r.pers * mf;
                return { work: m.work, idle: Math.max(0, dim - m.work), revenue, sale: 0, op, buy, int, cost: op + buy + int, pers, net: revenue - op - buy - int - pers, f: m.files };
            };
            const total = z(), yearAgg = {}, yearFull = {}, segAgg = {}, modelAgg = {}, items = {}, cats = {}, plateRows = [], monthWork = Array(12).fill(0);
            R.years.forEach(y => { yearAgg[y] = z(); yearFull[y] = z(); });
            R.plates.forEach(p => {
                if (!segOk(p)) return;
                const ct = R.vehicleCosts[p.vid], files1 = mi === null ? p.files : p.months[mi].files;
                const row = { p, files1, ...z() };
                p.months.forEach((m, i) => { monthWork[i] += m.work; });
                p.life.forEach(y => {
                    const r = rec(p, y);
                    add(yearAgg[y], r); yearAgg[y].plates++;
                    add(yearFull[y], { ...p.byYear[y], f: p.files });
                    if (!yOk(y)) return;
                    add(total, r); add(row, r); row.plates++;
                    const sa = segAgg[p.seg] || (segAgg[p.seg] = z()); add(sa, r); sa.plates++;
                    const ma = modelAgg[p.vid] || (modelAgg[p.vid] = z()); add(ma, r); ma.plates++;
                    const put = (grup, kalem, kategori, tutar) => {
                        const key = grup + '|' + kalem;
                        const it = items[key] || (items[key] = { grup, kalem, kategori, tutar: 0 });
                        it.tutar += tutar;
                        const ck = grup + '|' + kategori; cats[ck] = cats[ck] || { grup, kategori, tutar: 0 }; cats[ck].tutar += tutar;
                    };
                    ct.rows.forEach(x => put('Araç', x.kalem, x.kategori, x.vals[y] * mf));
                    const sh = p.byYear[y].persShare;
                    if (sh) R.pers.rows.forEach(x => put('Personel', x.kalem, x.kategori, x.vals[y] * sh * mf));
                });
                if (row.plates) { row.util = row.work + row.idle ? row.work / (row.work + row.idle) * 100 : 0; plateRows.push(row); }
            });
            // Üst / alt segment analizi
            const cross = { up: { files: 0, days: 0, gain: 0, diff: 0 }, down: { files: 0, days: 0, gain: 0, diff: 0 } };
            R.plates.forEach(p => {
                if (F.vid !== 'all' && p.vid !== F.vid) return;
                const ys = p.life.filter(yOk); if (!ys.length) return;
                p.cross.forEach(c => {
                    if (F.vid === 'all' && F.seg !== 'all' && c.req !== F.seg) return;
                    const src = mi === null ? c : c.m[mi]; if (!src.files) return;
                    const t = cross[c.kind], d = src.days * sc; t.files += src.files * sc; t.days += d;
                    ys.forEach(y => {
                        if (c.kind === 'up') { t.gain += d * rate(c.req, y); t.diff += d * (rate(c.given, y) - rate(c.req, y)); }
                        else { t.gain += d * rate(c.given, y); t.diff += d * (rate(c.req, y) - rate(c.given, y)); }
                    });
                });
            });
            let cum = 0;
            const yearRows = R.years.filter(y => yearAgg[y].plates).map(y => {
                const a = yearAgg[y]; cum += a.net;
                return { year: y, ...a, cum, util: a.work + a.idle ? a.work / (a.work + a.idle) * 100 : 0 };
            });
            // Geri ödeme: yıllık bazda kümülatif net ilk kez ≥ 0
            let pc = 0, payback = null; const activeYears = R.years.filter(y => yearFull[y].plates || yearFull[y].cost);
            activeYears.forEach((y, i) => { pc += yearFull[y].net; if (payback === null && pc >= 0) payback = { n: i + 1, year: y }; });
            const stats = R.sim.segStats, vSeg = (this.vehicles.find(v => v.id === F.vid) || {}).segment;
            const sStat = k => { const s = stats[k]; if (!s) return { total: 0, handled: 0, own: 0, up: 0, down: 0, days: 0 }; return mi === null ? s : s.m[mi]; };
            const segKeys = Object.keys(stats).filter(k => F.vid !== 'all' ? k === vSeg : (F.seg === 'all' || k === F.seg));
            const demand = segKeys.reduce((a, k) => a + sStat(k).total, 0);
            const handled = F.vid !== 'all' ? Math.round(plateRows.reduce((a, r) => a + r.files1, 0)) : segKeys.reduce((a, k) => a + sStat(k).handled, 0);
            const rentalDays = segKeys.reduce((a, k) => a + sStat(k).days, 0), simHandled = segKeys.reduce((a, k) => a + sStat(k).handled, 0);
            const files = { total: demand, handled, missed: Math.max(0, demand - handled), ratio: demand ? handled / demand * 100 : 0 };
            const order = k => { const i = SEGMENTS.indexOf(k); return i < 0 ? 99 : i; };
            const allSegs = [...new Set([...Object.keys(stats), ...Object.keys(segAgg)])].filter(k => F.seg === 'all' || k === F.seg).sort((a, b) => order(a) - order(b));
            const segmentRows = allSegs.map(k => {
                const a = segAgg[k] || z(), st = sStat(k);
                const cnt = R.plates.filter(p => p.seg === k && (F.vid === 'all' || p.vid === F.vid)).length;
                const cv = R.curves[k] || { peak: 0 };
                return { seg: k, cnt, total: st.total, handled: st.handled, cross: st.up + st.down, missed: st.total - st.handled, ratio: st.total ? st.handled / st.total * 100 : 0,
                    peak: cv.peak, ...a, util: a.work + a.idle ? a.work / (a.work + a.idle) * 100 : 0 };
            });
            const modelRows = this.sortedVehicles.filter(v => (F.seg === 'all' || v.segment === F.seg) && (F.vid === 'all' || v.id === F.vid) && (R.counts[v.id] || 0) > 0).map(v => {
                const a = modelAgg[v.id] || z();
                return { v, cnt: R.counts[v.id] || 0, ...a, util: a.work + a.idle ? a.work / (a.work + a.idle) * 100 : 0 };
            });
            const itemRows = Object.values(items).sort((a, b) => b.tutar - a.tutar);
            const catRows = Object.values(cats).sort((a, b) => b.tutar - a.tutar);
            const q = this.plateSearch.trim().toLocaleLowerCase('tr');
            const shownPlates = q ? plateRows.filter(r => (r.p.plate + ' ' + r.p.model + ' ' + r.p.seg).toLocaleLowerCase('tr').includes(q)) : plateRows;
            const gelir = total.revenue + total.sale, gider = total.cost + total.pers;
            const plateYears = plateRows.reduce((a, r) => a + r.plates, 0), pf = x => total.files ? x / total.files : 0;
            const util = total.work + total.idle ? total.work / (total.work + total.idle) * 100 : 0;
            // Başabaş doluluk: gelir çalışılan günle doğru orantılı kabul edilir
            const breakEven = total.revenue > 0 ? util * Math.max(0, gider - total.sale) / total.revenue : null;
            const peak = segKeys.reduce((a, k) => a + ((R.curves[k] || {}).peak || 0), 0);
            const fleetIn = segKeys.reduce((a, k) => a + R.plates.filter(p => p.seg === k).length, 0);
            const needFor = pct => segKeys.reduce((a, k) => { const c = R.curves[k]; if (!c || !c.total) return a; const p = c.points.find(x => x.handled >= pct / 100 * c.total - 1e-9); return a + (p ? p.n : c.peak); }, 0);
            const pctOf = (n) => demand ? n / demand * 100 : 0;
            const sup = this.supplierCalc(R, segKeys, mi, yOk);
            yearRows.forEach(r => { r.sup = (sup.byYear[r.year] || {}).margin || 0; r.company = r.net + r.sup; });
            const ownDayCost = total.work ? (gider - total.sale) / total.work : 0;
            const custDay = sup.ownDays ? sup.ownCust / sup.ownDays : (total.work ? total.revenue / total.work : 0);
            const supDay = sup.ownDays ? sup.ownSup / sup.ownDays : sup.avgSup;
            const cmp = { custDay, supDay, ownProfit: custDay - ownDayCost, supProfit: custDay - supDay, adv: supDay - ownDayCost, advTotal: (supDay - ownDayCost) * total.work };
            return {
                sup, cmp, companyNet: total.net + sup.margin, ownDayCost,
                mi, total, gelir, gider, util, breakEven, payback, peak, fleetIn, need80: needFor(80),
                perFileVeh: pf(total.cost), perFilePers: pf(total.pers), perFileRev: pf(gelir), perFileNet: pf(total.net),
                plateTotal: plateRows.length, idlePlates: plateRows.filter(r => r.files1 === 0).length,
                avgWork: plateYears ? total.work / plateYears : 0, avgRental: simHandled ? rentalDays / simHandled : 0,
                netPerWorkDay: total.work ? total.net / total.work : 0, netPerPlate: plateRows.length ? total.net / plateRows.length : 0,
                files, segKeys, monthWork,
                up: { ...cross.up, ratio: pctOf(cross.up.files) }, down: { ...cross.down, ratio: pctOf(cross.down.files) },
                yearRows, segmentRows, modelRows, itemRows, catRows, plateRowsAll: plateRows,
                plateRows: shownPlates, plateCount: shownPlates.length,
                itemTotal: itemRows.reduce((sum, r) => sum + r.tutar, 0)
            };
        },
        spanInfo() { const d = this.report.sim.spanDays; return d ? Math.round(d) : 0; },

        /* ================= Raporlama ================= */
        curveSegs() { return SEGMENTS.filter(s => (this.report.curves[s] || {}).total > 0); },
        segsNoModel() { return Object.keys(this.report.curves).filter(k => this.report.curves[k].total > 0 && !this.report.curves[k].hasModel); },
        curveSeg() {
            if (this.filters.seg !== 'all' && this.curveSegs.includes(this.filters.seg)) return this.filters.seg;
            return this.curveSegs.includes(this.reportSeg) ? this.reportSeg : (this.curveSegs[0] || null);
        },
        assignFiltered() {
            const R = this.report, F = this.filters, V = this.view, mi = V.mi;
            return R.sim.assign.filter(a => V.segKeys.includes(a.seg) && (mi === null || a.mi === mi));
        },
        monthly() {
            const R = this.report, V = this.view, st = R.sim.segStats, y = R.dataYear || 2026;
            const rows = MONTHS.map((m, i) => {
                const t = { total: 0, own: 0, up: 0, down: 0, handled: 0 };
                V.segKeys.forEach(k => { const s = st[k]; if (!s) return; const x = s.m[i]; t.total += x.total; t.own += x.own; t.up += x.up; t.down += x.down; t.handled += x.handled; });
                const dim = new Date(y, i + 1, 0).getDate(), plates = V.plateRowsAll.length;
                return { m, ...t, missed: t.total - t.handled, util: plates && t.total ? V.monthWork[i] / (plates * dim) * 100 : null };
            });
            return rows;
        },
        rentalHist() {
            const b = [['1 gün', 1, 1], ['2 gün', 2, 2], ['3 gün', 3, 3], ['4-5 gün', 4, 5], ['6-7 gün', 6, 7], ['8-14 gün', 8, 14], ['15-30 gün', 15, 30], ['30+ gün', 31, 1e9]];
            const out = b.map(x => ({ l: x[0], n: 0 }));
            this.assignFiltered.forEach(a => { const i = b.findIndex(x => a.days >= x[1] && a.days <= x[2]); if (i >= 0) out[i].n++; });
            return out;
        },
        weekday() {
            const names = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'], out = names.map(n => ({ l: n, n: 0, h: 0 }));
            this.assignFiltered.forEach(a => { const d = (new Date(a.s).getDay() + 6) % 7; out[d].n++; if (a.unit) out[d].h++; });
            return out;
        },
        dailyLoad() {
            const list = this.assignFiltered;
            const dem = E.dailyPeaks(list.map(a => [a.s, a.fr]));
            const used = E.dailyPeaks(list.filter(a => a.unit).map(a => [a.s, a.fr]));
            const off = dem.start !== null && used.start !== null ? Math.round((used.start - dem.start) / 86400000) : 0;
            const days = dem.peaks.map((d, i) => ({ t: dem.start + i * 86400000, demand: d, used: used.peaks[i - off] || 0 }));
            return { days, fleet: this.view.fleetIn };
        },
        bestFleet() { // segment bazında en kârlı araç sayısı (personel hariç)
            const out = {}; let n = 0, net = 0;
            this.view.segKeys.forEach(k => {
                const c = this.report.curves[k]; if (!c || !c.hasModel) return;
                const b = c.points.reduce((a, p) => (p.total > a.total + 1e-6 ? p : a), c.points[0]);
                out[k] = b; n += b.n; net += b.total;
            });
            return { bySeg: out, n, net };
        },
        execSummary() {
            const V = this.view, R = this.report, out = [];
            if (!R.plates.length && !V.files.total) return out;
            out.push(`<b>${this.formatCurrency(V.plateTotal)}</b> araçlık filo, ${this.formatCurrency(V.files.total)} dosyanın <b>${this.formatCurrency(V.files.handled)}</b> tanesini karşılıyor (<b>${this.pct(V.files.ratio)}</b>). Filo doluluğu <b>${this.pct(V.util)}</b>, net sonuç <b class="${V.total.net < 0 ? 'text-danger' : 'text-success'}">${this.shortMoney(V.total.net)}</b>.`);
            if (V.peak) out.push(`Dosyaların %80'ini karşılamak için <b>${this.formatCurrency(V.need80)}</b>, tamamını karşılamak için <b>${this.formatCurrency(V.peak)}</b> araç gerekiyor (en yoğun anda aynı anda kirada olması gereken araç sayısı).`);
            const bf = this.bestFleet; if (Object.keys(bf.bySeg).length) out.push(`Kârı en yükselten filo büyüklüğü <b>${this.formatCurrency(bf.n)}</b> araç; bu filo ile personel hariç ${this.hasSupplier ? 'şirket toplam neti (filo + tedarikçi marjı)' : 'net'} <b>${this.shortMoney(bf.net)}</b> (${Object.entries(bf.bySeg).map(([k, p]) => k + ': ' + p.n).join(', ')}).`);
            if (this.hasSupplier && V.sup.allDays) { const k = V.cmp; out.push(`Müşteriye günlük ortalama <b>${this.money(k.custDay)}</b> yansıtıyoruz. Kendi aracımızla günlük kârımız <b>${this.money(k.ownProfit)}</b> (gün maliyeti ${this.money(V.ownDayCost)}), tedarikçiyle <b>${this.money(k.supProfit)}</b> (tedarikçi ${this.money(k.supDay)}). Kendi aracı vermek günde <b class="${k.adv >= 0 ? 'text-success' : 'text-danger'}">${this.money(k.adv)}</b> ${k.adv >= 0 ? 'daha kârlı' : 'daha zararlı'}; filonun çalıştığı tüm günlerde toplam <b>${this.shortMoney(k.advTotal)}</b>. Tedarikçiye giden ${this.formatCurrency(V.sup.files)} dosyadan marj ${this.shortMoney(V.sup.margin)}, şirket toplam neti <b>${this.shortMoney(V.companyNet)}</b>.`); }
            if (V.breakEven !== null) out.push(`Başabaş doluluk oranı <b>${this.pct(V.breakEven)}</b>; filo doluluğu bunun altına düşerse zarar edilir (şu an ${this.pct(V.util)}).`);
            if (V.payback) out.push(`Yatırım <b>${V.payback.n}. yılda (${V.payback.year})</b> kendini geri ödüyor.`);
            else if (V.plateTotal) out.push(`Tanımlı yıllar içinde kümülatif net sonuç <b>pozitife dönmüyor</b>.`);
            const mr = [...V.modelRows].sort((a, b) => b.net / Math.max(1, b.cnt) - a.net / Math.max(1, a.cnt));
            if (mr.length > 1) out.push(`Araç başı en kârlı model <b>${mr[0].v.markaModel}</b> (${this.shortMoney(mr[0].net / Math.max(1, mr[0].cnt))}), en zayıf model <b>${mr[mr.length - 1].v.markaModel}</b> (${this.shortMoney(mr[mr.length - 1].net / Math.max(1, mr[mr.length - 1].cnt))}).`);
            const mo = this.monthly.filter(m => m.total); if (mo.length) { const top = mo.reduce((a, b) => (b.total > a.total ? b : a)); out.push(`Talebin en yoğun olduğu ay <b>${top.m}</b> (${this.formatCurrency(top.total)} dosya, karşılama ${this.pct(top.total ? top.handled / top.total * 100 : 0)}).`); }
            if (V.up.files || V.down.files) out.push(`Üst segmentle ${this.formatCurrency(V.up.files)}, alt segmentle ${this.formatCurrency(V.down.files)} ek dosya karşılandı; ek gelir <b>${this.shortMoney(V.up.gain + V.down.gain)}</b>.`);
            return out;
        },
        scenarioCompare() {
            const sumUp = (R, label, id) => {
                let work = 0, idle = 0, rev = 0, sale = 0, cost = 0, pers = 0;
                R.plates.forEach(p => p.life.forEach(y => { const r = p.byYear[y]; work += r.work; idle += r.idle; rev += r.revenue; sale += r.sale; cost += r.cost; pers += r.pers; }));
                const st = Object.values(R.sim.segStats), tot = st.reduce((a, s) => a + s.total, 0), h = st.reduce((a, s) => a + s.handled, 0);
                const net = rev + sale - cost - pers, sp = this.supplierCalc(R, null, null, () => true);
                return { id, label, sup: sp.margin, company: net + sp.margin, plates: R.plates.length, ratio: tot ? h / tot * 100 : 0, util: work + idle ? work / (work + idle) * 100 : 0, gelir: rev + sale, gider: cost + pers, net, perPlate: R.plates.length ? net / R.plates.length : 0 };
            };
            const rows = [sumUp(this.report, 'Mevcut durum', null)];
            this.settings.scenarios.forEach(s => {
                const R = E.buildReport({ vehicles: this.vehicles, files: this.parsedFiles, settings: this.settings, cutHour: this.timeRule, sim: s.sim, countsOverride: s.counts });
                rows.push(sumUp(R, s.ad, s.id));
            });
            return rows;
        },
        /* Simülatör kartlarının "nasıl hesaplandı" notları (kart başlığına göre) */
        tips() {
            const V = this.view, t = V.total, sm = this.shortMoney, m = this.money, f = this.formatCurrency, pc = this.pct, R = this.report;
            const fs = V.files, k = V.cmp || {}, gider = t.cost + t.pers;
            return {
                'Araç Satış Geliri': `Optimum satış yılını dolduran araçların satış tutarı, satış yılında gelir yazılır.\nAraç ömrü tanımlı yıllardan uzunsa satış hesaba katılmaz. Ay filtresi seçiliyken dahil edilmez.\nToplam: ${m(t.sale)}`,
                'Dosya Geliri': `Her plaka için: çalıştığı gün × günlük tutar (o yılın).\nÜst segment verilen dosya talep edilen segmentin, alt segment verilen dosya verilen segmentin tutarıyla fiyatlanır.\nGün sayımı: tam 24 saatler + 3 saatten fazla artan süre 1 gün.\nToplam: ${f(t.work)} gün → ${m(t.revenue)}`,
                'Araç İşletme Gideri': `Araç gider başlıklarının yıllık tutarları × araç adedi.\nYıllık tutar: baz yıl girilen tutar, sonraki yıllar enflasyonla artar. Km bazlı (bakım), ömür boyu adet (lastik), yılda adet (temizlik), tek seferlik ve yakıt km başlıkları kendi kurallarıyla hesaplanır. Araç başı detay: araç kartında "İncele".\nToplam: ${m(t.op)}`,
                'Alış Gideri': `Araç alış bedelinin anapara kısmı.\nPeşin: tamamı ilk kullanım yılına. Kredili: her yıl ödenen taksitlerin anapara kısmı; kredi araç ömründen uzunsa kalan anapara satış yılında kapatılır.\nToplam: ${m(t.buy)}`,
                'Faiz Gideri': `Kredili araçların taksitlerindeki faiz kısmı (eşit taksit; aylık faiz = yıllık faiz ÷ 12). Taksit ödendiği yıla yazılır.\nToplam: ${m(t.int)}`,
                'Personel Gideri': `Personel başlıklarının kişi başı yıllık tutarı × çalıştırılacak personel sayısı; enflasyonla artar.\nFilo geneli sabit gider olarak, o yıl aktif araçlara aldıkları dosya oranında dağıtılır.\nToplam: ${m(t.pers)}`,
                'Net Kâr / Zarar': `Araç satış geliri + dosya geliri − işletme − alış − faiz − personel\n= ${sm(t.sale)} + ${sm(t.revenue)} − ${sm(t.op)} − ${sm(t.buy)} − ${sm(t.int)} − ${sm(t.pers)}\n= ${m(t.net)}`,
                'Filo Doluluk Oranı': `Çalışılan gün ÷ (çalışılan + boşta gün).\nHer plaka dönem boyunca ${R.period} gün sayılır (tarihçe 1 yıllıksa 365).\n${f(t.work)} ÷ ${f(t.work + t.idle)} = ${pc(V.util)}`,
                'Karşılanan Dosya': `Talep: tarihçedeki dosya sayısı (seçili segment / ay).\nKarşılanan: araç verilebilen dosyalar (kendi segmenti + açıksa üst/alt segment).\nDosya, teslim anında boşta olan, segmentindeki en düşük giderli araca verilir; iade saati sınırından sonra dönen araç ertesi gün boşa çıkar.\n${f(fs.handled)} / ${f(fs.total)}`,
                'Karşılanan Dosya Oranı': `Karşılanan dosya ÷ talep edilen dosya.\n${f(fs.handled)} ÷ ${f(fs.total)} = ${pc(fs.ratio)}`,
                'Araç Sayısı': `Simülasyondaki plaka sayısı (araç kartlarındaki adetlerin toplamı).\nHiç dosya almayan: dönem boyunca bir kez bile kiralanmayan plaka.`,
                'Kendi Araçla Günlük Kâr': `Müşteriye yansıtılan ortalama günlük tutar − kendi aracımızın günlük maliyeti.\n${m(k.custDay)} − ${m(V.ownDayCost)} = ${m(k.ownProfit)}\nKendi araç günlük maliyeti = (işletme + alış + faiz + personel − araç satışı) ÷ çalışılan gün = ${sm(gider - t.sale)} ÷ ${f(t.work)}`,
                'Tedarikçiyle Günlük Kâr': `Aynı dosyaları tedarikçiye verseydik: müşteriye yansıtılan ortalama günlük tutar − tedarikçinin ortalama günlük tutarı.\n${m(k.custDay)} − ${m(k.supDay)} = ${m(k.supProfit)}\nOrtalamalar, kendi aracımızın çalıştığı günlerin segment / yıl dağılımıyla ağırlıklandırılır.`,
                'Kendi Aracın Günlük Avantajı': `Kendi araçla günlük kâr − tedarikçiyle günlük kâr = tedarikçi günlük tutarı − kendi araç günlük maliyeti.\n${m(k.supDay)} − ${m(V.ownDayCost)} = ${m(k.adv)}\nPozitifse araç almak tedarikçiye vermekten kârlı.\nToplam etki = günlük avantaj × çalışılan gün = ${m(k.advTotal)}`,
                'Tedarikçiye Giden Dosya': `Kendi aracımızla karşılanamayan ve tedarikçiye verilen dosyalar.\nMarj = gün × (müşteri günlük tutarı − tedarikçi günlük tutarı), yıllar toplamı.\nMüşteri ${m(V.sup.revenue)} − tedarikçi ${m(V.sup.cost)} = ${m(V.sup.margin)}\nTedarikçi tutarı girilmemiş segment / yıldaki dosyalar kayıp sayılır.`,
                'Şirket Toplam Neti': `Filo neti + tedarikçiye giden dosyalardan kalan marj.\n${m(t.net)} + ${m(V.sup.margin)} = ${m(V.companyNet)}`,
                'Başabaş Doluluk Oranı': `Gelirin çalışılan günle orantılı olduğu kabul edilir; giderler doluluktan bağımsızdır.\nBaşabaş = mevcut doluluk × (tüm giderler − araç satışı) ÷ dosya geliri\n= ${pc(V.util)} × ${sm(gider - t.sale)} ÷ ${sm(t.revenue)} = ${V.breakEven === null ? '-' : pc(V.breakEven)}`,
                '%100 Karşılama İçin Gereken Araç': `Tarihçede aynı anda kirada olması gereken en yüksek araç sayısı (iade saati kuralı dahil). Bu kadar araçla tüm dosyalar kendi segmentinde karşılanır.\n%80 için: dosyaların %80'ini karşılayan en az araç (${f(V.need80)}). Şu an: ${f(V.fleetIn)} araç.`,
                'Geri Ödeme Süresi': `Yıllık filo neti toplanarak ilerlenir (alış ilk yıl / taksitlerle gider, satış son yıl gelir).\nKümülatif net ilk kez sıfırın üzerine çıktığı yıl.`,
                'Ortalama Kiralama Süresi': `Karşılanan dosyaların kiralama gün sayısı ortalaması (24 saat + 3 saat kuralıyla).`,
                'Dosya Başı Araç Gideri': `Araç gideri (işletme + alış + faiz) ÷ dosya sayısı.\nDosya sayısı her kullanım yılı için tekrar sayılır (yıllar toplamı ${f(t.files)}).\n${sm(t.cost)} ÷ ${f(t.files)} = ${m(V.perFileVeh)}`,
                'Dosya Başı Personel Gideri': `Personel gideri ÷ dosya sayısı (yıllar toplamı).\n${sm(t.pers)} ÷ ${f(t.files)} = ${m(V.perFilePers)}`,
                'Dosya Başı Gelir': `(Dosya geliri + araç satışı) ÷ dosya sayısı (yıllar toplamı).\n${sm(t.revenue + t.sale)} ÷ ${f(t.files)} = ${m(V.perFileRev)}`,
                'Dosya Başı Net': `Net kâr / zarar ÷ dosya sayısı (yıllar toplamı).\n${sm(t.net)} ÷ ${f(t.files)} = ${m(V.perFileNet)}`,
                'Araç Başı Net (toplam)': `Net kâr / zarar ÷ plaka sayısı.\n${sm(t.net)} ÷ ${f(V.plateTotal)} = ${m(V.netPerPlate)}`,
                'Çalışılan Gün Başı Net': `Net kâr / zarar ÷ çalışılan gün.\n${sm(t.net)} ÷ ${f(t.work)} = ${m(V.netPerWorkDay)}`,
                'Araç Başı Ort. Çalışma': `Çalışılan gün ÷ (plaka × kullanım yılı). Bir aracın yılda ortalama kaç gün kirada olduğu.`,
                'Üst Segmentle Karşılanan': `Kendi segmentinde boş araç olmadığı için üst segment araçla verilen dosyalar.\nÖnce her araç kendi segmentinin dosyalarını alır; kalan dosyalar diğer araçların gerçekten boş kalan zamanlarına yerleştirilir (önce en yakın alt, sonra en yakın üst segment).`,
                'Üst Segment Teslim Oranı': `Üst segmentle karşılanan dosya ÷ tüm talep.\n${f(V.up.files)} ÷ ${f(fs.total)}`,
                'Üst Segmentten Ek Gelir': `Üst segment araçla verilen dosyaların geliri: gün × talep edilen segmentin günlük tutarı. Bu dosyalar başka türlü karşılanamayacaktı.`,
                'Fiyat Farkı (Feragat)': `Üst segment araç verip talep edilen (düşük) segmentin fiyatını aldığımız için vazgeçtiğimiz tutar: gün × (verilen segment tutarı − talep edilen segment tutarı).`,
                'Alt Segmentle Karşılanan': `Kendi segmentinde boş araç olmadığı için alt segment araçla verilen dosyalar. Alt segment önce denenir.`,
                'Alt Segment Teslim Oranı': `Alt segmentle karşılanan dosya ÷ tüm talep.\n${f(V.down.files)} ÷ ${f(fs.total)}`,
                'Alt Segmentten Ek Gelir': `Alt segment araçla verilen dosyaların geliri: gün × verilen (alt) segmentin günlük tutarı.`,
                'Gelir Kaybı': `Talep edilen segmentin tutarı yerine alt segmentin tutarını aldığımız için eksik kalan: gün × (talep edilen tutar − verilen tutar).`
            };
        },
        /* Raporlama: her analiz = başlık + bulgu + solda grafik, sağda aynı veri tablo olarak */
        reportBlocks() {
            if (this.activeTab !== 'raporlama' || !this.totalPlates) return [];
            const V = this.view, R = this.report, f = this.formatCurrency, sm = this.shortMoney, pc = this.pct, money = this.money;
            const c = (v, cl) => ({ v, c: cl || '' }), nc = n => this.netClass(n), B = [];
            // 1. Aylık talep ve karşılama
            const mo = this.monthly.filter(m => m.total), rt = m => (m.total ? m.handled / m.total * 100 : 0);
            const top = mo.length ? mo.reduce((a, b) => (b.total > a.total ? b : a)) : null, low = mo.length ? mo.reduce((a, b) => (rt(b) < rt(a) ? b : a)) : null;
            const tm = mo.reduce((a, m) => ({ total: a.total + m.total, handled: a.handled + m.handled, cross: a.cross + m.up + m.down, missed: a.missed + m.missed }), { total: 0, handled: 0, cross: 0, missed: 0 });
            B.push({ id: 'chMonthly', title: 'Aylık Talep ve Karşılama', sub: 'Her ay gelen dosyaların ne kadarına kendi filomuzla araç verebildik? Turuncu: karşılanan, gri: karşılanamayan. Çizgi aylık filo doluluğu.',
                insight: top ? `En yoğun ay ${top.m} (${f(top.total)} dosya). En düşük karşılama ${low.m} ayında: ${pc(rt(low))}.` : '',
                cols: ['Ay', 'Talep', 'Karşılanan', 'Üst/Alt Seg.', 'Karşılanamayan', 'Karşılama', 'Doluluk'],
                rows: mo.map(m => [c(m.m, 'text-start fw-bold'), c(f(m.total)), c(f(m.handled)), c(f(m.up + m.down)), c(f(m.missed), m.missed ? 'text-danger' : ''), c(pc(rt(m)), this.ratioClass(rt(m))), c(m.util === null ? '-' : pc(m.util))]),
                foot: [c('Toplam', 'text-start'), c(f(tm.total)), c(f(tm.handled)), c(f(tm.cross)), c(f(tm.missed)), c(pc(tm.total ? tm.handled / tm.total * 100 : 0)), c(pc(V.util))] });
            // 2. Gelirden net sonuca
            const t = V.total, gelir = t.revenue + t.sale, sh = x => pc(gelir ? x / gelir * 100 : 0);
            const wf = [['Dosya Geliri', t.revenue, '+'], ['Araç Satış Geliri', t.sale, '+'], ['Araç İşletme Gideri', -t.op, '−'], ['Alış Gideri', -t.buy, '−'], ['Faiz Gideri', -t.int, '−'], ['Personel Gideri', -t.pers, '−']];
            const wrows = wf.map(([l, v, sg]) => [c(sg + ' ' + l, 'text-start'), c(money(Math.abs(v)), v < 0 ? 'text-danger' : 'text-success'), c(sh(Math.abs(v)))]);
            wrows.push([c('= Filo Neti', 'text-start fw-bold'), c(money(t.net), 'fw-bold ' + nc(t.net)), c(sh(t.net))]);
            if (this.hasSupplier) { wrows.push([c('+ Tedarikçi Marjı', 'text-start'), c(money(V.sup.margin), nc(V.sup.margin)), c(sh(V.sup.margin))]); wrows.push([c('= Şirket Neti', 'text-start fw-bold'), c(money(V.companyNet), 'fw-bold ' + nc(V.companyNet)), c(sh(V.companyNet))]); }
            B.push({ id: 'chWaterfall', title: 'Gelirden Net Sonuca', sub: 'Toplam gelirin hangi giderlerle azalarak net sonuca dönüştüğü. Yeşil: gelir, kırmızı: gider.',
                insight: gelir ? `Her 100 ₺ gelirin ${f(t.net / gelir * 100)} ₺'si filo neti olarak kalıyor. En büyük gider kalemi: ${wf.slice(2).reduce((a, b) => (b[1] < a[1] ? b : a))[0]}.` : '',
                cols: ['Kalem', 'Tutar', 'Gelire Oranı'], rows: wrows });
            // 3. Gider yapısı
            const cats = V.catRows.filter(r => r.tutar > 0), bigC = cats[0];
            B.push({ id: 'chCost', title: 'Gider Yapısı', sub: 'Toplam giderin kategorilere göre dağılımı (araç ve personel giderleri birlikte).',
                insight: bigC ? `Giderin en büyük kısmı ${bigC.kategori}: ${pc(V.itemTotal ? bigC.tutar / V.itemTotal * 100 : 0)}.` : '',
                cols: ['Kategori', 'Grup', 'Tutar', 'Pay'],
                rows: cats.map(r => [c(r.kategori, 'text-start fw-bold'), c(r.grup, 'text-start'), c(money(r.tutar)), c(pc(V.itemTotal ? r.tutar / V.itemTotal * 100 : 0))]),
                foot: [c('Toplam', 'text-start'), c(''), c(money(V.itemTotal)), c('%100')] });
            // 4. Yıllar
            const Y = V.yearRows, cols4 = ['Yıl', 'Gelir', 'Gider', 'Filo Neti', 'Kümülatif'];
            if (this.hasSupplier) cols4.push('Şirket Neti');
            B.push({ id: 'chYears', title: 'Yıllara Göre Gelir, Gider ve Kümülatif Net', sub: 'Her yılın geliri ve gideri; turuncu çizgi yıllar ilerledikçe biriken net sonuç. Çizginin sıfırı geçtiği yıl yatırım geri dönmüş olur.',
                insight: V.payback ? `Yatırım ${V.payback.n}. yılda (${V.payback.year}) kendini geri ödüyor.` : 'Tanımlı yıllar içinde kümülatif net pozitife dönmüyor.',
                cols: cols4, rows: Y.map(r => { const row = [c(r.year, 'text-start fw-bold'), c(sm(r.revenue + r.sale)), c(sm(r.cost + r.pers)), c(sm(r.net), nc(r.net)), c(sm(r.cum), 'fw-bold ' + nc(r.cum))]; if (this.hasSupplier) row.push(c(sm(r.company), nc(r.company))); return row; }) });
            // 5. Filo büyüklüğü eğrisi
            const cs = this.curveSeg, cv = cs ? R.curves[cs] : null;
            if (cv) {
                const pts = cv.points, cur = R.plates.filter(p => p.seg === cs).length, crow = [];
                const mk = (label, p, cl) => { const r = [c(label, 'text-start ' + (cl || '')), c(f(p.n)), c(pc(p.coverage)), c(p.net === null ? '-' : sm(p.net), p.net === null ? '' : nc(p.net))]; if (cv.hasSup) r.push(c(sm(p.total), nc(p.total))); return r; };
                [50, 60, 70, 80, 90, 95, 100].forEach(x => { const p = pts.find(q => q.handled >= x / 100 * cv.total - 1e-9); if (p) crow.push(mk('%' + x + ' karşılama', p)); });
                if (pts[cur]) crow.push(mk('Mevcut filo', pts[cur], 'fw-bold text-orange'));
                let best = null; if (cv.hasModel) { best = pts.reduce((a, p) => (p.total > a.total + 1e-6 ? p : a), pts[0]); crow.push(mk('En kârlı', best, 'fw-bold text-success')); }
                const cols5 = ['Hedef', 'Araç', 'Karşılama', 'Filo Neti']; if (cv.hasSup) cols5.push('Şirket Neti');
                const p80 = pts.find(q => q.handled >= 0.8 * cv.total - 1e-9);
                B.push({ id: 'chCurve', title: 'Filo Büyüklüğü – Karşılama – Kâr', sub: `${cs} segmentinde araç sayısı arttıkça karşılama oranı (turuncu) ve net sonuç (koyu${cv.hasSup ? ', mavi: şirket neti' : ''}) nasıl değişir? Nokta mevcut filodur. Personel gideri hariçtir.`,
                    insight: `${cs} segmentinde %80 karşılama için ${p80 ? f(p80.n) : '-'} araç, tamamı için ${f(cv.peak)} araç gerekir.` + (best ? ` Kârı en yüksek yapan araç sayısı ${f(best.n)}.` : ''),
                    cols: cols5, rows: crow, segSelect: true });
            }
            // 6. Plaka doluluğu
            const P = V.plateRowsAll, bk = [['%90 ve üzeri', 90, 101], ['%75 – %90', 75, 90], ['%50 – %75', 50, 75], ['%25 – %50', 25, 50], ['%25 altı', -1, 25]];
            const prow = bk.map(([l, lo, hi]) => { const g = P.filter(r => r.util >= lo && r.util < hi), n = g.length; return [c(l, 'text-start fw-bold'), c(f(n)), c(pc(P.length ? n / P.length * 100 : 0)), c(n ? money(g.reduce((a, r) => a + r.net, 0) / n) : '-', n ? nc(g.reduce((a, r) => a + r.net, 0)) : '')]; });
            const lowN = P.filter(r => r.util < 50).length;
            B.push({ id: 'chPlates', title: 'Araç Bazında Doluluk', sub: 'Her çubuk bir araç; araçlar yılın yüzde kaçında kirada olduğuna göre sıralı. Yeşil: %75 üstü, sarı: %50–75, kırmızı: %50 altı.',
                insight: lowN ? `${f(lowN)} aracın doluluğu %50'nin altında; bu araçlar filodan çıkarılmaya aday.` : 'Tüm araçların doluluğu %50\'nin üzerinde.',
                cols: ['Doluluk', 'Araç', 'Pay', 'Araç Başı Ort. Net'], rows: prow });
            // 7. Günlük ihtiyaç
            const D = this.dailyLoad, byM = {};
            D.days.forEach(d => { const k = new Date(d.t).getMonth(); const o = byM[k] || (byM[k] = { max: 0, sum: 0, n: 0, over: 0 }); o.max = Math.max(o.max, d.demand); o.sum += d.demand; o.n++; if (d.demand > D.fleet) o.over++; });
            const over = Object.values(byM).reduce((a, o) => a + o.over, 0), mx = D.days.reduce((a, d) => (d.demand > a.demand ? d : a), { demand: 0, t: 0 });
            B.push({ id: 'chDaily', title: 'Günlük Araç İhtiyacı ve Filo Kapasitesi', sub: 'Gri alan: her gün aynı anda ihtiyaç duyulan araç. Turuncu: kirada olan aracımız. Kesikli çizgi: filodaki araç sayısı. Gri alan çizgiyi aştığında dosya karşılanamıyor.',
                insight: `${f(over)} günde ihtiyaç filo kapasitesini (${f(D.fleet)} araç) aştı. En yüksek ihtiyaç ${f(mx.demand)} araç${mx.t ? ' (' + new Date(mx.t).toLocaleDateString('tr-TR') + ')' : ''}.`,
                cols: ['Ay', 'En Yüksek İhtiyaç', 'Ortalama İhtiyaç', 'Filo', 'Kapasite Aşılan Gün'],
                rows: Object.keys(byM).map(Number).sort((a, b) => a - b).map(k => { const o = byM[k]; return [c(MONTHS[k], 'text-start fw-bold'), c(f(o.max)), c(f(o.sum / o.n)), c(f(D.fleet)), c(f(o.over), o.over ? 'text-danger fw-bold' : '')]; }) });
            // 8. Segment
            const S = V.segmentRows.filter(r => r.cnt || r.total), bestS = S.filter(r => r.cnt).reduce((a, r) => (!a || r.net > a.net ? r : a), null);
            B.push({ id: 'chSegments', title: 'Segment Karşılaştırması', sub: 'Segment bazında gelir (yeşil), gider (kırmızı) ve net (turuncu).',
                insight: bestS ? `En kârlı segment ${bestS.seg} (net ${sm(bestS.net)}).` : '',
                cols: ['Segment', 'Araç', 'Karşılama', 'Gelir', 'Gider', 'Net'],
                rows: S.map(r => [c(r.seg, 'text-start fw-bold'), c(f(r.cnt)), c(pc(r.ratio), this.ratioClass(r.ratio)), c(sm(r.revenue + r.sale)), c(sm(r.cost + r.pers)), c(sm(r.net), nc(r.net))]) });
            // 9. Kiralama süresi
            const H = this.rentalHist, hn = H.reduce((a, h) => a + h.n, 0), le7 = H.slice(0, 5).reduce((a, h) => a + h.n, 0);
            B.push({ id: 'chRental', title: 'Kiralama Süresi Dağılımı', sub: 'Dosyaların kaç gün sürdüğü (tüm talep).',
                insight: hn ? `Dosyaların ${pc(le7 / hn * 100)}'i 7 gün veya daha kısa; ortalama kiralama ${(V.avgRental || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} gün.` : '',
                cols: ['Süre', 'Dosya', 'Pay'], rows: H.map(h => [c(h.l, 'text-start fw-bold'), c(f(h.n)), c(pc(hn ? h.n / hn * 100 : 0))]),
                foot: [c('Toplam', 'text-start'), c(f(hn)), c('%100')] });
            // 10. Haftanın günleri
            const W = this.weekday, wt = W.reduce((a, w) => (w.n > a.n ? w : a), W[0]);
            B.push({ id: 'chWeek', title: 'Haftanın Günlerine Göre Teslimat', sub: 'Hangi gün kaç dosya teslim edildi; vale ve personel planlaması için.',
                insight: wt && wt.n ? `En yoğun gün ${wt.l} (${f(wt.n)} teslimat).` : '',
                cols: ['Gün', 'Teslimat', 'Karşılanan', 'Karşılama'],
                rows: W.map(w => [c(w.l, 'text-start fw-bold'), c(f(w.n)), c(f(w.h)), c(pc(w.n ? w.h / w.n * 100 : 0), this.ratioClass(w.n ? w.h / w.n * 100 : 0))]) });
            return B;
        },
        /* Detaylı veri seti */
        dsRows() {
            const R = this.report, F = this.filters, q = this.ds.search.trim().toLocaleLowerCase('tr');
            if (this.ds.type === 'dosya') {
                const plate = {}; R.plates.forEach(p => { plate[p.id] = p; });
                const y = F.year === 'all' ? R.years[0] : Number(F.year);
                const rate = (sg) => Number(((this.settings.gunlukTutar || {})[sg] || {})[y]) || 0;
                const st = this.ds.status;
                return this.assignFiltered.filter(a => {
                    const p = a.unit ? plate[a.unit] : null;
                    if (F.vid !== 'all' && (!p || p.vid !== F.vid)) return false;
                    if (st !== 'all' && (st === 'missed' ? a.unit : a.kind !== st)) return false;
                    if (q && !(String(a.no) + ' ' + (p ? p.plate + ' ' + p.model : '')).toLocaleLowerCase('tr').includes(q)) return false;
                    return true;
                }).map(a => {
                    const p = a.unit ? plate[a.unit] : null, ps = a.kind === 'down' ? a.given : a.seg;
                    return { 'Dosya No': a.no, 'Talep Segmenti': a.seg, 'Teslimat': E.formatDate(a.s), 'İade': E.formatDate(a.e), 'Gün': a.days,
                        'Durum': { own: 'Kendi segmenti', up: 'Üst segment', down: 'Alt segment' }[a.kind] || 'Karşılanamadı',
                        'Verilen Segment': a.given || '-', 'Plaka': p ? p.plate : '-', 'Araç': p ? p.model : '-',
                        ['Gelir (' + y + ')']: a.unit ? a.days * rate(ps) : 0 };
                });
            }
            const V = this.view, out = [], mi = V.mi;
            V.plateRowsAll.forEach(r => {
                const p = r.p;
                if (q && !(p.plate + ' ' + p.model).toLocaleLowerCase('tr').includes(q)) return;
                p.life.forEach(y => {
                    if (F.year !== 'all' && String(y) !== String(F.year)) return;
                    const b = p.byYear[y], dim = mi === null ? 0 : new Date(this.report.dataYear || 2026, mi + 1, 0).getDate(), mf = mi === null ? 1 : dim / 365;
                    const work = mi === null ? b.work : p.months[mi].work, idle = mi === null ? b.idle : Math.max(0, dim - work);
                    const rev = mi === null ? b.revenue : b.mRev[mi], sale = mi === null ? b.sale : 0, op = b.op * mf, buy = b.buy * mf, int = b.int * mf, pers = b.pers * mf;
                    out.push({ 'Plaka': p.plate, 'Araç': p.model, 'Segment': p.seg, 'Yıl': y, 'Dosya': Math.round(mi === null ? p.files : p.months[mi].files),
                        'Çalışılan Gün': work, 'Boşta Gün': idle, 'Doluluk %': work + idle ? Math.round(work / (work + idle) * 1000) / 10 : 0,
                        'Dosya Geliri': rev, 'Araç Satış Geliri': sale, 'İşletme Gideri': op, 'Alış Gideri': buy, 'Faiz Gideri': int, 'Personel Payı': pers, 'Net': rev + sale - op - buy - int - pers });
                });
            });
            return out;
        },
        dsCols() { return this.dsRows.length ? Object.keys(this.dsRows[0]) : []; },
        dsPages() { return Math.max(1, Math.ceil(this.dsRows.length / this.ds.size)); },
        dsPageRows() { const s = (this.ds.page - 1) * this.ds.size; return this.dsRows.slice(s, s + this.ds.size); },
        dsButtons() { return this.pager(this.ds.page, this.dsPages); }
    },
    mounted() {
        this.loadData();
        this.vehicleModal = new bootstrap.Modal(document.getElementById('vehicleModal'));
        this.costModal = new bootstrap.Modal(document.getElementById('costModal'));
        this.plateModal = new bootstrap.Modal(document.getElementById('plateModal'));
        this.confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
        this.scenarioModal = new bootstrap.Modal(document.getElementById('scenarioModal'));
        document.getElementById('scenarioModal').addEventListener('shown.bs.modal', () => { const el = document.getElementById('scenarioNameInput'); if (el) el.focus(); });
        this.headerModal = new bootstrap.Modal(document.getElementById('headerModal'));
        document.getElementById('headerModal').addEventListener('shown.bs.modal', () => { const el = document.getElementById('hdrEditInput'); if (el) el.focus(); });
        this.tempVehicle = this.getEmptyVehicle();
        try { this.costClip = JSON.parse(localStorage.getItem(STORAGE_KEY + '_kopya') || 'null'); } catch (e) { this.costClip = null; }
        this.$watch(() => [this.settings, this.vehicles, this.historicalData, this.timeRule], () => this.scheduleSave(), { deep: true });
        this.$watch(() => [this.filters.seg, this.filters.vid, this.filters.month, this.plateSearch], () => { this.plateLimit = 100; });
        this.$watch(() => this.filters.seg, () => { if (this.filters.vid !== 'all' && !this.brandOptions.some(v => v.id === this.filters.vid)) this.filters.vid = 'all'; });
        this.$watch(() => this.activeTab, () => { const mc = document.querySelector('.main-content'); if (mc) mc.scrollTop = 0; this.headerError = ''; this.newHeader = ''; this.newCategory = ''; this.newAmount = null; this.newTip = 'yillik'; });
        if (window.CloudSync && window.CloudSync.enabled) window.CloudSync.init(this);
        else { this.auth.state = 'in'; this.sync.loaded = true; this.sync.status = 'local'; }
        this.$watch(() => this.settings.sim.target, t => { if (t !== 'manual' && this.authed) this.$nextTick(() => this.applyTarget(t)); });
        this.$watch(() => this.authed, a => { if (a && this.settings.sim.target !== 'manual') this.$nextTick(() => this.applyTarget(this.settings.sim.target)); }, { immediate: true });
        this.$watch(() => [this.persSummary.suggested, this.settings.personelKilit], () => this.syncPersonnel(), { immediate: true });
        this.$watch(() => this.histSize, () => { this.histPage = 1; });
        this.$watch(() => this.histPages, n => { if (this.histPage > n) this.histPage = n; });
        this.$watch(() => [this.ds.type, this.ds.status, this.ds.search, this.ds.size, this.filters.year, this.filters.month, this.filters.seg, this.filters.vid], () => { this.ds.page = 1; });
        this.$watch(() => [this.activeTab, this.view, this.curveSeg, this.authed], () => this.scheduleCharts(), { flush: 'post' });
    },
    methods: {
        /* ---- Uygulama içi onay penceresi (Evet / Hayır) ---- */
        askConfirm(text, info = false) {
            this.confirmText = text; this.confirmInfo = info;
            this.confirmModal.show();
            return new Promise(res => { this.confirmResolve = res; });
        },
        answer(v) {
            this.safeHide(this.confirmModal, 'confirmModal');
            const r = this.confirmResolve; this.confirmResolve = null;
            if (r) r(v);
        },
        notify(text) {
            this.toast.text = text; this.toast.show = true;
            clearTimeout(this._toastT); this._toastT = setTimeout(() => { this.toast.show = false; }, 1800);
        },
        onCloudSaved() { this.notify('Kaydedildi'); },
        showTip(e, key) {
            const text = this.tips[key]; if (!text) return;
            const r = e.currentTarget.getBoundingClientRect(), W = 340;
            const x = Math.max(8, Math.min(window.innerWidth - W - 8, r.right - W + 10));
            const up = r.bottom + 220 > window.innerHeight;
            this.tip = { show: true, text, x, y: up ? r.top - 8 : r.bottom + 8, up };
        },
        hideTip() { this.tip.show = false; },
        /* Personel sayısı kilidi: açıkken önerilen sayıdan otomatik; elle değiştirince kilitlenir */
        onPersInput(v) { this.settings.personelSayisi = v; if (!this.settings.personelKilit) this.settings.personelKilit = true; },
        togglePersLock() {
            this.settings.personelKilit = !this.settings.personelKilit;
            if (!this.settings.personelKilit) this.syncPersonnel();
        },
        syncPersonnel() {
            const sug = this.persSummary.suggested;
            if (!this.settings.personelKilit && sug !== null && this.settings.personelSayisi !== sug) this.settings.personelSayisi = sug;
        },
        /* Açılış animasyonu sürerken kapatma isteği Bootstrap'ta yok sayılır; animasyon bitince kapat */
        safeHide(m, id) {
            const el = document.getElementById(id);
            if (m._isTransitioning) el.addEventListener('shown.bs.modal', () => m.hide(), { once: true }); else m.hide();
        },
        go(tab) { this.activeTab = tab; },
        pager(c, n) {
            const set = new Set([1, n, c, c - 1, c + 1, c - 2, c + 2].filter(p => p >= 1 && p <= n));
            const arr = [...set].sort((a, b) => a - b), out = [];
            arr.forEach((p, i) => { if (i && p - arr[i - 1] > 1) out.push('…'); out.push(p); });
            return out;
        },

        /* ---- Giriş / Bulut ---- */
        async login() {
            if (this.auth.busy) return;
            const email = this.auth.email.trim();
            if (!email || !this.auth.password) { this.auth.error = 'E-posta ve şifre yazın.'; return; }
            this.auth.busy = true; this.auth.error = '';
            const err = await window.CloudSync.signIn(email, this.auth.password);
            this.auth.busy = false;
            if (err) this.auth.error = err; else { this.auth.password = ''; this.showPass = false; }
        },
        async logout() {
            if (!await this.askConfirm('Çıkış yapmak istediğinize emin misiniz?')) return;
            await window.CloudSync.signOut();
            this.resetLocal();
        },
        resetLocal() {
            clearTimeout(this._t);
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* yoksay */ }
            this.settings = normalizeSettings(defaultSettings()); this.vehicles = []; this.historicalData = [];
            this.timeRule = 15; this.filters = EMPTY_FILTERS(); this.activeTab = 'tahminleme';
        },
        currentData() { return { settings: this.settings, vehicles: this.vehicles, historicalData: this.historicalData, timeRule: this.timeRule }; },
        backupLocal() {
            try { const cur = localStorage.getItem(STORAGE_KEY); if (cur) localStorage.setItem(STORAGE_KEY + '_backup', cur); } catch (e) { /* yoksay */ }
        },
        remoteSettings(o) { this.settings = normalizeSettings(o); },
        remoteTimeRule(n) { this.timeRule = n; },
        remoteVehiclesReplace(list) { this.vehicles = list.map(normalizeVehicle); },
        remoteVehicle(v) {
            const nv = normalizeVehicle(v), i = this.vehicles.findIndex(x => String(x.id) === String(nv.id));
            if (i > -1) this.vehicles[i] = nv; else this.vehicles.push(nv);
        },
        remoteVehicleRemove(id) {
            const i = this.vehicles.findIndex(x => String(x.id) === String(id));
            if (i > -1) this.vehicles.splice(i, 1);
        },
        remoteVehicleImage(id, img) {
            const v = this.vehicles.find(x => String(x.id) === String(id));
            if (v) v.imageBase64 = img || '';
        },
        remoteHist(arr) { this.historicalData = arr; },

        /* ---- Kayıt ---- */
        scheduleSave() { clearTimeout(this._t); this._t = setTimeout(() => this.saveData(), 400); },
        saveData() {
            Store.save({ settings: this.settings, vehicles: this.vehicles, historicalData: this.historicalData, timeRule: this.timeRule });
            if (!(window.CloudSync && window.CloudSync.enabled)) this.notify('Kaydedildi');
        },
        applyData(d) {
            this.settings = normalizeSettings(d.settings);
            this.vehicles = (d.vehicles || []).map(normalizeVehicle);
            this.historicalData = d.historicalData || [];
            if (d.timeRule !== undefined) this.timeRule = d.timeRule;
        },
        loadData() {
            const saved = Store.load();
            if (saved) this.applyData(saved); else this.settings = normalizeSettings(defaultSettings());
        },

        /* ---- Gider / Personel Başlıkları (aynı mantık) ---- */
        addHeader() {
            const name = this.newHeader.trim();
            if (!name) { this.headerError = 'Lütfen bir başlık yazın.'; return; }
            if (this.isP && (this.newAmount === null || this.newAmount === undefined)) { this.headerError = 'Lütfen kişi başı yıllık tutarı yazın.'; return; }
            const taken = this.isP ? this.settings.personelTanimlari.map(h => h.ad) : [...DEFAULT_HEADERS, ...this.settings.giderTanimlari.map(h => h.ad)];
            if (taken.some(n => n.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) { this.headerError = 'Bu başlık zaten var.'; return; }
            const item = { ad: name, kategori: this.newCategory.trim() || (this.newTip === 'yakit' ? 'Yakıt' : 'Diğer') };
            if (this.isP) item.tutar = this.newAmount; else item.tip = this.newTip;
            this.hdrList.push(item);
            this.newHeader = ''; this.newCategory = ''; this.newAmount = null; this.newTip = 'yillik'; this.headerError = '';
        },
        async removeHeader(index) {
            const h = this.hdrList[index];
            if (!await this.askConfirm(`'${h.ad}' başlığını silmek istediğinize emin misiniz?`)) return;
            const i = this.hdrList.indexOf(h); if (i < 0) return;
            this.hdrList.splice(i, 1);
            if (!this.isP) this.vehicles.forEach(v => { delete v.giderler[h.ad]; if (v.giderAdet) delete v.giderAdet[h.ad]; });
        },
        openHeaderEdit(i) {
            const h = this.hdrList[i];
            this.hdrEdit = { isP: this.isP, index: i, ad: h.ad, kategori: h.kategori || '', error: '' };
            this.headerModal.show();
        },
        saveHeaderEdit() {
            const e = this.hdrEdit, list = e.isP ? this.settings.personelTanimlari : this.settings.giderTanimlari, h = list[e.index];
            if (!h) { this.safeHide(this.headerModal, 'headerModal'); return; }
            const ad = e.ad.trim();
            if (!ad) { e.error = 'Başlık boş olamaz.'; return; }
            const taken = e.isP ? list.filter(x => x !== h).map(x => x.ad) : [...DEFAULT_HEADERS, ...list.filter(x => x !== h).map(x => x.ad)];
            if (taken.some(n => n.toLocaleLowerCase('tr') === ad.toLocaleLowerCase('tr'))) { e.error = 'Bu başlık zaten var.'; return; }
            const old = h.ad;
            if (!e.isP && old !== ad) { // araçlarda girilmiş değerler yeni başlığa taşınır
                this.vehicles.forEach(v => {
                    if (v.giderler && old in v.giderler) { v.giderler[ad] = v.giderler[old]; delete v.giderler[old]; }
                    if (v.giderAdet && old in v.giderAdet) { v.giderAdet[ad] = v.giderAdet[old]; delete v.giderAdet[old]; }
                });
            }
            h.ad = ad; h.kategori = e.kategori.trim() || 'Diğer';
            this.safeHide(this.headerModal, 'headerModal');
            this.notify('Başlık güncellendi');
        },
        onDrop(i) {
            if (this.dragIndex < 0 || this.dragIndex === i) { this.dragIndex = -1; return; }
            const list = this.hdrList, [m] = list.splice(this.dragIndex, 1);
            list.splice(i, 0, m); this.dragIndex = -1;
        },

        /* ---- Yıllar ---- */
        addYear() {
            const y = Number(this.newYear);
            if (y >= 2000 && y <= 2100 && !this.settings.enflasyonYillari.includes(y)) {
                this.settings.enflasyonYillari.push(y);
                this.settings.enflasyonYillari.sort((a, b) => a - b);
                this.settings = normalizeSettings(this.settings);
            }
            this.newYear = null;
        },
        async removeYear(y) {
            if (this.settings.enflasyonYillari.length <= 1) return;
            if (!await this.askConfirm(`${y} yılını silmek istediğinize emin misiniz?`)) return;
            this.settings.enflasyonYillari = this.settings.enflasyonYillari.filter(v => v !== y);
            delete this.settings.enflasyonOranlari[y];
            FUELS.forEach(f => delete this.settings.yakitFiyatlari[f][y]);
            SEGMENTS.forEach(s => delete this.settings.gunlukTutar[s][y]);
            if (String(this.filters.year) === String(y)) this.filters.year = 'all';
        },

        /* ---- Araç ---- */
        getEmptyVehicle() {
            return { id: 'v' + Date.now(), markaModel: '', segment: 'B', yakitTuru: 'Benzin', alisBedeli: null, kredili: false, vade: null, faiz: null,
                satisTutari: null, imageBase64: '', count: 0, giderler: {}, giderAdet: {} };
        },
        openVehicleModal(index = -1) {
            this.editingVehicleIndex = index; this.submitted = false;
            this.editingVehicleId = index > -1 ? this.vehicles[index].id : null;
            this.tempVehicle = index > -1 ? normalizeVehicle(JSON.parse(JSON.stringify(this.vehicles[index]))) : this.getEmptyVehicle();
            this.allHeaders.forEach(h => { if (this.tempVehicle.giderler[h] === undefined) this.tempVehicle.giderler[h] = null; });
            this.settings.giderTanimlari.forEach(h => { if ((this.tipOf(h.ad) || {}).n && this.tempVehicle.giderAdet[h.ad] === undefined) this.tempVehicle.giderAdet[h.ad] = null; });
            this.photoKey++; // dosya seçme alanı her açılışta boş gelsin
            this.vehicleModal.show();
        },
        tipOf(name) { const h = this.hdrByName[name]; return h ? this.costTypes[h.tip] || this.costTypes.yillik : null; },
        adetInvalid(h) { return this.submitted && !!(this.tipOf(h) || {}).n && this.empty(this.tempVehicle.giderAdet[h]); },
        fieldCfg(h) {
            if (h === DEFAULT_HEADERS[0]) return { step: 1, decimals: false, min: 1 };
            if (h === DEFAULT_HEADERS[2]) return { step: 0.1, decimals: true, min: 0 };
            return { step: 1, decimals: false, min: 0 };
        },
        empty(x) { return x === null || x === undefined || x === ''; },
        fieldInvalid(h) {
            if (!this.submitted) return false;
            const v = this.tempVehicle.giderler[h];
            return this.empty(v) || (h === DEFAULT_HEADERS[0] && v < 1);
        },
        topInvalid(k) {
            if (!this.submitted) return false;
            const t = this.tempVehicle;
            if (k === 'vade' || k === 'faiz') return t.kredili && this.empty(t[k]);
            return this.empty(t[k]);
        },
        formInvalid() { return !this.tempVehicle.markaModel.trim() || ['alisBedeli', 'satisTutari', 'vade', 'faiz'].some(k => this.topInvalid(k)) || this.allHeaders.some(h => this.fieldInvalid(h) || this.adetInvalid(h)); },
        loanPreview() {
            const t = this.tempVehicle;
            if (!t || !t.kredili || !Number(t.vade) || !Number(t.alisBedeli)) return null;
            return E.loanSchedule(t.alisBedeli, t.vade, t.faiz);
        },
        /* Gider ve performans verilerini kopyala / yapıştır (temel bilgiler hariç) */
        copyCosts() {
            const t = this.tempVehicle, giderler = {}, giderAdet = {};
            this.allHeaders.forEach(h => { giderler[h] = t.giderler[h]; if (t.giderAdet && h in t.giderAdet) giderAdet[h] = t.giderAdet[h]; });
            this.costClip = { from: t.markaModel.trim() || 'Adsız araç', giderler: JSON.parse(JSON.stringify(giderler)), giderAdet: JSON.parse(JSON.stringify(giderAdet)) };
            try { localStorage.setItem(STORAGE_KEY + '_kopya', JSON.stringify(this.costClip)); } catch (e) { /* yoksay */ }
            this.notify(`'${this.costClip.from}' gider verileri kopyalandı`);
        },
        pasteCosts() {
            const c = this.costClip; if (!c) return;
            const t = this.tempVehicle;
            this.allHeaders.forEach(h => {
                if (h in c.giderler) t.giderler[h] = c.giderler[h];
                if ((this.tipOf(h) || {}).n && h in c.giderAdet) t.giderAdet[h] = c.giderAdet[h];
            });
            this.notify(`'${c.from}' verileri yapıştırıldı`);
        },
        handleImageUpload(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = () => { // depolamayı doldurmamak için küçült
                    const k = Math.min(1, 480 / img.width), c = document.createElement('canvas');
                    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    const png = c.toDataURL('image/png');
                    this.tempVehicle.imageBase64 = png.length < 400000 ? png : c.toDataURL('image/jpeg', 0.8);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        },
        saveVehicle() {
            this.submitted = true;
            if (this.formInvalid()) return;
            this.tempVehicle.markaModel = this.tempVehicle.markaModel.trim();
            if (!this.tempVehicle.kredili) { this.tempVehicle.vade = null; this.tempVehicle.faiz = null; }
            const copy = JSON.parse(JSON.stringify(this.tempVehicle));
            const ei = this.editingVehicleId === null ? -1 : this.vehicles.findIndex(x => String(x.id) === String(this.editingVehicleId));
            if (ei > -1) this.vehicles[ei] = copy; else this.vehicles.push(copy);
            this.vehicleModal.hide();
        },
        async deleteVehicle(v) {
            if (await this.askConfirm(`'${v.markaModel}' aracını silmek istediğinize emin misiniz?`)) this.vehicles.splice(this.vehicles.indexOf(v), 1);
        },
        isComplete(v) { return E.isVehicleComplete(v, this.settings); },
        missingOf(v) { return E.missingFields(v, this.settings); },

        /* ---- Tarihçe ---- */
        async clearHistoricalData() {
            if (await this.askConfirm('Tüm tarihçe verilerini silmek istediğinize emin misiniz?')) { this.historicalData = []; this.importMsg = ''; this.histPage = 1; }
        },
        /* Yeni yükleme mevcut tarihçeyi siler, yerine yeni verileri yazar */
        async addRecords(rows) {
            const { records, bad } = E.rowsToRecords(rows);
            if (!records.length) { this.importMsg = `Yüklenebilir kayıt bulunamadı${bad ? ` (${bad} satır okunamadı: segment/tarih kontrol edin)` : ''}. Mevcut veriler değiştirilmedi.`; return; }
            const seen = new Set(), fresh = [];
            records.forEach(r => {
                const k = [r.dosyaNo, r.segment, r.teslimat, r.iade].join('|');
                if (!seen.has(k)) { seen.add(k); fresh.push(r); }
            });
            const old = this.historicalData.length;
            if (old && !await this.askConfirm(`Mevcut ${this.formatCurrency(old)} kayıt silinecek ve yerine ${this.formatCurrency(fresh.length)} yeni kayıt yüklenecek. Devam edilsin mi?`)) {
                this.importMsg = 'Yükleme iptal edildi, mevcut veriler korundu.'; return;
            }
            this.historicalData = fresh; this.histPage = 1;
            this.importMsg = `${fresh.length} kayıt yüklendi` + (old ? ` (önceki ${old} kayıt silindi)` : '') + (records.length - fresh.length ? `, ${records.length - fresh.length} mükerrer satır atlandı` : '') + (bad ? `, ${bad} satır okunamadı (segment/tarih kontrol edin)` : '') + '.';
        },
        /* Başlıkları kontrol eder; eksik varsa yüklemeyi durdurur ve hangi başlığın bulunamadığını söyler */
        async importTable(table, strict) {
            const headerless = !strict && table.length && E.parseDate(table[0][2]) !== null; // yapıştırmada başlıksız veri kabul
            if (!headerless) {
                const miss = E.missingHeaders(table);
                if (miss.length) {
                    this.importMsg = '';
                    await this.askConfirm(`Yükleme tamamlanamadı: ${miss.map(m => '"' + m + '"').join(', ')} başlığı bulunamadı. İlk satırda "Dosya Numarası", "Segment", "Araç Teslimat Tarihi" ve "Araç İade Tarihi" sütun başlıkları olmalı. Mevcut veriler değiştirilmedi.`, true);
                    return;
                }
            }
            await this.addRecords(E.tableToRows(table));
        },
        handleFileUpload(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            if (/\.csv$/i.test(file.name)) {
                reader.onload = e => this.importTable(E.parseCSV(e.target.result), true);
                reader.readAsText(file, 'utf-8');
            } else {
                reader.onload = e => {
                    const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    const table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
                    this.importTable(table, true);
                };
                reader.readAsArrayBuffer(file);
            }
            event.target.value = '';
        },
        addPasted() {
            const table = this.pasteText.split(/\r?\n/).filter(l => l.trim()).map(l => l.split('\t'));
            this.importTable(table, false);
            this.pasteText = '';
        },

        /* ---- Simülatör ---- */
        effCount(v) { return this.report.counts[v.id] || 0; },
        vehicleTotal(v) { const c = this.report.vehicleCosts[v.id]; return c ? c.total : 0; },
        showCostDetails(v) { this.activeCostVehicle = v; this.costModal.show(); },
        showPlate(p) { this.activePlate = p; this.plateModal.show(); },
        costOf(id) { return this.report.vehicleCosts[id]; },
        setCount(v, val) { v.count = Math.max(0, Math.floor(Number(val) || 0)); },
        /* Hedef karşılama oranı: adetleri bir kez hesaplayıp araçlara yazar; sonra adetler elle değiştirilebilir */
        setTarget(val) {
            const t = val === 'manual' || val === 'best' ? val : Number(val);
            if (t === 'manual') { this.settings.sim.preset = 'manual'; return; }
            this.applyTarget(t);
        },
        applyTarget(t) {
            const R = E.buildReport({ vehicles: this.vehicles, files: this.parsedFiles, settings: this.settings, cutHour: this.timeRule, sim: { ...this.settings.sim, target: t } });
            this.vehicles.forEach(v => { if (v.id in R.counts) v.count = R.counts[v.id]; });
            this.settings.sim.target = 'manual';
            this.settings.sim.preset = t;
            this.notify(t === 'best' ? 'En kârlı filo adetleri uygulandı' : `%${t} hedefine göre adetler uygulandı`);
        },
        presetLabel(p) { return p === 'best' ? 'en kârlı filo' : '%' + p + ' karşılama'; },
        clearFilters() { this.filters = EMPTY_FILTERS(); this.plateSearch = ''; },
        async resetScenario() {
            if (!await this.askConfirm('Tüm araç adetleri 0 yapılacak, hedef karşılama oranı "Manuel"e dönecek ve üst/alt segment seçenekleri kapatılacak. Bu değişiklik bütün kullanıcılar için geçerli olur. Devam edilsin mi?')) return;
            this.vehicles.forEach(v => { v.count = 0; });
            this.settings.sim = DEFAULT_SIM();
            this.clearFilters();
        },
        snapshot() {
            const counts = {}; this.vehicles.forEach(v => { counts[v.id] = v.count || 0; });
            return { counts, sim: { target: 'manual', up: !!this.settings.sim.up, down: !!this.settings.sim.down, preset: this.settings.sim.preset || 'manual' } };
        },
        openScenarioModal() { this.scenarioEditId = null; this.scenarioName = ''; this.scenarioNote = ''; this.scenarioError = ''; this.scenarioModal.show(); },
        editScenario(s) { this.scenarioEditId = s.id; this.scenarioName = s.ad; this.scenarioNote = s.not || ''; this.scenarioError = ''; this.scenarioModal.show(); },
        saveScenario() {
            const ad = this.scenarioName.trim(), not = this.scenarioNote.trim(), id = this.scenarioEditId;
            if (!ad) { this.scenarioError = 'Lütfen senaryoya bir ad verin.'; return; }
            if (this.settings.scenarios.some(s => s.id !== id && s.ad.toLocaleLowerCase('tr') === ad.toLocaleLowerCase('tr'))) { this.scenarioError = 'Bu adla kayıtlı bir senaryo var.'; return; }
            if (id) { // incele / düzenle: yalnızca ad ve not güncellenir
                const sc = this.settings.scenarios.find(s => s.id === id);
                if (sc) { sc.ad = ad; sc.not = not; }
                this.safeHide(this.scenarioModal, 'scenarioModal');
                this.notify(`'${ad}' güncellendi`);
                return;
            }
            const snap = this.snapshot();
            this.settings.scenarios.push({ id: 's' + Date.now(), ad, not, ...snap, filters: { ...this.filters }, tarih: new Date().toISOString(), by: this.auth.user ? this.auth.user.email : '' });
            this.safeHide(this.scenarioModal, 'scenarioModal');
            this.notify(`'${ad}' kaydedildi`);
        },
        editingScenario() { return this.settings.scenarios.find(s => s.id === this.scenarioEditId) || null; },
        applyScenario(s) {
            this.vehicles.forEach(v => { v.count = Math.max(0, Math.floor(Number(s.counts[v.id]) || 0)); });
            this.settings.sim = { ...DEFAULT_SIM(), ...s.sim };
            this.filters = { ...EMPTY_FILTERS(), ...(s.filters || {}) };
            this.notify(`'${s.ad}' uygulandı`);
        },
        async deleteScenario(s) {
            if (!await this.askConfirm(`'${s.ad}' senaryosunu silmek istediğinize emin misiniz?`)) return;
            const i = this.settings.scenarios.findIndex(x => x.id === s.id);
            if (i > -1) this.settings.scenarios.splice(i, 1);
        },
        scenarioTitle(s) {
            const base = s.sim.target && s.sim.target !== 'manual' ? s.sim.target : s.sim.preset;
            const t = !base || base === 'manual' ? 'Manuel adet' : (base === 'best' ? 'En kârlı filo' : '%' + base + ' hedefi');
            const n = Object.values(s.counts).reduce((a, b) => a + (Number(b) || 0), 0);
            return `${t}${s.sim.target === 'manual' || !s.sim.target ? ' · ' + n + ' araç' : ''}${s.sim.up ? ' · üst seg.' : ''}${s.sim.down ? ' · alt seg.' : ''}` + (s.tarih ? ' · ' + new Date(s.tarih).toLocaleDateString('tr-TR') : '');
        },

        /* Tedarikçiye giden dosyalar: hiç araç verilemeyen ya da o yıl ömrü dışındaki plakaya düşen dosyalar.
           Tedarikçi tutarı girilmemiş segment/yılda dosya kaybedilmiş sayılır. */
        supplierCalc(R, segKeys, mi, yOk) {
            const sc = R.scale || 1, plate = {}, ts = this.settings.tedarikciTutar || {};
            R.plates.forEach(p => { plate[p.id] = p; });
            const rate = (sg, y) => Number(((this.settings.gunlukTutar || {})[sg] || {})[y]) || 0, sup = (sg, y) => Number((ts[sg] || {})[y]) || 0;
            const out = { files: 0, lost: 0, days: 0, revenue: 0, cost: 0, margin: 0, byYear: {}, allDays: 0, allCost: 0, ownDays: 0, ownSup: 0, ownCust: 0 };
            R.years.forEach(y => { out.byYear[y] = { margin: 0, revenue: 0, cost: 0, days: 0 }; });
            R.sim.assign.forEach(a => {
                if (segKeys && !segKeys.includes(a.seg)) return;
                if (mi !== null && a.mi !== mi) return;
                const p = a.unit ? plate[a.unit] : null; let toSup = false, lost = false;
                R.years.forEach(y => {
                    if (!yOk(y)) return;
                    const s = sup(a.seg, y), d = a.days * sc;
                    if (s > 0) { out.allDays += d; out.allCost += d * s; }
                    if (p && p.life.includes(y)) { // kendi aracımızla verilen gün: aynı gün tedarikçiye verseydik ne öderdik?
                        if (s > 0) { out.ownDays += d; out.ownSup += d * s; out.ownCust += d * rate(a.kind === 'down' ? a.given : a.seg, y); }
                        return;
                    }
                    if (!s) { lost = true; return; }
                    const r = rate(a.seg, y), b = out.byYear[y];
                    out.days += d; out.revenue += d * r; out.cost += d * s; out.margin += d * (r - s);
                    b.days += d; b.revenue += d * r; b.cost += d * s; b.margin += d * (r - s); toSup = true;
                });
                if (toSup) out.files++; else if (lost) out.lost++;
            });
            out.avgSup = out.allDays ? out.allCost / out.allDays : 0;
            return out;
        },

        /* ---- Biçimlendirme ---- */
        formatCurrency(num) { return Number(num || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 }); },
        money(num) { return '₺ ' + this.formatCurrency(num); },
        shortMoney(num) {
            const n = Number(num) || 0, a = Math.abs(n), f = x => x.toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
            if (a >= 1e9) return '₺ ' + f(n / 1e9) + ' Mr';
            if (a >= 1e6) return '₺ ' + f(n / 1e6) + ' Mn';
            if (a >= 1e4) return '₺ ' + f(n / 1e3) + ' Bin';
            return this.money(n);
        },
        pct(n) { return '%' + (n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); },
        netClass(n) { return n < 0 ? 'text-danger' : 'text-success'; },
        ratioClass(r) { return r < 50 ? 'text-danger' : (r <= 75 ? 'text-orange' : 'text-success'); },
        cell(v, col) {
            if (typeof v !== 'number') return v;
            if (/Gelir|Satış|Gider|Finansman|Personel|Net|Marj/.test(col)) return this.money(v);
            if (/%/.test(col)) return this.pct(v);
            return this.formatCurrency(v);
        },

        /* ================= Raporlama: Excel ve grafikler ================= */
        exportDataset() {
            const ws = XLSX.utils.json_to_sheet(this.dsRows.map(r => { const o = {}; Object.keys(r).forEach(k => { o[k] = typeof r[k] === 'number' ? Math.round(r[k] * 100) / 100 : r[k]; }); return o; }));
            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, this.ds.type === 'dosya' ? 'Dosya Detayı' : 'Plaka Detayı');
            XLSX.writeFile(wb, `ikame_${this.ds.type === 'dosya' ? 'dosya' : 'plaka'}_detay.xlsx`);
        },
        scheduleCharts() {
            clearTimeout(this._chartT);
            if (this.activeTab !== 'raporlama' || !this.authed) { this.destroyCharts(); return; }
            this._chartT = setTimeout(() => this.renderCharts(), 60);
        },
        destroyCharts() { (this._charts || []).forEach(c => c.destroy()); this._charts = []; },
        chart(id, cfg) {
            const el = document.getElementById(id); if (!el || !window.Chart) return;
            cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: {} }, cfg.options || {});
            cfg.options.plugins = Object.assign({ legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }, cfg.options.plugins || {});
            if (cfg.type !== 'doughnut') { // arka plan çizgileri olmadan, sade eksenler
                const sc = cfg.options.scales = cfg.options.scales || {};
                ['x', 'y'].forEach(k => { sc[k] = sc[k] || {}; });
                Object.values(sc).forEach(a => { a.grid = { display: false }; a.border = { display: true, color: '#ced4da' }; a.ticks = Object.assign({ color: '#6c757d', font: { size: 11 } }, a.ticks || {}); });
            }
            this._charts.push(new Chart(el, cfg));
        },
        renderCharts() {
            this.destroyCharts();
            if (!window.Chart || this.activeTab !== 'raporlama') return;
            const V = this.view, M = this.monthly, sm = v => this.shortMoney(v), money = { ticks: { callback: v => sm(v) } };
            const tipMoney = { callbacks: { label: c => `${c.dataset.label ? c.dataset.label + ': ' : ''}${this.money(c.parsed.y !== undefined ? c.parsed.y : c.parsed)}` } };
            // 1. Aylık talep ve karşılama
            this.chart('chMonthly', { data: { labels: M.map(m => m.m.slice(0, 3)), datasets: [
                { type: 'bar', label: 'Kendi segmenti', data: M.map(m => m.own), backgroundColor: C.orange, stack: 's' },
                { type: 'bar', label: 'Üst segment', data: M.map(m => m.up), backgroundColor: C.blue, stack: 's' },
                { type: 'bar', label: 'Alt segment', data: M.map(m => m.down), backgroundColor: C.purple, stack: 's' },
                { type: 'bar', label: 'Karşılanamayan', data: M.map(m => m.missed), backgroundColor: '#dee2e6', stack: 's' },
                { type: 'line', label: 'Filo doluluğu %', data: M.map(m => m.util), borderColor: C.dark, backgroundColor: C.dark, yAxisID: 'y2', tension: .3, spanGaps: true }
            ] }, options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'Dosya' } }, y2: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: v => '%' + v } } } } });
            // 2. Gelirden net kâra (şelale)
            const t = V.total, steps = [['Dosya Geliri', t.revenue], ['Araç Satışı', t.sale], ['İşletme', -t.op], ['Alış', -t.buy], ['Faiz', -t.int], ['Personel', -t.pers]];
            let run = 0; const bars = steps.map(([l, v]) => { const a = run; run += v; return [a, run]; });
            const labels = [...steps.map(s => s[0]), 'Filo Neti'], data = [...bars, [0, run]], colors = [...steps.map(s => (s[1] >= 0 ? C.green : C.red)), run >= 0 ? C.orange : C.red];
            if (this.hasSupplier) { labels.push('Tedarikçi Marjı', 'Şirket Neti'); data.push([run, run + V.sup.margin], [0, run + V.sup.margin]); colors.push(V.sup.margin >= 0 ? C.green : C.red, C.dark); }
            this.chart('chWaterfall', { type: 'bar', data: { labels, datasets: [{ data, backgroundColor: colors }] },
                options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const r = c.raw; return this.money(r[1] - r[0]); } } } }, scales: { y: money } } });
            // 3. Gider yapısı
            const cats = V.catRows.filter(r => r.tutar > 0), pal = [C.orange, C.dark, C.blue, C.amber, C.purple, C.green, C.red, C.grey, '#868e96', '#e8590c', '#5c7cfa', '#20c997'];
            this.chart('chCost', { type: 'doughnut', data: { labels: cats.map(r => (r.grup === 'Personel' ? 'Personel · ' : '') + r.kategori), datasets: [{ data: cats.map(r => r.tutar), backgroundColor: cats.map((r, i) => pal[i % pal.length]) }] },
                options: { cutout: '60%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => `${c.label}: ${this.money(c.parsed)} (${this.pct(V.itemTotal ? c.parsed / V.itemTotal * 100 : 0)})` } } } } });
            // 4. Yıllara göre
            const Y = V.yearRows;
            this.chart('chYears', { data: { labels: Y.map(r => r.year), datasets: [
                { type: 'bar', label: 'Gelir', data: Y.map(r => r.revenue + r.sale), backgroundColor: C.green },
                { type: 'bar', label: 'Gider', data: Y.map(r => r.cost + r.pers), backgroundColor: C.red },
                { type: 'line', label: 'Kümülatif net', data: Y.map(r => r.cum), borderColor: C.orange, backgroundColor: C.orange, tension: .2 }
            ] }, options: { plugins: { tooltip: tipMoney }, scales: { y: money } } });
            // 5. Plaka bazında doluluk
            const P = [...V.plateRowsAll].sort((a, b) => b.util - a.util);
            this.chart('chPlates', { type: 'bar', data: { labels: P.map(r => r.p.plate), datasets: [{ label: 'Doluluk %', data: P.map(r => r.util),
                backgroundColor: P.map(r => (r.util < 50 ? C.red : r.util <= 75 ? C.amber : C.green)), barPercentage: 1, categoryPercentage: .9 }] },
                options: { plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => { const r = P[c[0].dataIndex]; return `${r.p.plate} · ${r.p.model}`; }, label: c => 'Doluluk ' + this.pct(c.parsed.y) } } },
                    scales: { x: { grid: { display: false }, ticks: { display: P.length <= 40 } }, y: { min: 0, max: 100, ticks: { callback: v => '%' + v } } } } });
            // 6. Filo büyüklüğü eğrisi
            const cs = this.curveSeg, cv = cs ? this.report.curves[cs] : null;
            if (cv) {
                const pts = cv.points, cur = this.report.plates.filter(p => p.seg === cs).length;
                this.chart('chCurve', { data: { labels: pts.map(p => p.n), datasets: [
                    { type: 'line', label: 'Karşılama oranı %', data: pts.map(p => p.coverage), borderColor: C.orange, backgroundColor: C.orange, yAxisID: 'y', pointRadius: pts.map(p => (p.n === cur ? 5 : 0)), tension: .2 },
                    ...(cv.hasModel ? [{ type: 'line', label: 'Filo neti (personel hariç)', data: pts.map(p => p.net), borderColor: C.dark, backgroundColor: C.dark, yAxisID: 'y2', pointRadius: pts.map(p => (p.n === cur ? 5 : 0)), tension: .2 }] : []),
                    ...(cv.hasModel && cv.hasSup ? [{ type: 'line', label: 'Şirket neti (filo + tedarikçi marjı)', data: pts.map(p => p.total), borderColor: C.blue, backgroundColor: C.blue, borderDash: [5, 3], yAxisID: 'y2', pointRadius: pts.map(p => (p.n === cur ? 5 : 0)), tension: .2 }] : [])
                ] }, options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: c => c[0].label + ' araç', label: c => (c.dataset.yAxisID === 'y2' ? c.dataset.label + ': ' + this.money(c.parsed.y) : 'Karşılama: ' + this.pct(c.parsed.y)) } } },
                    scales: { x: { title: { display: true, text: cs + ' segmenti araç sayısı' }, ticks: { maxTicksLimit: 15 } }, y: { min: 0, max: 100, ticks: { callback: v => '%' + v } }, y2: { position: 'right', grid: { display: false }, ticks: { callback: v => sm(v) } } } } });
            }
            // 7. Segment karşılaştırması
            const S = V.segmentRows.filter(r => r.cnt || r.total);
            this.chart('chSegments', { type: 'bar', data: { labels: S.map(r => r.seg), datasets: [
                { label: 'Gelir', data: S.map(r => r.revenue + r.sale), backgroundColor: C.green },
                { label: 'Gider', data: S.map(r => r.cost + r.pers), backgroundColor: C.red },
                { label: 'Net', data: S.map(r => r.net), backgroundColor: C.orange }
            ] }, options: { plugins: { tooltip: tipMoney }, scales: { y: money } } });
            // 8. Günlük eşzamanlı talep
            const D = this.dailyLoad;
            this.chart('chDaily', { type: 'line', data: { labels: D.days.map(d => new Date(d.t).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })), datasets: [
                { label: 'Aynı anda ihtiyaç duyulan araç', data: D.days.map(d => d.demand), borderColor: C.grey, backgroundColor: 'rgba(173,181,189,.25)', fill: true, pointRadius: 0, borderWidth: 1 },
                { label: 'Kirada olan araç', data: D.days.map(d => d.used), borderColor: C.orange, backgroundColor: C.orange, pointRadius: 0, borderWidth: 1.5 },
                { label: 'Filodaki araç', data: D.days.map(() => D.fleet), borderColor: C.dark, borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 }
            ] }, options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 12 } } } } });
            // 9. Kiralama süresi dağılımı
            const H = this.rentalHist;
            this.chart('chRental', { type: 'bar', data: { labels: H.map(h => h.l), datasets: [{ label: 'Dosya', data: H.map(h => h.n), backgroundColor: C.orange }] }, options: { plugins: { legend: { display: false } } } });
            // 10. Haftanın günlerine göre teslimat
            const W = this.weekday;
            this.chart('chWeek', { type: 'bar', data: { labels: W.map(w => w.l), datasets: [
                { label: 'Karşılanan', data: W.map(w => w.h), backgroundColor: C.orange, stack: 'w' },
                { label: 'Karşılanamayan', data: W.map(w => w.n - w.h), backgroundColor: '#dee2e6', stack: 'w' }
            ] }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
        }
    }
});
app.component('num-input', NumInput);
app.mount('#app');
