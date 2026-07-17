# SNS完全自動化: セットアップと運用

作成: 2026-07-17。戦略は[twitter-strategy.md](twitter-strategy.md)、文面・アカウント設定は[twitter-launch-assets.md](twitter-launch-assets.md)を参照。

**現在の状態: コードとlaunchdの登録は完了済み。ただしX APIの鍵が未設定のため、投稿は全てdry-run(生成のみで投稿しない)で動く。**
下記の「あなたがやる作業」を終えると、その瞬間から本当に自動投稿が始まる。

---

## 全体の流れ(すべて自動)

| 曜日・時刻(JST) | ジョブ | 内容 |
|---|---|---|
| 毎日 19:00 | `com.keibaapp.shutubawatch` | 枠順・オッズ取り込み(確定した瞬間に自動で拾う) |
| 金・土 22:00 | `com.keibaapp.diagnoseupcoming` | 翌日分の出馬表更新 → 全レース診断(LLM) → **「あすの診断」を投稿** |
| 土・日 07:30 | `com.keibaapp.snspostmorning` | **「きょうの狙い」を投稿** |
| 土・日 17:30 | `com.keibaapp.snsresults` | 配当同期 → ROI集計 → **「結果」を朝の投稿の引用RTで投稿** |

「あすの診断」投稿を22:30の別ジョブにせず**診断スクリプトの末尾に連結している**のは意図的。
時刻で待たせると、診断が長引いたときに中途半端なデータで投稿してしまうため
(`set -e`により、診断が失敗すれば投稿もされない)。

## あなたがやる作業(3つ)

### 1. MacのタイムゾーンをJSTに戻す ★必須

**現在このMacは Asia/Ho_Chi_Minh(+07)になっており、全スケジュールが2時間ズレる。**
特に朝の投稿が09:30 JST(1R発走の5分前)になり、「予想は発走前に公開」の看板が崩れる。

```bash
sudo systemsetup -settimezone Asia/Tokyo
```
(sudoのパスワードが必要なため、AI側からは実行できない。システム設定のGUIからでも可)

確認: `date +%z` が `+0900` を返せばOK。
※スクリプト側の日付計算はJSTで固定してあるので日付がズレることはないが、**launchdの発火時刻だけはシステムのTZで決まる**ため、この設定が必要。TZが違う場合はログに警告が出る。

### 2. スリープ対策 ★必須

launchdは**Macがスリープしている時刻の実行を、後追いもせずスキップする**(既知の制約)。
土日の朝7:30・夜22:00に確実に動かすには、自動で目覚めるよう登録する:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 06:55:00
```
(毎日6:55に自動起動。夜22:00は普段使っている時間帯なので通常は問題ないが、
心配なら`sudo pmset repeat wakeorpoweron MTWRFSU 21:55:00`と使い分ける)

### 3. X APIの鍵を取得して`.env.local`に追加 ★これをやると自動投稿が始まる

1. https://developer.x.com にアカウントのXでログインし、開発者登録(無料、審査は自動)
2. **課金の有効化**: 2026年2月に無料枠が廃止され従量課金制になった。支払い方法を登録する。
   **投稿は約$0.015/件。週13投稿なら月$1弱**(この用途では実質無視できる額)
3. Project → App を作成
4. **App permissions を「Read and write」に変更**(既定はRead only。投稿できない)
5. 「Keys and tokens」で以下を発行:
   - API Key / API Key Secret(= Consumer Keys)
   - Access Token / Access Token Secret
   ⚠️ **権限をRead and writeに変えた後は、Access Tokenを必ず再生成すること**
   (権限変更前に発行したトークンは読み取り専用のまま)
6. `~/keiba-app/.env.local` の末尾に追記:

```
X_API_KEY=xxxxx
X_API_SECRET=xxxxx
X_ACCESS_TOKEN=xxxxx
X_ACCESS_SECRET=xxxxx
```

⚠️ 鍵は他人に見せない(このファイルは`.gitignore`済みでGitHubには上がらない)。

**動作確認(投稿せずに確認できる):**
```bash
cd ~/keiba-app
npm run sns:auto -- --mode morning --date 2026-07-11 --env-file .env.local --dry-run
```
`X認証: 設定済み`と出れば鍵は通っている(`--dry-run`があるので投稿はされない)。

**本当に投稿する準備ができたら**`--dry-run`を外して実行すれば、それが初投稿になる。

## 安全装置(壊れたデータを公開しないために)

自動投稿の前に必ず`src/lib/sns/validate.ts`のチェックが走り、**1つでも引っかかれば投稿せず
Macの通知センターに理由を出す**:

- 診断済みレースが0件、または8件未満(診断バッチが落ちた)
- 買い目のあるレースが0件
- **買い目レースのオッズ充足率が80%未満**(2026-07-11に「odds_winが全馬0のまま診断が走る」事故が実際に起きたため)
- 結果報告時: 確定済み結果が0件、投資額の合計が0円

投稿を一時的に止めたいときは`.env.local`に`X_DRY_RUN=1`を追加する(鍵を消さなくてよい)。

## 手動で使うコマンド

```bash
# 特定の日の投稿を手動生成(dry-run)
npm run sns:auto -- --mode evening|morning|results --date YYYY-MM-DD --env-file .env.local --dry-run

# 投稿文・画像・動画をまとめて生成(投稿はしない。TikTok用の素材もここから)
npm run sns:pack -- --date YYYY-MM-DD --mode preview|results --env-file .env.local

# 自動バッチを手動で追いつき実行(スリープで飛んだとき)
bash scripts/run_diagnose_upcoming.sh
bash scripts/run_sns_results.sh
```

ログ: `scripts/logs/diagnose_upcoming.log`・`sns_post_morning.log`・`sns_results.log`
投稿済みツイートIDの記録: `sns-out/posted.json`(結果報告を朝の予想の引用RTにするために使う)

## TikTokは自動投稿できない(構造的な制約)

[未監査の開発者アプリからの投稿はSELF_ONLY(自分だけ)に強制される](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)ため、
公開投稿には審査通過が必要。**動画の生成までは自動化済み**なので、手動投稿する:

- `sns-out/<日付>-auto/video-preview.mp4`(朝)・`video-results.mp4`(夕方)が自動で出来ている
- これをTikTokに上げ、アプリ内でトレンド音源を付ける(動画は無音で書き出してある。権利的にも安全で伸びやすい)
- 静止画カルーセル(`*-story.png`を写真モードで複数枚)も有効

## ジョブの停止・再開

```bash
launchctl list | grep keiba                                    # 状態確認
launchctl bootout gui/$(id -u)/com.keibaapp.snspostmorning     # 停止
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.keibaapp.snspostmorning.plist  # 再開
```

登録済みジョブ: `shutubawatch` / `diagnoseupcoming` / `snspostmorning` / `snsresults`
