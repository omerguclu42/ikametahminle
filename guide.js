/* Eurocross İkame Tahminleme - Çalışma Rehberi içeriği */
window.GUIDE = [
    {
        id: 'genel', title: 'Genel Bakış ve Çalışma Sırası', icon: 'bi-compass',
        intro: 'Uygulama, geçmiş ikame dosyalarını (teslim ve iade tarihleri) kendi filomuzla karşılasaydık ne olurdu sorusunu araç araç, gün gün simüle eder ve sonucu yıllara yayarak gelir, gider ve kârlılık olarak gösterir.',
        sections: [
            { h: 'Önerilen çalışma sırası', items: [
                '1. Araç Gider Başlıkları: araçlar için girilecek gider kalemlerini ve tiplerini tanımlayın.',
                '2. Personel Gider Başlıkları: vale / personel maliyetlerini ve personel sayısını girin.',
                '3. Yakıt & Enflasyon: tahminleme yıllarını, enflasyon oranlarını ve yakıt fiyatlarını girin.',
                '4. Günlük Tutar: her müşteri için Eurocross Turkey günlük tutarını segment ve yıla göre girin; başabaş ve kârlılığı aynı sayfada görün.',
                '5. Araç Veri Girişi: filoda kullanılabilecek modelleri alış, satış ve giderleriyle tanımlayın.',
                '6. Tarihçe: geçmiş dosya verisini Excel / CSV olarak yükleyin.',
                '7. Tahminleme Simülatörü: araç adetlerini belirleyin ya da hedef oran seçin, sonuçları inceleyin, senaryo kaydedin.',
                '8. Raporlama: grafik ve tablolarla detaylı analiz yapın, senaryoları karşılaştırın.'
            ] },
            { h: 'Menüdeki işaretler', items: [
                'Yeşil ✓: o sayfadaki zorunlu bilgiler tamam.',
                'Sarı nokta: eksik bilgi var; simülasyon eksik veriyle yanlış sonuç verebilir.'
            ] },
            { h: 'Kayıt ve senkronizasyon', items: [
                'Her değişiklik otomatik kaydedilir ve buluta (Firebase) gönderilir; köşede "Kaydedildi ✓" görünür.',
                'Başka bir bilgisayardaki değişiklik birkaç saniye içinde ekranınıza gelir. Sağ üstte "Buluta kaydedildi" yazısı verilerin güncel olduğunu gösterir.',
                'Sekmeyi ya da tarayıcıyı kapatınca oturum kapanır; tekrar açarken giriş gerekir. Sayfayı yenilemek oturumu kapatmaz.'
            ] },
            { h: 'Sunum modu ve PDF', items: [
                'Sağ üstteki "Sunum Modu" menüyü gizler ve yazıları büyütür; Esc tuşu ya da "Sunum modundan çık" ile kapanır.',
                'Simülatör ve Raporlama sayfalarındaki "PDF olarak kaydet" yazdırma penceresini açar; hedef olarak "PDF olarak kaydet" seçin.'
            ] }
        ]
    },
    {
        id: 'giderBasliklari', title: 'Araç Gider Başlıkları', icon: 'bi-tags',
        intro: 'Araç formunda doldurulacak gider kalemleri burada tanımlanır. Her başlık araç formunda zorunlu alan olur. Optimum Satış Yılı, Optimum Satış KM ve 100 KM Yakıt Tüketimi her zaman vardır.',
        sections: [
            { h: 'Gider tipleri ve hesaplama', items: [
                'Yıllık tutar: girilen tutar baz yılın gideridir; sonraki her yıl o yılın enflasyonu kadar artar. (Kasko, trafik sigortası, MTV…)',
                'Km bazlı (bakım gibi): işlem başı tutar ve kaç km\'de bir yapıldığı girilir. İşlem sayısı = optimum satış km ÷ km aralığı (aşağı yuvarlanır). Yıllık gider = işlem sayısı ÷ optimum satış yılı × tutar × enflasyon. Örnek: 100.000 km ÷ 10.000 km = 10 bakım ÷ 3 yıl = yılda 3,33 bakım.',
                'Ömür boyu adet (lastik gibi): değişim başı tutar ve ömür boyunca kaç kez değişeceği girilir. Değişimler ömre eşit aralıkla yayılır (optimum yıl ÷ adet); 1. değişim ilk yıl, sonrakiler yapıldığı yılın enflasyonlu fiyatıyla.',
                'Yılda adet × birim fiyat (temizlik gibi): birim tutar ve yılda kaç kez yapıldığı girilir; birim tutar her yıl enflasyon kadar artar. Örnek: 60 × ₺300 = ₺18.000.',
                'Tek seferlik (sabit gider): yalnızca ilk kullanım yılına gider yazılır (GPS cihazı gibi). Aboneliği ayrı bir yıllık gider olarak ekleyin.',
                'Yakıt km: valenin yıllık kullanacağı km girilir. Yakıt gideri = km ÷ 100 × 100 km tüketim × o yılın yakıt fiyatı.'
            ] },
            { h: 'Kullanım', items: [
                'Yeni başlık eklerken "Tüm araçlara aynı değer" alanını doldurursanız değer kayıtlı tüm araçlara yazılır; boş bırakırsanız araçlar "eksik bilgi" olur.',
                'Kalem ikonu başlığın adını ve kategorisini düzenler; adı değişince araçlardaki değerler yeni ada taşınır. Aynı pencereden tüm araçlara yeni değer de yazılabilir.',
                'Başlıkları sürükleyerek sıralayabilirsiniz; araç formunda da aynı sıra kullanılır. Kategori, Gider Dağılımı tablolarında gruplama için kullanılır.'
            ] }
        ]
    },
    {
        id: 'personelGider', title: 'Personel Gider Başlıkları', icon: 'bi-people',
        intro: 'Vale ve personel maliyetleri kişi başı yıllık tutar olarak girilir. Toplam personel gideri = kişi başı tutar × personel sayısı; her yıl enflasyonla artar.',
        sections: [
            { h: 'Personel sayısı', items: [
                'Simülatördeki toplam araç: Tahminleme Simülatörü\'ndeki araç adetlerinin toplamı (otomatik).',
                'Kaç araca 1 personel: örneğin 10 yazarsanız her 10 araç için 1 personel önerilir.',
                'Önerilen personel = toplam araç ÷ kaç araca 1 personel, yukarı yuvarlanır.',
                'Kilit açıkken çalıştırılacak personel sayısı önerilen sayıdan otomatik alınır ve araç sayısı değiştikçe güncellenir. Sayıyı elle değiştirirseniz kilit kendiliğinden kapanır.'
            ] },
            { h: 'Simülasyona etkisi', items: [
                'Personel gideri filo geneli sabit gider olarak, o yıl aktif araçlara aldıkları dosya oranında dağıtılır.',
                'Kilit açıkken personel araç sayısıyla birlikte değiştiği için "En kârlı filo" ve "+1 araç etkisi" hesaplarına her aracın personel payı da eklenir.',
                'Operasyon Yükü kartlarında personelin haftada 6 gün çalıştığı kabul edilir (günde aktif personel = personel × 6/7).'
            ] }
        ]
    },
    {
        id: 'aracGiris', title: 'Araç Veri Girişi', icon: 'bi-car-front',
        intro: 'Filoda kullanılabilecek her marka / model bir kez tanımlanır; kaç adet kullanılacağı simülatörde belirlenir. Fotoğraf dışındaki tüm alanlar zorunludur, 0 girilebilir.',
        sections: [
            { h: 'Temel bilgiler', items: [
                'Segment: aracın hangi segment dosyalarını alacağını belirler (B, C, C+, D, D+, E, E+).',
                'Araç alış bedeli: peşin alımda tamamı ilk kullanım yılına gider yazılır.',
                'Krediyle alındı: vade (en fazla optimum satış yılı × 12 ay) ve yıllık faiz seçilir. Eşit taksitli kredi; aylık faiz = yıllık ÷ 12. Taksitlerin anapara kısmı "Alış Gideri", faiz kısmı "Faiz Gideri" olarak ödendiği yıllara yazılır.',
                'Araç satış tutarı: optimum satış yılının sonunda gelir olarak yazılır.'
            ] },
            { h: 'Gider ve performans verileri', items: [
                'Optimum satış yılı, tahminleme yılı sayısıyla aynı olmalıdır; farklıysa uyarı ve tek tıkla eşitleme butonu çıkar.',
                'Optimum satış km, km bazlı giderlerde (bakım) işlem sayısını belirler; yakıt hesabında kullanılmaz.',
                '"Gider Verilerini Kopyala" yalnızca sağ taraftaki gider ve performans alanlarını kopyalar; başka bir araçta "Yapıştır" ile doldurulur.'
            ] },
            { h: 'Araç kartları', items: [
                '"İncele" aracın yıllara göre gider tablosunu ve her kalemin nasıl hesaplandığını gösterir.',
                'Eksik bilgili araç kırmızı çerçeveyle görünür ve simülasyona dahil edilmez.'
            ] }
        ]
    },
    {
        id: 'yakitVeEnflasyon', title: 'Yakıt & Enflasyon', icon: 'bi-graph-up-arrow',
        intro: 'Tahminlemenin kaç yıl yapılacağı, yıllık enflasyon oranları ve yakıt fiyatları burada belirlenir.',
        sections: [
            { h: 'Kurallar', items: [
                'En düşük yıl baz yıldır; giderler o yıl girilen tutardır. Sonraki her yıl bir önceki yılın üzerine o yılın enflasyonu eklenir.',
                'Yıl sayısı araçların optimum satış yılıyla aynı olmalıdır (3 yıl kullanılacak araç için 3 yıl).',
                'Yakıt fiyatları her yıl için ayrı girilir (enflasyonla otomatik artmaz). Elektrikli araçlarda ₺/kWh girilir.',
                'Tüm tutarlar KDV dahil girilir.'
            ] }
        ]
    },
    {
        id: 'tarihce', title: 'Tarihçe (Dosyalar)', icon: 'bi-file-earmark-spreadsheet',
        intro: 'Simülasyonun dayandığı geçmiş ikame dosyaları. Dosya numarası, segment, müşteri, araç teslimat tarihi ve araç iade tarihi (saatli) yüklenir.',
        sections: [
            { h: 'Yükleme', items: [
                'Excel / CSV yüklenebilir ya da Excel\'den kopyalanıp yapıştırılabilir. İlk satırda başlıklar olmalıdır; eksik başlık varsa yükleme yapılmaz ve hangi başlığın bulunamadığı söylenir.',
                'Yeni yükleme mevcut tarihçenin yerine geçer (onay istenir). Aynı dosya tekrar ediyorsa bir kez alınır.',
                'Tam yıllık (365 gün) veri yüklenmesi önerilir; daha kısa veride çalışılan gün ve gelir yalnızca o dönemi kapsar.'
            ] },
            { h: 'Müşteri', items: [
                'Müşteri sütunu isteğe bağlıdır; yoksa dosyalar müşterisiz yüklenir ve Günlük Tutar sayfasında "Müşterisi belirtilmemiş" olarak fiyatlanır.',
                'Bir müşteri birçok dosyada geçebilir; müşteriler tekrarsız listelenir. Büyük / küçük harf ve fazla boşluk farkı aynı müşteri sayılır (ilk görülen yazılış kullanılır).',
                'Müşteri listesi Günlük Tutar sayfasında, simülatör ve raporlama filtrelerinde ve müşteri bazlı tablolarda kullanılır.'
            ] },
            { h: 'Kiralama günü', items: [
                'Tam 24 saatler sayılır; kalan süre 3 saatten fazlaysa 1 gün eklenir (en az 1 gün). Örnek: 12:00 teslim, ertesi gün 15:00 iade = 1 gün; 15:01 iade = 2 gün.'
            ] }
        ]
    },
    {
        id: 'iadeSaati', title: 'İade Dönüş Saati', icon: 'bi-clock-history',
        intro: 'İade edilen aracın aynı gün yeni dosyaya verilip verilemeyeceğini belirler.',
        sections: [
            { h: 'Kural', items: [
                'İade saati sınırdan önceyse araç, iade saatinden sonra başlayan aynı gün bir dosyaya verilebilir.',
                'İade saati sınır veya sonrasıysa araç o gün yeni dosya alamaz; ertesi gün 00:00\'dan itibaren boştadır.'
            ] }
        ]
    },
    {
        id: 'gunlukTutar', title: 'Günlük Tutar ve Fiyat Analizi', icon: 'bi-cash-coin',
        intro: 'Eurocross Turkey günlük tutarı müşteri, segment ve yıla göre girilir. Varsayılan tutar yoktur; her müşteri için tutar girilmelidir. Sayfa, girilen tutarla gelir, gider, kârlılık ve başabaş tahminini anında gösterir. Hesaplar yalnızca kendi filomuzla karşılanan dosyalar üzerindendir.',
        sections: [
            { h: 'Tutar girişi', items: [
                'Tarihçedeki müşteriler listeden seçilir; her müşteri için segment × yıl bazında Eurocross Turkey günlük tutarı girilir. Müşteri bilgisi olmayan dosyalar listede "Müşterisi belirtilmemiş" olarak yer alır.',
                'Müşterinin talep ettiği segmentler turuncu işaretlidir (dosya sayısıyla). Boş bırakılan hücrede gelir 0 hesaplanır; tutarı eksik müşteriler sayfanın üstünde listelenir.',
                'Dosya geliri = kiralama günü (tam gün) × dosyanın müşterisinin, o segment ve yıldaki günlük tutarı. Üst segment araç verilirse talep edilen segmentin, alt segment araç verilirse verilen segmentin tutarı alınır.',
                '"Başka müşteriden kopyala" ile bir müşterinin tutarları seçili müşteriye alınır; "Diğer müşterilere uygula" ile seçili müşterinin tutarları eksik hücrelere ya da tüm müşterilere yazılır.'
            ] },
            { h: 'Fiyat analizi', items: [
                'Gün başı maliyet (başabaş tutar) = müşterinin dosyalarına çalışan araçların [işletme gideri + personel payı + (alış + faiz − satış) ÷ araç ömrü], müşterinin o araçlardaki kiralama günü payıyla, ÷ müşterinin kiralama günü. Müşteriye o yıl araç çalışmadıysa segmentteki filonun ortalaması kullanılır. Simülatördeki mevcut filo ve doluluğa göre hesaplanır; filo değişirse başabaş da değişir. Toplamlar simülatördeki Müşteri sekmesiyle aynıdır.',
                'Her tutar hücresinin altında başabaş tutar yazar: tutar bunun üzerindeyse yeşil (kâr), altındaysa kırmızı (zarar).',
                'Bir hücreye tıklayınca sağda o segment ve yılın analizi açılır: günlük kâr ve kâr marjı, başabaşa göre indirim payı ya da gereken zam, ortalama kiralama süresi, dosya başı gelir / gider / kâr ve o yılın tahmini dosya, gün, gelir, gider ve neti.',
                '"Tutar değişirse" tablosu tutar %10 / %20 azalır ya da artarsa günlük kârın, dosya başı kârın ve yıllık netin ne olacağını gösterir.',
                'Yıllara Göre Forecast: müşterinin kendi filomuzla karşılanan tüm dosyaları için yıl yıl gelir, gider, net, kârlılık ve kümülatif net; kümülatif netin pozitife döndüğü yıl "kâra geçiş" olarak işaretlenir.',
                'Segment × Yıl Başabaş Tablosu: her hücrede girilen tutar / başabaş tutar ve gün başı kâr. Hücreye tıklayınca analiz o hücreye geçer.'
            ] }
        ]
    },
    {
        id: 'tahminleme', title: 'Tahminleme Simülatörü', icon: 'bi-speedometer2',
        intro: 'Seçilen filoyla tarihçedeki her dosya, teslim anında boşta olan araca verilir; sonuç tahminleme yıllarına yayılarak gelir, gider ve kârlılık hesaplanır.',
        sections: [
            { h: 'Dosya dağıtım kuralı', items: [
                'Dosyalar teslim zamanına göre sırayla işlenir. Her dosya kendi segmentindeki, o an boşta olan en düşük giderli araca verilir (öncelik: yıllık ortalama net maliyet = alış + giderler − satış, yıla bölünmüş).',
                'Bir araç aynı anda tek dosya alır; iade dönüş saati kuralı uygulanır.',
                'Üst / Alt Segment Araç Verilebilir açıksa: önce her araç kendi segmentinin dosyalarını alır, kalan dosyalar diğer segment araçlarının gerçekten boş kalan zamanlarına yerleştirilir (önce en yakın alt, sonra en yakın üst segment).'
            ] },
            { h: 'Ayarlar', items: [
                'Hedef karşılama oranı: seçilen orana (%50–%100) ya da "En kârlı filo"ya göre adetler bir kez hesaplanıp araç kartlarına yazılır; sonra kaydırıcılarla değiştirilebilir. "Hedefe göre yeniden hesapla" tekrar uygular.',
                'En kârlı filo: her segmentte araç, getirdiği net (dosya geliri − araç gideri − kilit açıksa personel payı) pozitif olduğu sürece eklenir.',
                'Hizmet sayısı değişimi: her segmentin dosyaları zamana göre sıralanır, seçilen oranda dosya eşit aralıkla seçilir; azalışta çıkarılır, artışta aynı tarih ve saatle kopyası eklenir. Segment dağılımı ve mevsimsellik korunur.',
                'Senaryoyu Kaydet: araç adetleri, hedef, hizmet değişimi, üst/alt segment seçenekleri ve filtreler adı, notu ve sahibiyle kaydedilir. Senaryo adına tıklayınca o hâle dönülür.'
            ] },
            { h: 'Araç kartları', items: [
                'Kartta araç başı gider, satış tutarı, yıllık ortalama net maliyet ve toplam gider yazar.',
                '"N. araç eklenirse" kutusu bir araç daha eklenirse şirket netinin (tüm yıllar) ne kadar değişeceğini gösterir: yeşil kârlılık artar, kırmızı zarar artar.'
            ] },
            { h: 'Kartlar ve tablolar', items: [
                'Her kartın sağ üstündeki ⓘ ikonunun üzerine gelince o kartın nasıl hesaplandığı gerçek rakamlarla gösterilir.',
                'Filtreler: Yıl, Ay (teslim ayı), Segment, Marka Model, Müşteri. Her filtre açılır listeden çoktan seçmelidir (tıklayarak birden çok seçilir, "yalnız" ile tek seçim, "Temizle" ile Tümü). Ay seçiliyken yıllık giderler seçili ayların gün sayısına oranlanır, araç satışı dahil edilmez.',
                'Müşteri seçiliyken: talep ve karşılama o müşterilerin dosyalarından; gelir o müşterilerin dosyalarından kendi günlük tutarlarıyla; araç gideri, personel gideri, satış ve çalışılan / boşta gün her araçta seçili müşterilerin kiralama günü payıyla hesaplanır. Böylece tüm müşterilerin toplamı filtresiz sonuca eşittir.',
                'Detay tablolarında (Yıllık Özet, Segment, Müşteri, Araç Modeli, Gider Dağılımı, Plaka Detayı, Ay Detayı) sütun başlığına tıklayınca sıralanır.',
                'Müşteri tablosu: dosya, karşılanan, karşılama oranı, kiralama günü, doluluğa katkı (müşteriye çalışılan gün ÷ filodaki toplam araç günü), gelir, gider, net ve kârlılık (net ÷ gelir).'
            ] }
        ]
    },
    {
        id: 'raporlama', title: 'Raporlama', icon: 'bi-bar-chart-line',
        intro: 'Simülatördeki filonun sonuçları grafik ve tablolarla incelenir. Filtreler simülatörle ortaktır.',
        sections: [
            { h: 'Sayfa düzeni', items: [
                'Üstte yönetici özeti ve ana göstergeler, altında numaralı analizler yer alır. Her analizde solda grafik, sağda aynı verinin tablosu ve turuncu kutuda öne çıkan bulgu vardır.',
                'Senaryo kısayollarına tıklayınca o senaryo uygulanır ve tüm rapor ona göre yenilenir.'
            ] },
            { h: 'Öne çıkan analizler', items: [
                'Filo Büyüklüğü – Karşılama – Kâr: segmentte araç sayısı arttıkça karşılama oranı ve net nasıl değişir; en kârlı nokta.',
                'Duyarlılık Analizi: Eurocross Turkey günlük tutarı, alış / satış bedeli, giderler, yakıt, personel, enflasyon ve hizmet sayısı değişince şirket netinin ne kadar değiştiği; en etkili varsayım en üstte.',
                'Model Karar Tablosu: her modelin gün başı geliri, maliyeti ve günlük kârı.',
                'Müşteri analizleri (müşteri bilgisi varsa): müşteri bazında gelir-gider-net, talep ve karşılama, talep / gelir / doluluk payları, birim ekonomi (gün başı gelir, maliyet, kâr), aylık talep dağılımı ve müşteri × segment talep matrisi.',
                'Detaylı Veri Seti: dosya ya da plaka-yıl bazında tüm veriler; Excel\'e aktarılabilir.'
            ] }
        ]
    }
];
