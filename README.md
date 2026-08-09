<div align="center">
<h1>
  Discord Server Web Analytics
  
  [![discord.py](https://img.shields.io/badge/discord.py-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discordpy.readthedocs.io/)
  [![Python 3.10](https://img.shields.io/badge/Python-3.10-yellow?style=flat-square&logo=python&logoColor=white)](https://www.python.org/downloads/release/python-3100/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
  [![Astro](https://img.shields.io/badge/Astro-FF5D01?style=flat-square&logo=astro&logoColor=white)](https://astro.build/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
  [![LICENSE](https://img.shields.io/badge/LICENSE-AGPL--3.0-green.svg?style=flat-square)](LICENSE)
</h1>
Discord鯖のアクティビティ収集、集計、可視化するための統合システムです。<br>
Discord.pyによるデータ収集、FastAPIによるデータ提供、Astro/ReactによるWebダッシュボードで構成<br>
<br>

<img src="public/dashboard.png" alt="dashboard">
<br>
<sub>Webダッシュボード</sub>
</div>
<br/>

## なんのためにつくった...?

Discordの今までのチャット履歴等を全て取得し、視覚化するため！！
もとは月の発言ランキングの集計のために使っていたものを改造したものです。
公開Botとかにする予定は今のところないので(db死ぬので)、使いたい人はライセンスの下改造してね！！

## 機能など...

### データ収集

- Botはメッセージの送信日時、文字数、チャンネルのみを保存します。※メッセージ本文は保存しません。
- 削除されたユーザー（Deleted User）やBotが認識できないユーザーは、ランキングおよび個人推移グラフから自動的に除外されます。

### Webダッシュボード

- サーバー全体の活動量、ヒートマップ、チャンネル別分布を表示。
- ユーザーごとの発言数推移を折れ線グラフで可視化。
- ログイン中のユーザーおよび検索したユーザーのデータをグラフ上で比較可能。

## ディレクトリ構成

```
- bot/ : データ収集およびコマンド操作を行うDiscordBot
- backend/ : データベースと通信し、フロントエンドにJSONを提供するRESTAPI
- frontend/ : Webダッシュボード (Astro + React)
```

## 環境変数について

- `API_SECRET`: 32文字以上のランダム値。(バックエンド用)
- `ADMIN_SESSION_SECRET`: 32文字以上のランダム値。バックエンドとフロントエンド同様
- `ADMIN_PASSWORD_HASH`: ソルト付きPBKDF2-HMAC-SHA-256形式管理者パスハッシュ
- `TRUST_CLOUDFLARE_PROXY`: originへの直接接続を遮断した場合に限り`true`
- `CLOUDFLARE_TRUSTED_PROXY_CIDRS`: `CF-Connecting-IP`を信頼する接続元CIDRをカンマ区切りで設定
Cloudflareがオリジンへ直接接続する構成では、[Cloudflare公式IP一覧](https://www.cloudflare.com/ips/)と同期してください。Cloudflare Tunnelや手前のリバースプロキシを使う場合は、FastAPIから見える直前のプロキシCIDRを指定
`ADMIN_PASSWORD_HASH`は次のコマンドで生成し、出力された1行全体をCloudflareの環境変数へ設定。
```bash
python scripts/generate_admin_password_hash.py
```

## ライセンス

[AGPL-3.0](LICENSE)  
改変した後、ネットワーク経由でユーザーにサービスを提供する場合、ソースコードの公開義務が発生します。

---
© 2026 ymkw.top
