# FamilyAgenda – agenda partagé (PWA)

Application web desktop, installable en PWA, pour gérer un agenda à plusieurs utilisateurs :

- Blocage d'une **journée**, de **plusieurs jours** ou d'un **créneau horaire** ; les créneaux peuvent se chevaucher (affichés côte à côte dans les vues Semaine/Jour).
- Détails : titre, lieu, notes, couleur, **personnes concernées**, **rappels** (notification push sur smartphone et desktop).
- **Hors connexion** : tout est stocké localement (IndexedDB). Les modifications faites hors ligne sont mises en file d'attente puis **resynchronisées** à la reconnexion (et toutes les 30 s, au retour sur l'onglet, et à chaque modification).
- Vues Mois / Semaine / Jour, un code couleur par utilisateur.

## Architecture

| Partie | Technologies |
|---|---|
| `client/` | React + TypeScript + Vite, `vite-plugin-pwa` (service worker Workbox, `injectManifest`), IndexedDB (`idb`) |
| `server/` | Node.js ≥ 22.5 (SQLite intégré `node:sqlite`), Express, JWT, `web-push` (VAPID) |

Synchronisation : `POST /api/sync { cursor, mutations }` applique les mutations locales (dernier écrit gagnant, par évènement), puis renvoie tout ce qui a changé depuis `cursor`. Les suppressions sont des « tombstones ». Un utilisateur ne peut modifier un évènement que s'il en est le propriétaire ou un participant.

Rappels : un planificateur serveur (toutes les 20 s) envoie une notification push au propriétaire et aux participants, une seule fois par rappel. Les rappels manqués de plus de 10 min (serveur éteint) sont ignorés.

## Démarrage

```bash
npm install
npm run icons -w client      # (déjà généré) icônes PNG de la PWA

# Développement : 2 terminaux
npm run dev:server           # API sur http://localhost:3000
npm run dev:client           # UI sur  http://localhost:5173 (proxy /api)

# Production : le serveur sert le client compilé
npm run build
npm start                    # http://localhost:3000
```

Créez un compte par personne depuis l'écran de connexion. Cliquez sur **Activer les notifications** sur chaque appareil à notifier.

## Docker

Une seule image contient le serveur et le client compilé.

```bash
docker compose up -d --build
# → http://localhost:3000   (changer le port : PORT=8080 docker compose up -d)
```

- Les données (base SQLite, secret JWT, **clés VAPID**) sont dans le volume `familyagenda-data`, monté sur `/data`. Sauvegardez-le : perdre `vapid.json` invalide tous les abonnements aux notifications.
- Variables utiles : `VAPID_SUBJECT`, `TZ`, `PORT` (voir ci-dessous).
- Mise à jour : `docker compose up -d --build`. Les données sont conservées.
- Sauvegarde : `docker run --rm -v familyagenda_familyagenda-data:/data -v "$PWD":/backup alpine tar czf /backup/familyagenda-data.tgz -C /data .`
- Pour les notifications sur iPhone, placez le conteneur derrière un reverse proxy **HTTPS** (Caddy, nginx, Traefik…).

## Image publiée sur GitHub (GHCR)

Chaque **release** GitHub déclenche le workflow [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml), qui construit l'image (`linux/amd64` et `linux/arm64`) et la publie sur `ghcr.io/horfee/familyagenda`.

- Pour publier : créez une release avec un tag `vX.Y.Z` (onglet *Releases* → *Draft a new release*, ou `gh release create v1.0.0 --generate-notes`).
- Tags produits pour `v1.2.3` : `1.2.3`, `1.2`, `1` et `latest` (sauf pré-release, qui ne met pas à jour `latest`). Les versions `v0.x` ne produisent pas le tag `0`.
- Le workflow peut aussi être lancé à la main (onglet *Actions* → *Run workflow*) ; l'image est alors taguée `sha-<commit>`.
- Utilisation : `docker pull ghcr.io/horfee/familyagenda:latest`, ou dans `docker-compose.yml` remplacez `build: .` par `image: ghcr.io/horfee/familyagenda:latest`.
- Le paquet est **privé** par défaut : pour le tirer depuis un autre serveur, soit rendez-le public (*Profil → Packages → familyagenda → Package settings → Change visibility*), soit connectez-vous : `echo $TOKEN | docker login ghcr.io -u horfee --password-stdin` (jeton avec le droit `read:packages`).

## Configuration (variables d'environnement du serveur)

| Variable | Rôle |
|---|---|
| `PORT` | Port HTTP (défaut 3000) |
| `DATA_DIR` | Dossier de la base SQLite, du secret JWT et des clés VAPID (défaut `server/data`) |
| `JWT_SECRET` | Secret de signature (généré et conservé dans `DATA_DIR` sinon) |
| `VAPID_SUBJECT` | **À renseigner avec une vraie adresse** (`mailto:vous@domaine.fr` ou `https://…`). Apple refuse les notifications (`BadJwtToken`) avec la valeur par défaut en `.local` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Clés Web Push (générées sinon) |

## Notifications sur smartphone

- Le Web Push exige **HTTPS** (sauf `localhost`) : placez le serveur derrière un reverse proxy TLS (Caddy, nginx…) ou un tunnel.
- Android/Chrome : fonctionne directement dans le navigateur.
- iOS (16.4+) : l'application doit d'abord être **ajoutée à l'écran d'accueil**.
- Ne perdez pas `DATA_DIR/vapid.json` : changer de clés invaliderait tous les abonnements.

## Limites connues

- Les rappels sont envoyés par le serveur : un évènement créé hors ligne ne notifie qu'après synchronisation.
- Pas de récurrence d'évènements, ni de gestion de fuseaux horaires multiples (heure locale du navigateur).
- Pas de tests automatisés : validation par typecheck, build et test de fumée de l'API.
