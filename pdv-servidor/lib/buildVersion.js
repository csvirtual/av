// Identificador de build mostrado em Dados da loja (achado do usuário: "o
// número da build é o mesmo do commit, fica mais padrão" — em vez de um
// número de versão bumpado à mão). Duas fontes, nessa ordem:
//
// 1) `git rev-parse --short HEAD` — funciona sempre que o .git está
//    presente (checkout normal, o caso deste ambiente de desenvolvimento).
// 2) O arquivo BUILD_VERSION — cobre o deploy real, feito por um ZIP
//    gerado com `git archive` (ver README/instruções de deploy), que NUNCA
//    inclui a pasta .git. BUILD_VERSION guarda o placeholder
//    `$Format:%h$`, substituído pelo hash de verdade automaticamente pelo
//    próprio `git archive` no momento de gerar o zip — mecanismo padrão do
//    git (ver .gitattributes: `export-subst`), não algo que este código
//    processa manualmente.
//
// Se nenhuma das duas resolver (ex: pasta copiada à mão, sem .git e sem o
// arquivo), cai num fallback inofensivo — nunca quebra o arranque do
// servidor por causa disto.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function resolveBuildVersion() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (hash) return hash;
  } catch {
    // Sem .git aqui (ex: pasta veio de um zip de deploy) — tenta o arquivo.
  }
  try {
    const fromFile = readFileSync(path.join(ROOT, 'BUILD_VERSION'), 'utf8').trim();
    // Se ninguém substituiu o placeholder (zip gerado sem `git archive`,
    // ex: um "Compactar pasta" manual), ele continua literal — não usa.
    if (fromFile && !fromFile.startsWith('$Format')) return fromFile;
  } catch {
    // Arquivo não existe — segue pro fallback final.
  }
  return 'dev';
}

export const BUILD_VERSION = resolveBuildVersion();
