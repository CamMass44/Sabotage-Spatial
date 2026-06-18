# 🚀 Sabotage Spatial

Jeu de déduction sociale multijoueur inspiré d'Among Us, jouable **directement dans le navigateur**, sans installation. 4 à 12 joueurs incarnent les survivants d'un vaisseau à la dérive ; parmi eux se cachent un ou plusieurs **saboteurs**.

## Lancer le jeu

```bash
npm install
npm start
```

Puis ouvre **http://localhost:3000**. Crée un salon, copie le lien d'invitation et partage-le : tes amis rejoignent en un clic (sur le même réseau, remplace `localhost` par l'IP de ta machine).

> ⚠️ **Chat vocal** : le micro (WebRTC) ne fonctionne que sur `localhost` ou en **HTTPS**. Pour jouer en ligne avec le vocal, déploie derrière HTTPS (voir plus bas).

## Fonctionnalités

- **Salons privés** avec code à 4 lettres et lien de partage (`/?room=CODE`)
- **4 à 12 joueurs**, paramètres personnalisables par l'hôte (nombre de saboteurs, délais, missions, réunions d'urgence, révélation des rôles…)
- **Compatible mobile et PC** : ZQSD/WASD/flèches au clavier, joystick virtuel tactile
- **Carte vue de dessus** : 13 pièces reliées par des couloirs, collisions, champ de vision limité
- **Missions** : 8 mini-jeux différents (câbles, code, simon, astéroïdes, scan, carburant, boucliers, téléchargement) avec barre de progression globale
- **Saboteurs** : élimination avec délai de recharge, 4 sabotages (lumières, réacteur ☢, oxygène 🫧, communications 📡 — les deux critiques font gagner les saboteurs s'ils ne sont pas réparés à temps), chat textuel privé, les complices se reconnaissent (pseudo rouge)
- **Salle caméras** : n'importe quel joueur peut surveiller librement tout le vaisseau depuis la console de la salle caméras (désactivée pendant un sabotage des communications)
- **Signalement** : marqueurs « événement suspect » posables sur la carte, visibles par tous
- **Réunions** : signalement de corps ou bouton d'urgence → discussion, vote (avec abstention), éjection à la pluralité, égalité = personne
- **Éliminés** : deviennent spectateurs (vision totale, traversent les murs, peuvent finir leurs missions) mais **perdent le chat textuel et vocal** ; leur avatar disparaît pour les vivants
- **Chat textuel** global + canal saboteurs, **chat vocal** WebRTC (mesh, bouton micro)
- **Reconnexion automatique** : un joueur déconnecté a 60 s pour revenir (rafraîchissement compris), sa session est restaurée
- **Conditions de victoire** : équipage → toutes les missions finies ou tous les saboteurs éjectés ; saboteurs → parité atteinte ou sabotage critique non réparé

## Mode développement : bots 🤖

Pour tester seul (le jeu exige 4 joueurs minimum), l'hôte peut ajouter des **bots** depuis le salon avec le bouton **« 🤖 + Bot »** (et en retirer avec « 🤖 − »). Les bots comptent dans l'effectif, reçoivent un rôle comme les autres, et :

- naviguent de pièce en pièce via un graphe de la carte (sans traverser les murs) ;
- accomplissent leurs missions (pause de ~3 s sur place) ;
- accourent réparer les sabotages — en priorité les critiques ;
- signalent les corps qu'ils croisent, discutent et votent en réunion ;
- un bot **saboteur** déclenche des sabotages et élimine les équipiers isolés (humains compris !).

L'IA est volontairement simple (fichier [server/bots.js](server/bots.js)) : c'est un outil de test, pas un adversaire compétitif. Les bots sont retirés du chat vocal et ne maintiennent pas un salon en vie quand tous les humains sont partis.

## Contrôles

| Action | PC | Mobile |
|---|---|---|
| Se déplacer | ZQSD / WASD / flèches | joystick virtuel |
| Utiliser / Réparer / Caméras / Urgence | `E` ou `Espace` | bouton UTILISER |
| Signaler un corps | `R` | bouton SIGNALER |
| Tuer (saboteur) | `T` | bouton TUER |
| Saboter (saboteur) | `V` | bouton SABOTER |
| Carte + marqueurs | `C` | bouton CARTE |
| Fermer / quitter caméras | `Échap` | boutons ✕ |

## Architecture

```
server/index.js   Express + Socket.io (sert le client + temps réel)
server/game.js    Logique autoritaire : salons, phases, votes, sabotages, victoires
shared/shared.js  Carte, missions, constantes (partagé client/serveur)
client/           HTML/CSS/JS vanilla + Canvas 2D (zéro build, léger pour mobile)
```

Choix technique : le client est en **Canvas 2D vanilla** plutôt que React/Phaser — aucun build, chargement instantané, parfait pour les machines modestes. Le serveur Socket.io reste l'autorité sur les règles (rôles, kills, votes, victoires) ; les positions sont envoyées par les clients à 12 Hz et rediffusées à 10 Hz.

## Déploiement en ligne (Render, gratuit)

Le projet est prêt pour Render : le blueprint [`render.yaml`](render.yaml) décrit le service et une sonde `/healthz` permet la surveillance. HTTPS automatique (donc le chat vocal fonctionne) et WebSocket pris en charge sans config.

1. **Mettre le code sur GitHub** — crée un dépôt vide sur <https://github.com/new> (sans README ni .gitignore), puis depuis ce dossier :
   ```bash
   git remote add origin https://github.com/<TON_PSEUDO>/sabotage-spatial.git
   git push -u origin main
   ```
2. **Déployer sur Render** — sur <https://render.com> : connecte-toi avec GitHub → **New +** → **Blueprint** → sélectionne le dépôt → **Apply**. Render lit `render.yaml` et construit le service (~2-3 min).
3. **Jouer** — l'URL publique ressemble à `https://sabotage-spatial.onrender.com`. Partage-la : tout le monde peut rejoindre en un clic.

> ℹ️ Le tier gratuit met le service en veille après 15 min sans trafic ; le premier joueur attend ~50 s au réveil, puis tout est fluide. Pour supprimer cette latence, passe le `plan` en payant dans `render.yaml`.

> 🎙️ Le chat vocal (WebRTC) utilise un serveur STUN public et fonctionne pour la grande majorité des joueurs. Derrière certains réseaux d'entreprise (NAT strict), il peut échouer — le chat textuel, lui, marche toujours. Pour 100 % de fiabilité, ajoute un serveur TURN dans `RTC_CONFIG` ([client/js/voice.js](client/js/voice.js)).

### Autres hébergeurs

Le serveur est un simple process Node (`npm start`, port via `$PORT`). Fonctionne aussi sur **Railway, Fly.io** ou un VPS derrière un reverse proxy HTTPS (Caddy/Nginx). Les salons sont en mémoire : pour du multi-instance, ajouter l'adaptateur Redis de Socket.io et du sticky-session.

Pistes d'évolution prévues par le design :
- **Classement** : brancher PostgreSQL/Supabase (victoires, parties jouées) — les salons étant en mémoire, rien à migrer
- **TURN** : ajouter un serveur TURN (coturn) dans `RTC_CONFIG` (`client/js/voice.js`) pour le vocal derrière les NAT stricts
- Nouveaux mini-jeux : ajouter un type dans `shared.js` + un builder dans `client/js/minigames.js`
