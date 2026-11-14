# Quantum Timeline Hook — Developer Brief

Nov 12, 2026 · @ronald

## Nama: Quantum Timeline Hook

Nama final: **Quantum Timeline Hook** (singkatan QTimeline). Setiap pool bercabang menjadi dua timeline (YES dan NO) sampai event selesai, dan resolusi event dikunci tanda tangan post-quantum. Kata "timeline" juga bahasa sehari-hari CT ("good timeline", "bad timeline"). Nama kerja EITHER dan Timeline Hook dibatalkan.

| Kandidat | Status | Bukti |
| --- | --- | --- |
| EITHER | Dipakai: Eitherway (EITHER), AI app builder + launchpad, kapitalisasi sekitar $9,7 juta | [CoinGecko](https://www.coingecko.com/en/coins/eitherway), [CoinMarketCap](https://coinmarketcap.com/currencies/eitherway/) |
| WhatIf | Dipakai: token What IF (IF), kapitalisasi sekitar $17,5 juta per Juli 2026 | [BeInCrypto](https://beincrypto.com/price/what-if-3/) |
| Two Worlds | Mirip: 2Worlds, game VR Web3 | [2Worlds docs](https://2worlds.gitbook.io/2worlds-documentation) |
| **Quantum Timeline Hook / QTimeline** | Tidak ditemukan proyek dengan nama ini dalam pencarian per 12 Nov 2026 | — |

Ticker sementara: $QTL. Hindari penamaan gaya "QHook" atau "QSimple..." supaya tidak terlihat berafiliasi dengan QHooks. Sebelum dipakai publik, cek handle X dan domain.

## Ringkasan dan kenapa sekarang

**One-liner:** *Every pool, two timelines. Settled with quantum-safe signatures.*

Quantum Timeline Hook adalah hook Uniswap v4 yang membuat **conditional pools**: satu pasangan aset (misalnya ETH/USDC) diperdagangkan di dua timeline untuk satu event nyata. Trader bisa memperdagangkan harga ETH *seandainya* event terjadi, bukan hanya bertaruh YES/NO. Saat event selesai, timeline yang kalah ditutup dan timeline yang menang ditebus 1:1.

**Masalah yang diselesaikan**

- Prediction market hanya menjawab "apakah X terjadi", bukan "berapa harga aset jika X terjadi".
- Prediction market dan DEX hidup terpisah. Likuiditas taruhan tidak bisa dirutekan aggregator seperti pool Uniswap biasa.

**Kenapa sekarang**

- Prediction market mencatat volume $137 miliar dalam 30 hari (10 Okt–8 Nov 2026) ([DeFi Rate](https://defirate.com/prediction-markets/volume/snapshot/2026-11-09T0330/)).
- Event besar ramai diperdagangkan onchain, misalnya tanggal IPO Anthropic di Polymarket dan perps pre-IPO di Hyperliquid ([FourWeekMBA](https://fourweekmba.com/ai-anthropic-perps-trade-13-above-bitgets-103-ipo-estimate/)).
- Uniswap Foundation sendiri mempiloti futarchy lewat Conditional Funding Markets bersama Butter ([Uniswap Foundation](https://www.uniswapfoundation.org/conditional-funding-markets)).

## Cara kerja

Satu kolateral dipecah menjadi dua token kondisional, dan setiap timeline punya pool v4 sendiri; hook melakukan pecah dan gabung di dalam swap.

1. **Buat market.** Kreator menetapkan event ("Fed menaikkan suku bunga di rapat berikutnya?"), sumber resolusi, batas waktu, dan pasangan dasar (ETH/USDC). Kreator memasang bond.
2. **Split.** 1 USDC dipecah menjadi 1 USDC-YES + 1 USDC-NO; 1 ETH menjadi 1 ETH-YES + 1 ETH-NO. Invariant: YES + NO selalu bisa digabung kembali menjadi 1 kolateral.
3. **Dua pool timeline.** Pool ETH-YES/USDC-YES dan ETH-NO/USDC-NO, keduanya memakai `TimelineHook`. Pool ketiga USDC-YES/USDC-NO memberi harga probabilitas murni.
4. **Swap satu klik.** Pengguna cukup mengirim USDC dan memilih timeline. Hook memecah kolateral, menjalankan swap di timeline itu, dan mengembalikan sisi lawan ke pengguna (atau menjualnya, sesuai pilihan).
5. **Resolusi.** Oracle melaporkan hasil. Token timeline kalah bernilai 0; token timeline menang ditebus 1:1 ke aset asli. LP di timeline menang bisa memindahkan posisinya ke pool biasa.

**Contoh market**

| Market | Yang diperdagangkan | Dibaca sebagai |
| --- | --- | --- |
| ETH/USDC · "Fed menaikkan suku bunga?" | Harga ETH di timeline YES vs NO | Pasar memperkirakan dampak keputusan Fed pada ETH |
| USDC-YES/USDC-NO · event yang sama | Rasio harga YES terhadap NO | Probabilitas implisit event |
| TOKEN/ETH · "Proposal X lolos?" | Harga token proyek di dua timeline | Futarchy: pilih keputusan yang menaikkan harga |

## Inti post-quantum

Aksi paling berharga di Quantum Timeline Hook adalah **resolusi event**: satu tanda tangan menentukan timeline mana yang bernilai 1 dan mana yang 0. Karena itu resolusi, pembuatan market, dan sengketa dikunci kunci post-quantum (PQ), bukan hanya ECDSA.

**Model resolusi quantum-safe**

1. Setiap resolver (komite m-of-n) dan kreator market mendaftarkan kunci publik ML-DSA-44 di `PQKeyRegistry`.
2. Laporan hasil event (`marketId`, hasil, bukti sumber) harus ditandatangani hybrid: ECDSA **dan** ML-DSA-44, oleh minimal m resolver.
3. `ResolutionAdapter` memverifikasi tanda tangan lewat `PQVerifierRouter` sebelum hasil dikunci, lalu masa sengketa berjalan.
4. Sengketa dan fallback multisig juga wajib hybrid. Trader tetap memakai wallet biasa untuk swap dan penebusan.

| Aksi | Pemegang | Tanda tangan |
| --- | --- | --- |
| Buat market | Kreator | Hybrid (ECDSA + ML-DSA-44) |
| Laporkan hasil | Komite resolver (m-of-n) | Hybrid per resolver |
| Ajukan sengketa | Siapa pun dengan bond | ECDSA (bond sebagai jaminan) |
| Putuskan sengketa, fallback | Multisig + timelock | Hybrid per signer |
| Swap, split/merge, penebusan | Pengguna | Tidak berubah (wallet biasa) |

**Verifikasi di EVM hari ini**

- EVM belum punya precompile PQ. Verifier Solidity standar NIST menghabiskan sekitar 1,2 juta gas untuk ML-DSA-44 ([arXiv 2611.08108](https://arxiv.org/html/2611.08108)). Usulan precompile (EIP-8051, EIP-8052) masuk C-tier di daftar Hegotá 7 Sep 2026, jadi jangan ditunggu ([AppliedPQC](https://github.com/AppliedPQC/pqc-research/issues/35)).
- Resolusi hanya terjadi sekali per market, jadi biaya beberapa juta gas untuk m tanda tangan masih masuk akal di L2. Angka pastinya diukur di testnet.
- Skema: **ML-DSA-44** (FIPS 204, final). Falcon (FN-DSA) lebih kecil tapi FIPS 206 masih draft ([Wikipedia: NIST PQC](https://en.wikipedia.org/wiki/NIST_Post-Quantum_Cryptography_Standardization)).
- `PQVerifierRouter` append-only: adapter precompile bisa ditambah nanti lewat PQ multisig + timelock; verifier lama tidak bisa dihapus, dan router tidak pernah menyentuh kolateral.

**Batas klaim:** yang quantum-safe adalah resolusi dan otoritas market, bukan wallet pengguna. Narasi yang jujur: *"No quantum computer can forge the outcome."*

## Peta kompetitor

Prediction market berbasis hook v4 sudah dicoba di hackathon, tapi yang kami temukan belum ada produk live yang membuat **pool aset kondisional** yang bisa dirutekan seperti pool Uniswap biasa.

| Proyek | Yang dilakukan | Status | Beda dengan Quantum Timeline Hook |
| --- | --- | --- | --- |
| [Predict](https://ethglobal.com/showcase/predict-77f7b) | Satu pool v4 per market, pasangan token YES/NO, metadata di ENS | Hackathon (HackMoney 2026) | Hanya taruhan YES/NO, bukan harga aset per timeline |
| [ClawLogic](https://ethglobal.com/showcase/clawlogic-qxfj4) | Prediction market hook yang hanya bisa dipakai agent terdaftar | Hackathon | Tertutup untuk manusia; CPMM di dalam hook |
| [declareindependence](https://ethglobal.com/showcase/declareindependence-ph36w) | Conditional tokens (Gnosis) + FPMM sebagai hook v4 | Hackathon | Paling dekat secara teknis; belum ada split/merge di dalam swap untuk pasangan aset |
| [Butter CFM](https://www.uniswapfoundation.org/conditional-funding-markets) | Futarchy untuk memilih penerima grant | Pilot dengan Uniswap Foundation | Khusus tata kelola grant, bukan pasar terbuka |
| [Pubhouse](https://github.com/fewwwww/awesome-uniswap-hooks) | Pasar token prediksi untuk keyakinan apa pun | Terdaftar di awesome-uniswap-hooks | Token prediksi, bukan timeline aset |
| Polymarket, Kalshi | Kontrak event biner | Live, volume terbesar | Tidak terhubung ke likuiditas Uniswap; tidak ada harga aset kondisional |

## Arsitektur dan kontrak

Satu setoran dipecah hook menjadi dua timeline; setelah oracle menyelesaikan event, hanya timeline pemenang yang bisa ditebus.

&#91;embedded content: Timeline Hook · dari setoran ke penebusan\]

Pool ketiga (USDC-YES/USDC-NO) berjalan berdampingan untuk harga probabilitas murni.

| Kontrak | Tugas |
| --- | --- |
| `ConditionalVault` | Mengunci kolateral, mint dan burn token YES/NO (ERC-1155 atau ERC-20 wrapper), penebusan setelah resolusi |
| `TimelineHook` | Hook v4: split/merge kolateral di dalam swap (`beforeSwap` + return delta), menolak swap setelah batas waktu event |
| `MarketFactory` | Membuat market: event, oracle, batas waktu, bond; deploy tiga pool sekaligus |
| `ResolutionAdapter` | Antarmuka ke oracle utama + fallback multisig dengan timelock |
| `TimelineRouter` | Swap satu klik dari USDC/ETH biasa ke posisi timeline, dan kembali |

Karena hook ini memakai return delta untuk split/merge, kode `TimelineHook` adalah bagian paling berisiko dan wajib diaudit lebih dulu.

Kontrak tambahan untuk inti post-quantum: `PQKeyRegistry` (kunci publik ML-DSA kreator, resolver, dan signer multisig) dan `PQVerifierRouter` (verifier append-only). `ResolutionAdapter` hanya menerima laporan hasil yang lolos verifikasi hybrid.

## Oracle, resolusi, dan risiko

Risiko terbesar Quantum Timeline Hook ada di resolusi event, bukan di AMM. MVP memakai market yang dikurasi dengan sumber resolusi yang jelas.

| Opsi oracle | Cocok untuk | Kelemahan |
| --- | --- | --- |
| Optimistic oracle (misalnya UMA) | Event dunia nyata (keputusan Fed, tanggal IPO) | Ada masa sengketa; resolusi bisa tertunda |
| Data feed (misalnya Chainlink) | Event berbasis angka (harga, suku bunga yang dipublikasi) | Hanya untuk data yang tersedia sebagai feed |
| Komite multisig + timelock | Fallback jika oracle utama gagal atau event ambigu | Butuh kepercayaan; harus transparan dan terbatas |

**Aturan resolusi wajib di setiap market:** sumber resmi, zona waktu, definisi tepat, dan hasil jika event dibatalkan (misalnya kedua timeline ditebus 0,5).

| Risiko | Skenario | Mitigasi |
| --- | --- | --- |
| Oracle dimanipulasi | Hasil salah dilaporkan untuk market besar | Bond + masa sengketa; cap likuiditas per market di awal |
| Event ambigu | Pertanyaan bisa dibaca dua cara | Template pertanyaan yang dikurasi; aturan pembatalan |
| Likuiditas terpecah | Dua timeline + pool dasar memecah LP | Insentif LP per market; seed likuiditas dari treasury |
| Bug akuntansi split/merge | YES + NO tidak lagi setara 1 kolateral | Invariant test dan audit; fungsi split/merge sesederhana mungkin |
| Regulasi | Prediction market diatur ketat di beberapa negara | Konsultasi hukum sebelum mainnet; pertimbangkan geo-restriksi di frontend (bukan nasihat hukum) |

**Invariant wajib:** total kolateral terkunci = total pasangan YES+NO beredar; setelah resolusi, hanya token pemenang yang bisa ditebus, dan tidak pernah lebih dari kolateral yang ada.

## Model pendapatan dan token di Pons

Protokol mendapat bagian kecil dari setiap aliran kolateral dan dari pembuatan market.

| Sumber | Mekanisme | Nilai awal (untuk diuji) |
| --- | --- | --- |
| Fee split/merge | Dipotong saat kolateral dipecah atau digabung di dalam swap | 0,10% |
| Bagian swap fee | Protokol mengambil porsi kecil dari fee LP di pool timeline | 10% dari fee LP |
| Pembuatan market | Biaya flat + bond kreator (bond kembali jika market selesai bersih) | Ditetapkan per kategori event |
| Resolusi | Bagian dari bond pihak yang kalah dalam sengketa | Fase 2 |

**Token $QTL (ticker sementara) di Pons**

- Token yang di-launch lewat Pons memakai hook milik Pons, jadi pool Quantum Timeline Hook berdiri terpisah dari pool graduation token itu.
- Kegunaan: bond kreator market dengan diskon, bagian pendapatan protokol (buyback atau distribusi), dan voting kurasi market di fase 1.
- Market pertama sebaiknya event yang sedang ramai di CT saat launch, supaya token dan produk diperkenalkan bersamaan.

## MVP, tahapan, dan kriteria lulus

MVP: satu market yang dikurasi, satu pasangan dasar (ETH/USDC), resolusi lewat satu oracle + fallback multisig.

1. **Fase 1: Market kurasi (MVP).** `ConditionalVault` (split/merge), `TimelineHook`, tiga pool (YES, NO, probabilitas), resolusi, penebusan, dan frontend satu klik. Testnet, lalu mainnet dengan cap kolateral.
   - Gate: invariant kolateral lulus, audit pertama selesai, satu market testnet diselesaikan dan ditebus penuh.
2. **Fase 2: Market permissionless.** Siapa pun bisa membuat market dengan bond, template pertanyaan, dan alur sengketa.
   - Gate: audit alur sengketa, minimal 5 market mainnet selesai tanpa insiden.
3. **Fase 3: Ekspansi.** Market skalar (misalnya "berapa suku bunga"), vault LP otomatis lintas timeline, dan integrasi aggregator.
   - Gate: data volume dan kedalaman likuiditas fase 2 dipublikasikan.

**Kriteria lulus MVP**

- [ ] Swap satu klik dari USDC ke posisi timeline berhasil dalam satu transaksi.
- [ ] YES + NO selalu bisa digabung kembali menjadi kolateral sebelum resolusi.
- [ ] Setelah resolusi, token pemenang ditebus 1:1 dan token kalah tidak bisa ditebus.
- [ ] Event dibatalkan → aturan pembatalan berjalan sesuai yang tertulis di market.
- [ ] Dashboard menampilkan harga aset di kedua timeline dan probabilitas implisit.

**Stack:** Solidity + Foundry (v4-core, v4-periphery, OpenZeppelin uniswap-hooks), kerangka conditional tokens (Gnosis CTF atau implementasi ERC-1155 sendiri), adapter oracle, indexer, Next.js dashboard.

## Pertanyaan terbuka dan sumber

- [ ] Oracle utama untuk MVP: optimistic oracle atau data feed? Tergantung jenis event pertama.
- [ ] Chain pertama: Robinhood Chain, Base, atau Elysium (Uniswap mendukung hook v4 di Elysium)?
- [ ] Kerangka token kondisional: pakai Gnosis CTF yang sudah teruji, atau ERC-1155 sendiri yang lebih ringan?
- [ ] Status hukum prediction market di yurisdiksi tim dan target pengguna.
- [ ] Ketersediaan nama: handle X, domain, dan ticker.

* [ ] Siapa komite resolver awal, berapa m-of-n, dan di mana kunci PQ mereka disimpan? Wallet umum belum mendukung ML-DSA.
* [ ] Verifier ML-DSA mana yang dipakai dan berapa gas nyatanya di chain target?

**Sumber** (diakses 12 Nov 2026)

- [DeFi Rate: volume prediction market 30 hari](https://defirate.com/prediction-markets/volume/snapshot/2026-11-09T0330/)
- [FourWeekMBA: Anthropic perps dan market IPO di Polymarket](https://fourweekmba.com/ai-anthropic-perps-trade-13-above-bitgets-103-ipo-estimate/)
- [Uniswap Foundation: Conditional Funding Markets](https://www.uniswapfoundation.org/conditional-funding-markets)
- [ETHGlobal: Predict](https://ethglobal.com/showcase/predict-77f7b), [ClawLogic](https://ethglobal.com/showcase/clawlogic-qxfj4), [declareindependence](https://ethglobal.com/showcase/declareindependence-ph36w)
- [awesome-uniswap-hooks](https://github.com/fewwwww/awesome-uniswap-hooks)
- [KuCoin: Uniswap mendukung hook v4 di Elysium](https://www.kucoin.com/news/flash/uniswap-to-support-v4-hooks-on-elysium-hyperliquid-l2-project)
- [Uniswap docs: Hooks](https://docs.uniswap.org/contracts/v4/concepts/hooks)
- [CoinGecko: Eitherway](https://www.coingecko.com/en/coins/eitherway)
