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
/* Filtreler çoktan seçmelidir: boş dizi = Tümü */
const EMPTY_FILTERS = () => ({ year: [], month: [], seg: [], vid: [], cust: [] });
const NO_CUST = ''; // müşteri bilgisi olmayan dosyalar
const NO_CUST_LABEL = 'Müşterisi belirtilmemiş';
const STAT_KEYS = ['total', 'handled', 'own', 'up', 'down', 'days'];
/* Eski tek seçimli filtreleri ('all' / tek değer) diziye çevirir */
function normFilters(f) {
    const d = EMPTY_FILTERS(); f = f || {};
    Object.keys(d).forEach(k => {
        const v = f[k];
        if (Array.isArray(v)) d[k] = [...v];
        else if (v !== undefined && v !== null && v !== 'all') d[k] = [v];
        if (k === 'year' || k === 'month') d[k] = d[k].map(Number).filter(x => !isNaN(x));
        else if (k !== 'cust') d[k] = d[k].map(String);
    });
    return d;
}
const DEFAULT_SIM = () => ({ target: 'manual', up: false, down: false, preset: 'manual', growth: 0 });
const GROWTHS = [-50, -40, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 40, 50];

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
        musteriTutar: {},
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
    // Müşteri bazlı günlük tutarlar: { müşteri: { gunluk: {seg: {yıl}}, tedarikci: {seg: {yıl}} } }
    s.musteriTutar = s.musteriTutar && typeof s.musteriTutar === 'object' && !Array.isArray(s.musteriTutar) ? s.musteriTutar : {};
    Object.keys(s.musteriTutar).forEach(c => fillCustRates(s.musteriTutar[c] = s.musteriTutar[c] || {}, s.enflasyonYillari));
    s.sim = { ...DEFAULT_SIM(), ...(s.sim || {}) };
    if (s.sim.target !== 'manual' && s.sim.target !== 'best') s.sim.target = TARGETS.includes(Number(s.sim.target)) ? Number(s.sim.target) : 'manual';
    s.sim.up = !!s.sim.up; s.sim.down = !!s.sim.down; s.sim.growth = GROWTHS.includes(Number(s.sim.growth)) ? Number(s.sim.growth) : 0;
    if (s.sim.preset !== 'manual' && s.sim.preset !== 'best' && !TARGETS.includes(Number(s.sim.preset))) s.sim.preset = 'manual';
    s.scenarios = Array.isArray(s.scenarios) ? s.scenarios.filter(x => x && x.ad) : [];
    return s;
}
function fillCustRates(o, years) {
    ['gunluk', 'tedarikci'].forEach(k => {
        o[k] = o[k] || {};
        SEGMENTS.forEach(sg => { o[k][sg] = o[k][sg] || {}; years.forEach(y => { if (o[k][sg][y] === undefined) o[k][sg][y] = null; }); });
    });
    return o;
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

/* ---- Çoktan seçmeli açılır liste (filtreler): boş seçim = Tümü ---- */
const MultiSelect = {
    props: { modelValue: { type: Array, default: () => [] }, options: { type: Array, default: () => [] }, placeholder: { type: String, default: 'Tümü' }, search: Boolean, width: { type: String, default: '160px' } },
    emits: ['update:modelValue'],
    data() { return { open: false, q: '' }; },
    computed: {
        sel() { return new Set(this.modelValue.map(String)); },
        shown() { const q = this.q.trim().toLocaleLowerCase('tr'); return q ? this.options.filter(o => String(o.l).toLocaleLowerCase('tr').includes(q)) : this.options; },
        label() {
            const n = this.modelValue.length; if (!n) return this.placeholder;
            const ls = this.options.filter(o => this.sel.has(String(o.v))).map(o => o.s || o.l);
            return n <= 2 && ls.length === n ? ls.join(', ') : n + ' seçili';
        }
    },
    watch: { open(o) { if (!o) this.q = ''; } },
    methods: {
        toggle(o) {
            const k = String(o.v), order = new Map(this.options.map((x, i) => [String(x.v), i]));
            const arr = this.sel.has(k) ? this.modelValue.filter(x => String(x) !== k) : [...this.modelValue, o.v];
            arr.sort((a, b) => (order.has(String(a)) ? order.get(String(a)) : 1e9) - (order.has(String(b)) ? order.get(String(b)) : 1e9));
            this.$emit('update:modelValue', arr);
        },
        only(o) { this.$emit('update:modelValue', [o.v]); },
        selectShown() { const set = new Set(this.modelValue.map(String)); const add = this.shown.filter(o => !set.has(String(o.v))).map(o => o.v); this.$emit('update:modelValue', [...this.modelValue, ...add]); },
        clear() { this.$emit('update:modelValue', []); },
        onDoc(e) { if (this.open && this.$el && !this.$el.contains(e.target)) this.open = false; }
    },
    mounted() { document.addEventListener('mousedown', this.onDoc); },
    beforeUnmount() { document.removeEventListener('mousedown', this.onDoc); },
    template: `
    <div class="msel" :class="{open}">
        <button type="button" class="form-select form-select-sm msel-btn" :class="{'msel-on': modelValue.length}" :style="{width}" @click="open = !open" :title="label">{{ label }}</button>
        <div class="msel-menu" v-if="open">
            <input v-if="search" class="form-control form-control-sm mb-1" v-model="q" placeholder="Ara...">
            <div class="msel-list">
                <label class="msel-item" v-for="o in shown" :key="String(o.v)" :class="{on: sel.has(String(o.v))}">
                    <input type="checkbox" class="form-check-input" :checked="sel.has(String(o.v))" @change="toggle(o)">
                    <span class="msel-l">{{ o.l }}</span>
                    <small v-if="o.n !== undefined" class="text-muted">{{ o.n }}</small>
                    <a href="#" class="msel-only" @click.prevent="only(o)" title="Yalnızca bunu seç">yalnız</a>
                </label>
                <div v-if="!shown.length" class="small text-muted p-2">Sonuç yok</div>
            </div>
            <div class="msel-foot">
                <a href="#" @click.prevent="selectShown">{{ q ? 'Görünenleri seç' : 'Hepsini seç' }}</a>
                <a href="#" @click.prevent="clear" :class="{disabled: !modelValue.length}">Temizle (Tümü)</a>
            </div>
        </div>
    </div>`
};

/* ---- Sıralanabilir tablo: başlığa tıkla → büyükten küçüğe, tekrar → küçükten büyüğe ---- */
const SortTable = {
    props: { cols: Array, rows: Array, foot: Array, clickable: Boolean, limit: Number },
    emits: ['row'],
    data() { return { k: -1, dir: -1 }; },
    computed: {
        sorted() {
            if (this.k < 0) return this.rows;
            const k = this.k, d = this.dir;
            return [...this.rows].sort((a, b) => {
                const x = a.cells[k].v, y = b.cells[k].v;
                if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
                return String(x).localeCompare(String(y), 'tr', { numeric: true }) * d;
            });
        },
        shown() { return this.limit ? this.sorted.slice(0, this.limit) : this.sorted; }
    },
    methods: { sortBy(i) { if (this.k === i) this.dir = -this.dir; else { this.k = i; this.dir = -1; } } },
    template: `
    <table class="table table-hover align-middle mb-0 text-end sort-table">
        <thead class="table-light"><tr>
            <th v-for="(c, i) in cols" :key="i" class="sortable" :class="{'text-start': c.start, sorted: k === i}" @click="sortBy(i)" :title="'Sırala: ' + c.l">
                {{ c.l }} <i class="bi sort-ic" :class="k === i ? (dir < 0 ? 'bi-sort-down' : 'bi-sort-up') : 'bi-arrow-down-up'"></i></th>
        </tr></thead>
        <tbody>
            <tr v-for="(r, ri) in shown" :key="r.key || ri" :class="{'cursor-pointer': clickable}" @click="clickable && $emit('row', r)">
                <td v-for="(c, ci) in r.cells" :key="ci" :class="c.c">
                    <div v-if="c.bar !== undefined" class="progress" style="height:8px;min-width:80px"><div class="progress-bar bg-orange" :style="{width: c.bar + '%'}"></div></div>
                    <template v-else><img v-if="c.img" :src="c.img" class="rounded me-2" style="width:40px;height:30px;object-fit:cover">{{ c.d }}</template>
                </td>
            </tr>
            <tr v-if="!rows.length"><td :colspan="cols.length" class="text-center text-muted py-3">Sonuç yok</td></tr>
        </tbody>
        <tfoot v-if="foot"><tr class="fw-bold"><td v-for="(c, i) in foot" :key="i" :class="c.c">{{ c.d }}</td></tr></tfoot>
    </table>`
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
    gunlukTutar: ['Günlük Tutar', 'Müşteri, segment ve yıla göre müşteriye yansıtılan ve tedarikçiye ödenen günlük tutarlar.'],
    rehber: ['Çalışma Rehberi', 'Her sayfanın başlıkları ne işe yarar, hesaplar hangi mantıkla yapılır.']
};
const C = { orange: '#ff6600', orangeL: '#ffa94d', dark: '#343a40', grey: '#adb5bd', green: '#2b8a3e', red: '#e03131', blue: '#1c7ed6', purple: '#7048e8', amber: '#f59f00' };

const app = createApp({
    data() {
        return {
            activeTab: 'tahminleme', present: false, guide: window.GUIDE || [], guideId: 'genel',
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
            targets: TARGETS, growths: GROWTHS,
            months: MONTHS,

            newHeader: '', newCategory: '', newAmount: null, newTip: 'yillik', newDefVal: null, newDefN: null, headerError: '', dragIndex: -1,
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
            // Günlük Tutar: seçili müşteri ve kopyalama kaynağı
            gtCust: null, gtCopyFrom: '__default',
            sensP: 10, sensData: null, sensBusy: false, margData: {}, margBusy: false,
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
        guideItem() { return this.guide.find(g => g.id === this.guideId) || null; },
        pageMeta() { return PAGE_META[this.activeTab] || ['', '']; },
        years() { return E.sortedYears(this.settings); },
        isP() { return this.activeTab === 'personelGider'; },
        hdrList() { return this.isP ? this.settings.personelTanimlari : this.settings.giderTanimlari; },
        allHeaders() { return [...DEFAULT_HEADERS, ...this.settings.giderTanimlari.map(h => h.ad)]; },
        fuelHeaders() { return this.settings.giderTanimlari.filter(h => h.tip === 'yakit').map(h => h.ad); },
        hdrByName() { const o = {}; this.settings.giderTanimlari.forEach(h => { o[h.ad] = h; }); return o; },
        hasSupplier() {
            const pos = o => SEGMENTS.some(sg => this.years.some(y => Number(((o || {})[sg] || {})[y]) > 0));
            return pos(this.settings.tedarikciTutar) || Object.values(this.settings.musteriTutar || {}).some(m => pos(m.tedarikci));
        },
        /* Tarihçedeki müşteriler (tekrarsız): dosya sayısı ve segment dağılımıyla */
        histCustomers() {
            const map = new Map(); let none = 0;
            this.historicalData.forEach(d => {
                const c = d.musteri || NO_CUST; if (!c) { none++; return; }
                const o = map.get(c) || { c, files: 0, segs: {} }; o.files++;
                const sg = E.normSegment(d.segment); o.segs[sg] = (o.segs[sg] || 0) + 1; map.set(c, o);
            });
            return { list: [...map.values()].sort((a, b) => a.c.localeCompare(b.c, 'tr')), none };
        },
        hasCustomers() { return this.histCustomers.list.length > 0; },
        /* Filtre ve tablolar için müşteri listesi; müşteri bilgisi olmayan dosya varsa "belirtilmemiş" de eklenir */
        customerList() { const H = this.histCustomers; return H.list.length ? [...H.list.map(x => x.c), ...(H.none ? [NO_CUST] : [])] : []; },
        filterOpts() {
            const H = this.histCustomers;
            return {
                year: this.years.map(y => ({ v: y, l: String(y) })),
                month: MONTHS.map((m, i) => ({ v: i, l: m, s: m.slice(0, 3) })),
                seg: SEGMENTS.map(sg => ({ v: sg, l: sg + ' Segmenti', s: sg })),
                vid: this.brandOptions.map(v => ({ v: String(v.id), l: v.markaModel })),
                cust: [...H.list.map(x => ({ v: x.c, l: x.c, n: this.formatCurrency(x.files) })), ...(H.list.length && H.none ? [{ v: NO_CUST, l: NO_CUST_LABEL, n: this.formatCurrency(H.none) }] : [])]
            };
        },
        /* Günlük Tutar sayfası: her müşterinin talep ettiği segment × yıl için kendi / tedarikçi tutarı girilmiş mi */
        custRateStatus() {
            const mt = this.settings.musteriTutar || {}, yrs = this.years, filled = x => x !== null && x !== undefined && x !== '';
            const out = {};
            this.histCustomers.list.forEach(o => {
                const e = mt[o.c] || {}, segs = Object.keys(o.segs).filter(sg => SEGMENTS.includes(sg));
                const miss = k => segs.filter(sg => yrs.some(y => !filled(((e[k] || {})[sg] || {})[y])));
                const own = miss('gunluk'), sup = miss('tedarikci');
                out[o.c] = { own, sup, ok: !own.length, supOk: !sup.length, segs };
            });
            return out;
        },
        custMissingOwn() { return this.histCustomers.list.filter(o => !this.custRateStatus[o.c].ok).map(o => o.c); },
        custMissingSup() { return this.histCustomers.list.filter(o => !this.custRateStatus[o.c].supOk).map(o => o.c); },
        custEntry() { return this.gtCust ? (this.settings.musteriTutar || {})[this.gtCust] || null : null; },
        orphanRates() { const have = new Set(this.histCustomers.list.map(o => o.c)); return Object.keys(this.settings.musteriTutar || {}).filter(c => !have.has(c)); },
        /* Gelir hesabında tutarı bulunamayan müşteri / segment / yıllar (kısaltılmış metin) */
        missingRatesText() {
            const L = this.report.missingRates; if (!L.length) return '';
            const max = 12; return L.slice(0, max).join(', ') + (L.length > max ? ` ve ${L.length - max} kalem daha` : '');
        },
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
                if (s !== null && e !== null) out.push({ no: d.dosyaNo, seg: E.normSegment(d.segment), s, e, c: d.musteri || NO_CUST });
            });
            return out;
        },
        /* Hizmet sayısı değişimi uygulanmış dosyalar */
        simFiles() { return E.adjustFiles(this.parsedFiles, this.settings.sim.growth); },
        report() {
            return E.buildReport({ vehicles: this.vehicles, files: this.simFiles, settings: this.settings, cutHour: this.timeRule, sim: this.settings.sim });
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
                gunlukTutar: this.hasCustomers ? !this.custMissingOwn.length
                    : segs.length > 0 && segs.every(sg => yrs.every(y => Number((s.gunlukTutar[sg] || {})[y]) > 0))
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
            const sg = this.filters.seg;
            return this.sortedVehicles.filter(v => (this.report.counts[v.id] || 0) > 0 && (!sg.length || sg.includes(v.segment)));
        },
        filtersActive() { const f = this.filters; return Object.keys(f).some(k => f[k].length > 0); },
        activeScenarioId() {
            const cur = this.snapshot();
            const sc = this.settings.scenarios.find(s => !!s.sim.up === cur.sim.up && !!s.sim.down === cur.sim.down && (s.sim.target || 'manual') === 'manual' && (Number(s.sim.growth) || 0) === cur.sim.growth
                && this.vehicles.every(v => (Number(s.counts[v.id]) || 0) === (Number(cur.counts[v.id]) || 0)));
            return sc ? sc.id : null;
        },
        optMax() { const o = Number(this.tempVehicle && this.tempVehicle.giderler[DEFAULT_HEADERS[0]]) || 0; return o >= 1 ? Math.floor(o) * 12 : 0; },
        horizonIssues() {
            const n = this.years.length;
            return this.vehicles.filter(v => this.isComplete(v) && Number(v.giderler[DEFAULT_HEADERS[0]]) !== n)
                .map(v => ({ ad: v.markaModel, opt: Number(v.giderler[DEFAULT_HEADERS[0]]) }));
        },

        /* Tarihçe sayfalama */
        histPages() { return Math.max(1, Math.ceil(this.historicalData.length / this.histSize)); },
        histRows() { const s = (this.histPage - 1) * this.histSize; return this.historicalData.slice(s, s + this.histSize); },
        pageButtons() { return this.pager(this.histPage, this.histPages); },

        /* ---- Filtre bağlamı (çoktan seçmeli) ---- */
        msel() { const m = this.filters.month; return m.length ? [...m].map(Number).sort((a, b) => a - b) : null; },
        fctx() {
            const R = this.report, F = this.filters, y0 = R.dataYear || 2026, ms = this.msel;
            const dimOf = i => new Date(y0, i + 1, 0).getDate();
            const dimSum = ms ? ms.reduce((a, i) => a + dimOf(i), 0) : 0;
            const yset = F.year.length ? new Set(F.year.map(String)) : null, sset = F.seg.length ? new Set(F.seg) : null;
            const vset = F.vid.length ? new Set(F.vid.map(String)) : null, cs = F.cust.length ? new Set(F.cust) : null;
            const mset = ms ? new Set(ms) : null;
            return { ms, mset, dimOf, dimSum, mf: ms ? dimSum / 365 : 1, cs, sset, vset, y0,
                yOk: y => !yset || yset.has(String(y)), segOk: p => (!sset || sset.has(p.seg)) && (!vset || vset.has(String(p.vid))),
                mOk: i => !mset || mset.has(i), cOk: c => !cs || cs.has(c || NO_CUST) };
        },
        /* Plaka başına seçili aylardaki müşteri kırılımı: fiyat anahtarları (segment+müşteri → gün), müşteri günleri ve dosya sayıları */
        plateCust() {
            const R = this.report, ms = this.msel, out = new Map();
            R.plates.forEach(p => {
                const keys = {}, cf = {}, cd = {}; let tot = 0;
                const addP = pr => { for (const k in pr) { const d = pr[k], c = E.splitKey(k)[1]; keys[k] = (keys[k] || 0) + d; cd[c] = (cd[c] || 0) + d; tot += d; } };
                const addF = o => { for (const c in o) cf[c] = (cf[c] || 0) + o[c]; };
                if (ms) ms.forEach(i => { addP(p.mPrice[i]); addF(p.mCf[i]); }); else { addP(p.price); p.mCf.forEach(addF); }
                out.set(p.id, { keys, cf, cd, tot });
            });
            return out;
        },
        /* Müşteri filtresi seçiliyken: o müşterilerin talebiyle segment bazında gereken araç (tek başına) */
        custCurve() {
            const X = this.fctx; if (!X.cs) return null;
            const R = this.report, bySeg = {};
            R.sim.assign.forEach(a => { if (X.cs.has(a.c)) (bySeg[a.seg] = bySeg[a.seg] || []).push({ s: a.s, e: a.e }); });
            const out = {};
            Object.keys(bySeg).forEach(k => {
                const cv = E.fleetCurve(bySeg[k], this.timeRule), cum = []; let c = 0;
                cv.forEach(u => { c += u.files; cum.push(c); });
                out[k] = { total: bySeg[k].length, peak: cv.length, cum };
            });
            return out;
        },

        /* Filtrelere göre tüm özetler (simülatör + raporlama) */
        view() {
            const R = this.report, X = this.fctx, sc = R.scale || 1, ms = X.ms, cs = X.cs, mf = X.mf, PC = this.plateCust, RT = R.rates;
            const yOk = X.yOk;
            const z = () => ({ work: 0, idle: 0, revenue: 0, sale: 0, op: 0, buy: 0, int: 0, cost: 0, pers: 0, net: 0, plates: 0, files: 0 });
            const add = (a, r) => { a.work += r.work; a.idle += r.idle; a.revenue += r.revenue; a.sale += r.sale; a.op += r.op; a.buy += r.buy; a.int += r.int; a.cost += r.cost; a.pers += r.pers; a.net += r.net; a.files += r.f; };
            const sumC = o => { let x = 0; for (const c in o) if (cs.has(c)) x += o[c]; return x; };
            const shareOf = p => { const pc = PC.get(p.id); return pc.tot ? sumC(pc.cd) / pc.tot : 0; };
            /* Plakanın bir yıldaki sonucu. Ay seçiliyse seçili aylarda teslim edilen dosyaların çalışma günü ve geliri; yıllık giderler gün sayısına oranlanır, satış hariç.
               Müşteri seçiliyse gelir yalnızca o müşterilerin dosyalarından; giderler, çalışılan ve boşta gün o müşterilerin plakadaki kiralama günü payıyla dağıtılır. */
            const rec = (p, y) => {
                const r = p.byYear[y]; let o;
                if (!ms) o = { work: r.work, idle: r.idle, revenue: r.revenue, sale: r.sale, op: r.op, buy: r.buy, int: r.int, pers: r.pers, f: p.files };
                else {
                    let work = 0, idle = 0, revenue = 0, f = 0;
                    ms.forEach(i => { const dim = X.dimOf(i), ow = Math.min(dim, Math.round(p.months[i].occ)); work += ow; idle += Math.max(0, dim - ow); revenue += r.mRev[i]; f += p.months[i].files; });
                    o = { work, idle, revenue, sale: 0, op: r.op * mf, buy: r.buy * mf, int: r.int * mf, pers: r.pers * mf, f };
                }
                if (cs) {
                    const pc = PC.get(p.id), sh = pc.tot ? sumC(pc.cd) / pc.tot : 0;
                    ['work', 'idle', 'sale', 'op', 'buy', 'int', 'pers'].forEach(k => { o[k] *= sh; });
                    let rev = 0; for (const k in pc.keys) { const [sg, c] = E.splitKey(k); if (cs.has(c)) rev += pc.keys[k] * sc * RT.rate(c, sg, y); }
                    o.revenue = rev; o.f = sumC(pc.cf) * sc;
                }
                o.cost = o.op + o.buy + o.int; o.net = o.revenue + o.sale - o.cost - o.pers;
                return o;
            };
            /* Geri ödeme için tüm yıl (ay filtresinden bağımsız) sonuç; müşteri seçiliyse o müşterilerin payı */
            const recFull = (p, y) => {
                const r = p.byYear[y]; if (!cs) return { ...r, f: p.files };
                let a = 0, t = 0, rev = 0;
                for (const k in p.price) { const d = p.price[k], [sg, c] = E.splitKey(k); t += d; if (cs.has(c)) { a += d; rev += d * sc * RT.rate(c, sg, y); } }
                const sh = t ? a / t : 0, o = { work: r.work * sh, idle: r.idle * sh, revenue: rev, sale: r.sale * sh, op: r.op * sh, buy: r.buy * sh, int: r.int * sh, pers: r.pers * sh, f: 0 };
                o.cost = o.op + o.buy + o.int; o.net = o.revenue + o.sale - o.cost - o.pers; return o;
            };
            const total = z(), yearAgg = {}, yearFull = {}, segAgg = {}, modelAgg = {}, items = {}, cats = {}, plateRows = [], monthWork = Array(12).fill(0), monthCap = Array(12).fill(0);
            R.years.forEach(y => { yearAgg[y] = z(); yearFull[y] = z(); });
            R.plates.forEach(p => {
                if (!X.segOk(p)) return;
                const ct = R.vehicleCosts[p.vid], sh = cs ? shareOf(p) : 1;
                if (cs && !sh) return;
                const pc = PC.get(p.id), files1 = cs ? sumC(pc.cf) * sc : (ms ? ms.reduce((a, i) => a + p.months[i].files, 0) : p.files);
                const row = { p, files1, ...z() };
                p.months.forEach((m, i) => {
                    const dim = X.dimOf(i), k = cs ? this.dayShare(p.mPrice[i], cs) : 1;
                    monthWork[i] += Math.min(m.occ, dim) * k; monthCap[i] += dim * k;
                });
                p.life.forEach(y => {
                    const r = rec(p, y);
                    add(yearAgg[y], r); yearAgg[y].plates++;
                    add(yearFull[y], recFull(p, y));
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
                    ct.rows.forEach(x => put('Araç', x.kalem, x.kategori, x.vals[y] * mf * sh));
                    const ps = p.byYear[y].persShare;
                    if (ps) R.pers.rows.forEach(x => put('Personel', x.kalem, x.kategori, x.vals[y] * ps * mf * sh));
                });
                if (row.plates) { row.util = row.work + row.idle ? row.work / (row.work + row.idle) * 100 : 0; plateRows.push(row); }
            });
            // Üst / alt segment analizi
            const cross = { up: { files: 0, days: 0, gain: 0, diff: 0 }, down: { files: 0, days: 0, gain: 0, diff: 0 } };
            R.plates.forEach(p => {
                if (X.vset && !X.vset.has(String(p.vid))) return;
                const ys = p.life.filter(yOk); if (!ys.length) return;
                p.cross.forEach(c => {
                    if (!X.vset && X.sset && !X.sset.has(c.req)) return;
                    if (cs && !cs.has(c.c || NO_CUST)) return;
                    let fl = c.files, dy = c.days;
                    if (ms) { fl = 0; dy = 0; ms.forEach(i => { fl += c.m[i].files; dy += c.m[i].days; }); }
                    if (!fl) return;
                    const t = cross[c.kind], d = dy * sc; t.files += fl * sc; t.days += d;
                    ys.forEach(y => {
                        const rq = RT.rate(c.c, c.req, y), gv = RT.rate(c.c, c.given, y);
                        if (c.kind === 'up') { t.gain += d * rq; t.diff += d * (gv - rq); }
                        else { t.gain += d * gv; t.diff += d * (rq - gv); }
                    });
                });
            });
            let cum = 0;
            const yearRows = R.years.filter(y => yearAgg[y].plates).map(y => {
                const a = yearAgg[y]; cum += a.net;
                return { year: y, ...a, cum, util: a.work + a.idle ? a.work / (a.work + a.idle) * 100 : 0 };
            });
            // Geri ödeme: yıllık bazda kümülatif net ilk kez ≥ 0
            let pcum = 0, payback = null; const activeYears = R.years.filter(y => yearFull[y].plates || yearFull[y].cost);
            activeYears.forEach((y, i) => { pcum += yearFull[y].net; if (payback === null && pcum >= 0) payback = { n: i + 1, year: y }; });
            const stats = R.sim.segStats;
            const vSegs = X.vset ? new Set(this.vehicles.filter(v => X.vset.has(String(v.id))).map(v => v.segment)) : null;
            const sStat = k => this.statOf(stats[k], ms, cs);
            const segKeys = Object.keys(stats).filter(k => (vSegs ? vSegs.has(k) : (!X.sset || X.sset.has(k))));
            const demand = segKeys.reduce((a, k) => a + sStat(k).total, 0);
            const handled = X.vset ? Math.round(plateRows.reduce((a, r) => a + r.files1, 0)) : segKeys.reduce((a, k) => a + sStat(k).handled, 0);
            const rentalDays = segKeys.reduce((a, k) => a + sStat(k).days, 0), simHandled = segKeys.reduce((a, k) => a + sStat(k).handled, 0);
            const files = { total: demand, handled, missed: Math.max(0, demand - handled), ratio: demand ? handled / demand * 100 : 0 };
            const order = k => { const i = SEGMENTS.indexOf(k); return i < 0 ? 99 : i; };
            const CC = this.custCurve;
            const curveOf = k => {
                if (CC) { const c = CC[k]; return c ? { peak: c.peak, need: pct => { const n = c.cum.findIndex(x => x >= pct / 100 * c.total - 1e-9); return n < 0 ? c.peak : n + 1; } } : { peak: 0, need: () => 0 }; }
                const c = R.curves[k]; if (!c || !c.total) return { peak: c ? c.peak : 0, need: () => 0 };
                return { peak: c.peak, need: pct => { const p = c.points.find(x => x.handled >= pct / 100 * c.total - 1e-9); return p ? p.n : c.peak; } };
            };
            const allSegs = [...new Set([...Object.keys(stats), ...Object.keys(segAgg)])].filter(k => !X.sset || X.sset.has(k)).sort((a, b) => order(a) - order(b));
            const segmentRows = allSegs.map(k => {
                const a = segAgg[k] || z(), st = sStat(k);
                const cnt = R.plates.filter(p => p.seg === k && (!X.vset || X.vset.has(String(p.vid)))).length;
                return { seg: k, cnt, total: st.total, handled: st.handled, cross: st.up + st.down, missed: st.total - st.handled, ratio: st.total ? st.handled / st.total * 100 : 0,
                    peak: curveOf(k).peak, ...a, util: a.work + a.idle ? a.work / (a.work + a.idle) * 100 : 0 };
            }).filter(r => r.cnt || r.total || r.plates);
            const modelRows = this.sortedVehicles.filter(v => (!X.sset || X.sset.has(v.segment)) && (!X.vset || X.vset.has(String(v.id))) && (R.counts[v.id] || 0) > 0).map(v => {
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
            const peak = segKeys.reduce((a, k) => a + curveOf(k).peak, 0);
            const fleetIn = segKeys.reduce((a, k) => a + R.plates.filter(p => p.seg === k).length, 0);
            const needFor = pct => segKeys.reduce((a, k) => a + curveOf(k).need(pct), 0);
            const pctOf = (n) => demand ? n / demand * 100 : 0;
            const sup = this.supplierCalc(R, segKeys, ms, yOk, null, cs);
            yearRows.forEach(r => { r.sup = (sup.byYear[r.year] || {}).margin || 0; r.company = r.net + r.sup; });
            const ownDayCost = total.work ? (gider - total.sale) / total.work : 0;
            const custDay = sup.ownDays ? sup.ownCust / sup.ownDays : (total.work ? total.revenue / total.work : 0);
            const supDay = sup.ownDays ? sup.ownSup / sup.ownDays : sup.avgSup;
            const cmp = { custDay, supDay, ownProfit: custDay - ownDayCost, supProfit: custDay - supDay, adv: supDay - ownDayCost, advTotal: (supDay - ownDayCost) * total.work };
            return {
                sup, cmp, companyNet: total.net + sup.margin, ownDayCost, rec,
                ms, cs, total, gelir, gider, util, breakEven, payback, peak, fleetIn, need80: needFor(80),
                perFileVeh: pf(total.cost), perFilePers: pf(total.pers), perFileRev: pf(gelir), perFileNet: pf(total.net),
                plateTotal: plateRows.length, idlePlates: plateRows.filter(r => r.files1 === 0).length,
                avgWork: plateYears ? total.work / plateYears : 0, avgRental: simHandled ? rentalDays / simHandled : 0,
                netPerWorkDay: total.work ? total.net / total.work : 0, netPerPlate: plateRows.length ? total.net / plateRows.length : 0,
                files, segKeys, monthWork, monthCap,
                up: { ...cross.up, ratio: pctOf(cross.up.files) }, down: { ...cross.down, ratio: pctOf(cross.down.files) },
                yearRows, segmentRows, modelRows, itemRows, catRows, plateRowsAll: plateRows,
                plateRows: shownPlates, plateCount: shownPlates.length,
                itemTotal: itemRows.reduce((sum, r) => sum + r.tutar, 0)
            };
        },
        /* Müşteri bazında sonuçlar: talep / karşılama segment istatistiklerinden; gelir müşterinin dosyalarından (kendi tutarıyla);
           araç ve personel gideri, satış ve çalışılan gün her plakada müşterinin kiralama günü payıyla dağıtılır. */
        custView() {
            const R = this.report, X = this.fctx, V = this.view, sc = R.scale || 1, RT = R.rates, PC = this.plateCust, ms = X.ms;
            const list = this.customerList.filter(c => X.cOk(c));
            if (!this.hasCustomers) return { rows: [], tot: null, capTotal: 0 };
            const z = c => ({ c, label: c || NO_CUST_LABEL, total: 0, handled: 0, own: 0, up: 0, down: 0, days: 0, work: 0, revenue: 0, sale: 0, cost: 0, pers: 0, files: 0 });
            const A = new Map(); list.forEach(c => A.set(c, z(c)));
            V.segKeys.forEach(k => {
                const s = R.sim.segStats[k]; if (!s) return;
                Object.keys(s.c).forEach(c => { const a = A.get(c); if (!a) return; const x = this.statOf(s, ms, new Set([c])); STAT_KEYS.forEach(q => { a[q] += x[q]; }); });
            });
            let capTotal = 0;
            R.plates.forEach(p => {
                if (!X.segOk(p)) return;
                const pc = PC.get(p.id), ys = p.life.filter(X.yOk); if (!ys.length) return;
                ys.forEach(y => {
                    const b = p.byYear[y]; let work, idle, sale, cost, pers;
                    if (!ms) { work = b.work; idle = b.idle; sale = b.sale; cost = b.cost; pers = b.pers; }
                    else { work = 0; idle = 0; ms.forEach(i => { const dim = X.dimOf(i), ow = Math.min(dim, Math.round(p.months[i].occ)); work += ow; idle += Math.max(0, dim - ow); }); sale = 0; cost = b.cost * X.mf; pers = b.pers * X.mf; }
                    capTotal += work + idle;
                    if (!pc.tot) return;
                    for (const c in pc.cd) { const a = A.get(c); if (!a) continue; const sh = pc.cd[c] / pc.tot; a.work += work * sh; a.sale += sale * sh; a.cost += cost * sh; a.pers += pers * sh; }
                    for (const k in pc.keys) { const [sg, c] = E.splitKey(k), a = A.get(c); if (a) a.revenue += pc.keys[k] * sc * RT.rate(c, sg, y); }
                });
                for (const c in pc.cf) { const a = A.get(c); if (a) a.files += pc.cf[c] * sc; }
            });
            const sp = this.hasSupplier ? this.supplierCalc(R, V.segKeys, ms, X.yOk, null, X.cs).byCust : {};
            const rows = [...A.values()].filter(a => a.total || a.revenue || a.files).map(a => {
                const s = sp[a.c] || { margin: 0, files: 0, lost: 0 }, gider = a.cost + a.pers, gelir = a.revenue + a.sale, net = gelir - gider;
                return { ...a, gelir, gider, net, cross: a.up + a.down, missed: a.total - a.handled, ratio: a.total ? a.handled / a.total * 100 : 0,
                    contrib: capTotal ? a.work / capTotal * 100 : 0, margin: gelir ? net / gelir * 100 : 0, avgRental: a.handled ? a.days / a.handled : 0,
                    revDay: a.work ? a.revenue / a.work : 0, costDay: a.work ? (gider - a.sale) / a.work : 0, netFile: a.handled ? net / a.handled : 0,
                    sup: s.margin, supFiles: s.files, lost: s.lost, company: net + s.margin };
            }).sort((a, b) => b.gelir - a.gelir || b.total - a.total);
            const tot = rows.reduce((t, r) => { ['total', 'handled', 'cross', 'missed', 'days', 'work', 'revenue', 'sale', 'cost', 'pers', 'gelir', 'gider', 'net', 'sup', 'company', 'contrib'].forEach(k => { t[k] += r[k]; }); return t; },
                { total: 0, handled: 0, cross: 0, missed: 0, days: 0, work: 0, revenue: 0, sale: 0, cost: 0, pers: 0, gelir: 0, gider: 0, net: 0, sup: 0, company: 0, contrib: 0 });
            tot.ratio = tot.total ? tot.handled / tot.total * 100 : 0; tot.margin = tot.gelir ? tot.net / tot.gelir * 100 : 0;
            return { rows, tot, capTotal };
        },
        /* Detay tabloları (sıralanabilir) */
        detailTables() {
            const V = this.view, m = this.money, f = this.formatCurrency, pc = this.pct, nc = n => this.netClass(n);
            const T = (v, d, c) => ({ v, d: d === undefined ? v : d, c: c || '' });
            const M = v => T(v, m(v)), N = v => T(v, m(v), nc(v)), I = v => T(v, f(v)), P = v => T(v, pc(v));
            const col = (l, start) => ({ l, start: !!start });
            const sup = this.hasSupplier;
            const yc = [col('Yıl', 1), col('Aktif Araç'), col('Çalışılan Gün'), col('Boşta Gün'), col('Doluluk'), col('Dosya Geliri'), col('Araç Satışı'), col('İşletme Gideri'), col('Alış Gideri'), col('Faiz Gideri'), col('Personel Gideri'), col('Filo Neti'), col('Kümülatif Net')];
            if (sup) yc.push(col('Tedarikçi Marjı'), col('Şirket Neti'));
            const yillik = { cols: yc, rows: V.yearRows.map(r => { const c = [T(r.year, r.year, 'text-start fw-bold'), I(r.plates), I(r.work), I(r.idle), P(r.util), M(r.revenue), M(r.sale), M(r.op), M(r.buy), M(r.int), M(r.pers), N(r.net), T(r.cum, m(r.cum), 'fw-bold ' + nc(r.cum))]; if (sup) c.push(N(r.sup), T(r.company, m(r.company), 'fw-bold ' + nc(r.company))); return { key: r.year, cells: c }; }) };
            const segment = { cols: [col('Segment', 1), col('Araç'), col('Pik İhtiyaç'), col('Dosya'), col('Karşılanan'), col('Üst/Alt Seg.'), col('Karşılanamayan'), col('Karşılama Oranı'), col('Doluluk'), col('Gelir'), col('Araç Gideri'), col('Personel Gideri'), col('Net')],
                rows: V.segmentRows.map(r => ({ key: r.seg, cells: [T(r.seg, r.seg, 'text-start fw-bold'), I(r.cnt), I(r.peak), I(r.total), I(r.handled), I(r.cross), T(r.missed, f(r.missed), r.missed ? 'text-danger' : ''), T(r.ratio, pc(r.ratio), 'fw-bold ' + this.ratioClass(r.ratio)), T(r.cnt ? r.util : -1, r.cnt ? pc(r.util) : '-'), M(r.revenue + r.sale), M(r.cost), M(r.pers), N(r.net)] })) };
            const model = { cols: [col('Araç', 1), col('Segment'), col('Öncelik'), col('Adet'), col('Çalışılan Gün'), col('Boşta Gün'), col('Doluluk'), col('Gelir'), col('Araç Gideri'), col('Personel Gideri'), col('Net'), col('Araç Başı Net')],
                rows: V.modelRows.map(r => ({ key: r.v.id, cells: [{ v: r.v.markaModel, d: r.v.markaModel, c: 'text-start fw-bold', img: r.v.imageBase64 || this.placeholder }, T(r.v.segment), I(this.rankOf[r.v.id] || 0), I(r.cnt), I(r.work), I(r.idle), P(r.util), M(r.revenue + r.sale), M(r.cost), M(r.pers), N(r.net), N(r.cnt ? r.net / r.cnt : 0)] })) };
            const it = V.itemTotal || 1;
            const giderItems = { cols: [col('Gider Kalemi', 1), col('Grup', 1), col('Kategori', 1), col('Tutar'), col('Pay')],
                rows: V.itemRows.map(r => ({ key: r.grup + r.kalem, cells: [T(r.kalem, r.kalem, 'text-start'), T(r.grup, r.grup, 'text-start'), T(r.kategori, r.kategori, 'text-start'), M(r.tutar), P(r.tutar / it * 100)] })),
                foot: [T('', 'Toplam', 'text-start'), T(''), T(''), T(0, m(V.itemTotal)), T(0, '%100')] };
            const giderCats = { cols: [col('Kategori', 1), col('Grup', 1), col('Tutar'), col('Pay')],
                rows: V.catRows.map(r => ({ key: r.grup + r.kategori, cells: [T(r.kategori, r.kategori, 'text-start fw-bold'), T(r.grup, r.grup, 'text-start'), M(r.tutar), P(r.tutar / it * 100)] })) };
            const plaka = { cols: [col('Plaka', 1), col('Araç', 1), col('Segment'), col('Dosya'), col('Çalışılan'), col('Boşta'), col('Doluluk'), col('Doluluk %'), col('Gelir'), col('Araç Gideri'), col('Personel'), col('Net')],
                rows: V.plateRows.map(r => ({ key: r.p.id, p: r.p, cells: [T(r.p.plate, r.p.plate, 'text-start fw-bold'), T(r.p.model, r.p.model, 'text-start'), T(r.p.seg), I(Math.round(r.files1)), I(r.work), I(r.idle), { v: r.util, bar: r.util }, P(r.util), M(r.revenue + r.sale), M(r.cost), M(r.pers), N(r.net)] })) };
            const A = this.monthDetail;
            const ay = { cols: [col('Ay', 1), col('Talep'), col('Karşılanan'), col('Karşılama'), col('Üst/Alt Seg.'), col('Karşılanamayan'), col('Dolu Gün'), col('Doluluk'), col('Dosya Geliri'), col('Gider (Araç + Personel)'), col('Net'), col('Kümülatif Net')],
                rows: A.rows.map(r => ({ key: r.mi, cells: [T(r.mi, MONTHS[r.mi], 'text-start fw-bold'), I(r.total), I(r.handled), T(r.ratio, pc(r.ratio), 'fw-bold ' + this.ratioClass(r.ratio)), I(r.cross), T(r.missed, f(r.missed), r.missed ? 'text-danger' : ''), I(r.work), P(r.util), M(r.revenue), M(r.cost), N(r.net), T(r.cum, m(r.cum), 'fw-bold ' + nc(r.cum))] })),
                foot: A.rows.length ? [T('', 'Toplam', 'text-start'), T(0, f(A.tot.total)), T(0, f(A.tot.handled)), T(0, pc(A.tot.total ? A.tot.handled / A.tot.total * 100 : 0)), T(0, f(A.tot.cross)), T(0, f(A.tot.missed)), T(0, f(A.tot.work)), T(0, pc(A.tot.cap ? A.tot.work / A.tot.cap * 100 : 0) + ' ort.'), T(0, m(A.tot.revenue)), T(0, m(A.tot.cost)), T(0, m(A.tot.net), nc(A.tot.net)), T(0, m(A.tot.net), nc(A.tot.net))] : null };
            const CV = this.custView, ct = CV.tot;
            const mc = [col('Müşteri', 1), col('Dosya'), col('Karşılanan'), col('Üst/Alt Seg.'), col('Karşılanamayan'), col('Karşılama'), col('Kiralama Günü'), col('Doluluğa Katkı'), col('Gelir'), col('Araç Gideri'), col('Personel Gideri'), col('Net'), col('Kârlılık')];
            if (sup) mc.push(col('Tedarikçi Marjı'), col('Şirket Neti'));
            const musteri = { cols: mc, rows: CV.rows.map(r => { const c = [T(r.label, r.label, 'text-start fw-bold' + (r.c ? '' : ' text-muted')), I(r.total), I(r.handled), I(r.cross), T(r.missed, f(r.missed), r.missed ? 'text-danger' : ''), T(r.ratio, pc(r.ratio), 'fw-bold ' + this.ratioClass(r.ratio)), I(r.days), P(r.contrib), M(r.gelir), M(r.cost), M(r.pers), N(r.net), T(r.margin, pc(r.margin), nc(r.margin))]; if (sup) c.push(N(r.sup), T(r.company, m(r.company), 'fw-bold ' + nc(r.company))); return { key: r.c || '-', cells: c }; }),
                foot: ct && CV.rows.length ? [T('', 'Toplam', 'text-start'), T(0, f(ct.total)), T(0, f(ct.handled)), T(0, f(ct.cross)), T(0, f(ct.missed)), T(0, pc(ct.ratio)), T(0, f(ct.days)), T(0, pc(ct.contrib)), T(0, m(ct.gelir)), T(0, m(ct.cost)), T(0, m(ct.pers)), T(0, m(ct.net), nc(ct.net)), T(0, pc(ct.margin), nc(ct.margin)), ...(sup ? [T(0, m(ct.sup), nc(ct.sup)), T(0, m(ct.company), nc(ct.company))] : [])] : null };
            return { yillik, segment, musteri, model, giderItems, giderCats, plaka, ay };
        },
        /* Müşteri bazında aylık talep: en yüksek 5 müşteri + Diğer (filtreler uygulanır) */
        custMonthly() {
            if (!this.hasCustomers) return { series: [], rows: [] };
            const A = this.assignFiltered, tot = {};
            A.forEach(a => { tot[a.c] = (tot[a.c] || 0) + 1; });
            const top = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, 5), idx = new Map(top.map((c, i) => [c, i]));
            const other = Object.keys(tot).length > top.length, n = top.length + (other ? 1 : 0);
            const m = Array.from({ length: 12 }, () => Array(n).fill(0));
            A.forEach(a => { const i = idx.has(a.c) ? idx.get(a.c) : top.length; m[a.mi][i]++; });
            const rows = m.map((v, mi) => ({ mi, v, total: v.reduce((x, y) => x + y, 0) })).filter(r => r.total);
            return { series: [...top.map(c => c || NO_CUST_LABEL), ...(other ? ['Diğer'] : [])], rows, other };
        },
        /* Müşteri × segment talep matrisi */
        custSegments() {
            if (!this.hasCustomers) return { segs: [], rows: [] };
            const A = this.assignFiltered, segSet = new Set(), by = new Map(), ord = sg => { const i = SEGMENTS.indexOf(sg); return i < 0 ? 99 : i; };
            A.forEach(a => { segSet.add(a.seg); const o = by.get(a.c) || {}; o[a.seg] = (o[a.seg] || 0) + 1; by.set(a.c, o); });
            const segs = [...segSet].sort((a, b) => ord(a) - ord(b));
            const rows = [...by.entries()].map(([c, o]) => { const v = segs.map(sg => o[sg] || 0); return { c, label: c || NO_CUST_LABEL, v, total: v.reduce((x, y) => x + y, 0) }; }).sort((a, b) => b.total - a.total);
            return { segs, rows };
        },
        /* Ay bazlı performans (teslim ayına göre) */
        monthDetail() {
            const R = this.report, X = this.fctx, V = this.view, st = R.sim.segStats, sc = R.scale || 1, RT = R.rates;
            const yrs = R.years.filter(X.yOk), nY = yrs.length || 1;
            const rows = []; let cum = 0; const tot = { total: 0, handled: 0, cross: 0, missed: 0, work: 0, cap: 0, revenue: 0, cost: 0, net: 0 };
            for (let mi = 0; mi < 12; mi++) {
                if (!X.mOk(mi)) continue;
                const dim = X.dimOf(mi), d = { total: 0, handled: 0, cross: 0 };
                V.segKeys.forEach(k => { const x = this.statOf(st[k], [mi], X.cs); d.total += x.total; d.handled += x.handled; d.cross += x.up + x.down; });
                let work = 0, cap = 0, revenue = 0, cost = 0;
                R.plates.forEach(p => {
                    if (!X.segOk(p)) return;
                    const k = X.cs ? this.dayShare(p.mPrice[mi], X.cs) : 1; if (!k) return;
                    p.life.forEach(y => {
                        if (!X.yOk(y)) return;
                        const b = p.byYear[y];
                        work += Math.min(p.months[mi].occ, dim) * k; cap += dim * k; cost += (b.cost + b.pers) * dim / 365 * k;
                        if (!X.cs) revenue += b.mRev[mi];
                        else { const pr = p.mPrice[mi]; for (const key in pr) { const [sg, c] = E.splitKey(key); if (X.cs.has(c)) revenue += pr[key] * sc * RT.rate(c, sg, y); } }
                    });
                });
                if (!d.total && !work) continue;
                const total = d.total * nY, handled = d.handled * nY, net = revenue - cost; cum += net;
                const r = { mi, total, handled, cross: d.cross * nY, missed: total - handled, ratio: total ? handled / total * 100 : 0, work, cap, util: cap ? work / cap * 100 : 0, revenue, cost, net, cum };
                rows.push(r); Object.keys(tot).forEach(k => { tot[k] += r[k]; });
            }
            return { rows, tot };
        },
        /* Operasyon yükü: kendi filomuzun günlük teslimat ve iade işlemleri */
        opsLoad() {
            const R = this.report, X = this.fctx, plate = {};
            R.plates.forEach(p => { plate[p.id] = p; });
            const day = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
            const del = {}, ret = {}; let lo = Infinity, hi = -Infinity;
            R.sim.assign.forEach(a => {
                if (a.s < lo) lo = a.s; if (a.e > hi) hi = a.e;
                const p = a.unit ? plate[a.unit] : null; if (!p || !X.segOk(p) || !X.cOk(a.c)) return;
                if (X.mOk(a.mi)) { const k = day(a.s); del[k] = (del[k] || 0) + 1; }
                if (X.mOk(new Date(a.e).getMonth())) { const k = day(a.e); ret[k] = (ret[k] || 0) + 1; }
            });
            const out = { max: { total: 0, del: 0, ret: 0, date: '-' }, min: { total: 0, del: 0, ret: 0, date: '-' }, avgTotal: 0, avgDel: 0, avgRet: 0, maxDel: 0, maxRet: 0, perAvg: 0, perMax: 0, days: 0 };
            if (lo === Infinity) return out;
            let d0 = day(lo), d1 = day(hi);
            const list = [];
            for (let t = d0; t <= d1; t = new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate() + 1).getTime()) {
                if (!X.mOk(new Date(t).getMonth())) continue;
                list.push({ t, del: del[t] || 0, ret: ret[t] || 0 });
            }
            if (!list.length) return out;
            list.forEach(x => { x.total = x.del + x.ret; });
            const mx = list.reduce((a, x) => (x.total > a.total ? x : a)), mn = list.reduce((a, x) => (x.total < a.total ? x : a));
            const ds = t => new Date(t).toLocaleDateString('tr-TR');
            const n = list.length, sd = list.reduce((a, x) => a + x.del, 0), sr = list.reduce((a, x) => a + x.ret, 0);
            const pers = Number(this.settings.personelSayisi) || 0, active = pers * 6 / 7;
            Object.assign(out, { max: { ...mx, date: ds(mx.t) }, min: { ...mn, date: ds(mn.t) }, avgDel: sd / n, avgRet: sr / n, avgTotal: (sd + sr) / n,
                maxDel: Math.max(...list.map(x => x.del)), maxRet: Math.max(...list.map(x => x.ret)), days: n, pers, active,
                perAvg: active ? (sd + sr) / n / active : 0, perMax: active ? mx.total / active : 0, list });
            return out;
        },
        spanInfo() { const d = this.report.sim.spanDays; return d ? Math.round(d) : 0; },
        spanRange() { const S = this.report.sim, d = t => new Date(t).toLocaleDateString('tr-TR'); return S.totalFiles ? d(S.minS) + ' – ' + d(S.maxS) : ''; },

        /* ================= Raporlama ================= */
        curveSegs() { return SEGMENTS.filter(s => (this.report.curves[s] || {}).total > 0); },
        segsNoModel() { return Object.keys(this.report.curves).filter(k => this.report.curves[k].total > 0 && !this.report.curves[k].hasModel); },
        curveSeg() {
            if (this.filters.seg.length === 1 && this.curveSegs.includes(this.filters.seg[0])) return this.filters.seg[0];
            return this.curveSegs.includes(this.reportSeg) ? this.reportSeg : (this.curveSegs[0] || null);
        },
        assignFiltered() {
            const R = this.report, X = this.fctx, V = this.view;
            return R.sim.assign.filter(a => V.segKeys.includes(a.seg) && X.mOk(a.mi) && X.cOk(a.c));
        },
        monthly() {
            const R = this.report, V = this.view, X = this.fctx, st = R.sim.segStats;
            return MONTHS.map((m, i) => {
                const t = { total: 0, own: 0, up: 0, down: 0, handled: 0 };
                V.segKeys.forEach(k => { const x = this.statOf(st[k], [i], X.cs); t.total += x.total; t.own += x.own; t.up += x.up; t.down += x.down; t.handled += x.handled; });
                return { m, ...t, missed: t.total - t.handled, util: V.monthCap[i] && t.total ? V.monthWork[i] / V.monthCap[i] * 100 : null };
            });
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
        /* En kârlı filo: her segmentte, aracın getirdiği net (gelir − araç gideri − kilit açıksa personel payı) ile
           o işi tedarikçiye verseydik kazanacağımız marj karşılaştırılarak araç sayısı seçilir; sonra bu filo
           tam simülasyondan geçirilip (üst/alt segment, personel, tedarikçi dahil) gerçek şirket neti hesaplanır. */
        bestFleet() {
            if (!this.totalPlates && !this.vehicles.length) return null;
            const R = this.reportFor({ ...this.settings.sim, target: 'best' }), all = () => true;
            const sum = this.netOf(R), sp = this.supplierCalc(R, null, null, all);
            const bySeg = {}; R.plates.forEach(p => { bySeg[p.seg] = (bySeg[p.seg] || 0) + 1; });
            const cur = this.netOf(this.report), cs = this.supplierCalc(this.report, null, null, all);
            return { n: R.plates.length, bySeg, net: sum, company: sum + sp.margin, curCompany: cur + cs.margin, pers: this.persFor(R.plates.length) };
        },
        execSummary() {
            const V = this.view, R = this.report, out = [];
            if (!R.plates.length && !V.files.total) return out;
            out.push(`<b>${this.formatCurrency(V.plateTotal)}</b> araçlık filo, ${this.formatCurrency(V.files.total)} dosyanın <b>${this.formatCurrency(V.files.handled)}</b> tanesini karşılıyor (<b>${this.pct(V.files.ratio)}</b>). Filo doluluğu <b>${this.pct(V.util)}</b>, net sonuç <b class="${V.total.net < 0 ? 'text-danger' : 'text-success'}">${this.shortMoney(V.total.net)}</b>.`);
            if (V.peak) out.push(`Dosyaların %80'ini karşılamak için <b>${this.formatCurrency(V.need80)}</b>, tamamını karşılamak için <b>${this.formatCurrency(V.peak)}</b> araç gerekiyor (en yoğun anda aynı anda kirada olması gereken araç sayısı).`);
            const bf = this.bestFleet; if (bf && bf.n) { const d = bf.company - bf.curCompany; out.push(`Kârı en yükselten filo <b>${this.formatCurrency(bf.n)}</b> araç (${Object.entries(bf.bySeg).map(([k, n]) => k + ': ' + n).join(', ')})${this.settings.personelKilit ? '' : ', ' + bf.pers + ' personelle'}. Bu filoyla ${this.hasSupplier ? 'şirket toplam neti' : 'net sonuç'} <b>${this.shortMoney(bf.company)}</b>; mevcut filoya göre <b class="${d >= 0 ? 'text-success' : 'text-danger'}">${d >= 0 ? '+' : ''}${this.shortMoney(d)}</b>.`); }
            if (this.hasSupplier && V.sup.allDays) { const k = V.cmp; out.push(`Müşteriye günlük ortalama <b>${this.money(k.custDay)}</b> yansıtıyoruz. Kendi aracımızla günlük kârımız <b>${this.money(k.ownProfit)}</b> (gün maliyeti ${this.money(V.ownDayCost)}), tedarikçiyle <b>${this.money(k.supProfit)}</b> (tedarikçi ${this.money(k.supDay)}). Kendi aracı vermek günde <b class="${k.adv >= 0 ? 'text-success' : 'text-danger'}">${this.money(k.adv)}</b> ${k.adv >= 0 ? 'daha kârlı' : 'daha zararlı'}; filonun çalıştığı tüm günlerde toplam <b>${this.shortMoney(k.advTotal)}</b>. Tedarikçiye giden ${this.formatCurrency(V.sup.files)} dosyadan marj ${this.shortMoney(V.sup.margin)}, şirket toplam neti <b>${this.shortMoney(V.companyNet)}</b>.`); }
            if (V.breakEven !== null) out.push(`Başabaş doluluk oranı <b>${this.pct(V.breakEven)}</b>; filo doluluğu bunun altına düşerse zarar edilir (şu an ${this.pct(V.util)}).`);
            if (V.payback) out.push(`Yatırım <b>${V.payback.n}. yılda (${V.payback.year})</b> kendini geri ödüyor.`);
            else if (V.plateTotal) out.push(`Tanımlı yıllar içinde kümülatif net sonuç <b>pozitife dönmüyor</b>.`);
            const mr = [...V.modelRows].sort((a, b) => b.net / Math.max(1, b.cnt) - a.net / Math.max(1, a.cnt));
            if (mr.length > 1) out.push(`Araç başı en kârlı model <b>${mr[0].v.markaModel}</b> (${this.shortMoney(mr[0].net / Math.max(1, mr[0].cnt))}), en zayıf model <b>${mr[mr.length - 1].v.markaModel}</b> (${this.shortMoney(mr[mr.length - 1].net / Math.max(1, mr[mr.length - 1].cnt))}).`);
            const mo = this.monthly.filter(m => m.total); if (mo.length) { const top = mo.reduce((a, b) => (b.total > a.total ? b : a)); out.push(`Talebin en yoğun olduğu ay <b>${top.m}</b> (${this.formatCurrency(top.total)} dosya, karşılama ${this.pct(top.total ? top.handled / top.total * 100 : 0)}).`); }
            const CR = this.custView.rows.filter(r => r.c);
            if (CR.length > 1) {
                const top = CR[0], best = CR.reduce((a, r) => (r.net > a.net ? r : a), CR[0]), lossN = CR.filter(r => r.net < 0).length, gt = this.custView.tot.gelir;
                out.push(`${CR.length} müşteri içinde en çok gelir getiren <b>${top.label}</b> (${this.shortMoney(top.gelir)}, gelirin ${this.pct(gt ? top.gelir / gt * 100 : 0)}'i, karşılama ${this.pct(top.ratio)}). En kârlı müşteri <b>${best.label}</b> (net ${this.shortMoney(best.net)})${lossN ? `; <b class="text-danger">${lossN}</b> müşteride filo zarar ediyor` : ''}.`);
            }
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
                const R = this.reportFor({ ...DEFAULT_SIM(), ...s.sim }, s.counts);
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
                'Dosya Geliri': `Her dosya için: kiralama günü × günlük tutar.\nKiralama günü tam gündür (24 saat + 3 saati aşan kalan 1 gün). Yıl sonuna sarkan dosya (ör. 25 Aralık teslim, 2 Ocak iade = 8 gün) tamamen başladığı yılın tutarıyla ve teslimat ayına gelir yazılır.\nGünlük tutar dosyanın müşterisine göre alınır; müşteriye tutar girilmemişse varsayılan segment tutarı kullanılır.\nMüşteri filtresi seçiliyken yalnızca o müşterilerin dosyalarının geliri; giderler araç başına müşterinin kiralama günü payıyla dağıtılır.\nÜst segment verilen dosya talep edilen segmentin, alt segment verilen dosya verilen segmentin tutarıyla fiyatlanır.\nGün sayımı: tam 24 saatler + 3 saatten fazla artan süre 1 gün.\nToplam: ${f(t.work)} gün → ${m(t.revenue)}`,
                'Araç İşletme Gideri': `Araç gider başlıklarının yıllık tutarları × araç adedi.\nYıllık tutar: baz yıl girilen tutar, sonraki yıllar enflasyonla artar. Km bazlı (bakım), ömür boyu adet (lastik), yılda adet (temizlik), tek seferlik ve yakıt km başlıkları kendi kurallarıyla hesaplanır. Araç başı detay: araç kartında "İncele".\nToplam: ${m(t.op)}`,
                'Alış Gideri': `Araç alış bedelinin anapara kısmı.\nPeşin: tamamı ilk kullanım yılına. Kredili: her yıl ödenen taksitlerin anapara kısmı; kredi araç ömründen uzunsa kalan anapara satış yılında kapatılır.\nToplam: ${m(t.buy)}`,
                'Faiz Gideri': `Kredili araçların taksitlerindeki faiz kısmı (eşit taksit; aylık faiz = yıllık faiz ÷ 12). Taksit ödendiği yıla yazılır.\nToplam: ${m(t.int)}`,
                'Personel Gideri': `Personel başlıklarının kişi başı yıllık tutarı × çalıştırılacak personel sayısı; enflasyonla artar.\nFilo geneli sabit gider olarak, o yıl aktif araçlara aldıkları dosya oranında dağıtılır.\nToplam: ${m(t.pers)}`,
                'Net Kâr / Zarar': `Araç satış geliri + dosya geliri − işletme − alış − faiz − personel\n= ${sm(t.sale)} + ${sm(t.revenue)} − ${sm(t.op)} − ${sm(t.buy)} − ${sm(t.int)} − ${sm(t.pers)}\n= ${m(t.net)}`,
                'Filo Doluluk Oranı': `Çalışılan gün ÷ (çalışılan + boşta gün).\nHer plaka dönem boyunca ${R.period} gün sayılır (tarihçe 1 yıllıksa 365).\n${f(t.work)} ÷ ${f(t.work + t.idle)} = ${pc(V.util)}`,
                'Karşılanan Dosya': `Talep: tarihçedeki dosya sayısı (seçili segment / ay).\nKarşılanan: araç verilebilen dosyalar (kendi segmenti + açıksa üst/alt segment).\nDosya, teslim anında boşta olan, segmentindeki en düşük giderli araca verilir; iade saati sınırından sonra dönen araç ertesi gün boşa çıkar.\n${f(fs.handled)} / ${f(fs.total)}`,
                'Karşılanan Dosya Oranı': `Karşılanan dosya ÷ talep edilen dosya.\n${f(fs.handled)} ÷ ${f(fs.total)} = ${pc(fs.ratio)}`,
                'Araç Sayısı': `Simülasyondaki plaka sayısı (araç kartlarındaki adetlerin toplamı).\nHiç dosya almayan: dönem boyunca bir kez bile kiralanmayan plaka.`,
                'En Yoğun Gün': `Kendi filomuzla yapılan teslimat (dosya başlangıcı) + iade (dosya bitişi) işlemlerinin en fazla olduğu gün.\nTedarikçiye giden dosyalar dahil değildir. Segment / marka / ay filtresi uygulanır.`,
                'Ortalama Gün': `Veri dönemindeki her gün (işlem olmayan günler dahil) teslimat + iade ortalaması.\n${this.formatCurrency(this.opsLoad.days)} gün üzerinden.`,
                'En Sakin Gün': `Teslimat + iade toplamının en az olduğu gün (dönem içindeki işlem olmayan günler dahil).`,
                'Personel Başına Günlük İşlem': `Her personel haftada 6 gün çalışır, 1 gün izinlidir; günde ortalama aktif personel = personel × 6 / 7.\nOrtalama: günlük ortalama işlem ÷ aktif personel = ${this.fmt1(this.opsLoad.avgTotal)} ÷ ${this.fmt1(this.opsLoad.active)} = ${this.fmt1(this.opsLoad.perAvg)}\nEn yoğun gün: ${this.formatCurrency(this.opsLoad.max.total)} ÷ ${this.fmt1(this.opsLoad.active)} = ${this.fmt1(this.opsLoad.perMax)}`,
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
        /* Duyarlılık: her varsayım ±%p değişince şirket toplam neti (tüm yıllar, mevcut filo) ne olur */
        sensitivity() { return this.sensData; },
        /* Model karar tablosu: çalışılan gün başı gelir / maliyet ve tedarikçiye göre avantaj */
        modelDecision() {
            const V = this.view, X = this.fctx, R = this.report;
            const yrs = this.years.filter(X.yOk);
            return V.modelRows.map(r => {
                const w = r.work, custDay = w ? r.revenue / w : 0, costDay = w ? (r.cost + r.pers - r.sale) / w : 0;
                // tedarikçi günlük tutarı: segmentteki talebin müşteri dağılımıyla ağırlıklı ortalama
                const sv = yrs.map(y => R.segAvg(r.v.segment, y).sup).filter(x => x > 0), supDay = sv.length ? sv.reduce((a, b) => a + b, 0) / sv.length : 0;
                return { v: r.v, cnt: r.cnt, util: r.util, custDay, costDay, supDay, own: custDay - costDay, adv: supDay ? supDay - costDay : null, marg: this.margOf(r.v) === null ? undefined : this.margOf(r.v) };
            });
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
            // Müşteri bazlı analizler
            this.custBlocks(B, c, nc);
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
            // Model karar tablosu
            const MD = this.modelDecision, sup = this.hasSupplier;
            if (MD.length) {
                const bestM = MD.reduce((a, r) => (r.own > a.own ? r : a), MD[0]);
                const mcols = ['Model', 'Adet', 'Doluluk', 'Gelir / gün', 'Maliyet / gün', 'Günlük kâr']; if (sup) mcols.push('Tedarikçi / gün', 'Avantaj / gün'); mcols.push('+1 araç');
                B.splice(5, 0, { id: 'chModel', title: 'Model Karar Tablosu', sub: 'Her modelin çalışılan gün başına müşteri geliri ve toplam maliyeti (alış + faiz + işletme + personel payı − satış)' + (sup ? '; tedarikçi günlük tutarıyla karşılaştırma' : '') + '. "+1 araç": bu modelden bir araç daha eklenirse Net Kâr / Zarar üzerindeki etkisi.',
                    insight: `Gün başı en kârlı model ${bestM.v.markaModel}: günde ${money(bestM.own)} kâr (gelir ${money(bestM.custDay)}, maliyet ${money(bestM.costDay)}).`,
                    cols: mcols, rows: MD.map(r => { const row = [c(r.v.markaModel + ' (' + r.v.segment + ')', 'text-start fw-bold'), c(f(r.cnt)), c(pc(r.util)), c(money(r.custDay), 'text-success'), c(money(r.costDay), 'text-danger'), c(money(r.own), nc(r.own))]; if (sup) row.push(c(r.supDay ? money(r.supDay) : '-'), c(r.adv === null ? '-' : money(r.adv), r.adv === null ? '' : nc(r.adv))); row.push(c(r.marg === undefined ? '-' : sm(r.marg), r.marg === undefined ? '' : nc(r.marg))); return row; }) });
            }
            // Duyarlılık analizi
            const SN = this.sensitivity;
            if (SN) {
                const top = SN.rows[0];
                B.splice(6, 0, { id: 'chSens', title: 'Duyarlılık Analizi', sens: true, sub: `Her varsayım tek başına ±%${SN.p} değişince şirket toplam neti (tüm yıllar, mevcut filo) ne kadar değişir? En etkili varsayım en üstte. Kırmızı: azalış senaryosu, yeşil: artış senaryosu.`,
                    insight: this.sensBusy ? 'Güncelleniyor…' : top ? `Sonucu en çok etkileyen varsayım "${top.label}": ±%${SN.p} değişimde net ${sm(Math.min(top.lo, top.hi))} ile ${top.hi >= top.lo ? '+' : ''}${sm(Math.max(top.lo, top.hi))} arasında oynuyor (baz ${sm(SN.base)}).` : '',
                    cols: ['Varsayım', '−%' + SN.p, '+%' + SN.p, 'Etki aralığı'],
                    rows: SN.rows.map(r => [c(r.label, 'text-start fw-bold'), c((r.lo >= 0 ? '+' : '') + sm(r.lo), nc(r.lo)), c((r.hi >= 0 ? '+' : '') + sm(r.hi), nc(r.hi)), c(sm(r.range))]) });
            }
            // Operasyon yükü
            const OL = this.opsLoad;
            if (OL.list && OL.list.length) {
                const byM = {}; OL.list.forEach(x => { const k = new Date(x.t).getMonth(); const o = byM[k] || (byM[k] = { n: 0, d: 0, r: 0, max: 0 }); o.n++; o.d += x.del; o.r += x.ret; o.max = Math.max(o.max, x.total); });
                B.push({ id: 'chOps', title: 'Operasyon Yükü (Teslimat + İade)', sub: 'Kendi filomuzla her gün yapılan teslimat ve iade işlemleri. Personelin haftada 6 gün çalıştığı kabul edilir; tablo ay bazında ortalama ve en yoğun günü verir.',
                    insight: `En yoğun gün ${OL.max.date}: ${f(OL.max.total)} işlem (${OL.max.del} teslimat, ${OL.max.ret} iade)` + (OL.active ? `; personel başına ${this.fmt1(OL.perMax)} işlem. Ortalamada personel başına günde ${this.fmt1(OL.perAvg)} işlem düşüyor.` : '.'),
                    cols: ['Ay', 'Ort. Teslimat', 'Ort. İade', 'Ort. İşlem', 'En Yoğun Gün', 'Personel Başına (ort.)'],
                    rows: Object.keys(byM).map(Number).sort((a, b) => a - b).map(k => { const o = byM[k], avg = (o.d + o.r) / o.n; return [c(MONTHS[k], 'text-start fw-bold'), c(this.fmt1(o.d / o.n)), c(this.fmt1(o.r / o.n)), c(this.fmt1(avg)), c(f(o.max)), c(OL.active ? this.fmt1(avg / OL.active) : '-')]; }) });
            }
            // Senaryo karşılaştırması
            const SC = this.scenarioCompare;
            if (SC.length > 1) {
                const key = r => (sup ? r.company : r.net), bs = SC.reduce((a, r) => (key(r) > key(a) ? r : a), SC[0]);
                const scols = ['Senaryo', 'Sahibi', 'Araç', 'Karşılama', 'Doluluk', 'Gelir', 'Gider', 'Filo Neti']; if (sup) scols.push('Şirket Neti');
                B.push({ id: 'chScen', title: 'Senaryo Karşılaştırması', sub: 'Kayıtlı senaryoların tüm yıllar ve tüm segmentler için sonucu (filtreden bağımsız). Senaryoya geçmek için sayfanın üstündeki kısayolları kullanın.',
                    insight: `En yüksek ${sup ? 'şirket neti' : 'net'}: "${bs.label}" (${sm(key(bs))}, ${f(bs.plates)} araç, karşılama ${pc(bs.ratio)}).`,
                    cols: scols, rows: SC.map(r => { const sc = r.id ? this.settings.scenarios.find(x => x.id === r.id) : null; const row = [c(r.label, 'text-start fw-bold' + (r.id ? '' : ' text-orange')), c(sc && sc.by ? sc.by : '-', 'text-start small'), c(f(r.plates)), c(pc(r.ratio), this.ratioClass(r.ratio)), c(pc(r.util)), c(sm(r.gelir), 'text-success'), c(sm(r.gider), 'text-danger'), c(sm(r.net), 'fw-bold ' + nc(r.net))]; if (sup) row.push(c(sm(r.company), 'fw-bold ' + nc(r.company))); return row; }) });
            }
            return B;
        },
        /* Detaylı veri seti */
        dsRows() {
            const R = this.report, X = this.fctx, q = this.ds.search.trim().toLocaleLowerCase('tr'), cu = this.hasCustomers;
            if (this.ds.type === 'dosya') {
                const plate = {}; R.plates.forEach(p => { plate[p.id] = p; });
                const ys = R.years.filter(X.yOk), y = ys.length ? ys[0] : R.years[0];
                const st = this.ds.status;
                return this.assignFiltered.filter(a => {
                    const p = a.unit ? plate[a.unit] : null;
                    if (X.vset && (!p || !X.vset.has(String(p.vid)))) return false;
                    if (st !== 'all' && (st === 'missed' ? a.unit : a.kind !== st)) return false;
                    if (q && !(String(a.no) + ' ' + (a.c || '') + ' ' + (p ? p.plate + ' ' + p.model : '')).toLocaleLowerCase('tr').includes(q)) return false;
                    return true;
                }).map(a => {
                    const p = a.unit ? plate[a.unit] : null, ps = a.kind === 'down' ? a.given : a.seg;
                    const o = { 'Dosya No': a.no };
                    if (cu) o['Müşteri'] = a.c || NO_CUST_LABEL;
                    return Object.assign(o, { 'Talep Segmenti': a.seg, 'Teslimat': E.formatDate(a.s), 'İade': E.formatDate(a.e), 'Gün': a.days,
                        'Durum': { own: 'Kendi segmenti', up: 'Üst segment', down: 'Alt segment' }[a.kind] || 'Karşılanamadı',
                        'Verilen Segment': a.given || '-', 'Plaka': p ? p.plate : '-', 'Araç': p ? p.model : '-',
                        ['Gelir (' + y + ')']: a.unit ? a.days * R.rates.rate(a.c, ps, y) : 0 });
                });
            }
            const V = this.view, out = [];
            V.plateRowsAll.forEach(r => {
                const p = r.p;
                if (q && !(p.plate + ' ' + p.model).toLocaleLowerCase('tr').includes(q)) return;
                p.life.forEach(y => {
                    if (!X.yOk(y)) return;
                    const b = V.rec(p, y);
                    out.push({ 'Plaka': p.plate, 'Araç': p.model, 'Segment': p.seg, 'Yıl': y, 'Dosya': Math.round(b.f),
                        'Çalışılan Gün': b.work, 'Boşta Gün': b.idle, 'Doluluk %': b.work + b.idle ? Math.round(b.work / (b.work + b.idle) * 1000) / 10 : 0,
                        'Dosya Geliri': b.revenue, 'Araç Satış Geliri': b.sale, 'İşletme Gideri': b.op, 'Alış Gideri': b.buy, 'Faiz Gideri': b.int, 'Personel Payı': b.pers, 'Net': b.net });
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
        this.$watch(() => [JSON.stringify(this.filters), this.plateSearch], () => { this.plateLimit = 100; });
        this.$watch(() => this.filters.seg.join('|'), () => { const ok = new Set(this.brandOptions.map(v => String(v.id))); const nv = this.filters.vid.filter(id => ok.has(String(id))); if (nv.length !== this.filters.vid.length) this.filters.vid = nv; });
        // Tarihçeden kalkan müşteri filtreden düşer; Günlük Tutar sayfasında seçili müşteri her zaman listede olur
        this.$watch(() => this.customerList.join('|'), () => {
            const ok = new Set(this.customerList); const nc = this.filters.cust.filter(c => ok.has(c)); if (nc.length !== this.filters.cust.length) this.filters.cust = nc;
            const L = this.histCustomers.list; if (L.length && !L.some(o => o.c === this.gtCust)) this.gtCust = L[0].c; if (!L.length) this.gtCust = null;
        }, { immediate: true });
        this.$watch(() => [this.gtCust, this.authed, !!this.custEntry], () => this.ensureCustEntry(this.gtCust), { immediate: true });
        this.$watch(() => this.activeTab, () => { const mc = document.querySelector('.main-content'); if (mc) mc.scrollTop = 0; this.headerError = ''; this.newHeader = ''; this.newCategory = ''; this.newAmount = null; this.newTip = 'yillik'; });
        if (window.CloudSync && window.CloudSync.enabled) window.CloudSync.init(this);
        else { this.auth.state = 'in'; this.sync.loaded = true; this.sync.status = 'local'; }
        this.$watch(() => this.settings.sim.target, t => { if (t !== 'manual' && this.authed) this.$nextTick(() => this.applyTarget(t)); });
        this.$watch(() => this.authed, a => { if (a && this.settings.sim.target !== 'manual') this.$nextTick(() => this.applyTarget(this.settings.sim.target)); }, { immediate: true });
        this.$watch(() => [this.persSummary.suggested, this.settings.personelKilit], () => this.syncPersonnel(), { immediate: true });
        this.$watch(() => this.optMax, m => { const t = this.tempVehicle; if (t && t.kredili && m && Number(t.vade) > m) t.vade = m; });
        window.addEventListener('keydown', e => { if (e.key === 'Escape' && this.present) this.present = false; });
        this.$watch(() => [this.activeTab, this.report, this.sensP, this.authed], () => this.scheduleSens());
        this.$watch(() => this.sensData, () => this.scheduleCharts());
        this.$watch(() => [this.activeTab, this.report, this.authed], () => this.scheduleMarginal(), { immediate: true });
        this.$watch(() => this.present, () => this.$nextTick(() => this.scheduleCharts()));
        this.$watch(() => this.histSize, () => { this.histPage = 1; });
        this.$watch(() => this.histPages, n => { if (this.histPage > n) this.histPage = n; });
        this.$watch(() => [this.ds.type, this.ds.status, this.ds.search, this.ds.size, JSON.stringify(this.filters)], () => { this.ds.page = 1; });
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
        showTipText(e, text) {
            const r = e.currentTarget.getBoundingClientRect(), W = 340;
            const x = Math.max(8, Math.min(window.innerWidth - W - 8, r.left + r.width / 2 - W / 2)), up = r.bottom + 220 > window.innerHeight;
            this.tip = { show: true, text, x, y: up ? r.top - 8 : r.bottom + 8, up };
        },
        margOf(v) { return this.margBusy || !(v.id in this.margData) ? null : this.margData[v.id]; },
        marginalTip(v) {
            const m = this.margOf(v), n = v.count + 1;
            if (m === null) return 'Hesaplanıyor…';
            return `${v.markaModel} için ${n}. aracı eklersen Net Kâr / Zarar kartı (tüm yıllar) ${m >= 0 ? '+' : ''}${this.money(m)} değişir.\n` +
                `Hesap: filo bir araç fazlasıyla baştan simüle edilir; dosyalar yeniden dağıtılır (üst/alt segment seçenekleri dahil) ve iki sonucun Net Kâr / Zarar farkı alınır.\n` +
                `Yeni aracın getirdiği ek dosya geliri − aracın tüm giderleri (alış, faiz, işletme; satış geliri düşülür)` +
                `${this.settings.personelKilit ? '' : ' − personel sayısı artarsa ek personel gideri (kilit açık)'}.\nTedarikçi marjı hesaba katılmaz.`;
        },
        /* +1 araç etkisi: her model için filo bir araç fazlasıyla tam simüle edilir (arka planda) */
        scheduleMarginal() {
            clearTimeout(this._margT);
            if (!this.authed || !['tahminleme', 'raporlama'].includes(this.activeTab)) return;
            this.margBusy = true;
            this._margT = setTimeout(() => {
                const base = this.netOf(this.report), counts = {}, out = {};
                this.vehicles.forEach(v => { counts[v.id] = v.count || 0; });
                const sim = { ...this.settings.sim, target: 'manual' };
                this.vehicles.filter(v => this.isComplete(v)).forEach(v => {
                    const R = this.reportFor(sim, { ...counts, [v.id]: counts[v.id] + 1 });
                    out[v.id] = this.netOf(R) - base;
                });
                this.margData = out; this.margBusy = false;
            }, 450);
        },
        hideTip() { this.tip.show = false; },
        /* Segment istatistiğini seçili aylar (ms) ve müşteriler (cs) için toplar */
        statOf(s, ms, cs) {
            const o = { total: 0, handled: 0, own: 0, up: 0, down: 0, days: 0 }; if (!s) return o;
            const srcs = cs ? [...cs].map(c => s.c && s.c[c]).filter(Boolean) : [s];
            srcs.forEach(x => {
                if (!ms) STAT_KEYS.forEach(q => { o[q] += x[q]; });
                else ms.forEach(i => { const m = x.m[i]; STAT_KEYS.forEach(q => { o[q] += m[q]; }); });
            });
            return o;
        },
        /* Bir fiyat tablosunda (segment+müşteri → gün) seçili müşterilerin gün payı */
        dayShare(pr, cs) { let a = 0, t = 0; for (const k in pr) { const d = pr[k]; t += d; if (cs.has(E.splitKey(k)[1])) a += d; } return t ? a / t : 0; },
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
            let applied = 0;
            if (!this.isP && !this.empty(this.newDefVal)) applied = this.applyHeaderToAll(name, this.newTip, this.newDefVal, this.newDefN);
            this.newHeader = ''; this.newCategory = ''; this.newAmount = null; this.newTip = 'yillik'; this.newDefVal = null; this.newDefN = null; this.headerError = '';
            if (applied) this.notify(`'${name}' ${applied} araca uygulandı`);
        },
        async removeHeader(index) {
            const h = this.hdrList[index];
            if (!await this.askConfirm(`'${h.ad}' başlığını silmek istediğinize emin misiniz?`)) return;
            const i = this.hdrList.indexOf(h); if (i < 0) return;
            this.hdrList.splice(i, 1);
            if (!this.isP) this.vehicles.forEach(v => { delete v.giderler[h.ad]; if (v.giderAdet) delete v.giderAdet[h.ad]; });
        },
        /* Başlığın değerini tüm araçlara yazar (ikinci sayı varsa o da) */
        applyHeaderToAll(name, tip, val, n) {
            const needN = !!(this.costTypes[tip] || {}).n;
            this.vehicles.forEach(v => {
                v.giderler[name] = val;
                if (needN && !this.empty(n)) { v.giderAdet = v.giderAdet || {}; v.giderAdet[name] = n; }
            });
            return this.vehicles.length;
        },
        openHeaderEdit(i) {
            const h = this.hdrList[i];
            this.hdrEdit = { isP: this.isP, index: i, ad: h.ad, kategori: h.kategori || '', error: '', val: null, n: null };
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
            let applied = 0;
            if (!e.isP && !this.empty(e.val)) applied = this.applyHeaderToAll(ad, h.tip, e.val, e.n);
            this.safeHide(this.headerModal, 'headerModal');
            this.notify(applied ? `Başlık güncellendi, ${applied} araca uygulandı` : 'Başlık güncellendi');
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
            SEGMENTS.forEach(s => { delete this.settings.gunlukTutar[s][y]; delete this.settings.tedarikciTutar[s][y]; });
            Object.values(this.settings.musteriTutar || {}).forEach(m => ['gunluk', 'tedarikci'].forEach(k => SEGMENTS.forEach(sg => { if (m[k] && m[k][sg]) delete m[k][sg][y]; })));
            this.filters.year = this.filters.year.filter(x => String(x) !== String(y));
        },

        /* ---- Müşteri bazlı günlük tutarlar ---- */
        ensureCustEntry(c) {
            if (!c || !this.authed) return;
            const mt = this.settings.musteriTutar || (this.settings.musteriTutar = {});
            if (!mt[c]) mt[c] = fillCustRates({}, this.years);
        },
        custOptionLabel(o) {
            const st = this.custRateStatus[o.c], base = `${o.c} · ${this.formatCurrency(o.files)} dosya`;
            if (!st) return base;
            if (!st.ok) return `⚠ ${base} · günlük tutar eksik`;
            return st.supOk ? `✓ ${base}` : `✓ ${base} · tedarikçi tutarı eksik`;
        },
        /* Seçili müşterinin tutarlarını varsayılan tablodan ya da başka bir müşteriden kopyalar */
        async copyCustRates() {
            const c = this.gtCust, src = this.gtCopyFrom; if (!c || !src || src === c) return;
            const from = src === '__default' ? { gunluk: this.settings.gunlukTutar, tedarikci: this.settings.tedarikciTutar } : (this.settings.musteriTutar || {})[src];
            if (!from) return;
            const srcName = src === '__default' ? 'varsayılan tutarlar' : `'${src}'`;
            if (!await this.askConfirm(`'${c}' müşterisinin kendi ve tedarikçi günlük tutarları ${srcName} ile değiştirilecek. Devam edilsin mi?`)) return;
            this.settings.musteriTutar[c] = fillCustRates(JSON.parse(JSON.stringify({ gunluk: from.gunluk || {}, tedarikci: from.tedarikci || {} })), this.years);
            this.notify(`${srcName} '${c}' müşterisine kopyalandı`);
        },
        /* Seçili müşterinin tutarlarını tutarı eksik olan (veya tüm) müşterilere uygular */
        async applyCustRatesToAll(onlyMissing) {
            const c = this.gtCust, e = this.custEntry; if (!c || !e) return;
            const targets = this.histCustomers.list.map(o => o.c).filter(x => x !== c && (!onlyMissing || !this.custRateStatus[x].ok || !this.custRateStatus[x].supOk));
            if (!targets.length) { this.notify('Uygulanacak müşteri yok'); return; }
            if (!await this.askConfirm(`'${c}' müşterisinin tutarları ${onlyMissing ? 'tutarı eksik olan' : 'diğer tüm'} ${targets.length} müşteriye kopyalanacak${onlyMissing ? ' (yalnızca boş hücreler doldurulur)' : ' (mevcut tutarlarının üzerine yazılır)'}. Devam edilsin mi?`)) return;
            const empty = x => x === null || x === undefined || x === '';
            targets.forEach(t => {
                this.ensureCustEntry(t); const d = this.settings.musteriTutar[t];
                ['gunluk', 'tedarikci'].forEach(k => SEGMENTS.forEach(sg => this.years.forEach(y => {
                    const v = ((e[k] || {})[sg] || {})[y];
                    if (!onlyMissing || empty(d[k][sg][y])) d[k][sg][y] = v === undefined ? null : v;
                })));
            });
            this.notify(`${targets.length} müşteriye uygulandı`);
        },
        async removeOrphanRates() {
            const L = this.orphanRates; if (!L.length) return;
            if (!await this.askConfirm(`Tarihçede artık bulunmayan ${L.length} müşterinin (${L.join(', ')}) günlük tutarları silinecek. Devam edilsin mi?`)) return;
            L.forEach(c => { delete this.settings.musteriTutar[c]; });
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
            if (k === 'vade') return t.kredili && (this.empty(t.vade) || (this.optMax && Number(t.vade) > this.optMax));
            if (k === 'faiz') return t.kredili && this.empty(t[k]);
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
        async addRecords(rows, noCustCol) {
            const { records, bad } = E.rowsToRecords(rows);
            if (!records.length) { this.importMsg = `Yüklenebilir kayıt bulunamadı${bad ? ` (${bad} satır okunamadı: segment/tarih kontrol edin)` : ''}. Mevcut veriler değiştirilmedi.`; return; }
            const seen = new Set(), fresh = [];
            records.forEach(r => {
                const k = [r.dosyaNo, r.segment, r.teslimat, r.iade, r.musteri || ''].join('|');
                if (!seen.has(k)) { seen.add(k); fresh.push(r); }
            });
            const old = this.historicalData.length;
            if (old && !await this.askConfirm(`Mevcut ${this.formatCurrency(old)} kayıt silinecek ve yerine ${this.formatCurrency(fresh.length)} yeni kayıt yüklenecek. Devam edilsin mi?`)) {
                this.importMsg = 'Yükleme iptal edildi, mevcut veriler korundu.'; return;
            }
            this.historicalData = fresh; this.histPage = 1;
            const nc = new Set(fresh.map(r => r.musteri).filter(Boolean)).size, noC = fresh.filter(r => !r.musteri).length;
            this.importMsg = `${fresh.length} kayıt yüklendi` + (old ? ` (önceki ${old} kayıt silindi)` : '') + (records.length - fresh.length ? `, ${records.length - fresh.length} mükerrer satır atlandı` : '') + (bad ? `, ${bad} satır okunamadı (segment/tarih kontrol edin)` : '') + '.'
                + (noCustCol ? ' Müşteri sütunu bulunamadı; dosyalar müşteri bilgisi olmadan yüklendi.' : (nc ? ` ${nc} farklı müşteri bulundu` + (noC ? `, ${noC} dosyada müşteri boş` : '') + '. Günlük Tutar sayfasından müşteri tutarlarını girebilirsiniz.' : ''));
        },
        /* Başlıkları kontrol eder; eksik varsa yüklemeyi durdurur ve hangi başlığın bulunamadığını söyler */
        async importTable(table, strict) {
            const headerless = !strict && table.length && E.parseDate(table[0][2]) !== null; // yapıştırmada başlıksız veri kabul
            if (!headerless) {
                const miss = E.missingHeaders(table);
                if (miss.length) {
                    this.importMsg = '';
                    await this.askConfirm(`Yükleme tamamlanamadı: ${miss.map(m => '"' + m + '"').join(', ')} başlığı bulunamadı. İlk satırda "Dosya Numarası", "Segment", "Müşteri", "Araç Teslimat Tarihi" ve "Araç İade Tarihi" sütun başlıkları olmalı. Mevcut veriler değiştirilmedi.`, true);
                    return;
                }
            }
            await this.addRecords(E.tableToRows(table), !headerless && !E.hasCustomerColumn(table));
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
            const R = E.buildReport({ vehicles: this.vehicles, files: this.simFiles, settings: this.settings, cutHour: this.timeRule, sim: { ...this.settings.sim, target: t } });
            this.vehicles.forEach(v => { if (v.id in R.counts) v.count = R.counts[v.id]; });
            this.settings.sim.target = 'manual';
            this.settings.sim.preset = t;
            this.notify(t === 'best' ? 'En kârlı filo adetleri uygulandı' : `%${t} hedefine göre adetler uygulandı`);
        },
        async alignOptYears() {
            const n = this.years.length, list = this.horizonIssues;
            if (!list.length) return;
            if (!await this.askConfirm(`${list.map(h => h.ad).join(', ')} araçlarında optimum satış yılı ${n} yıla eşitlenecek (tanımlı yıl sayısı). Kredili araçlarda vade ${n * 12} aydan uzunsa ${n * 12} aya indirilir. Devam edilsin mi?`)) return;
            this.vehicles.forEach(v => {
                if (!this.isComplete(v) || Number(v.giderler[DEFAULT_HEADERS[0]]) === n) return;
                v.giderler[DEFAULT_HEADERS[0]] = n;
                if (v.kredili && Number(v.vade) > n * 12) v.vade = n * 12;
            });
            this.notify(`Optimum satış yılı ${n} yıla eşitlendi`);
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
            return { counts, sim: { target: 'manual', up: !!this.settings.sim.up, down: !!this.settings.sim.down, preset: this.settings.sim.preset || 'manual', growth: this.settings.sim.growth || 0 } };
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
            this.settings.scenarios.push({ id: 's' + Date.now(), ad, not, ...snap, filters: normFilters(this.filters), tarih: new Date().toISOString(), by: this.auth.user ? this.auth.user.email : '' });
            this.safeHide(this.scenarioModal, 'scenarioModal');
            this.notify(`'${ad}' kaydedildi`);
        },
        editingScenario() { return this.settings.scenarios.find(s => s.id === this.scenarioEditId) || null; },
        applyScenario(s) {
            this.vehicles.forEach(v => { v.count = Math.max(0, Math.floor(Number(s.counts[v.id]) || 0)); });
            this.settings.sim = { ...DEFAULT_SIM(), ...s.sim };
            this.filters = normFilters(s.filters);
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
            return `${t}${s.sim.target === 'manual' || !s.sim.target ? ' · ' + n + ' araç' : ''}${s.sim.growth ? ' · hizmet ' + (s.sim.growth > 0 ? '+' : '') + s.sim.growth + '%' : ''}${s.sim.up ? ' · üst seg.' : ''}${s.sim.down ? ' · alt seg.' : ''}` + (s.tarih ? ' · ' + new Date(s.tarih).toLocaleDateString('tr-TR') : '');
        },

        /* Personel kilidi açıksa personel sayısı filoya göre önerilir */
        persFor(n) { const r = Number(this.settings.personelOrani) || 0; return !this.settings.personelKilit && r > 0 ? Math.ceil(n / r) : (Number(this.settings.personelSayisi) || 0); },
        /* Başka bir senaryo / adet için rapor (kilit açıksa personel o filoya göre) */
        reportFor(sim, counts) {
            const files = E.adjustFiles(this.parsedFiles, sim.growth || 0);
            const run = st => E.buildReport({ vehicles: this.vehicles, files, settings: st, cutHour: this.timeRule, sim, countsOverride: counts });
            let R = run(this.settings);
            const pn = this.persFor(R.plates.length);
            if (pn !== (Number(this.settings.personelSayisi) || 0)) R = run({ ...this.settings, personelSayisi: pn });
            return R;
        },
        netOf(R) { let n = 0; R.plates.forEach(p => p.life.forEach(y => { n += p.byYear[y].net; })); return n; },
        /* Duyarlılık analizi ağır (≈18 simülasyon): rapor açıldıktan sonra arka planda hesaplanır */
        computeSensitivity() {
            if (!this.totalPlates) return null;
            const p = Number(this.sensP) / 100, clone = o => JSON.parse(JSON.stringify(o));
            const counts = {}; this.vehicles.forEach(v => { counts[v.id] = v.count || 0; });
            const sim = { ...this.settings.sim, target: 'manual' }, all = () => true, g0 = Number(this.settings.sim.growth) || 0;
            const baseV = this.vehicles.map(v => ({ ...v, imageBase64: '' }));
            const run = (st, vs, growth) => {
                const R = E.buildReport({ vehicles: vs, files: E.adjustFiles(this.parsedFiles, growth), settings: st, cutHour: this.timeRule, sim, countsOverride: counts });
                return this.netOf(R) + this.supplierCalc(R, null, null, all, st).margin;
            };
            const scaleMap = (o, k) => Object.keys(o || {}).forEach(a => Object.keys(o[a] || {}).forEach(y => { const x = o[a][y]; if (x !== null && x !== '' && x !== undefined) o[a][y] = Number(x) * k; }));
            const vMod = fn => k => { const vs = clone(baseV); vs.forEach(v => fn(v, k)); return [this.settings, vs, g0]; };
            const sMod = fn => k => { const st = clone(this.settings); fn(st, k); return [st, baseV, g0]; };
            const opHeads = this.settings.giderTanimlari.filter(h => h.tip !== 'yakit').map(h => h.ad);
            const items = [
                ['Müşteri günlük tutarı', sMod((st, k) => { scaleMap(st.gunlukTutar, k); Object.values(st.musteriTutar || {}).forEach(m => scaleMap(m.gunluk, k)); })],
                ...(this.hasSupplier ? [['Tedarikçi günlük tutarı', sMod((st, k) => { scaleMap(st.tedarikciTutar, k); Object.values(st.musteriTutar || {}).forEach(m => scaleMap(m.tedarikci, k)); })]] : []),
                ['Araç alış bedeli', vMod((v, k) => { if (v.alisBedeli !== null) v.alisBedeli = Number(v.alisBedeli) * k; })],
                ['Araç satış tutarı', vMod((v, k) => { if (v.satisTutari !== null) v.satisTutari = Number(v.satisTutari) * k; })],
                ['Araç işletme giderleri', vMod((v, k) => opHeads.forEach(h => { if (v.giderler[h] !== null && v.giderler[h] !== undefined) v.giderler[h] = Number(v.giderler[h]) * k; }))],
                ['Yakıt fiyatı', sMod((st, k) => scaleMap(st.yakitFiyatlari, k))],
                ['Personel gideri', sMod((st, k) => st.personelTanimlari.forEach(h => { h.tutar = Number(h.tutar) * k; }))],
                ['Enflasyon (±' + Math.round(p * 50) + ' puan)', k => { const st = clone(this.settings); const d = (k > 1 ? 1 : -1) * p * 50; Object.keys(st.enflasyonOranlari).forEach(y => { st.enflasyonOranlari[y] = Number(st.enflasyonOranlari[y]) + d; }); return [st, baseV, g0]; }],
                ['Hizmet sayısı', k => [this.settings, baseV, g0 + (k > 1 ? 1 : -1) * p * 100]]
            ];
            const base = run(this.settings, baseV, g0);
            const rows = items.map(([label, fn]) => {
                const lo = run(...fn(1 - p)), hi = run(...fn(1 + p));
                return { label, lo: lo - base, hi: hi - base, range: Math.abs(hi - lo) };
            }).sort((a, b) => b.range - a.range);
            return { base, rows, p: Number(this.sensP) };
        },
        scheduleSens() {
            clearTimeout(this._sensT);
            if (this.activeTab !== 'raporlama' || !this.authed) return;
            this.sensBusy = true;
            this._sensT = setTimeout(() => { this.sensData = this.computeSensitivity(); this.sensBusy = false; }, 700);
        },
        /* Tedarikçiye giden dosyalar: hiç araç verilemeyen ya da o yıl ömrü dışındaki plakaya düşen dosyalar.
           Tedarikçi tutarı girilmemiş segment/yılda dosya kaybedilmiş sayılır. */
        supplierCalc(R, segKeys, ms, yOk, st, cs) {
            const RT = R.rates, sc = R.scale || 1, mset = ms ? new Set(ms) : null; // R.rates, raporun kurulduğu ayarlardan gelir (duyarlılıkta değiştirilmiş ayarlar)
            const years = R.years.filter(yOk), alive = {};
            R.plates.forEach(p => { alive[p.id] = years.map(y => p.life.includes(y)); });
            const tab = new Map(); // segment + müşteri → [ {r, s} yıl sırasıyla ]
            const tOf = (sg, c) => { const k = sg + '\t' + c; let t = tab.get(k); if (!t) { t = years.map(y => ({ r: RT.rate(c, sg, y), s: RT.sup(c, sg, y) })); tab.set(k, t); } return t; };
            const out = { files: 0, lost: 0, days: 0, revenue: 0, cost: 0, margin: 0, byYear: {}, byCust: {}, allDays: 0, allCost: 0, ownDays: 0, ownSup: 0, ownCust: 0 };
            const by = years.map(() => ({ margin: 0, revenue: 0, cost: 0, days: 0 }));
            R.years.forEach(y => { out.byYear[y] = { margin: 0, revenue: 0, cost: 0, days: 0 }; });
            const segSet = segKeys ? new Set(segKeys) : null, A = R.sim.assign;
            for (let i = 0; i < A.length; i++) {
                const a = A[i];
                if (segSet && !segSet.has(a.seg)) continue;
                if (mset && !mset.has(a.mi)) continue;
                if (cs && !cs.has(a.c)) continue;
                const al = a.unit ? alive[a.unit] : null, T = tOf(a.seg, a.c), Tp = a.kind === 'down' ? tOf(a.given, a.c) : T, d = a.days * sc;
                const bc = out.byCust[a.c] || (out.byCust[a.c] = { files: 0, lost: 0, margin: 0, revenue: 0, cost: 0 });
                let toSup = false, lost = false;
                for (let j = 0; j < years.length; j++) {
                    const s = T[j].s;
                    if (s > 0) { out.allDays += d; out.allCost += d * s; }
                    if (al && al[j]) { if (s > 0) { out.ownDays += d; out.ownSup += d * s; out.ownCust += d * Tp[j].r; } continue; }
                    if (!s) { lost = true; continue; }
                    const r = T[j].r, b = by[j];
                    out.days += d; out.revenue += d * r; out.cost += d * s; out.margin += d * (r - s);
                    b.days += d; b.revenue += d * r; b.cost += d * s; b.margin += d * (r - s); toSup = true;
                    bc.revenue += d * r; bc.cost += d * s; bc.margin += d * (r - s);
                }
                if (toSup) { out.files++; bc.files++; } else if (lost) { out.lost++; bc.lost++; }
            }
            years.forEach((y, j) => { out.byYear[y] = by[j]; });
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
        fmt1(n) { return (n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); },
        pct(n) { return '%' + (n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); },
        netClass(n) { return n < 0 ? 'text-danger' : 'text-success'; },
        ratioClass(r) { return r < 50 ? 'text-danger' : (r <= 75 ? 'text-warn' : 'text-success'); },
        savePdf() {
            const t = document.title, d = new Date().toISOString().slice(0, 10);
            document.title = `Eurocross_Ikame_${this.activeTab === 'raporlama' ? 'Raporlama' : 'Simulator'}_${d}`;
            const done = () => { document.title = t; window.removeEventListener('afterprint', done); };
            window.addEventListener('afterprint', done);
            setTimeout(() => window.print(), 50);
        },
        cell(v, col) {
            if (typeof v !== 'number') return v;
            if (/Gelir|Satış|Gider|Finansman|Personel|Net|Marj/.test(col)) return this.money(v);
            if (/%/.test(col)) return this.pct(v);
            return this.formatCurrency(v);
        },

        /* Raporlama: müşteri bazlı analiz blokları (müşteri bilgisi varsa) */
        custBlocks(B, c, nc) {
            const CV = this.custView, rows = CV.rows; if (!this.hasCustomers || !rows.length) return;
            const f = this.formatCurrency, sm = this.shortMoney, pc = this.pct, money = this.money, sup = this.hasSupplier, T = CV.tot;
            const lim = rows.length > 12 ? ' Grafikte ilk 12 müşteri gösterilir; tablo tüm müşterileri içerir.' : '';
            // Gelir, gider, net
            const best = rows.reduce((a, r) => (r.net > a.net ? r : a), rows[0]), worst = rows.reduce((a, r) => (r.net < a.net ? r : a), rows[0]);
            const fcols = ['Müşteri', 'Dosya', 'Gelir', 'Gider', 'Net', 'Kârlılık']; if (sup) fcols.push('Şirket Neti');
            B.push({ id: 'chCustFin', title: 'Müşteri Bazında Gelir, Gider ve Net', sub: 'Her müşterinin dosyalarından elde edilen gelir (müşterinin kendi günlük tutarıyla), ona düşen araç + personel gideri ve net sonuç. Giderler her araçta müşterinin kiralama günü payıyla dağıtılır.' + lim,
                insight: `En çok gelir ${rows[0].label} müşterisinden (${sm(rows[0].gelir)}). En kârlı ${best.label} (net ${sm(best.net)})` + (worst.net < 0 ? `, en çok zarar ettiren ${worst.label} (${sm(worst.net)}).` : '.'),
                cols: fcols, rows: rows.map(r => { const x = [c(r.label, 'text-start fw-bold'), c(f(r.total)), c(sm(r.gelir), 'text-success'), c(sm(r.gider), 'text-danger'), c(sm(r.net), 'fw-bold ' + nc(r.net)), c(pc(r.margin), nc(r.margin))]; if (sup) x.push(c(sm(r.company), nc(r.company))); return x; }),
                foot: [c('Toplam', 'text-start'), c(f(T.total)), c(sm(T.gelir)), c(sm(T.gider)), c(sm(T.net), nc(T.net)), c(pc(T.margin)), ...(sup ? [c(sm(T.company))] : [])] });
            // Talep ve karşılama
            const big = rows.filter(r => r.total >= Math.max(10, T.total * 0.02)), lowR = big.length ? big.reduce((a, r) => (r.ratio < a.ratio ? r : a), big[0]) : null;
            const ccols = ['Müşteri', 'Talep', 'Karşılanan', 'Üst/Alt Seg.', 'Karşılanamayan', 'Karşılama']; if (sup) ccols.push('Tedarikçiye Giden');
            B.push({ id: 'chCustCover', title: 'Müşteri Bazında Talep ve Karşılama', sub: 'Her müşterinin dosyalarının ne kadarına kendi filomuzla araç verebildik? Turuncu: kendi segmentinde, mavi: üst/alt segmentle, gri: karşılanamayan.' + lim,
                insight: lowR ? `Karşılama oranı en düşük büyük müşteri ${lowR.label}: ${pc(lowR.ratio)} (${f(lowR.missed)} dosya karşılanamadı).` : '',
                cols: ccols, rows: rows.map(r => { const x = [c(r.label, 'text-start fw-bold'), c(f(r.total)), c(f(r.handled)), c(f(r.cross)), c(f(r.missed), r.missed ? 'text-danger' : ''), c(pc(r.ratio), this.ratioClass(r.ratio))]; if (sup) x.push(c(f(r.supFiles))); return x; }),
                foot: [c('Toplam', 'text-start'), c(f(T.total)), c(f(T.handled)), c(f(T.cross)), c(f(T.missed)), c(pc(T.ratio)), ...(sup ? [c(f(rows.reduce((a, r) => a + r.supFiles, 0)))] : [])] });
            // Paylar
            const top3 = [...rows].sort((a, b) => b.total - a.total).slice(0, 3), t3 = top3.reduce((a, r) => a + r.total, 0), g3 = top3.reduce((a, r) => a + r.gelir, 0);
            const topC = rows.reduce((a, r) => (r.contrib > a.contrib ? r : a), rows[0]);
            B.push({ id: 'chCustShare', title: 'Müşteri Payları: Talep, Gelir ve Doluluk', sub: 'Grafik: toplam gelirin müşterilere dağılımı. Tablo: her müşterinin talep, gelir ve net içindeki payı ile filo doluluğuna katkısı (müşteriye çalışılan gün ÷ toplam araç günü; toplamı filo doluluk oranıdır).',
                insight: (rows.length > 3 ? `İlk 3 müşteri (${top3.map(r => r.label).join(', ')}) talebin ${pc(T.total ? t3 / T.total * 100 : 0)}'ini, gelirin ${pc(T.gelir ? g3 / T.gelir * 100 : 0)}'ini oluşturuyor. ` : '') + `Doluluğa en çok katkı ${topC.label}: ${pc(topC.contrib)}.`,
                cols: ['Müşteri', 'Talep Payı', 'Gelir Payı', 'Net Payı', 'Doluluğa Katkı'],
                rows: rows.map(r => [c(r.label, 'text-start fw-bold'), c(pc(T.total ? r.total / T.total * 100 : 0)), c(pc(T.gelir ? r.gelir / T.gelir * 100 : 0)), c(T.net ? pc(r.net / Math.abs(T.net) * 100) : '-', nc(r.net)), c(pc(r.contrib))]),
                foot: [c('Toplam', 'text-start'), c('%100'), c('%100'), c(T.net ? (T.net < 0 ? '-%100' : '%100') : '-'), c(pc(T.contrib))] });
            // Birim ekonomi
            const wk = rows.filter(r => r.work > 0), bestU = wk.length ? wk.reduce((a, r) => (r.revDay - r.costDay > a.revDay - a.costDay ? r : a), wk[0]) : null;
            B.push({ id: 'chCustUnit', title: 'Müşteri Birim Ekonomisi', sub: 'Müşteriye çalışılan gün başına ortalama gelir (müşterinin günlük tutarı) ve maliyet (araç + personel gideri − satış payı). Kâr / gün negatifse o müşteriye kendi aracımızla hizmet vermek zarar ettiriyor.' + lim,
                insight: bestU ? `Gün başı en kârlı müşteri ${bestU.label}: ${money(bestU.revDay - bestU.costDay)} (gelir ${money(bestU.revDay)}, maliyet ${money(bestU.costDay)}).` : '',
                cols: ['Müşteri', 'Ort. Kiralama', 'Gelir / gün', 'Maliyet / gün', 'Kâr / gün', 'Net / dosya'],
                rows: rows.map(r => [c(r.label, 'text-start fw-bold'), c(this.fmt1(r.avgRental) + ' gün'), c(r.work ? money(r.revDay) : '-', 'text-success'), c(r.work ? money(r.costDay) : '-', 'text-danger'), c(r.work ? money(r.revDay - r.costDay) : '-', nc(r.revDay - r.costDay)), c(r.handled ? money(r.netFile) : '-', nc(r.netFile))]) });
            // Aylık talep (ilk 5 müşteri + diğer)
            const MM = this.custMonthly;
            if (MM.series.length && MM.rows.length) {
                const peak = MM.rows.reduce((a, r) => (r.total > a.total ? r : a), MM.rows[0]), named = MM.other ? MM.series.length - 1 : MM.series.length;
                const lead = peak.v.slice(0, named).reduce((a, x, i) => (x > peak.v[a] ? i : a), 0);
                B.push({ id: 'chCustMonth', title: 'Müşteri Bazında Aylık Talep', sub: 'Her ay gelen dosyaların müşterilere dağılımı (talebi en yüksek 5 müşteri ayrı, diğerleri "Diğer"). Bir müşterinin hangi aydan itibaren yük getirdiği burada görünür.',
                    insight: peak.total ? `En yoğun ay ${MONTHS[peak.mi]} (${f(peak.total)} dosya); bu ayın en büyük payı ${pc(peak.v[lead] / peak.total * 100)} ile ${MM.series[lead]} müşterisinde.` : '',
                    cols: ['Ay', ...MM.series, 'Toplam'], rows: MM.rows.map(r => [c(MONTHS[r.mi], 'text-start fw-bold'), ...r.v.map(x => c(f(x))), c(f(r.total), 'fw-bold')]),
                    foot: [c('Toplam', 'text-start'), ...MM.series.map((x, i) => c(f(MM.rows.reduce((a, r) => a + r.v[i], 0)))), c(f(MM.rows.reduce((a, r) => a + r.total, 0)))] });
            }
            // Müşteri × segment
            const SG = this.custSegments;
            if (SG.segs.length && SG.rows.length) {
                const r0 = SG.rows[0], i0 = r0.v.reduce((a, x, j) => (x > r0.v[a] ? j : a), 0);
                B.push({ id: 'chCustSeg', title: 'Müşteri × Segment Talep Dağılımı', sub: 'Her müşterinin hangi segmentlerde araç talep ettiği (dosya sayısı). Filoya hangi segmentten araç eklenmesi gerektiğini müşteri bazında gösterir.' + lim,
                    insight: `En büyük müşteri ${r0.label}: talebinin ${pc(r0.total ? r0.v[i0] / r0.total * 100 : 0)}'i ${SG.segs[i0]} segmentinde.`,
                    cols: ['Müşteri', ...SG.segs, 'Toplam'], rows: SG.rows.map(r => [c(r.label, 'text-start fw-bold'), ...r.v.map(x => c(x ? f(x) : '-')), c(f(r.total), 'fw-bold')]),
                    foot: [c('Toplam', 'text-start'), ...SG.segs.map((x, i) => c(f(SG.rows.reduce((a, r) => a + r.v[i], 0)))), c(f(SG.rows.reduce((a, r) => a + r.total, 0)))] });
            }
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
            // Model karar
            const MD = this.modelDecision;
            if (MD.length) this.chart('chModel', { type: 'bar', data: { labels: MD.map(r => r.v.markaModel), datasets: [
                { label: 'Gelir / gün', data: MD.map(r => r.custDay), backgroundColor: C.green },
                { label: 'Maliyet / gün', data: MD.map(r => r.costDay), backgroundColor: C.red },
                ...(this.hasSupplier ? [{ label: 'Tedarikçi / gün', data: MD.map(r => r.supDay), backgroundColor: C.grey }] : [])
            ] }, options: { plugins: { tooltip: tipMoney }, scales: { y: { ticks: { callback: v => this.money(v) } } } } });
            // Duyarlılık (tornado)
            const SN = this.sensitivity;
            if (SN) this.chart('chSens', { type: 'bar', data: { labels: SN.rows.map(r => r.label), datasets: [
                { label: '−%' + SN.p, data: SN.rows.map(r => r.lo), backgroundColor: SN.rows.map(r => (r.lo < 0 ? C.red : C.green)) },
                { label: '+%' + SN.p, data: SN.rows.map(r => r.hi), backgroundColor: SN.rows.map(r => (r.hi < 0 ? '#ff8787' : '#69db7c')) }
            ] }, options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.x >= 0 ? '+' : ''}${this.money(c.parsed.x)}` } } }, scales: { x: { ticks: { callback: v => sm(v) } } } } });
            // Operasyon yükü
            const OL = this.opsLoad;
            if (OL.list && OL.list.length) this.chart('chOps', { type: 'line', data: { labels: OL.list.map(x => new Date(x.t).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })), datasets: [
                { label: 'Teslimat + iade', data: OL.list.map(x => x.total), borderColor: C.orange, backgroundColor: 'rgba(255,102,0,.12)', fill: true, pointRadius: 0, borderWidth: 1.5 },
                { label: 'Teslimat', data: OL.list.map(x => x.del), borderColor: C.dark, pointRadius: 0, borderWidth: 1 },
                { label: 'İade', data: OL.list.map(x => x.ret), borderColor: C.blue, pointRadius: 0, borderWidth: 1 }
            ] }, options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 12 } } } } });
            // Müşteri grafikleri
            const CR = this.custView.rows, cut = l => (l.length > 18 ? l.slice(0, 17) + '…' : l);
            if (this.hasCustomers && CR.length) {
                const top = CR.slice(0, 12);
                this.chart('chCustFin', { type: 'bar', data: { labels: top.map(r => cut(r.label)), datasets: [
                    { label: 'Gelir', data: top.map(r => r.gelir), backgroundColor: C.green },
                    { label: 'Gider', data: top.map(r => r.gider), backgroundColor: C.red },
                    { label: 'Net', data: top.map(r => r.net), backgroundColor: C.orange }
                ] }, options: { plugins: { tooltip: { callbacks: { title: c => top[c[0].dataIndex].label, label: tipMoney.callbacks.label } } }, scales: { y: money } } });
                const ct = CR.slice(0, 12);
                this.chart('chCustCover', { type: 'bar', data: { labels: ct.map(r => cut(r.label)), datasets: [
                    { label: 'Kendi segmenti', data: ct.map(r => r.handled - r.cross), backgroundColor: C.orange, stack: 'c' },
                    { label: 'Üst / alt segment', data: ct.map(r => r.cross), backgroundColor: C.blue, stack: 'c' },
                    { label: 'Karşılanamayan', data: ct.map(r => r.missed), backgroundColor: '#dee2e6', stack: 'c' }
                ] }, options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { title: c => ct[c[0].dataIndex].label } } }, scales: { x: { stacked: true, title: { display: true, text: 'Dosya' } }, y: { stacked: true } } } });
                const pal = [C.orange, C.dark, C.blue, C.amber, C.purple, C.green, C.red, '#20c997', C.grey];
                const sh = CR.slice(0, 8), rest = CR.slice(8).reduce((a, r) => a + Math.max(0, r.gelir), 0);
                const sl = [...sh.map(r => r.label), ...(rest > 0 ? ['Diğer'] : [])], sd = [...sh.map(r => Math.max(0, r.gelir)), ...(rest > 0 ? [rest] : [])], st = sd.reduce((a, b) => a + b, 0);
                this.chart('chCustShare', { type: 'doughnut', data: { labels: sl, datasets: [{ data: sd, backgroundColor: sl.map((x, i) => pal[i % pal.length]) }] },
                    options: { cutout: '60%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => `${c.label}: ${this.money(c.parsed)} (${this.pct(st ? c.parsed / st * 100 : 0)})` } } } } });
                const ut = top.filter(r => r.work > 0);
                this.chart('chCustUnit', { type: 'bar', data: { labels: ut.map(r => cut(r.label)), datasets: [
                    { label: 'Gelir / gün', data: ut.map(r => r.revDay), backgroundColor: C.green },
                    { label: 'Maliyet / gün', data: ut.map(r => r.costDay), backgroundColor: C.red }
                ] }, options: { plugins: { tooltip: { callbacks: { title: c => ut[c[0].dataIndex].label, label: tipMoney.callbacks.label } } }, scales: { y: { min: 0, ticks: { callback: v => this.money(v) } } } } });
                const MM = this.custMonthly, mpal = [C.orange, C.dark, C.blue, C.amber, C.purple];
                if (MM.series.length && MM.rows.length) this.chart('chCustMonth', { type: 'bar', data: { labels: MM.rows.map(r => MONTHS[r.mi].slice(0, 3)), datasets: MM.series.map((sname, i) => ({
                    label: cut(sname), data: MM.rows.map(r => r.v[i]), backgroundColor: MM.other && i === MM.series.length - 1 ? '#ced4da' : mpal[i % mpal.length], stack: 'm' })) },
                    options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'Dosya' } } } } });
                const SG = this.custSegments, spal = [C.orange, C.dark, C.blue, C.amber, C.purple, C.green, C.red, C.grey], sr = SG.rows.slice(0, 12);
                if (SG.segs.length && sr.length) this.chart('chCustSeg', { type: 'bar', data: { labels: sr.map(r => cut(r.label)), datasets: SG.segs.map((sg, i) => ({
                    label: sg, data: sr.map(r => r.v[i]), backgroundColor: spal[i % spal.length], stack: 's' })) },
                    options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { title: c => sr[c[0].dataIndex].label } } }, scales: { x: { stacked: true, title: { display: true, text: 'Dosya' } }, y: { stacked: true } } } });
            }
            // Senaryolar
            const SC = this.scenarioCompare;
            if (SC.length > 1) this.chart('chScen', { type: 'bar', data: { labels: SC.map(r => r.label), datasets: [
                { label: 'Filo neti', data: SC.map(r => r.net), backgroundColor: C.orange },
                ...(this.hasSupplier ? [{ label: 'Şirket neti', data: SC.map(r => r.company), backgroundColor: C.dark }] : [])
            ] }, options: { plugins: { tooltip: tipMoney }, scales: { y: { ticks: { callback: v => sm(v) } } } } });
        }
    }
});
app.component('num-input', NumInput);
app.component('sort-table', SortTable);
app.component('multi-select', MultiSelect);
app.mount('#app');
