# Setup

1. Create a Trakt application at <https://trakt.tv/oauth/applications>.
2. Use `obsidian://sync-trakt-auth` as its redirect URI.
3. Enter the client ID and secret in the plugin settings.
4. Select **Connect** and complete Trakt's device authorization.
5. Optionally add a TMDB API key for poster images.
6. Choose the note folder and sync sources, then run **Sync**.

## Credential storage

The Trakt client ID, client secret, access and refresh tokens, and optional
TMDB API key are stored unencrypted in this vault's
`.obsidian/plugins/trakt-vault-sync/data.json`. Vault sync, backups, Git, or
other file-sync services may copy that file. Do not publish or share it.
