# codex-eco — Codex için eco modu

**Codex oturumun sen tek harf yazmadan önce zaten ~5.500 token'a mal oluyor. `codex-eco` bunu ölçer, gerçekten işe yarayan ayarlarla üçte birini keser ve etkisi canlı modelde ölçülmüş davranış kuralları getirir — kuralların işleri kötüleştirdiği modeller dahil.**

**Codex CLI** ve **ChatGPT masaüstü uygulamasındaki Codex** için çalışır. Tek kurulum ikisini de kapsar.

[English](README.md) · [Türkçe](README.tr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Codex CLI](https://img.shields.io/badge/Codex%20CLI-0.147-black)](https://developers.openai.com/codex) [![Doğrulandı](https://img.shields.io/badge/do%C4%9Frulayan-Codex'in%20kendi%20do%C4%9Frulay%C4%B1c%C4%B1lar%C4%B1-brightgreen)](#buradaki-her-iddia-nasıl-doğrulandı)

![codex-eco](assets/social-preview.png)

## Hızlı başlangıç

```bash
git clone https://github.com/sup3x/codex-eco && cd codex-eco && ./install.sh
```

Sonra yeni bir Codex oturumunda:

| | Codex CLI | ChatGPT masaüstündeki Codex |
|---|---|---|
| Aç | `$eco` | `@eco` |
| Görevle birlikte | `$eco orders.js'deki başarısız testi düzelt` | `@eco orders.js'deki başarısız testi düzelt` |
| Kurulumunu ayarla | `$eco setup` | `@eco setup` |

Tek başına `$eco` tam olarak `Eco mode active.` cevabını verir — bu satırı görüyorsan yüklenmiştir.

Windows: `.\install.ps1`. İki kurucu da değiştirdiği her şeyi yedekler ve `--uninstall` / `-Uninstall` destekler.

## Token'ının nereye gittiğini gör — hiç harcamadan

Bu depodaki en faydalı şey çalıştırmak bedava ve hiçbir model çağrısı yapmıyor:

```bash
node scripts/prefix-audit.mjs
```

```
section                           chars   ~tokens
-------------------------------------------------
skills catalog                   16,901     4,225
recommended-plugins advert        2,849       712
core instruction prose            2,269       567
multi-agent mode note               271        68
-------------------------------------------------
TOTAL before you type            22,290     5,573

configuration                     chars   ~tokens      change
-------------------------------------------------------------
as configured now                22,290     5,573           -
eco profile (safe)               14,684     3,671      -34.1%
eco profile (aggressive)          9,768     2,442      -56.2%
```

Bunlar tek bir makineden gelen gerçek sayılar; `codex debug prompt-input` üretiyor, yani Codex'in göndereceği tam öğe listesi. Kendi projende çalıştırırsan kendi sayılarını görürsün — `AGENTS.md` dosyanın maliyeti dahil. Denetimin önerdiği her anahtar, önerilmeden önce `codex mcp-server --strict-config` ile senin Codex sürümüne karşı doğrulanır; böylece bir yazım hatası asla tasarruf gibi görünemez.

## Ne alıyorsun

| Bileşen | Ne yapar |
|---|---|
| **`eco` skill** | Pazarlığa kapalı bir doğruluk tabanıyla davranış kuralları. Bir kez çağırmak thread boyunca geçerli. `eco setup` config değişikliklerini önerir, onay almadan hiçbir şey uygulamaz. |
| **`eco-max` skill** | Aynı kurallar, en sıkı cevap bütçesiyle; rutin işler için. `eco`'dan üretilir, bu yüzden ikisi birbirinden ayrışamaz. |
| **`profiles/eco.config.toml`** | Güvenli ön-ek kademesi: doğrulanmış dört ayar artı iki sınır. `codex --profile eco`. |
| **`profiles/eco-max.config.toml`** | Akıl yürütme eforuna taban ekler ve agresif ön-ek kademesini açar. |
| **`AGENTS.eco.md`** | Aynı disiplin, depo seviyesinde bir blok olarak — skill çağırmadan sürekli açık kalsın istersen. |
| **`scripts/prefix-audit.mjs`** | Yukarıdaki ücretsiz, çevrimdışı denetim. |
| **`bench/`** | Buradaki her sayının arkasındaki ölçüm harness'ı, deterministik grader, köken manifesti ve ön-kayıtlar. |

## Ölçülen sonuçlar

<!-- codex-eco:results:start -->
_Henüz yayınlanmış bir ana çalışma yok. Çalıştırmalar yayınlandığında `node scripts/build-assets.mjs` bu bölümü `bench/manifest.json`'dan doldurur._
<!-- codex-eco:results:end -->

## Kurallar tam olarak neyi hedefliyor

Her kural, silahsız ajanın gerçek bir transkriptte o şeyi yaptığı **görüldüğü** için var:

1. **Preamble turu.** Codex, ne yapacağını duyuran bir mesajla başlıyor — *"I'll inspect the test file and its nearby project context, then summarize"* — ve komutu ancak ondan sonra çalıştırıyor. Bu, hiçbir işi ilerletmeyen faturalı bir tur. Onu bastıran kural, dört aday ifadeyi birbirine karşı ölçerek seçildi ([Part A](bench/preregistration/001-first-study.md)).
2. **İstenmeyen keşif.** Tek bir dosyayı incelemesi istenen silahsız ajan, ayrıca `Get-ChildItem -Force` ve ağaç geneli `rg -n "orders" .` çalıştırdı — kimsenin istemediği bir dizin dökümü ve tam ağaç grep'i. Silahlı kollar 1.4 yerine 1 komut kullandı.
3. **Bütün dosyayı dökme.** Codex'te editör aracı yok; her şey bir shell komutu. Bu yüzden kurallar komut hijyeni üzerine: bölgeyi iste (`sed -n`, `Get-Content -TotalCount`), `rg -n`'den önce `rg -l`, bağımsız komutları tek çağrıda birleştir, dosyayı shell'le yeniden yazmak yerine `apply_patch`.
4. **Thread'in büyümesi.** Codex'te modelin kendisinin çağırabildiği bir `new_context` aracı var ve Codex'in kendi rehberi sıkıştırmanın doğruluğa mal olabileceğini söylüyor. Kurallar diyor ki: geçmiş anlamını yitirince yeni bir bağlam başlat, ve thread ortasında model veya efor değiştirme — ölçüldü, bu cache'lenmiş ön-ek oranını 0.95'ten 0.07'ye düşürüyor.

## Ölçümle: **işe yaramayanlar**

Yayınlanmış Codex rehberleri bunların hepsini öneriyor. Codex 0.147'de hiçbiri tasarruf sağlamıyor:

| Öneri | Gerçek |
|---|---|
| `model_reasoning_summary = "none"` | Şu anki her model zaten `none` ile geliyor. Sıfır değişiklik. |
| `model_verbosity = "low"` | `gpt-5.4-mini` hariç her modelde zaten varsayılan. Neredeyse herkes için sıfır değişiklik. |
| `hide_agent_reasoning` / `show_raw_agent_reasoning` | Yalnızca görüntüyle ilgili. Ölçüldü: prompt bayt bayt aynı. |
| `features.token_budget` | Geliştirme aşamasında, ve açmak prompt'a ~1.858 karakter **ekliyor**. |
| `model_supports_reasoning_summaries` | Resmî örnek config'de var; kurulu binary **bilinmeyen alan diye reddediyor**. |
| `minimal` akıl yürütme eforu | CLI her string'i sessizce kabul ediyor; bazı güncel modeller `minimal`'ı istek anında HTTP 400 ile reddediyor. Güvenli taban `low`. |
| Skills bloğunu küçültmek için `model_context_window`'u düşürmek | İşe yarıyor (100k'da −1.883 karakter) ama otomatik sıkıştırma eşiğini de düşürüyor, ve sıkıştırma cache'i tamamen öldürüyor. Net etki negatif. |

Bu tablo, projenin neden bu biçimde var olduğunun cevabı: Codex'te frugal *görünen* ama ölçüldüğünde olmayan bir yapılandırma yayınlamak çok kolay.

## Buradaki her iddia nasıl doğrulandı

- **Depoyu Codex'in kendi doğrulayıcıları geçiriyor.** Codex 0.147, `skill-creator` ve `plugin-creator`'ı diskte sistem skill'i olarak, çalıştırılabilir doğrulayıcılarla getiriyor. `plugins/eco/skills/*` `quick_validate.py`'den, `plugins/eco` `validate_plugin.py`'den geçiyor. Claude Code portundan kopyalanan `argument-hint`'in Codex'te hiç var olmadığını da böyle öğrendik.
- **Prompt boyutları tahmin değil, `codex debug prompt-input` çıktısı.** Karakter sayıları kesin; token sayıları `~` işaretli, çünkü karakter/4.
- **Config anahtarları önerilmeden önce `codex mcp-server --strict-config` ile doğrulanıyor.** Codex bilinmeyen anahtarları sessizce yok sayıyor, yani bir ayarın gerçek olduğunu anlamanın tek yolu bu.
- **Kalite deterministik notlanıyor.** `bench/lib/grade.mjs` her cevabı planlanmış hatalara karşı, döngüde model olmadan puanlıyor. Kendi ürettiği bir yanlış-negatif ve nasıl yakalandığı da belgeli — [ön-kayıttaki](bench/preregistration/001-first-study.md) Amendment 2.
- **Kural değişiklikleri ön-kayıtlı.** Uç noktalar ve eşikler çalıştırmalardan önce yazılıyor, başarısızlıklar başarılarla birlikte yayınlanıyor.
- **Asla dolar rakamı yok.** `codex exec` olay akışında maliyet alanı yok. ChatGPT planında para birimi senin hız sınırın, o yüzden bu proje token raporlar.

## Kurulum, detaylı

### Standalone skill — CLI **ve** masaüstü uygulaması

```bash
./install.sh                 # $HOME/.agents/skills
CODEX_SKILLS_DIR=... ./install.sh
./install.sh --uninstall
```

Codex standalone skill'leri üç kökten, en özelden başlayarak okuyor:

```
$CWD/.agents/skills      # yalnız bu proje
$HOME/.agents/skills     # sen, her yerde
/etc/codex/skills        # tüm makine veya konteyner
```

### Codex plugin'i olarak — CLI, tek komut

```bash
codex plugin marketplace add sup3x/codex-eco
codex plugin add eco@codex-eco
```

Ölçülen fark: plugin ile kurulu skill'i çağırmak 35 çıktı token'ına, standalone kopya 131'e mal oldu — çünkü standalone yolda ajan `SKILL.md`'yi bir shell komutuyla okuyor, plugin yolunda gövde doğrudan veriliyor. Plugin yolu aktivasyonda daha ucuz; standalone yol masaüstü uygulamasının okuduğu yol. İkisini birlikte kurmak sorun değil.

Dikkat: agresif profil plugin alt sistemini kapatıyor — onu plugin kurulumuyla değil, standalone kurulumla eşleştir.

### Profiller

```bash
cp profiles/eco.config.toml "$CODEX_HOME/eco.config.toml"    # varsayılan olarak ~/.codex
codex --profile eco
```

Profil açılışta katmanlanır; bu yüzden thread ortasında model/efor değiştirmenin yaptığı gibi cache'lenmiş ön-eki bozmaz, ve kaldırmak tek bir dosyayı silmek demektir.

## Bir Codex skill'inin yapamadığı iki şey

1. **Akıl yürütme eforunu değiştiremez.** Codex skill frontmatter'ı yalnızca `name`, `description` ve `metadata` kabul ediyor — bu projenin Claude Code kardeşinin aksine efor alanı yok. Efor bir profilden veya bayraktan gelir; `eco-max` bu yüzden hem skill hem profil olarak geliyor.
2. **Bir hook shell çıktısını yeniden yazamaz.** Codex hook'ları `permissionDecision`, `updatedInput`, `additionalContext` ve `updatedMCPToolOutput` taşıyor; shell sonucunu yeniden yazacak bir alan yok. `tool_output_token_limit` bu işi yerleşik olarak yapıyor, bu yüzden bu proje hiç hook getirmiyor.

## Benzer çalışmalar

| Proje | Katman | Dürüst karşılaştırma |
|---|---|---|
| [RTK](https://github.com/rtk-ai/rtk) | Shell çıktısı sıkıştırma proxy'si | Bu alanın devi ve tamamlayıcı: komut çıktısını bağlama girmeden küçültüyor. Codex entegrasyonu en zayıf halkası — Codex'te talimata indirgeniyor — buradaki kuralların doldurduğu boşluk tam olarak bu. |
| token-diet | Kısa-cevap kural seti | Codex desteği iddia ediyor ama sayıları başka bir ajandan taşınmış. Bu proje Codex'in kendisinde ölçüyor; bütün fark bu. |
| [agent-token-saver](https://github.com/Supersynergy/agent-token-saver) | Codex'te kontrollü A/B | Bunu Codex'te ölçen tek önceki çalışma. Atıf veriyoruz ve protokolde geçmeye çalışıyoruz: ön-kayıt, kol başına n, bootstrap GA, kesin Mann-Whitney, deterministik notlama ve yayınlanan negatif sonuçlar. |
| ccusage tarzı panolar | İzleme | Harcamayı sonradan ölçer; hiçbir şeyi azaltmaz. |

## Katkı

En değerli katkı başka modellerden, planlardan ve platformlardan gelen ölçüm sonuçları — özellikle eco'nun kaybettiği sonuçlar. `node bench/bench.mjs ab --task "..." --n 5 --rubric orders-review` her çalıştırmanın olay akışını senin için yazar. [CONTRIBUTING.md](CONTRIBUTING.md).

## Lisans

[MIT](LICENSE) © 2026 Kerim
