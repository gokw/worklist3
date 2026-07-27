# セキュリティチェックの方針と運用(Issue #28)

利用しているライブラリ・ソースコードのセキュリティを、一度きりではなく
**定期的に自動でチェックする**ための方針と、その仕組みをまとめる。

## 対象と道具

チェック対象は2つ。それぞれ無料の範囲で自動化している。

| 対象 | 見るもの | 道具 | 設定ファイル |
|---|---|---|---|
| ① 依存ライブラリ | 既知の脆弱性を持つバージョンを使っていないか | Dependabot / `npm audit` | [dependabot.yml](../.github/dependabot.yml) / [security.yml](../.github/workflows/security.yml) |
| ② ソースコード | 秘密情報(APIキー等)の混入 | gitleaks | [security.yml](../.github/workflows/security.yml) |

> 補足: ソースの本格的な静的解析(GitHub CodeQL)は、private リポジトリでは
> 有料機能(GitHub Advanced Security)が必要なため、本プロジェクトでは採用していない。
> public 化した場合は無料で使えるので、そのとき追加を検討する。

## いつ回るか

- **push / Pull Request のたび**（`main` 対象） … その場で混入を検知
- **毎週月曜 09:00 JST** … 新しく公表された脆弱性を拾う（コードが変わっていなくても回る）
- **手動**（GitHub の Actions 画面の「Run workflow」ボタン）

Dependabot は上記とは別に、脆弱な依存を見つけると自動で「バージョンを上げる PR」を出す。

## 深刻度ごとの対応基準

`npm audit` / Dependabot / GitHub のアラートで報告される深刻度に応じて判断する。

| 深刻度 | 対応 |
|---|---|
| **Critical / High** | 気づいたら即対応。修正版があればバージョンを上げ、テスト・ビルドが通ることを確認してマージ |
| **Moderate** | 次のまとまった作業のタイミングで対応 |
| **Low / 開発依存のみ** | 記録して様子見でよい（本番の実害が薄いもの） |

- CI（security.yml の npm-audit）は **High 以上が残っていると失敗**する。Moderate 以下は一覧表示のみで失敗させない。
- 秘密情報が検知された場合は、深刻度に関わらず最優先。該当のキー等を**無効化（再発行）**してから履歴の扱いを検討する。

## 秘密情報を混入させないための前提

- APIキーやトークンはコードに直接書かず、`.env` 等に置く（`.gitignore` で除外済み）。
- Google 連携の Client ID / Calendar ID は機微情報ではないため localStorage 保持で問題ない。
  アクセストークンはメモリ保持のみで永続化しない（[gcalClient.ts](../src/lib/gcalClient.ts) 参照）。

## 手元での確認方法

CI を待たずに、ローカルでも同じチェックができる。

```bash
# 依存の脆弱性チェック
npm audit

# High 以上があるかだけ確認(CIと同じ基準)
npm audit --audit-level=high

# 見つかった脆弱性を自動修正(バージョンが上がるので、あとで test/build 確認)
npm audit fix
npm test && npm run build
```

## GitHub 側で一度だけ有効化しておく設定

リポジトリの Settings → Advanced Security（または Code security）で、無料の範囲で次を ON にしておくと
Dependabot がフルに機能する。

- **Dependency graph**
- **Dependabot alerts**
- **Dependabot security updates**
