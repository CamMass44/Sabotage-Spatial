'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const game = require('./game');

const app = express();
app.set('trust proxy', 1); // derrière le reverse proxy HTTPS de l'hébergeur (Render, etc.)
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000
});

// Sonde de santé pour l'hébergeur (réponse légère, pas la page HTML complète)
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

io.on('connection', (socket) => game.attach(io, socket));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sabotage Spatial — serveur lancé sur le port ${PORT}`);
});
