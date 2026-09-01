# SocialNow Hermes provisioning

Dit is de afgeschermde ingang tussen een bevestigde OS-OS-aanmelding en de GitHub-
provisioningworkflow. De publieke route accepteert alleen een kortlevend Vercel OIDC-token
van het productieproject `os-os`. Persoonsgegevens worden met AES-256-GCM versleuteld
voordat de aanvraag in GitHub wordt gezet.

## Grenzen

- `GET /health` bevat geen configuratie of klantgegevens.
- `POST /v1/provision` vereist OIDC, een unieke `jti` en een `Idempotency-Key` die exact
  gelijk is aan het aanmelddossier.
- De private GitHub App is uitsluitend op de factory- en provisioningrepository geïnstalleerd.
- De queue gebruikt alleen kortlevende installatie-tokens; de App-sleutel staat uitsluitend in
  de Hostinger-omgeving en macOS Sleutelhanger.
- De container logt uitsluitend technische gebeurtenisnamen, dossier-id en slug.

## Productievariabelen

`VERCEL_OIDC_ISSUER`, `VERCEL_OIDC_AUDIENCE`, `VERCEL_OIDC_SUBJECT`,
`VERCEL_PROJECT_ID`, `VERCEL_OWNER_ID`, `QUEUE_GITHUB_REPOSITORY`,
`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY_B64` en
`QUEUE_ENCRYPTION_KEY` zijn verplicht. Ze horen in de
Hostinger Docker Manager-omgeving en nooit in Git.

## VPS-netwerk

Docker publiceert de provisioner uitsluitend op `127.0.0.1:39101`. De bestaande Caddy-
service van de VPS gebruikt `deploy/Caddyfile` als hostconfiguratie en verzorgt TLS voor
`hermes.socialnow.nl`. Start geen tweede Caddy-container: poort 80/443 wordt centraal door
de VPS-proxy beheerd. Valideer een wijziging altijd met `caddy validate` voordat Caddy wordt
herladen.
