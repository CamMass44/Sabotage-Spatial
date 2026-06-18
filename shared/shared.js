/*
 * Données partagées entre le serveur et le client :
 * carte du vaisseau, missions, points d'interaction, réglages par défaut.
 * Chargé via require() côté serveur et via <script> côté navigateur (window.SHARED).
 */
(function (exports) {
  'use strict';

  exports.WORLD = { w: 2400, h: 1500 };
  exports.PLAYER_RADIUS = 16;
  exports.SPAWN = { x: 1200, y: 360 };

  exports.COLORS = [
    '#C51111', '#1B43D6', '#1B913E', '#ED54BA', '#F07613', '#F5F557',
    '#3F474E', '#D6E0F0', '#6B2FBB', '#71491E', '#38FEDC', '#50EF39'
  ];
  exports.COLOR_NAMES = [
    'Rouge', 'Bleu', 'Vert', 'Rose', 'Orange', 'Jaune',
    'Noir', 'Blanc', 'Violet', 'Marron', 'Cyan', 'Citron'
  ];

  // Pièces du vaisseau (rectangles praticables)
  exports.ROOMS = [
    { id: 'caf',      name: 'Cafétéria',         x: 900,  y: 100,  w: 600, h: 400 },
    { id: 'med',      name: 'Infirmerie',        x: 450,  y: 200,  w: 300, h: 250 },
    { id: 'reactor',  name: 'Réacteur',          x: 100,  y: 550,  w: 300, h: 350 },
    { id: 'elec',     name: 'Électricité',       x: 550,  y: 600,  w: 300, h: 280 },
    { id: 'engUp',    name: 'Moteur supérieur',  x: 100,  y: 150,  w: 280, h: 250 },
    { id: 'engDown',  name: 'Moteur inférieur',  x: 100,  y: 1050, w: 280, h: 250 },
    { id: 'security', name: 'Salle caméras',     x: 500,  y: 1000, w: 280, h: 250 },
    { id: 'storage',  name: 'Stockage',          x: 900,  y: 950,  w: 400, h: 400 },
    { id: 'comms',    name: 'Communications',    x: 1450, y: 1100, w: 300, h: 250 },
    { id: 'nav',      name: 'Navigation',        x: 2000, y: 550,  w: 300, h: 300 },
    { id: 'o2',       name: 'O2',                x: 1600, y: 300,  w: 250, h: 220 },
    { id: 'weapons',  name: 'Armement',          x: 1900, y: 120,  w: 280, h: 240 },
    { id: 'shields',  name: 'Boucliers',         x: 1900, y: 1000, w: 280, h: 240 }
  ];

  // Couloirs reliant les pièces (rectangles praticables)
  exports.CORRIDORS = [
    { x: 1140, y: 490,  w: 120, h: 470 },  // Cafétéria <-> Stockage
    { x: 740,  y: 280,  w: 170, h: 100 },  // Cafétéria <-> Infirmerie
    { x: 580,  y: 440,  w: 100, h: 170 },  // Infirmerie <-> Électricité
    { x: 370,  y: 280,  w: 90,  h: 90  },  // Infirmerie <-> Moteur sup.
    { x: 180,  y: 390,  w: 100, h: 170 },  // Moteur sup. <-> Réacteur
    { x: 390,  y: 680,  w: 170, h: 100 },  // Réacteur <-> Électricité
    { x: 180,  y: 890,  w: 100, h: 170 },  // Réacteur <-> Moteur inf.
    { x: 370,  y: 1080, w: 140, h: 100 },  // Moteur inf. <-> Salle caméras
    { x: 770,  y: 1080, w: 140, h: 100 },  // Salle caméras <-> Stockage
    { x: 1290, y: 1150, w: 170, h: 100 },  // Stockage <-> Communications
    { x: 1490, y: 330,  w: 120, h: 100 },  // Cafétéria <-> O2
    { x: 1840, y: 280,  w: 70,  h: 90  },  // O2 <-> Armement
    { x: 2080, y: 350,  w: 100, h: 210 },  // Armement <-> Navigation
    { x: 2060, y: 840,  w: 100, h: 170 },  // Navigation <-> Boucliers
    { x: 1740, y: 1130, w: 170, h: 100 }   // Communications <-> Boucliers
  ];

  exports.WALKABLE = exports.ROOMS.concat(exports.CORRIDORS);

  // Missions disponibles (type => mini-jeu côté client)
  exports.TASKS = [
    { id: 'cables_elec',  name: 'Réparer les câbles',        room: 'Électricité',      x: 700,  y: 740,  type: 'wires' },
    { id: 'cables_stock', name: 'Réparer les câbles',        room: 'Stockage',         x: 1000, y: 1100, type: 'wires' },
    { id: 'upload',       name: 'Téléverser les données',    room: 'Communications',   x: 1600, y: 1230, type: 'download' },
    { id: 'nav_code',     name: 'Entrer le cap',             room: 'Navigation',       x: 2150, y: 700,  type: 'code' },
    { id: 'reactor_sim',  name: 'Calibrer le réacteur',      room: 'Réacteur',         x: 250,  y: 760,  type: 'simon' },
    { id: 'scan',         name: 'Scanner médical',           room: 'Infirmerie',       x: 600,  y: 320,  type: 'scan' },
    { id: 'fuel_up',      name: 'Remplir le moteur (haut)',  room: 'Moteur supérieur', x: 240,  y: 270,  type: 'hold' },
    { id: 'fuel_down',    name: 'Remplir le moteur (bas)',   room: 'Moteur inférieur', x: 240,  y: 1170, type: 'hold' },
    { id: 'asteroids',    name: 'Détruire les astéroïdes',   room: 'Armement',         x: 2040, y: 240,  type: 'target' },
    { id: 'shields_on',   name: 'Amorcer les boucliers',     room: 'Boucliers',        x: 2040, y: 1120, type: 'toggle' },
    { id: 'o2_filter',    name: 'Nettoyer le filtre O2',     room: 'O2',               x: 1730, y: 380,  type: 'code' },
    { id: 'caf_data',     name: 'Télécharger les données',   room: 'Cafétéria',        x: 1380, y: 200,  type: 'download' }
  ];

  // Points d'interaction spéciaux
  exports.POINTS = {
    emergency:  { x: 1200, y: 300 },   // Bouton d'urgence (Cafétéria)
    camera:     { x: 640,  y: 1125 },  // Console de surveillance (Salle caméras)
    lightsFix:  { x: 620,  y: 680 },   // Tableau électrique
    reactorFix: { x: 250,  y: 630 },   // Console du réacteur
    o2Fix:      { x: 1680, y: 460 },   // Panneau O2
    commsFix:   { x: 1680, y: 1160 }   // Antenne comms
  };

  exports.SABOTAGES = {
    lights:  { name: 'Lumières',       fix: 'lightsFix',  critical: false, desc: 'La vision des équipiers est réduite' },
    reactor: { name: 'Réacteur',       fix: 'reactorFix', critical: true,  desc: 'Fusion imminente : réparez vite !' },
    o2:      { name: 'Oxygène',        fix: 'o2Fix',      critical: true,  desc: "L'oxygène s'épuise : réparez vite !" },
    comms:   { name: 'Communications', fix: 'commsFix',   critical: false, desc: 'Missions et caméras désactivées' }
  };

  exports.DEFAULT_SETTINGS = {
    impostors: 1,        // nombre de saboteurs
    killCooldown: 30,    // s entre deux éliminations
    discussTime: 45,     // s de discussion en réunion
    voteTime: 45,        // s de vote
    tasksPerPlayer: 4,   // missions par joueur
    emergencies: 1,      // réunions d'urgence par joueur
    confirmEjects: true, // révèle le rôle des éjectés
    reactorTime: 40,     // s avant la fusion du réacteur
    o2Time: 45,          // s avant l'asphyxie
    sabCooldown: 30      // s entre deux sabotages
  };

  exports.LIMITS = {
    impostors: [1, 3], killCooldown: [10, 60], discussTime: [15, 120],
    voteTime: [15, 120], tasksPerPlayer: [2, 8], emergencies: [0, 3],
    reactorTime: [20, 90], o2Time: [20, 90], sabCooldown: [10, 60]
  };

  exports.MIN_PLAYERS = 4;
  exports.MAX_PLAYERS = 12;

  function inRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  exports.pointWalkable = function (x, y) {
    for (var i = 0; i < exports.WALKABLE.length; i++) {
      if (inRect(x, y, exports.WALKABLE[i])) return true;
    }
    return false;
  };

  // Vérifie qu'un cercle de rayon rad tient à cette position (8 points d'échantillon)
  exports.canStand = function (x, y, rad) {
    rad = rad || exports.PLAYER_RADIUS;
    if (!exports.pointWalkable(x, y)) return false;
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      if (!exports.pointWalkable(x + Math.cos(a) * rad, y + Math.sin(a) * rad)) return false;
    }
    return true;
  };

  exports.roomAt = function (x, y) {
    for (var i = 0; i < exports.ROOMS.length; i++) {
      if (inRect(x, y, exports.ROOMS[i])) return exports.ROOMS[i];
    }
    return null;
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SHARED = {}));
