# SocialNow Hermes provisioning

Dit is de afgeschermde ingang tussen een bevestigde OS-OS-aanmelding en de GitHub-
provisioningworkflow. De publieke route accepteert alleen een kortlevend Vercel OIDC-token
van het productieproject `os-os`. Persoonsgegevens worden met AES-256-GCM versleuteld
voordat de aanvraag in GitHub wordt gezet.

## Grenzen

- `GET /health` bevat geen configuratie of klantgegevens.
- `POST /v1/provision` vereist OIDC, een unieke `jti` en een `Idempotency-Key` die exact
  gelijk is aan het aanmelddossier.
- De SSH-deploy-key mag alleen deze repository schrijven.
- Het GitHub SSH-hostkey staat vastgepind op de door GitHub gepubliceerde Ed25519-sleutel.
- De container logt uitsluitend technische gebeurtenisnamen, dossier-id en slug.

## Productievariabelen

`VERCEL_OIDC_ISSUER`, `VERCEL_OIDC_AUDIENCE`, `VERCEL_OIDC_SUBJECT`,
`VERCEL_PROJECT_ID`, `VERCEL_OWNER_ID`, `QUEUE_GIT_REPOSITORY`,
`QUEUE_SSH_PRIVATE_KEY_B64` en `QUEUE_ENCRYPTION_KEY` zijn verplicht. Ze horen in de
Hostinger Docker Manager-omgeving en nooit in Git.
