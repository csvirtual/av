// Cria o primeiro usuário admin, pra testar o login — uso manual por linha
// de comando. A lógica em si mora em lib/seedAdmin.js, porque o
// server.js também chama a mesma função sozinho a cada arranque (ver
// comentário lá) — este arquivo continua existindo pra quem preferir
// rodar `node seed.js` explicitamente, ou numa hospedagem que só dá pra
// rodar um comando avulso e não deixa configurar o `node server.js`
// direto como "start".
import { ensureAdminUser } from './lib/seedAdmin.js';

const created = await ensureAdminUser();
if (!created) {
  console.log('Usuário "admin" já existe — nada a fazer.');
}
process.exit(0);
