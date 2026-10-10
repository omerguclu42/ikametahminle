/* Eurocross İkame Tahminleme - Giriş ve Realtime Database senkronizasyonu
   Veri yapısı (ikame/):
     settings        {j: "<json>"}            ayarlar tek parça
     timeRule        sayı
     vehicles/<id>   {j: "<json>"}            araç (görsel hariç)
     images/<id>     "data:image/..."         araç görseli ayrı (sık değişmez, büyük)
     hist/meta       {sig, count}             tarihçe imzası
     hist/chunks/cN  "<json>"                 tarihçe 1000'erli parçalar
     meta            {initialized, by, at}
   Karşılıklı yazma döngüsünü önlemek için her parçanın "son bilinen" JSON'u tutulur;
   yalnızca gerçekten değişen parça yazılır, gelen değişiklik uygulanınca son bilinen güncellenir. */
(function (root) {
    'use strict';
    const cfg = root.FIREBASE_CONFIG, fb = root.firebase;
    const ROOT = 'ikame', CHUNK = 1000;
    const enabled = !!(cfg && fb && fb.initializeApp);
    let auth = null, db = null, vm = null, user = null, ready = false;
    let refs = [];
    let last, seen, remoteImages, lastHistRaw, lastHistLen;

    const reset = () => {
        last = { settings: null, timeRule: null, vehicles: {}, images: {}, hist: null };
        seen = { settings: null, hist: null, vehicles: {} };
        remoteImages = {}; lastHistRaw = null; lastHistLen = -1;
    };
    reset();

    const sigOf = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ':' + s.length; };
    const EMPTY_SIG = sigOf('[]');
    const vjson = v => { const { imageBase64, ...rest } = v; return JSON.stringify(rest); };
    const raw = x => (root.Vue && root.Vue.toRaw ? root.Vue.toRaw(x) : x);
    const TS = () => fb.database.ServerValue.TIMESTAMP;
    const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };

    function friendly(e) {
        const c = (e && (e.code || e.message)) || '';
        if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'E-posta veya şifre hatalı.';
        if (/invalid-email/.test(c)) return 'Geçerli bir e-posta adresi yazın.';
        if (/too-many-requests/.test(c)) return 'Çok fazla hatalı deneme. Biraz bekleyip tekrar deneyin.';
        if (/network/.test(c)) return 'İnternet bağlantısı kurulamadı.';
        if (/user-disabled/.test(c)) return 'Bu hesap devre dışı bırakılmış.';
        if (/permission/i.test(c)) return 'Bu hesabın veriye erişim izni yok. Yöneticiye başvurun.';
        return 'İşlem başarısız: ' + (e && e.message ? e.message : c);
    }

    /* ---------- Yazma ---------- */
    function histPayload(arr) {
        if (!arr.length) return null;
        const json = JSON.stringify(arr), chunks = {};
        for (let i = 0, n = 0; i < arr.length; i += CHUNK, n++) chunks['c' + n] = JSON.stringify(arr.slice(i, i + CHUNK));
        return { meta: { sig: sigOf(json), count: arr.length }, chunks };
    }
    function buildOps(data, full) {
        const ops = {}, email = user ? user.email : '';
        const sJ = JSON.stringify(data.settings);
        if (full || sJ !== last.settings) { ops['settings'] = { j: sJ, u: email, t: TS() }; last.settings = sJ; }
        if (full || data.timeRule !== last.timeRule) { ops['timeRule'] = data.timeRule; last.timeRule = data.timeRule; }
        const ids = new Set();
        (data.vehicles || []).forEach(v => {
            const id = String(v.id); ids.add(id);
            const j = vjson(v);
            if (full || j !== last.vehicles[id]) { ops['vehicles/' + id] = { j }; last.vehicles[id] = j; }
            const img = v.imageBase64 || '';
            if ((full && img) || img !== (last.images[id] || '')) { ops['images/' + id] = img || null; if (img) last.images[id] = img; else delete last.images[id]; }
        });
        Object.keys(last.vehicles).forEach(id => {
            if (!ids.has(id)) { ops['vehicles/' + id] = null; ops['images/' + id] = null; delete last.vehicles[id]; delete last.images[id]; }
        });
        const hr = raw(data.historicalData || []);
        if (full || hr !== lastHistRaw || hr.length !== lastHistLen) {
            const hs = hr.length ? sigOf(JSON.stringify(hr)) : EMPTY_SIG;
            lastHistRaw = hr; lastHistLen = hr.length;
            if (full || hs !== last.hist) { ops['hist'] = histPayload(hr); last.hist = hs; }
        }
        return ops;
    }
    function push(data) {
        if (!enabled || !ready || !user) return;
        const ops = buildOps(data, false);
        if (!Object.keys(ops).length) return;
        ops['meta/at'] = TS(); ops['meta/by'] = user.email;
        vm.sync.status = 'saving';
        db.ref(ROOT).update(ops).then(() => { if (vm.sync.status === 'saving') vm.sync.status = 'ok'; })
            .catch(e => { vm.sync.status = 'error'; vm.sync.msg = friendly(e); });
    }

    /* ---------- Dinleme ---------- */
    function listen(path, cb) {
        const ref = db.ref(path);
        ref.on('value', cb, err => onFail(err));
        refs.push(ref);
    }
    function onFail(err) {
        if (/permission/i.test((err && (err.code || err.message)) || '')) { vm.auth.error = friendly(err); hardSignOut(); }
        else { vm.sync.status = 'error'; vm.sync.msg = friendly(err); }
    }
    function attach() {
        return new Promise(resolve => {
            const first = { settings: true, timeRule: true, vehicles: true, images: true, hist: true };
            let pending = 5;
            const done = k => { if (first[k]) { first[k] = false; if (--pending === 0) resolve(); } };

            listen(ROOT + '/settings', snap => {
                const v = snap.val();
                if (v && v.j && v.j !== last.settings && v.j !== seen.settings) {
                    const o = parse(v.j);
                    if (o) { seen.settings = v.j; vm.remoteSettings(o); last.settings = JSON.stringify(vm.settings); }
                }
                done('settings');
            });
            listen(ROOT + '/timeRule', snap => {
                const v = snap.val();
                if (v !== null && v !== last.timeRule) { vm.remoteTimeRule(v); last.timeRule = v; }
                done('timeRule');
            });
            listen(ROOT + '/images', snap => {
                const o = snap.val() || {};
                remoteImages = o;
                Object.keys(o).forEach(id => { if (o[id] !== last.images[id]) { vm.remoteVehicleImage(id, o[id]); last.images[id] = o[id]; } });
                Object.keys(last.images).forEach(id => { if (!(id in o)) { vm.remoteVehicleImage(id, ''); delete last.images[id]; } });
                done('images');
            });
            listen(ROOT + '/vehicles', snap => {
                const o = snap.val() || {}, ids = Object.keys(o);
                if (first.vehicles) { // ilk yüklemede bulut esastır
                    vm.remoteVehiclesReplace(ids.map(id => parse(o[id].j)).filter(Boolean).map(v => ({ ...v, imageBase64: remoteImages[String(v.id)] || '' })));
                    last.vehicles = {}; vm.vehicles.forEach(v => { last.vehicles[String(v.id)] = vjson(v); });
                } else {
                    ids.forEach(id => {
                        const j = o[id].j;
                        if (j === last.vehicles[id] || j === seen.vehicles[id]) return;
                        const v = parse(j); if (!v) return;
                        seen.vehicles[id] = j;
                        vm.remoteVehicle({ ...v, imageBase64: remoteImages[id] || '' });
                        const sv = vm.vehicles.find(x => String(x.id) === id);
                        if (sv) last.vehicles[id] = vjson(sv);
                    });
                    Object.keys(last.vehicles).forEach(id => {
                        if (!(id in o)) { vm.remoteVehicleRemove(id); delete last.vehicles[id]; delete seen.vehicles[id]; }
                    });
                }
                done('vehicles');
            });
            listen(ROOT + '/hist/meta', async snap => {
                const m = snap.val();
                try {
                    if (!m) {
                        if (first.hist || last.hist !== EMPTY_SIG) { vm.remoteHist([]); last.hist = EMPTY_SIG; lastHistRaw = raw(vm.historicalData); lastHistLen = 0; }
                    } else if (m.sig !== last.hist && m.sig !== seen.hist) {
                        const cs = (await db.ref(ROOT + '/hist/chunks').once('value')).val() || {};
                        const arr = [];
                        Object.keys(cs).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).forEach(k => { const p = parse(cs[k]); if (p) arr.push(...p); });
                        seen.hist = m.sig; vm.remoteHist(arr);
                        lastHistRaw = raw(vm.historicalData); lastHistLen = lastHistRaw.length;
                        last.hist = lastHistLen ? sigOf(JSON.stringify(lastHistRaw)) : EMPTY_SIG;
                    }
                } catch (e) { onFail(e); }
                done('hist');
            });
        });
    }
    function detach() { refs.forEach(r => r.off()); refs = []; }

    /* ---------- Oturum ---------- */
    async function startSync() {
        vm.sync.status = 'connecting'; vm.sync.loaded = false; vm.sync.msg = '';
        reset();
        try {
            const meta = await db.ref(ROOT + '/meta').once('value');
            if (!meta.exists()) { // bulut boş: bu bilgisayardaki veriyi ilk kez yükle
                const data = vm.currentData();
                const ops = buildOps(data, true);
                ops['meta'] = { initialized: true, by: user.email, at: TS() };
                await db.ref(ROOT).update(ops);
            } else {
                vm.backupLocal(); // buluttaki veri esas alınacak; yerel kopya yedeklenir
            }
            await attach();
            ready = true; vm.sync.loaded = true; vm.sync.status = 'ok';
        } catch (e) { onFail(e); vm.sync.loaded = false; }
    }
    async function hardSignOut() { ready = false; detach(); try { await auth.signOut(); } catch (e) { /* yoksay */ } vm.sync.loaded = false; }

    function init(viewModel) {
        vm = viewModel;
        if (!enabled) return false;
        fb.initializeApp(cfg);
        auth = fb.auth(); db = fb.database();
        db.ref('.info/connected').on('value', s => { vm.sync.online = !!s.val(); });
        auth.onAuthStateChanged(u => {
            user = u;
            if (u) { vm.auth.user = { email: u.email }; vm.auth.state = 'in'; vm.auth.error = ''; startSync(); }
            else { ready = false; detach(); vm.auth.user = null; vm.auth.state = 'out'; vm.sync.loaded = false; }
        });
        return true;
    }
    async function signIn(email, password) {
        try { await auth.signInWithEmailAndPassword(email, password); return null; }
        catch (e) { return friendly(e); }
    }
    async function signOut() { await hardSignOut(); }

    root.CloudSync = { enabled, init, push, signIn, signOut };
})(window);
