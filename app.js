const { createApp } = Vue;
const E = window.Engine;

const SEGMENTS = E.SEGMENTS;
const FUELS = E.FUELS;
const DEFAULT_HEADERS = E.DEFAULT_HEADERS;
const STORAGE_KEY = 'eurocross_ikame_data';
const SETTINGS_VERSION = 2;
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#f1f3f5"/><text x="150" y="82" font-family="Arial" font-size="14" fill="#adb5bd" text-anchor="middle">Görsel yok</text></svg>');

/* Eski sürümde hazır gelen başlıklar; tek seferlik temizlenir */
const OLD_SEEDED = ['Yıllık Kasko Maliyeti', 'Yıllık Trafik Sigortası', 'Yıllık MTV', 'Yıllık Bakım Maliyeti (Ort.)', 'Lastik Gideri (Yıllık)'];

/* ---- Bulut senkronizasyonu için tek giriş noktası ----
   Firebase eklendiğinde window.CloudSync = { push(data) } tanımlanacak. */
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
        enflasyonYillari: [2026, 2027, 2028, 2029],
        enflasyonOranlari: { 2026: 0, 2027: 35, 2028: 28, 2029: 25 },
        yakitFiyatlari: {
            Benzin: { 2026: 45, 2027: 60, 2028: 80, 2029: 100 },
            Dizel: { 2026: 45, 2027: 60, 2028: 80, 2029: 100 },
            Elektrik: { 2026: 5, 2027: 8, 2028: 12, 2029: 15 }
        },
        gunlukTutar: {}
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
    if (!Array.isArray(s.personelTanimlari)) s.personelTanimlari = [];
    if (s.personelSayisi === undefined) s.personelSayisi = null;
    s.enflasyonYillari = (s.enflasyonYillari && s.enflasyonYillari.length ? s.enflasyonYillari : d.enflasyonYillari).map(Number);
    s.enflasyonOranlari = s.enflasyonOranlari || {};
    s.yakitFiyatlari = s.yakitFiyatlari || {};
    s.gunlukTutar = s.gunlukTutar || {};
    FUELS.forEach(f => { s.yakitFiyatlari[f] = s.yakitFiyatlari[f] || { ...(d.yakitFiyatlari[f]) }; });
    delete s.yakitFiyatlari.Hibrit;
    SEGMENTS.forEach(sg => { s.gunlukTutar[sg] = s.gunlukTutar[sg] || {}; });
    s.enflasyonYillari.forEach(y => {
        if (s.enflasyonOranlari[y] === undefined) s.enflasyonOranlari[y] = 0;
        FUELS.forEach(f => { if (s.yakitFiyatlari[f][y] === undefined) s.yakitFiyatlari[f][y] = 0; });
        SEGMENTS.forEach(sg => { if (s.gunlukTutar[sg][y] === undefined) s.gunlukTutar[sg][y] = null; });
    });
    return s;
}
function normalizeVehicle(v) {
    v.giderler = v.giderler || {};
    if (!FUELS.includes(v.yakitTuru)) v.yakitTuru = 'Benzin';
    if (!SEGMENTS.includes(v.segment)) v.segment = 'B';
    if (v.satisTutari === undefined) v.satisTutari = null;
    if (v.giderler['Yıllık Kullanılacak KM'] !== undefined) { // eski alan adı -> Optimum Satış KM
        if (v.giderler['Optimum Satış KM'] === undefined) v.giderler['Optimum Satış KM'] = v.giderler['Yıllık Kullanılacak KM'];
        delete v.giderler['Yıllık Kullanılacak KM'];
    }
    v.count = v.count || 0;
    return v;
}

/* ---- Sayı alanı: binlik ayraç + ok ile 1'er artırma/azaltma ---- */
const NumInput = {
    props: { modelValue: { default: null }, step: { type: Number, default: 1 }, decimals: { type: Boolean, default: false }, min: { type: Number, default: 0 }, invalid: Boolean },
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
            let n = Math.round(((this.parse(this.text) || 0) + d * this.step) * 100) / 100;
            if (n < this.min) n = this.min;
            this.text = this.fmt(n);
            this.$emit('update:modelValue', n);
        }
    },
    template: `
    <div class="input-group input-group-sm num-input" :class="{'is-invalid-group': invalid}">
        <input type="text" inputmode="decimal" class="form-control" :class="{'is-invalid': invalid}" :value="text"
               @input="onInput" @keydown.up.prevent="bump(1)" @keydown.down.prevent="bump(-1)">
        <span class="input-group-text p-0 spin">
            <button type="button" tabindex="-1" @click="bump(1)"><i class="bi bi-caret-up-fill"></i></button>
            <button type="button" tabindex="-1" @click="bump(-1)"><i class="bi bi-caret-down-fill"></i></button>
        </span>
    </div>`
};

const app = createApp({
    data() {
        return {
            activeTab: 'giderBasliklari',
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

            newHeader: '', newCategory: '', newAmount: null, headerError: '', dragIndex: -1,
            newYear: null,
            timeRule: 15,
            settings: defaultSettings(),
            vehicles: [],
            historicalData: [],
            importMsg: '', pasteText: '', showPaste: false,
            histPage: 1, histSize: 100,

            auth: { state: 'loading', error: '', busy: false, email: '', password: '', user: null },
            sync: { status: 'idle', msg: '', loaded: false, online: true },
            tempVehicle: null, editingVehicleIndex: -1, editingVehicleId: null, vehicleModal: null, submitted: false,
            costModal: null, activeCostVehicle: null,
            plateModal: null, activePlate: null,
            confirmModal: null, confirmText: '', confirmInfo: false, confirmResolve: null,

            filters: { year: 'all', month: 'all', seg: 'all', vid: 'all' },
            months: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
            detailTab: 'yillik', plateSearch: '', plateLimit: 100
        };
    },
    computed: {
        authed() { return this.auth.state === 'in' && this.sync.loaded; },
        syncLabel() {
            if (!this.sync.online) return 'Çevrimdışı';
            return { saving: 'Kaydediliyor…', ok: 'Senkron', connecting: 'Bağlanıyor…', error: 'Hata', local: 'Yerel mod' }[this.sync.status] || '';
        },
        years() { return E.sortedYears(this.settings); },
        isP() { return this.activeTab === 'personelGider'; },
        hdrList() { return this.isP ? this.settings.personelTanimlari : this.settings.giderTanimlari; },
        allHeaders() { return [...DEFAULT_HEADERS, ...this.settings.giderTanimlari.map(h => h.ad)]; },
        categories() { return [...new Set(this.hdrList.map(h => h.kategori).filter(Boolean))]; },
        sortedVehicles() {
            return [...this.vehicles].sort((a, b) => SEGMENTS.indexOf(a.segment) - SEGMENTS.indexOf(b.segment) || a.markaModel.localeCompare(b.markaModel, 'tr'));
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
            return E.buildReport({ vehicles: this.vehicles, files: this.parsedFiles, settings: this.settings, cutHour: this.timeRule });
        },
        incompleteVehicles() { return this.vehicles.filter(v => !E.isVehicleComplete(v, this.settings)); },
        totalPlates() { return this.report.plates.length; },

        /* Personel sayfası: yıllık özet */
        persSummary() {
            const k = E.inflationFactors(this.years, this.settings.enflasyonOranlari || {});
            const base = this.settings.personelTanimlari.reduce((a, h) => a + (Number(h.tutar) || 0), 0), count = Number(this.settings.personelSayisi) || 0;
            const perPerson = {}, totals = {};
            this.years.forEach(y => { perPerson[y] = base * k[y]; totals[y] = base * k[y] * count; });
            return { count, perPerson, totals };
        },

        brandOptions() {
            return this.sortedVehicles.filter(v => v.count > 0 && (this.filters.seg === 'all' || v.segment === this.filters.seg));
        },

        /* Tarihçe sayfalama */
        histPages() { return Math.max(1, Math.ceil(this.historicalData.length / this.histSize)); },
        histRows() { const s = (this.histPage - 1) * this.histSize; return this.historicalData.slice(s, s + this.histSize); },
        pageButtons() {
            const n = this.histPages, c = this.histPage, set = new Set([1, n, c, c - 1, c + 1, c - 2, c + 2].filter(p => p >= 1 && p <= n));
            const arr = [...set].sort((a, b) => a - b), out = [];
            arr.forEach((p, i) => { if (i && p - arr[i - 1] > 1) out.push('…'); out.push(p); });
            return out;
        },

        /* Filtrelere göre tüm özetler */
        view() {
            const R = this.report, F = this.filters;
            const mi = F.month === 'all' ? null : Number(F.month);
            const dim = mi === null ? 0 : new Date(R.dataYear || 2026, mi + 1, 0).getDate();
            const mf = mi === null ? 1 : dim / 365; // ay seçiliyken yıllık giderler gün sayısına oranlanır
            const segOk = p => (F.seg === 'all' || p.seg === F.seg) && (F.vid === 'all' || p.vid === F.vid);
            const yOk = y => F.year === 'all' || String(y) === String(F.year);
            const z = () => ({ work: 0, idle: 0, revenue: 0, sale: 0, cost: 0, pers: 0, net: 0, plates: 0, files: 0 });
            const add = (a, r) => { a.work += r.work; a.idle += r.idle; a.revenue += r.revenue; a.sale += r.sale; a.cost += r.cost; a.pers += r.pers; a.net += r.net; a.files += r.f; };
            // Ay seçiliyse: o ay teslim edilen dosyaların çalışma günü ve geliri; araç satışı hariç
            const rec = (p, y) => {
                const r = p.byYear[y];
                if (mi === null) return { ...r, f: p.files };
                const m = p.months[mi], revenue = m.work * r.rate, cost = r.cost * mf, pers = r.pers * mf;
                return { work: m.work, idle: Math.max(0, dim - m.work), revenue, sale: 0, cost, pers, net: revenue - cost - pers, f: m.files };
            };
            const total = z(), yearAgg = {}, segAgg = {}, modelAgg = {}, items = {}, cats = {}, plateRows = [], segFiles = {};
            R.years.forEach(y => { yearAgg[y] = z(); });
            R.plates.forEach(p => {
                if (!segOk(p)) return;
                const ct = R.vehicleCosts[p.vid], files1 = mi === null ? p.files : p.months[mi].files;
                const row = { p, files1, ...z() };
                p.life.forEach(y => {
                    const r = rec(p, y);
                    add(yearAgg[y], r); yearAgg[y].plates++;
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
                if (row.plates) { plateRows.push(row); segFiles[p.seg] = (segFiles[p.seg] || 0) + files1; }
            });
            let cum = 0;
            const yearRows = R.years.filter(y => yearAgg[y].plates).map(y => {
                const a = yearAgg[y]; cum += a.net;
                return { year: y, ...a, cum, util: a.work + a.idle ? a.work / (a.work + a.idle) * 100 : 0 };
            });
            const stats = R.sim.segStats, vSeg = (this.vehicles.find(v => v.id === F.vid) || {}).segment;
            const sStat = k => { const s = stats[k]; if (!s) return { total: 0, handled: 0, days: 0 }; return mi === null ? s : s.m[mi]; };
            const segKeys = Object.keys(stats).filter(k => F.vid !== 'all' ? k === vSeg : (F.seg === 'all' || k === F.seg));
            const demand = segKeys.reduce((a, k) => a + sStat(k).total, 0);
            const handled = Math.round(segKeys.reduce((a, k) => a + (segFiles[k] || 0), 0));
            const rentalDays = segKeys.reduce((a, k) => a + sStat(k).days, 0), simHandled = segKeys.reduce((a, k) => a + sStat(k).handled, 0);
            const files = { total: demand, handled, ratio: demand ? handled / demand * 100 : 0 };
            const order = k => { const i = SEGMENTS.indexOf(k); return i < 0 ? 99 : i; };
            const allSegs = [...new Set([...Object.keys(stats), ...Object.keys(segAgg)])].filter(k => F.seg === 'all' || k === F.seg).sort((a, b) => order(a) - order(b));
            const segmentRows = allSegs.map(k => {
                const a = segAgg[k] || z(), st = sStat(k);
                const cnt = R.plates.filter(p => p.seg === k && (F.vid === 'all' || p.vid === F.vid)).length, h = Math.round(segFiles[k] || 0);
                return { seg: k, cnt, total: st.total, handled: h, missed: st.total - h, ratio: st.total ? h / st.total * 100 : 0, ...a, util: a.work + a.idle ? a.work / (a.work + a.idle) * 100 : 0 };
            });
            const modelRows = this.sortedVehicles.filter(v => (F.seg === 'all' || v.segment === F.seg) && (F.vid === 'all' || v.id === F.vid) && v.count > 0).map(v => {
                const a = modelAgg[v.id] || z();
                return { v, ...a, util: a.work + a.idle ? a.work / (a.work + a.idle) * 100 : 0 };
            });
            const itemRows = Object.values(items).sort((a, b) => b.tutar - a.tutar);
            const catRows = Object.values(cats).sort((a, b) => b.tutar - a.tutar);
            const q = this.plateSearch.trim().toLocaleLowerCase('tr');
            const shownPlates = q ? plateRows.filter(r => (r.p.plate + ' ' + r.p.model + ' ' + r.p.seg).toLocaleLowerCase('tr').includes(q)) : plateRows;
            const gelir = total.revenue + total.sale, gider = total.cost + total.pers;
            const plateYears = plateRows.reduce((a, r) => a + r.plates, 0), pf = x => total.files ? x / total.files : 0;
            return {
                total, gelir, gider, util: total.work + total.idle ? total.work / (total.work + total.idle) * 100 : 0,
                perFileVeh: pf(total.cost), perFilePers: pf(total.pers), perFileRev: pf(gelir), perFileNet: pf(total.net),
                plateTotal: plateRows.length, idlePlates: plateRows.filter(r => r.files1 === 0).length,
                avgWork: plateYears ? total.work / plateYears : 0, avgRental: simHandled ? rentalDays / simHandled : 0,
                netPerWorkDay: total.work ? total.net / total.work : 0, netPerPlate: plateRows.length ? total.net / plateRows.length : 0,
                files, yearRows, segmentRows, modelRows, itemRows, catRows,
                plateRows: shownPlates, plateCount: shownPlates.length,
                itemTotal: itemRows.reduce((sum, r) => sum + r.tutar, 0)
            };
        },
        spanInfo() { const d = this.report.sim.spanDays; return d ? Math.round(d) : 0; }
    },
    mounted() {
        this.loadData();
        this.vehicleModal = new bootstrap.Modal(document.getElementById('vehicleModal'));
        this.costModal = new bootstrap.Modal(document.getElementById('costModal'));
        this.plateModal = new bootstrap.Modal(document.getElementById('plateModal'));
        this.confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
        this.tempVehicle = this.getEmptyVehicle();
        this.$watch(() => [this.settings, this.vehicles, this.historicalData, this.timeRule], () => this.scheduleSave(), { deep: true });
        this.$watch(() => [this.filters.seg, this.filters.vid, this.filters.month, this.plateSearch], () => { this.plateLimit = 100; });
        this.$watch(() => this.filters.seg, () => { if (this.filters.vid !== 'all' && !this.brandOptions.some(v => v.id === this.filters.vid)) this.filters.vid = 'all'; });
        this.$watch(() => this.activeTab, () => { this.headerError = ''; this.newHeader = ''; this.newCategory = ''; this.newAmount = null; });
        if (window.CloudSync && window.CloudSync.enabled) window.CloudSync.init(this);
        else { this.auth.state = 'in'; this.sync.loaded = true; this.sync.status = 'local'; }
        this.$watch(() => this.histSize, () => { this.histPage = 1; });
        this.$watch(() => this.histPages, n => { if (this.histPage > n) this.histPage = n; });
    },
    methods: {
        /* ---- Uygulama içi onay penceresi (Evet / Hayır) ---- */
        askConfirm(text, info = false) {
            this.confirmText = text; this.confirmInfo = info;
            this.confirmModal.show();
            return new Promise(res => { this.confirmResolve = res; });
        },
        answer(v) {
            this.confirmModal.hide();
            const r = this.confirmResolve; this.confirmResolve = null;
            if (r) r(v);
        },

        /* ---- Giriş / Bulut ---- */
        async login() {
            if (this.auth.busy) return;
            const email = this.auth.email.trim();
            if (!email || !this.auth.password) { this.auth.error = 'E-posta ve şifre yazın.'; return; }
            this.auth.busy = true; this.auth.error = '';
            const err = await window.CloudSync.signIn(email, this.auth.password);
            this.auth.busy = false;
            if (err) this.auth.error = err; else this.auth.password = '';
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
            this.timeRule = 15; this.filters = { year: 'all', month: 'all', seg: 'all', vid: 'all' };
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
        exportData() {
            const blob = new Blob([JSON.stringify({ settings: this.settings, vehicles: this.vehicles, historicalData: this.historicalData, timeRule: this.timeRule })], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'eurocross_ikame_backup.json';
            document.body.appendChild(a); a.click(); a.remove();
        },
        importData(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = e => {
                try { this.applyData(JSON.parse(e.target.result)); this.askConfirm('Veriler başarıyla yüklendi!', true); }
                catch (err) { this.askConfirm('Dosya okunamadı. Geçersiz format.', true); }
            };
            reader.readAsText(file); event.target.value = '';
        },

        /* ---- Gider / Personel Başlıkları (aynı mantık) ---- */
        addHeader() {
            const name = this.newHeader.trim();
            if (!name) { this.headerError = 'Lütfen bir başlık yazın.'; return; }
            if (this.isP && (this.newAmount === null || this.newAmount === undefined)) { this.headerError = 'Lütfen kişi başı yıllık tutarı yazın.'; return; }
            const taken = this.isP ? this.settings.personelTanimlari.map(h => h.ad) : [...DEFAULT_HEADERS, ...this.settings.giderTanimlari.map(h => h.ad)];
            if (taken.some(n => n.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) { this.headerError = 'Bu başlık zaten var.'; return; }
            const item = { ad: name, kategori: this.newCategory.trim() || 'Diğer' };
            if (this.isP) item.tutar = this.newAmount;
            this.hdrList.push(item);
            this.newHeader = ''; this.newCategory = ''; this.newAmount = null; this.headerError = '';
        },
        async removeHeader(index) {
            const h = this.hdrList[index];
            if (!await this.askConfirm(`'${h.ad}' başlığını silmek istediğinize emin misiniz?`)) return;
            const i = this.hdrList.indexOf(h); if (i < 0) return;
            this.hdrList.splice(i, 1);
            if (!this.isP) this.vehicles.forEach(v => { delete v.giderler[h.ad]; });
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
            return { id: 'v' + Date.now(), markaModel: '', segment: 'B', yakitTuru: 'Benzin', satisTutari: null, imageBase64: '', count: 0, giderler: {} };
        },
        openVehicleModal(index = -1) {
            this.editingVehicleIndex = index; this.submitted = false;
            this.editingVehicleId = index > -1 ? this.vehicles[index].id : null;
            this.tempVehicle = index > -1 ? JSON.parse(JSON.stringify(this.vehicles[index])) : this.getEmptyVehicle();
            this.allHeaders.forEach(h => { if (this.tempVehicle.giderler[h] === undefined) this.tempVehicle.giderler[h] = null; });
            this.vehicleModal.show();
        },
        fieldCfg(h) {
            if (h === DEFAULT_HEADERS[0]) return { step: 1, decimals: false, min: 1 };
            if (h === DEFAULT_HEADERS[2]) return { step: 0.1, decimals: true, min: 0 };
            return { step: 1, decimals: false, min: 0 };
        },
        fieldInvalid(h) {
            if (!this.submitted) return false;
            const v = this.tempVehicle.giderler[h];
            if (!DEFAULT_HEADERS.includes(h)) return false;
            return v === null || v === undefined || v === '' || (h === DEFAULT_HEADERS[0] && v < 1);
        },
        saleInvalid() { return false; },
        formInvalid() { return !this.tempVehicle.markaModel.trim() || this.allHeaders.some(h => this.fieldInvalid(h)); },
        handleImageUpload(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = () => { // localStorage'ı doldurmamak için küçült
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
            const copy = JSON.parse(JSON.stringify(this.tempVehicle));
            const ei = this.editingVehicleId === null ? -1 : this.vehicles.findIndex(x => String(x.id) === String(this.editingVehicleId));
            if (ei > -1) this.vehicles[ei] = copy; else this.vehicles.push(copy);
            this.vehicleModal.hide();
        },
        async deleteVehicle(v) {
            if (await this.askConfirm(`'${v.markaModel}' aracını silmek istediğinize emin misiniz?`)) this.vehicles.splice(this.vehicles.indexOf(v), 1);
        },
        isComplete(v) { return E.isVehicleComplete(v, this.settings); },

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
        vehicleTotal(v) { const c = this.report.vehicleCosts[v.id]; return c ? c.total : 0; },
        showCostDetails(v) { this.activeCostVehicle = v; this.costModal.show(); },
        showPlate(p) { this.activePlate = p; this.plateModal.show(); },
        costOf(id) { return this.report.vehicleCosts[id]; },
        formatCurrency(num) { return Number(num || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 }); },
        money(num) { return '₺ ' + this.formatCurrency(num); },
        pct(n) { return (n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + '%'; },
        netClass(n) { return n < 0 ? 'text-danger' : 'text-success'; },
        ratioClass(r) { return r < 50 ? 'text-danger' : (r <= 75 ? 'text-orange' : 'text-success'); },
        setCount(v, val) { v.count = Math.max(0, Math.floor(Number(val) || 0)); }
    }
});
app.component('num-input', NumInput);
app.mount('#app');
