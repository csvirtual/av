'use strict';

// Configuração compartilhada do host-agent. Pode ser sobrescrita por
// variáveis de ambiente na hora de rodar/empacotar o app.
module.exports = {
  SIGNALING_URL: process.env.CSRD_SIGNALING_URL || 'ws://localhost:8080',
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Para redes com NAT restritivo/simétrico, um servidor TURN é necessário.
    // Configure via variável de ambiente (formato JSON) ou edite aqui:
    // { urls: 'turn:seu-turn-server:3478', username: '...', credential: '...' }
    ...(process.env.CSRD_TURN_URL
      ? [{
          urls: process.env.CSRD_TURN_URL,
          username: process.env.CSRD_TURN_USERNAME,
          credential: process.env.CSRD_TURN_CREDENTIAL,
        }]
      : []),
  ],
};
