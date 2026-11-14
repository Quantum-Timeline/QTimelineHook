# QTimeline — Implementation Plan

**Target** · Satu rilis final sebelum token `$QTL` live di Pons  
**Jaringan** · Robinhood Chain Mainnet `4663`  
**Stack** · Next.js App Router + TypeScript, Solidity + Foundry, Uniswap v4, GitHub Actions  
**Acuan produk** · *Quantum Timeline Hook — Developer Brief* dan keputusan diskusi. Dokumen ini menetapkan pilihan implementasi ketika brief masih memuat opsi.  
**Status** · Spesifikasi final untuk coding. Verifikasi sumber primer diperbarui 13 November 2026. Aktivasi mainnet mengikuti checklist bukti di §9.3.

## 1. Keputusan final

| Area | Keputusan |
|---|---|
| Produk | Tiga pool mainnet dengan aset asli. Pool ETH-YES dan ETH-NO mendukung beli serta jual. Pool ketiga mendukung beli dan keluar dari posisi YES/NO. |
| Aset | Market pertama memakai ETH native dan USDG. Factory menerima pasangan dari daftar aset yang ditetapkan saat deploy. Untuk rilis ini daftar asetnya ETH dan USDG, dengan USDG sebagai aset pembayaran. Pasangan dikunci per market. |
| Market awal | Core PCE AS bulanan `≥ 0,3%`. Kandidat yang disepakati adalah periode Oktober 2026 jika rilis 25 November masih bisa diikuti. Aturan pemilihan periode pengganti ada di §2. |
| Trading | Tiga pool Uniswap v4 dengan fee swap **0,30%** dan tanpa fee tambahan QTimeline. Split, merge, dan klaim gratis dari sisi protokol. Gas jaringan dibayar terpisah. |
| Modal | Kas proyek mengisi ketiga pool. Patokan kedalaman pembukaan **$5** per arah, dengan dampak harga maksimal **1% sebelum fee**. Estimasi kerja **120 USDG + ekuivalen sekitar $53 dalam ETH**, total sekitar **$173** jika USDG bernilai $1. Hitung ulang dari harga, ticks, dan quote nyata saat seeding. |
| Resolusi | Satu bot melaporkan angka resmi BEA. Kontrak menerapkan ambang setelah **ECDSA dan ML-DSA-44** sama-sama lolos. Dua wallet operasional, deployer dan bot. |
| Cutoff dan batal | Swap tutup lima menit sebelum rilis resmi terjadwal. Tenggat laporan 48 jam dari jadwal rilis. Setelah tenggat, market tanpa laporan valid dapat dibatalkan oleh siapa saja. Payout batal 50% per outcome. |
| Token | QTimeline live sebelum `$QTL` terbit. Setelah alamat token terverifikasi, deployer mengikatnya sekali. Pemegang token memilih satu event lanjutan lewat voting yang sudah termasuk di rilis final. |
| Hosting | Satu build statis Next.js. Konfigurasi Vercel Hobby disiapkan. Untuk publikasi kampanye token, target gratis yang dipilih adalah **Cloudflare Pages Free**, dengan pemeriksaan kelayakan akun dan penggunaan sebelum deploy. Vercel membatasi Hobby untuk penggunaan personal/nonkomersial. Kampanye yang mengarahkan pengunjung untuk memperdagangkan token dengan tujuan finansial masuk definisi penggunaan komersial Vercel. |
| Infrastruktur | GitHub Actions Free untuk CI dan bot. RPC Alchemy Free. Frontend membaca chain langsung. Data market dan klaim bersumber dari kontrak. |

**Perubahan terhadap brief.** Gunakan vault khusus dengan token outcome ERC-20 dan ETH native, router untuk split/swap/merge, serta hook untuk penegakan lifecycle. Ganti komite, multisig cadangan, dan alur sengketa dengan resolver otomatis tunggal dan jalur batal deterministik. Hilangkan fee split/merge, bagian fee tambahan untuk protokol, bond kreator, buyback, dan distribusi pendapatan token. Kewenangan membuat market terbatas ke deployer. Voting memilih satu market lanjutan dari dua opsi yang sudah ditetapkan.

[Vercel Terms §4](https://vercel.com/legal/terms) · [Vercel Fair Use](https://vercel.com/docs/limits/fair-use-guidelines) · [Cloudflare Pages untuk Next.js statis](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/) · [Cloudflare Self-Serve Terms](https://www.cloudflare.com/terms/)

## 2. Spesifikasi event dan lifecycle

Parameter seperti ambang **30 bps**, waktu **5 menit / 48 jam**, fee **0,30%**, cap vault, dan jumlah kandidat voting adalah keputusan produk. Jadwal, alamat token, perilaku Uniswap, format data dan kompatibilitas toolchain diperiksa terhadap sumber resmi. Status pengujian masing-masing ada di §10.

Pertanyaan publik **“Apakah Core PCE AS bulan Oktober 2026 naik minimal 0,3% dibanding September?”** Gunakan angka bulanan yang dicetak pada rilis pertama BEA *Personal Income and Outlays, October 2026*. Ambil baris `PCE price index excluding food and energy` pada tabel perubahan dari bulan sebelumnya, kolom Oktober. Angka tahunan, headline PCE, proyeksi, dan revisi publikasi selanjutnya tidak dipakai. Bandingkan angka terbitan dalam basis points bertanda, tanpa floating point atau pembulatan kedua. Nilai `0,3%` menjadi `30` bps dan masuk YES. Nilai di bawah `30` masuk NO.

| Waktu untuk kandidat Oktober | WIB | UTC | Unix detik |
|---|---|---|---:|
| Cutoff seluruh swap | 25 Nov 2026 20.25 | 25 Nov 2026 13.25 | 1795613100 |
| Rilis terjadwal / laporan paling awal | 25 Nov 2026 20.30 | 25 Nov 2026 13.30 | 1795613400 |
| Tenggat laporan / batal paling awal | 27 Nov 2026 20.30 | 27 Nov 2026 13.30 | 1795786200 |

Buka market setelah kontrak, modal, bot, dan frontend lolos verifikasi. Factory hanya menerima aktivasi jika masih tersedia **minimal 24 jam trading** sebelum cutoff, dihitung dari waktu yang lebih akhir antara aktivasi dan `opensAt`. Jika kandidat Oktober kelewat, pakai **rilis Core PCE bulanan pertama berikutnya yang memenuhi jendela tersebut** dengan aturan angka yang sama. Jadwal BEA mencantumkan periode November pada 23 Desember 2026. Periksa lagi kalender BEA sebelum menandatangani konfigurasi. Saat market aktif, konfigurasi periode dan waktu tidak dapat diubah. Rilis yang terlambat dapat diterima selama masih di dalam tenggat. Jika BEA mengumumkan perubahan jadwal sebelum aktivasi, buat manifest dengan jadwal terbaru. Jika jadwal berubah setelah aktivasi, pertahankan cutoff awal dan ikuti aturan tenggat yang sudah dipublikasikan. Jadwalkan ulang kandidat berikutnya jika rilis dipindah ke waktu yang membuat market tidak layak dibuka.

| Status | Kondisi | Aksi pengguna |
|---|---|---|
| Draft | Market dan pool dibuat, belum diaktivasi | Treasury dapat split untuk seeding, merge, serta menarik likuiditas. |
| Scheduled | Sudah diaktivasi, `timestamp < opensAt` | Baca konfigurasi. Treasury dapat menarik likuiditas atau merge. Swap, split, dan penambahan LP menunggu waktu buka. |
| Open | Aktif dan `opensAt <= timestamp < cutoffAt` | Split, merge, swap, dan kelola likuiditas. |
| Awaiting result | Sudah diaktivasi dan `cutoffAt <= timestamp < deadline`, belum final | Merge pasangan klaim yang seimbang dan tarik likuiditas. Swap dan split ditutup. |
| Final YES / NO | Laporan valid diterima pada `releaseAt <= timestamp < deadline` | Tebus sisi pemenang 1:1. LP tarik posisi dan tebus token yang diterima. |
| Cancellation available | Sudah diaktivasi dan `timestamp >= deadline`, hasil masih kosong | Siapa saja bisa panggil `cancelExpired(marketId)`. Frontend menampilkan aksi batal. |
| Cancelled | Pembatalan tercatat di chain | Tebus setiap outcome sebesar 50%. Gabungkan jumlah YES/NO yang sama untuk tebus 100% aset dasar. |

**Batas transisi.** Konfigurasi wajib memenuhi `opensAt < cutoffAt < releaseAt < deadline`, dengan `cutoffAt = releaseAt - 300` dan `deadline = releaseAt + 172800`. Laporan hasil hanya untuk market yang pernah diaktivasi. Deployer dapat memanggil `discardDraft(id)` sebelum aktivasi. Siapa pun dapat memanggilnya ketika jendela trading minimum 24 jam sudah mustahil dipenuhi. Draft yang ditutup berhenti menerima split dan penambahan likuiditas, dengan jalur tarik LP dan merge lengkap tetap tersedia. Split Draft dibatasi untuk treasury, jadi tes wajib memastikan seluruh klaim seeding dapat ditarik dan digabung kembali. Draft yang ditutup tidak menghabiskan slot market publik. Slot dihitung ketika aktivasi berhasil. Market aktif tetap mengikuti jalur laporan atau batal di tabel.

**Contoh payout.** Setelah membeli ETH-YES, user memegang hasil swap dan klaim USDG-NO. Kalau YES, user tebus ETH. Kalau NO, user tebus USDG yang masih dipegang. Kalau batal, user menebus separuh ETH-YES dan separuh USDG-NO. Posisi yang diperdagangkan sebelumnya tetap mengikuti saldo aktual di wallet.

[Kalender BEA](https://www.bea.gov/news/schedule/) · [Contoh tabel resmi Core PCE](https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026)

## 3. Repositori dan lingkungan

Gunakan satu repositori GitHub dan pin versi toolchain, dependency, compiler, serta commit dependency Solidity. Node.js 24 LTS untuk Next.js, skrip dan bot. Gunakan `pnpm` dengan lockfile, dan Foundry dengan versi yang mendukung konfigurasi EVM verifier. Buat profil compiler terpisah bila verifier memerlukan pengaturan upstream yang berbeda dari kontrak aplikasi. Verifikasi bytecode hasil compile di target chain.

| Path | Isi |
|---|---|
| `apps/web/` | Next.js, wagmi, viem, UI trading, posisi, klaim, voting dan link Pons |
| `contracts/src/` | Vault, factory, hook, router, settlement, token outcome, voting |
| `contracts/script/` | Deploy, registrasi kunci, buat market, seed pool, aktivasi dan pengikatan QTL |
| `contracts/test/` | Unit, fuzz, invariant, integrasi v4, fork dan deployment smoke test |
| `packages/chain/` | ABI hasil build, tipe, encoding laporan, konfigurasi chain dan deployment |
| `ops/resolver/` | Pengambilan data BEA, parser, evidence manifest, signer dan pengiriman |
| `ops/market/` | Manifest event, calon voting, kalkulasi seeding dan pemeriksaan deployment |
| `.github/workflows/` | `ci.yml` dan `resolve-markets.yml` |
| `deployments/` | Manifest per chain dengan alamat, block deployment, commit, hash bytecode dan gas aktual |

Alamat kontrak awal di Robinhood Mainnet:

| Kontrak atau aset | Alamat |
|---|---|
| PoolManager v4 | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| PositionManager v4 | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| Quoter v4 | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| ETH native | Gunakan representasi native pada vault dan viem. Outcome ETH memakai token ERC-20 tersendiri. |

Skrip deploy wajib memeriksa `chainId`, bytecode, dan ABI. Paxos dan Robinhood mencantumkan alamat USDG yang sama. Di fork, cocokkan bytecode atau proxy, cek simbol, decimals, saldo, transfer, dan jalur klaim. USDG punya risiko kebijakan penerbit dan ketersediaan transfer. Tampilkan error yang dapat ditindaklanjuti saat aset tidak bisa ditransfer dan pertahankan saldo klaim sampai pengguna bisa menebusnya. Tentukan alamat testnet dari deployment resmi yang benar-benar tersedia. Jika periphery atau core v4 resmi belum tersedia di Robinhood Testnet `46630`, deploy core/periphery versi yang dipin sendiri untuk pengujian dan catat alamatnya. Fork mainnet tetap memakai alamat resmi. Token USDG testnet boleh berupa ERC-20 uji dengan decimals identik.

[Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments) · [Robinhood token contracts](https://docs.robinhood.com/chain/contracts/) · [Paxos USDG mainnet](https://docs.paxos.com/guides/stablecoin/usdg/mainnet) · [Paxos stablecoin terms](https://www.paxos.com/terms-and-conditions/stablecoin-terms-conditions) · [Robinhood network dan RPC](https://docs.robinhood.com/chain/connecting/)

## 4. Kontrak Solidity

Deploy kontrak aplikasi tanpa proxy. Untuk menghindari ketergantungan constructor melingkar, deploy registry market dan konfigurasi global lebih dulu. Hook, router, adapter, dan voting membaca registry yang sama. Sambungkan alamat factory dan modul dalam satu bootstrap sekali pakai, verifikasi kode dan konfigurasi, lalu segel wiring sebelum factory menerima pembuatan market. Tes deployment dari state kosong dan tolak penulisan ulang setelah segel. Kunci pelapor, verifier, pasangan aset, cutoff, ambang, dan payout dibekukan ketika market dibuat. Karena waktu cutoff berbasis jadwal yang dipublikasikan, monitor kalender menjelang aktivasi dan jelaskan bahwa perubahan jadwal atau publikasi yang dipercepat setelah aktivasi dapat memengaruhi kondisi perdagangan. Deployer tidak memiliki fungsi untuk menarik kolateral pengguna, mengganti hasil, atau menonaktifkan penebusan. Modal LP tetap dikelola melalui kepemilikan posisi Uniswap.

| Kontrak | Tanggung jawab dan antarmuka |
|---|---|
| `MarketFactory` | `createMarket(config, ecdsaSig, pqSig)`, `activateMarket(id)`, registry `marketId → config/vault/poolIds`. Hanya deployer membuat dan mengaktifkan market. Batasi dua market publik, dengan satu market Open atau menunggu hasil pada satu waktu. Market kedua wajib cocok dengan opsi voting yang menang. Draft yang tidak jadi dibuka dapat dibatalkan oleh deployer atau kedaluwarsa sesuai §2. |
| `ConditionalVault` | Satu instance per market. `split(asset, amount, recipient)`, `merge(asset, amount, recipient)`, `redeem(asset, outcome, amount, recipient)`. Gunakan saldo integer unit terkecil dan dua supply per aset. |
| `OutcomeToken` | Empat ERC-20 per market. Masing-masing mewakili ETH-YES, ETH-NO, USDG-YES, USDG-NO. Decimals mengikuti aset dasar. Hanya vault bisa mint atau burn. |
| `TimelineHook` | `beforeInitialize` mengizinkan factory dan tiga PoolKey terdaftar. `beforeSwap` menegakkan status Open untuk ketiga pool, termasuk panggilan langsung ke PoolManager. `beforeAddLiquidity` mengizinkan seeding Draft dan penambahan saat Open. Remove liquidity tetap tersedia. Return delta bernilai nol. |
| `TimelineRouter` | `tradeConditional` untuk beli/jual ETH bersyarat, `buyOutcome` dan `sellOutcome` untuk pool 3, serta jalur menutup posisi bersyarat. Router mengurus split, swap dan merge atomik, batas harga, penerima, refund, serta settlement. |
| `PQKeyRegistry` | Hubungkan alamat ECDSA deployer dan bot ke prepared public-key blob ML-DSA-44. Registrasi saat bootstrap. Simpan fingerprint key dan bytecode hash. Config market menunjuk key yang sudah ditetapkan. |
| `ResolutionAdapter` | `reportValue(report, evidenceJson, ecdsaSig, pqSig)`, `cancelExpired(id)`, `getStatus(id)`. Memverifikasi laporan, menghitung outcome, menyimpan bukti, dan menyediakan status ke vault serta hook. Kedua fungsi transisi terminal idempoten dari sisi pemanggil melalui status atau revert yang dapat dibedakan. |
| `QTLVoting` | `bindToken`, `configureElection`, `deposit`, `withdraw`, `vote`, `finalizeElection`. Pengikatan token sekali. Dua opsi tetap per pemilihan dengan bobot dari escrow. Satu voting pengganti dapat dibuka jika jadwal pemenang kedaluwarsa. |

### 4.1 Vault dan aturan dana

- Minta jumlah positif dan penerima valid. ETH native harus sesuai `msg.value`. Jalur ERC-20 menerima `msg.value == 0`, memakai SafeERC20, dan memeriksa delta saldo masuk sama dengan jumlah yang diminta. Dukung token dengan transfer nominal standar dari daftar aset tetap.
- Split menambah kolateral tercatat dan mencetak dua klaim dengan jumlah sama. Izinkan split untuk kas proyek saat Draft dan untuk semua pengguna saat Open. Merge tersedia sejak Draft hingga sebelum resolusi. Merge membakar jumlah YES dan NO yang sama lalu membayar aset dasar. Setelah YES/NO, hanya sisi pemenang memperoleh payout. Setelah Cancelled, redeem satu sisi membayar `amount / 2` dibulatkan ke bawah per aset dan merge pasangan lengkap tetap bayar penuh.
- Gunakan accounting terpisah per aset dan per market. Cek kapasitas sebelum mint. Tetapkan cap awal per vault **0,10 ETH** dan **500 USDG** kolateral aktif, termasuk seed dan setoran pengguna. Cancel, merge, redeem, serta penarikan LP tetap tersedia saat cap tercapai.
- Vault hanya membakar saldo milik pemanggil. Router menarik tiket dengan persetujuan pemilik, lalu merge atas saldo yang sudah dimilikinya. Pemanggil boleh menentukan penerima yang valid. Untuk batal, UI menggabungkan pasangan lengkap dulu agar dua tiket unit terkecil bisa dicairkan bersama. Tampilkan hasil pembulatan sebelum konfirmasi. Catat kewajiban berdasarkan supply dan payout yang berlaku. Sebelum final, supply YES harus sama dengan supply NO dan dana tercatat menutup nilai satu set lengkap. Sesudah final, gunakan supply sisi pemenang. Untuk pembatalan, gunakan batas atas kewajiban dari total supply kedua sisi dan pastikan payout aktual dengan pembulatan ke bawah tetap terdanai. Saldo aset aktual wajib menutup kewajiban. Donasi paksa dan pembulatan bukan dana yang boleh diambil admin. Gunakan checks-effects-interactions dan proteksi reentrancy untuk entry point yang memindah aset.
- Bayar LP melalui pelepasan posisi Uniswap. Posisi treasury tetap milik wallet deployer yang mewakili kas proyek. Treasury mempertahankan posisi awal sampai cutoff sebagai aturan operasional. PositionManager standar tetap memberi pemilik posisi kendali untuk menarik likuiditas. Kedalaman bergantung pada rentang aktif.

### 4.2 Pool dan rute pengguna

Buat tiga PoolKey dengan currency terurut, fee LP `3000` (0,30%), dan tick spacing `60`. Uniswap v4 memiliki kontrol protocol fee sendiri. Baca fee efektif dari state/quote pool saat pemeriksaan rilis dan tampilkan estimasi biaya swap aktual di UI. QTimeline tidak mengambil potongan tambahan dari fee LP. Gunakan hook address dengan permission bits sesuai callback, deploy via CREATE2, dan cocokkan alamat serta bits di skrip dan tes. Registrasikan PoolKey pada factory sebelum inisialisasi. Kontrak boleh menginisialisasi seluruh pool sebelum memasukkan modal. Aktifkan market setelah ketiga posisi awal terisi dan lulus quote pembukaan yang disimulasikan.

| Aksi | Urutan eksekusi |
|---|---|
| Beli ETH bersyarat | Split USDG. Swap USDG sisi terpilih menjadi ETH sisi yang sama. Kirim hasil ETH bersyarat dan seluruh USDG sisi lawan ke user. |
| Jual ETH bersyarat | Split ETH. Swap ETH sisi terpilih menjadi USDG sisi yang sama. Kirim hasil USDG bersyarat dan seluruh ETH sisi lawan ke user. |
| Beli YES/NO | Split USDG. Swap semua tiket lawan ke tiket pilihan. Kirim tiket pilihan awal ditambah hasil swap. |
| Jual posisi YES/NO | Swap sebagian tiket yang dipegang ke sisi lawan, merge pasangan yang cocok, dan kirim USDG serta sisa tiket. Frontend menghitung porsi swap dengan pencarian biner integer pada quote dari block yang sama. Untuk input `N` tiket dan porsi swap `x`, hasil merge adalah `min(N - x, quote(x))`. Bandingkan dua kandidat di sekitar titik temu dan pilih payout terbesar. Jika kedalaman membatasi swap, cari batas input yang terisi penuh terlebih dulu. User mengotorisasi jumlah input, minimum USDG kembali, dan toleransi harga. |
| Tutup posisi ETH bersyarat | Swap tiket hasil transaksi kembali ke jenis aset awal pada sisi yang sama. Merge dengan tiket sisi lawan yang diberikan user. Kirim aset hasil merge serta setiap tiket sisa. |

Untuk rute swap gunakan exact input. Jika harga limit atau kedalaman menyebabkan partial fill, revert transaksi dengan pesan yang dapat ditampilkan UI. Validasi `minAmountOut`, `deadline`, penerima, pool registry dan arah swap. Untuk rute dengan merge, ukur minimum hasil dalam aset asli setelah merge. Panggil `PoolManager.unlock` satu kali, terima callback hanya dari PoolManager, lalu settle input dan take output aktual. Semua delta PoolManager harus nol saat callback berakhir. Refund dan transfer memakai delta milik panggilan, sehingga saldo router dari transaksi lain tidak ikut terkirim. ETH untuk rute ini masuk melalui entry point payable atau pembayaran balik vault. Di PoolManager, ketiga pool hanya memperdagangkan ERC-20 outcome.

### 4.3 Hitung modal dan aktifkan market

1. Catat harga referensi ETH/USDG dan waktu pengukuran di manifest. Buka kedua pool ETH pada harga awal yang sama. Buka pool 3 pada rasio YES:NO **50:50**.
2. Mulai dari rentang relatif `[0,80×, 1,25×]` dari harga ETH pembukaan dan rentang probabilitas pool 3 sekitar **35%–65%**. Konversi ke rasio token aktual dan snap ke ticks valid. Masukkan decimals setiap token dan periksa orientasi currency0/currency1.
3. Hitung saldo likuiditas lewat SDK/math Uniswap dan kutip transaksi $5 di dua arah pada setiap pool. Untuk pool 3 ukur rute USDG → tiket dan tiket → USDG, untuk YES dan NO, termasuk langkah split/merge. Gunakan fork lokal dari state Draft dan simulasikan aktivasi serta waktu pembukaan di fork. Quoter on-chain mengikuti hook dan baru bisa mengutip swap ketika market Open. Hitung dampak harga terpisah dari fee swap. Catat estimasi setelah fee untuk UI dan ulangi quote on-chain setelah aktivasi.
4. Gunakan satu split ETH + USDG untuk kedua pool timeline. Setoran USDG tambahan membentuk dua sisi pool probabilitas. Model tanpa fee dengan harga ETH **$1.996**, USDG **$1** dan rentang ideal menghasilkan **52,26 USDG + 0,02618 ETH** untuk split bersama dua timeline dan **66,54 USDG** untuk pool 3, atau **$171,06** dalam model. Anggaran kerja dibulatkan menjadi **53 USDG + ETH setara $53** dan **67 USDG**, total sekitar **$173**. Catat harga referensi, minimum pada setiap arah dan konfigurasi ticks di manifest. Catat jumlah final sebelum treasury menandatangani. Jika estimasi dan quote tidak memenuhi target, perbaiki rentang atau jumlah modal dan ulangi simulasi sebelum aktivasi.
5. Jika harga keluar dari rentang aktif atau quote gagal, tampilkan **likuiditas tidak cukup**. Aksi klaim dan penarikan LP tetap tersedia. Patokan $5 merupakan ukuran transaksi uji, bukan batas nominal per user.

[Uniswap v4 hooks](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks) · [Settlement dan delta v4](https://developers.uniswap.org/docs/protocols/v4/guides/unlock-callback-and-deltas) · [Likuiditas terkonsentrasi](https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity) · [Model virtual reserve](https://app.uniswap.org/whitepaper-v3.pdf) · [Kontrol protocol fee v4](https://github.com/Uniswap/v4-core/blob/main/src/ProtocolFees.sol)

Untuk LP, gunakan PositionManager dengan persetujuan ERC-20 ke Permit2 dan persetujuan Permit2 ke PositionManager. Saat mint, set batas jumlah aset dan deadline. Catat NFT posisi milik treasury. Saat keluar, kurangi likuiditas dan ambil kedua token outcome, lalu pakai jalur klaim vault. Pastikan izin atau proses LP tidak dipakai sebagai syarat user menebus tiketnya. [Dokumentasi PositionManager](https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/overview)

## 5. Resolusi otomatis dan tanda tangan hybrid

**Dua wallet.** Deployer menyiapkan kontrak, mengisi modal, membuka market, mengikat alamat token Pons dan memproses pemenang voting. Wallet bot memiliki ETH untuk gas dan wewenang pelaporan. Deployer dan bot masing-masing memiliki kunci ML-DSA-44 sendiri, sebagai kunci tanda tangan tambahan untuk wallet yang sama. Simpan kunci deployer secara offline. Bot memakai GitHub Actions secrets untuk kunci ECDSA, kunci ML-DSA dan URL RPC. Lindungi branch yang menjalankan signer dan pin Actions ke commit.

**Verifier yang diimplementasikan.** Gunakan kandidat Fireblocks Labs `MLDSA44Verifier` pada commit `cca262b537a5ac2ee55efb427e5c61de0308e566`. Konfigurasi upstream memakai solc `0.8.30`, via IR, optimizer `10000` dan target `osaka`. Deploy helper Keccak, prepared public-key blob untuk tiap signer, dan verifier. Pin alamat verifier serta hash bytecode terkait pada konfigurasi deployment. Siapkan setiap blob secara reproducible dari public key mentah 1.312 byte menggunakan preparer yang dipin. Cocokkan hasil dengan referensi independen dan hash bytecode deploy sebelum mengikatnya ke wallet. Registry hanya menerima binding bootstrap yang telah diverifikasi. Uji proof of possession sebagai tambahan pada pengecekan derivasi blob. Gunakan verifier yang sama sepanjang market berjalan. Benchmark upstream sekitar **1,23 juta gas per verifikasi** dan **4,1 juta gas untuk menempatkan satu blob kunci**. Ukur deploy dan transaksi resolusi utuh di target chain. Kode upstream berstatus riset tanpa audit independen. Masukkan verifier, preparasi kunci, dan integrasi hybrid ke audit sebelum menerima dana pengguna. Hasil pengujian library signer dan pengujian verifier saja belum mencakup keseluruhan sistem resolusi.

### 5.1 Format yang ditandatangani

- EIP-712 domain `name = QTimeline`, `version = 1`, `chainId` dan `verifyingContract` yang sesuai dengan factory atau adapter. Gunakan typed data berbeda untuk pembuatan dan resolusi.
- `CreateMarket(bytes32 configHash,uint256 nonce,uint64 signatureExpiry)` mencakup hash dari ABI encoding konfigurasi penuh. Deployer menandatangani digest dengan ECDSA dan ML-DSA-44. Factory memverifikasi kunci deployer dan nonce sebelum membuat market.
- `ReportValue(bytes32 marketId,bytes32 sourceId,bytes32 periodId,int32 valueBps,bytes32 evidenceHash,uint64 signatureExpiry)`. Tetapkan `sourceId = keccak256(utf8("bea:core-pce:mom:first-release"))` dan `periodId = keccak256(utf8("YYYY-MM"))` dengan string periode kanonik yang sebenarnya. Adapter mencocokkan keduanya dengan config market.
- Kedua algoritma menandatangani **digest EIP-712 yang sama**. Untuk ML-DSA-44 gunakan Pure ML-DSA pada 32 byte digest sebagai message dengan context kosong, sesuai format verifier upstream yang diuji. Pakai encoding signature FIPS 204. Untuk ECDSA gunakan validasi canonical low-s.
- Kontrak memverifikasi ECDSA signer terdaftar, kunci PQ pasangannya, waktu, dan status market. Simpan satu hasil terminal. State update dan event resolusi berada dalam satu transaksi. Alamat pelapor atau relayer tidak menggantikan kedua validasi signature. Salinan laporan yang valid bisa diteruskan oleh siapa saja selama syaratnya masih berlaku.

### 5.2 Bot BEA

1. Baca config market dari RPC dan manifest yang cocok dengan hash on-chain. Abaikan Draft, market final, dan market di luar jendela laporan.
2. Ambil rilis BEA pada origin resmi HTTPS. Cocokkan judul dan periode rilis, identitas tabel perubahan bulanan, baris Core PCE, dan kolom periode target. Validasi nilai angka yang dicetak serta tanda minus. Gunakan URL halaman publikasi khusus periode, di bawah www.bea.gov, dengan URL arsip rilis pertama bila diperlukan. Validasi origin final setelah redirect. Ambil nilai tercetak, bukan hitung ulang dari seri yang sudah diperbarui. Jika sumber belum rilis, struktur ambigu, request gagal, atau periode salah, tahan pengajuan dan coba lagi. Sebelum sign dan broadcast, simpan evidence pertama yang lolos sebagai artefak workflow per market. Beri workflow resolver izin `actions: read` untuk mengambil artefak dari run sebelumnya pada repo yang sama. Gunakan nama artefak deterministik dari chain ID dan market ID, simpan selama minimal tujuh hari, dan catat identitas run. Jika daftar atau arsip gagal dibaca, retry tanpa memilih angka lain. Gunakan expiry tetap sebesar deadline market dan selalu cek status kontrak sebelum mencoba ulang.
3. Simpan evidence JSON berisi URL, periode, label tabel, angka cetak dan SHA-256 respons sumber. Serialisasikan sesuai JSON Canonicalization Scheme (RFC 8785) dan hitung `evidenceHash = keccak256(utf8(canonicalJson))`. Publikasikan evidence yang bisa dicocokkan dengan hash melalui artefak CI dan arsip publik tanpa rahasia. Simpan angka, periode, dan hash pada event on-chain. Sertakan byte JSON kanonik pada calldata `reportValue`, batasi sampai 4 KiB dan cocokkan hash dengan laporan yang ditandatangani. Bukti ringkas tetap bisa diverifikasi dari transaksi publik walau artefak CI kedaluwarsa.
4. Hitung kedua signature, simulasikan `reportValue`, estimasi gas dan kirim. Catat transaction hash serta receipt. Jika jaringan gagal, polling berikutnya cek status on-chain dahulu. Jika transaksi sudah final, berhenti. Jalankan satu workflow resolver pada satu waktu agar pengiriman berulang aman.
5. Gunakan schedule GitHub Actions tiap **15 menit** pada tanggal rilis dan dua hari berikutnya, dengan offset di luar awal jam. Konfigurasi cron per event sebelum membuka market, lalu periksa periode aktif di workflow dan jendela kontrak. Anggarkan maksimal sekitar 288 run per event dan cek kuota gratis repo privat sebelum aktivasi. Gunakan satu job Linux singkat per run, dan jangan batalkan job yang sedang mengirim transaksi. Dengan repo privat, periksa kuota dan tetapkan hard stop tagihan tambahan. Jangan menggantungkan penutupan pool pada jadwal runner. Jika rilis tiba di tengah interval, finalisasi dilakukan pada run yang berhasil berikutnya. Jika GitHub terlambat, kontrak tetap menutup trading sendiri berdasarkan timestamp. Bila tenggat lewat, user bisa membatalkan langsung. Jadwalkan pembatalan dari bot sebagai kemudahan, dengan jalur publik di kontrak.
6. Simpan saldo gas bot terpisah dari modal LP. CI frontend, pull request, dan preview tidak memuat secret signer. RPC key browser dibuat terpisah dari key bot dan diperlakukan sebagai publik. Terapkan allowlist origin jika didukung konfigurasi akun. Perlakukan key browser sebagai publik dan pisahkan dari RPC bot. Saat quote atau simulasi gagal, nonaktifkan swap dan tetap tampilkan alamat kontrak untuk akses langsung.

**Model kepercayaan.** BEA menerbitkan data dan bot proyek melaporkannya. Kontrak memverifikasi otorisasi laporan dan menerapkan ambang. Kedua tanda tangan berada di bawah kendali proyek dan bisa terdampak oleh insiden pada lingkungan bot yang sama. Otorisasi hybrid membuktikan siapa yang menyetujui laporan. Validitas angka BEA tetap bergantung pada bot dan evidence yang bisa diperiksa publik. Frontend menyebut **“Laporan hasil diverifikasi dengan ECDSA dan ML-DSA-44”** agar klaim kriptografi sesuai dengan fungsi yang benar-benar digunakan.

[NIST FIPS 204](https://csrc.nist.gov/pubs/fips/204/final) · [Fireblocks verifier terpin](https://github.com/fireblocks-labs/evm-ml-dsa-verifier/tree/cca262b537a5ac2ee55efb427e5c61de0308e566) · [Catatan keamanan upstream](https://github.com/fireblocks-labs/evm-ml-dsa-verifier/blob/cca262b537a5ac2ee55efb427e5c61de0308e566/docs/SAFETY.md) · [Node.js 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html) · [GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) · [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Alchemy Free](https://www.alchemy.com/pricing)

## 6. Token QTL dan voting

QTimeline live sebelum token Pons terbit. UI menampilkan status token **Belum launch** sampai alamat resmi ditetapkan. Setelah launch, deployer mencocokkan alamat dan jaringan terhadap halaman token serta event deployment factory yang digunakan Pons untuk launch tersebut. Dokumentasi utama Pons mencatat jalur aktif Uniswap v3, dan dokumentasi Pons v2 memuat jalur v4 yang berbeda. Gunakan factory dan link dari launch aktual. Setelah cocok, deployer menjalankan `bindToken(address)` sekali. Frontend membaca alamat itu dari chain dan menampilkan tautan Pons yang diverifikasi. Swap tiga pool pertama tetap menggunakan ETH dan USDG.

Voting memilih **satu dari dua ambang** untuk rilis Core PCE bulanan berikutnya yang memberi waktu persiapan. Kandidat A **minimal 0,2%** dan kandidat B **minimal 0,3%**, dengan periode dan jadwal BEA yang sama. Keduanya harus siap secara konfigurasi sebelum voting dibuka. Simpan hash config dua calon, periode pendaftaran, dan periode voting. Beri pendaftaran **24 jam** dan voting **24 jam**. Pilih periode rilis yang menyisakan minimal 24 jam untuk menyiapkan dan membuka market setelah voting.

- Pemegang QTL mendepositkan jumlah yang ingin dijadikan bobot suara sebelum voting dimulai. Bobot adalah saldo yang sudah dikunci saat voting mulai. Setiap wallet memilih sekali, bobot 1 unit token = 1 unit suara. UI menjelaskan deposit sementara dan waktu tarik kembali.
- Pengguna dapat tarik deposit sebelum voting mulai atau sesudah voting berakhir, termasuk ketika voting kosong atau market kedua tertunda. Token disimpan oleh kontrak voting selama periode voting dan dikembalikan sesuai saldo tiap pengguna.
- Siapa pun dapat memfinalisasi voting sesudah waktu berakhir. Suara terbanyak menang. Jika seri atau total suara nol, pakai kandidat B sebagai default yang sudah diumumkan. Factory memeriksa hash kandidat pemenang ketika deployer membuat market kedua.
- Sediakan modal seed untuk market kedua dan pastikan market pertama sudah terminal sebelum membuka pendaftaran. Factory hanya menerima konfigurasi pemenang yang ditandatangani. Jika jadwal bergeser sehingga jendela 24 jam tidak terpenuhi, tandai voting kedaluwarsa, buka jalur withdraw sesuai waktu yang semula diumumkan, dan izinkan satu voting pengganti untuk periode BEA berikutnya. Perubahan periode wajib lewat voting baru. Batasi satu pemilihan aktif, simpan deposito dan suara per `electionId`, dan hentikan pemilihan baru setelah market kedua diaktivasi. Jika jadwal voting pengganti juga kedaluwarsa, akhiri jalur pembukaan market kedua dan pertahankan penarikan seluruh escrow. Treasury dapat menarik LP market pertama sesudah cutoff dan menebus hasilnya setelah resolusi. Pembukaan market kedua tetap melalui pemeriksaan saldo, quote, dan tenggat. Kedua market dan jalur klaim tampil pada frontend yang sama.

Implementasi escrow dipilih agar perpindahan QTL antar-wallet selama voting tidak menambah bobot suara dan agar snapshot tidak bergantung pada server atau indexer pihak ketiga.

[Pons](https://docs.ponsfamily.com/) · [Dokumentasi Pons v2](https://docs.ponsfamily.com/v2)

## 7. Frontend dan deployment

### 7.1 Layar

| Halaman | Perilaku |
|---|---|
| `/` | Jelaskan dua harga ETH untuk event yang sama, tampilkan status QTL, market aktif dan tautan market terdahulu. |
| `/market/?id=...` | Tampilkan pertanyaan, cutoff, sumber, kondisi YES/NO, dua tab ETH dan satu tab YES/NO, quote, fee, dampak harga, minimum hasil, serta hasil klaim untuk setiap outcome. |
| `/positions/` | Baca saldo token outcome untuk market terdaftar. Tampilkan trade balik, merge, klaim, batal jika eligible, status transaksi dan tautan explorer. |
| `/vote/` | Tampilkan kedua kandidat, jadwal, deposit QTL, bobot, hasil dan withdraw. |
| `/rules/` | Jelaskan bot, dua tanda tangan, aset, biaya, risiko harga, payout batal, dan cara klaim langsung via kontrak jika situs tidak tersedia. |

Gunakan route statis dengan query parameter untuk market ID agar market kedua bisa ditemukan tanpa build baru. Simpan ABI dan alamat factory, hook, router, resolution, dan voting di manifest publik. Baca state, token balances, dan quote via viem. Baca event dalam batch dari block deployment bila perlu. Hindari polling agresif. Perbarui quote saat amount berubah, saat block berubah dalam interval wajar, dan sebelum wallet diminta menandatangani. Simulasikan transaksi, tampilkan revert yang bisa ditindaklanjuti, lalu kirim lewat wallet user. Setelah konfirmasi, gunakan receipt dan refresh saldo. Tampilkan probabilitas dari harga spot pool 3 sebagai estimasi pasar, bersama status likuiditas. Setelah mengoreksi decimals dan orientasi aset, jika `r` adalah jumlah tiket NO per tiket YES, tampilkan `pYES = r / (1 + r)`. Label sebagai estimasi rasio harga, tampilkan data stale atau likuiditas di luar range, dan jangan gunakan rasio itu sebagai syarat kontrak.

### 7.2 Build dan publikasi

- `next.config.ts` memakai `output: 'export'`. Asset statis, routes di atas, dan `next build` menghasilkan `out/`. Hindari SSR, server actions, database, dan scheduler host agar build yang sama portable.
- **Profil Vercel Hobby:** set root `apps/web`, install workspace dengan lockfile, build Next.js dan periksa output. Gunakan profil ini hanya jika deployment memenuhi Terms Hobby atau Vercel memberi izin yang sesuai.
- **Target publik gratis yang dipilih:** Cloudflare Pages Free, connect GitHub, production branch `main`, command build workspace dan output `apps/web/out` dari root repo. Untuk mulai, gunakan domain `pages.dev`. Pastikan syarat provider dan penggunaan yang direncanakan terpenuhi sebelum publish. Deploy publik dan bot produksi memakai config chain `4663`.
- **Preview dan QA:** gunakan artefak CI, localhost, atau deployment test yang diizinkan. Tampilkan chain test dengan label jelas dan pisahkan env, signer, serta manifest dari mainnet.
- Publikasikan ABI, alamat vault, dan instruksi klaim on-chain bersama rilis. Saat marketing berhenti atau frontend diganti, kontrak klaim dan penarikan tetap dapat digunakan. Akses historis dan link explorer tetap tersedia selama situs dipertahankan.

[Next.js static export](https://nextjs.org/docs/app/guides/static-exports) · [Cloudflare Pages build](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/) · [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) · [Vercel Hobby](https://vercel.com/docs/plans/hobby)

## 8. Urutan kerja

| Urutan | Kerjakan | Selesai kalau |
|---|---|---|
| 1 | Bootstrap repositori, lockfiles, CI dan manifest schema | Build frontend statis, compile Solidity, lint dan unit tests lulus. |
| 2 | OutcomeToken, vault dan settlement state machine | Split/merge dan payout YES, NO, batal lulus unit dan invariant. |
| 3 | Hook, factory, router, pool seeding dan quotes | Enam arah perdagangan dasar tersedia. Semua delta settle dan ketiga pool menolak swap setelah cutoff. |
| 4 | Hybrid signing, verifier dan BEA bot | Signature valid end-to-end, input salah ditolak, retry aman, dan gas terukur. |
| 5 | Next.js market, wallet, posisi dan klaim | Browser test memakai kontrak nyata di lingkungan uji. UX menampilkan hasil tiap outcome sebelum konfirmasi. |
| 6 | QTL voting dan registrasi Pons | Pemilih dapat deposit, vote, withdraw, dan hash pemenang mengikat pembuatan market kedua. |
| 7 | Robinhood Testnet, fork mainnet, review dan deployment | Event gimmick berjalan end-to-end. Bukti tes, review, alamat, bytecode, estimasi gas, dan modal seed tercatat. |

## 9. Pengujian dan rilis mainnet

### 9.1 Matriks minimum

- **Vault:** ETH native dan USDG, decimals berbeda, split/merge simetris, cap, transfer invalid, penarikan LP, klaim parsial, pembulatan batal, klaim ganda, dan kewajiban tertutup setelah setiap urutan tindakan. Fuzz pengguna dan market terpisah.
- **Uniswap v4:** arah buy/sell pada pool YES dan NO, posisi YES/NO di pool 3, exit parsial, kondisi di luar rentang, min output, allowance, refund, callback caller, settlement, validasi pool, bootstrap sekali pakai, Draft kedaluwarsa, waktu Scheduled, dan cutoff yang berlaku walau swap langsung lewat PoolManager. LP masih bisa menarik setelah cutoff dan final.
- **Resolusi:** fixture BEA angka bulanan di bawah, tepat, dan di atas 0,3%, periode salah, kolom tahunan, format hilang, retry yang memakai evidence lama, batas calldata evidence, expired, laporan terlalu awal, duplikasi, market/chain/digest berbeda. Uji kombinasi signature benar dan salah dengan vektor ML-DSA-44 NIST dan hasil signer bot.
- **Voting:** pengikatan token sekali, opsi tetap, dana kembali, satu suara per wallet, bobot tetap setelah pendaftaran, hasil seri dan kosong, jadwal kedaluwarsa, pemilihan pengganti, serta konfigurasi market kedua yang cocok dengan hasil voting.
- **Testnet:** jalankan market gimmick “Apakah gue berak sebelum pukul 13.00 WIB pada hari tes?” dengan hasil uji yang diisi sekali sebagai input khusus testnet, lalu diproses bot dan ditandatangani hybrid. Buat run YES, NO, dan batal. Lakukan run tambahan yang membaca fixture rilis BEA historis melalui parser produksi. Gunakan verifier sungguhan dan tiga pool yang benar-benar menjalankan transaksi pada lingkungan uji.
- **Fork Robinhood Mainnet:** pastikan kontrak terhubung dengan USDG dan deployment v4 resmi. Simulasikan deploy verifier, blob key, swap, LP seeding dan penarikan. Catat gas deploy, gas per jenis swap, gas laporan hybrid, gas klaim, dan biaya yang terlihat dari estimasi RPC. Simpan hash bytecode yang diuji.

### 9.2 Runbook produksi

1. Verifikasi rilis BEA, waktu, aset, pool manager, besaran seed, alamat deployer dan bot, kesiapan bot, serta syarat hosting. Selesaikan review hukum publikasi market di yurisdiksi target sesuai brief dan audit awal kontrak sebelum dana pengguna diterima.
2. Deploy kontrak dan publikasikan ABI serta alamat yang sudah diverifikasi. Aktifkan resolver workflow dengan secret produksi dan saldo gas. Lakukan dry run yang memastikan parsing, signing dan simulasi transaksi benar.
3. Buat market dan tiga pool. Seed dari kas proyek, lalu cek quote pembukaan $5 pada masing-masing arah. Publikasikan pertanyaan, payout, cutoff, sumber, dan status token. Aktifkan hanya setelah semua verifikasi rilis lulus.
4. Setelah token Pons terbit, verifikasi CA, bind token, aktifkan link resmi dan voting. Pengikatan alamat adalah setup satu kali oleh deployer. Resolusi setiap event tetap otomatis.
5. Setelah cutoff, cek swap tertutup. Pantau hasil on-chain dan receipt bot. Jika bot gagal sampai tenggat, jalur batal terbuka untuk publik. Setelah final, cek fungsi klaim dan LP withdrawal dari UI dan transaksi langsung.
6. Jika kampanye berhenti, tutup pemasaran sesuai jadwal yang dipilih proyek. Simpan alamat, ABI, bukti resolusi dan instruksi klaim yang bisa digunakan tanpa frontend utama.

**Bukti siap rilis** berupa commit build, manifest deployment, hasil audit yang dipersyaratkan brief, hasil tes, catatan gas, dan hasil quote seeding. Nilai yang bergantung pada waktu deployment diambil dari chain atau sumber resmi dan dimasukkan ke manifest. Dengan demikian coding dapat dimulai dari spesifikasi ini, sementara status siap menerima dana ditentukan oleh bukti rilis tersebut.

### 9.3 Keputusan aktivasi mainnet

| Bukti | Kondisi lulus |
|---|---|
| Integrasi chain | Fork memakai kontrak resmi. Testnet menjalankan tiga pool, hybrid signing dan klaim YES, NO, serta batal. |
| Keamanan | Audit awal mencakup verifier, hook, router, vault, adapter, voting, dan wiring. Temuan kritis atau tinggi ditutup dan perbaikannya diverifikasi sebelum market dibuka. |
| Modal dan biaya | Quote pembukaan memenuhi target $5 pada setiap arah. Gas aktual transaksi resolusi dan saldo bot tercatat. |
| Data dan akses | Jadwal BEA valid, bot lulus dry run, jalur batal serta klaim langsung diuji, dan frontend menunjuk manifest produksi yang tepat. |
| Publikasi | Hosting produksi layak sesuai syarat layanan. Review hukum sesuai brief selesai sebelum pembukaan untuk dana publik. |

Jika salah satu bukti belum tersedia, pertahankan market dalam Draft atau pilih periode BEA berikutnya sesuai §2. Alamat token QTL baru diperlukan untuk link Pons dan voting setelah token benar-benar terbit.

## 10. Bukti riset dan batas verifikasi

Pemeriksaan per **13 November 2026**. Sumber dokumentasi mendukung pilihan implementasi. Hasil lokal mendukung kelayakan teknis komponen yang diuji. Status mainnet mengikuti bukti integrasi §9.

| Komponen | Bukti yang sudah ada | Verifikasi saat coding dan rilis |
|---|---|---|
| Aset dan chain | Robinhood dan Paxos mengonfirmasi alamat USDG yang sama di chain 4663. Robinhood mendokumentasikan ETH sebagai gas, chain testnet 46630, dan ArbOS 61. | Dari RPC ber-API key, baca chain ID, kode USDG, decimals, pool deployments, dan profil biaya. Akses RPC publik dari lingkungan riset ini timeout. Belum ada konfirmasi bytecode atau transaksi live dari sini. |
| Uniswap v4 | PoolManager, PositionManager, dan Quoter cocok dengan daftar deployment resmi Robinhood. Kode core mendokumentasikan bahwa protocol fee dikendalikan terpisah dari fee LP. | Verifikasi bytecode, fee efektif, permission bits hook, dan quote dengan konfigurasi pool yang benar di fork. |
| Rilis Core PCE | Kalender BEA mencantumkan 25 November untuk periode Oktober dan 23 Desember untuk periode November. Rilis September menampilkan Core PCE bulanan **0,3%** dan tahunan **3,1%** pada bagian berbeda. Rilis Juli menampilkan **0,2%** bulanan, contoh yang harus menghasilkan NO. | Uji parser produksi dengan fixture HTML resmi kedua rilis. Simpan URL dan hash fixture. Validasi ulang jadwal dan periode sebelum membuka market. Nilai Core PCE Oktober belum tersedia saat riset. |
| ML-DSA-44 | NIST FIPS 204 dan kode Fireblocks mendukung format Pure ML-DSA-44, context kosong. Commit kandidat dipin dan file Solidity, helper, serta preparer yang diuji cocok dengan hash Git upstream. | Uji dengan vektor NIST, hasil signer produksi, dan derivasi blob independen. Audit kontrak aplikasi, verifier, registrasi key, dan seluruh jalur payout. |
| Infrastruktur | Vercel Hobby terbatas pada personal/nonkomersial. Cloudflare mendokumentasikan deployment Next.js static export dan batas Free. GitHub mendokumentasikan jadwal dapat tertunda atau dilewatkan, serta kuota untuk repo privat. Alchemy mendokumentasikan endpoint Robinhood dan allowlist API key. | Validasi persyaratan layanan dan kelayakan deployment produksi. Uji build `out/`, kuota GitHub Actions/RPC, secret isolation, serta jalur pembatalan ketika scheduler gagal. |

[Robinhood ArbOS](https://docs.robinhood.com/chain/run-a-full-node/) · [Paxos USDG mainnet](https://docs.paxos.com/guides/stablecoin/usdg/mainnet) · [BEA Juli 2026](https://www.bea.gov/news/2026/personal-income-and-outlays-july-2026) · [BEA September 2026](https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026) · [Alchemy allowlist](https://www.alchemy.com/docs/best-practices-when-using-alchemy)

### 10.1 Pengukuran lokal yang berhasil dijalankan

Pengujian menggunakan **Node.js 24.22.1**, **solc 0.8.30** (`73712a01`), dan **Anvil 1.7.1** dengan hardfork Osaka, chain lokal 31337. Konfigurasi compiler memakai via IR dan optimizer 10.000, sesuai upstream. Kunci uji dibuat sementara untuk pengujian.

1. Compile file Solidity dari commit terpin. Verifikasi hash helper, deploy helper dan prepared public-key blob, lalu deploy verifier.
2. Buat tanda tangan dari Node `crypto.sign(null, digest, privateKey)` atas pesan 32 byte. Cek raw public key **1.312 byte** dan signature **2.420 byte**. Panggilan `verify()` menerima signature asli serta menolak pesan yang diubah, signature yang diubah, dan signature yang dipotong.
3. Deploy harness lokal yang memeriksa ECDSA dan ML-DSA-44 atas pesan 32 byte yang sama. Harness menerima kedua tanda tangan valid dan menolak masing-masing kombinasi dengan ECDSA salah atau ML-DSA salah. Ini menguji interoperabilitas dasar. EIP-712, pembekuan config, dan lifecycle market tetap harus diuji di adapter QTimeline.

| Pengukuran | Hasil lokal |
|---|---:|
| Ukuran runtime verifier | 24.032 byte |
| Deploy helper | 4.716.360 gas |
| Deploy satu prepared public-key blob | 4.434.333 gas pada run hybrid |
| Deploy verifier | 5.175.028 gas |
| Estimasi panggilan mandiri `verify()` | 1.289.310 gas pada run hybrid |

Gas lokal di atas mencakup transaksi atau estimasi panggilan mandiri yang diukur oleh Anvil. Benchmark **1.226.311 gas** upstream menghitung bagian verifikasi internal. Biaya total resolusi QTimeline mencakup pemeriksaan ECDSA, penyimpanan hasil, calldata dan komponen biaya Robinhood. Hitung anggaran ETH bot dari pengukuran transaksi penuh di target chain, bukan dari tabel lokal.

### 10.2 Model modal awal yang dihitung ulang

Model menggunakan virtual reserve Uniswap, target dampak harga pembukaan **1%**, dan ukuran transaksi **$5**. Pada pool timeline, input $5 memerlukan virtual reserve setara **$495** per sisi untuk mencapai target. Rentang relatif `0,80×–1,25×` mengubah cadangan virtual itu menjadi sekitar **52,26 USDG** dan ETH bernilai **$52,26** pada harga tengah.

Pada pool 3 yang buka **50:50**, sisi beli membutuhkan virtual reserve minimal **245 unit tiket per sisi**. Sisi keluar dari posisi senilai $5 membutuhkan **249,975 unit per sisi**, sehingga sisi keluar menjadi batas yang dipakai. Pada rentang probabilitas **35%–65%**, setoran nyata modelnya sekitar **66,54 USDG**. Angka tersebut sudah memperhitungkan split untuk beli dan merge untuk keluar.

Dengan ETH **$1.996** dan USDG **$1**, hasil model totalnya **$171,06**. Anggaran kerja dibulatkan ke **sekitar $173**. Harga ETH dan USDG tersebut adalah input contoh, sedangkan ticks yang valid, fee aktual, biaya gas, dan eksekusi $5 diperiksa ulang dengan quote sebelum aktivasi.


### 10.3 QHooks sebagai referensi produk dan transparansi

QHooks mendokumentasikan penggunaan Uniswap v4 di Robinhood Chain dan kunci post-quantum kedua untuk aksi kreator. Referensi ini relevan untuk melihat cara menjelaskan cakupan tanda tangan kepada pengguna dan cara mempublikasikan alamat kontrak serta transaksi yang bisa diperiksa di explorer.

- Di halaman Rules QTimeline, tampilkan aksi yang memakai verifikasi hybrid, alamat adapter, verifier dan hook, serta tautan transaksi resolusi setelah final. Gunakan alur QTimeline sendiri untuk tiga pool, pelaporan BEA, payout dan klaim.
- Pisahkan identitas QTimeline dari QHooks di nama kontrak, UI, dan materi publik. QHooks adalah pembanding produk, dengan SDK dan contoh modul yang diterbitkan terpisah di builder kit. Repo frontend menyatakan core launch contracts berada di luar cakupan publikasinya.
- Implementasi ML-DSA-44 tetap mengikuti verifier Fireblocks yang dipin di §5. Sumber QHooks yang diperiksa mendukung pembandingan fitur dan dokumentasi. Skema tanda tangan, implementasi verifier dan status audit QHooks belum diverifikasi dalam review ini.

[Situs QHooks](https://qhooks.com/) · [README frontend QHooks](https://github.com/qhooks/qhooks.com/blob/main/README.md) · [Halaman kontrak QHooks](https://github.com/qhooks/qhooks.com/blob/main/contracts.html) · [Builder kit QHooks](https://github.com/qhooks/builder-kit)
