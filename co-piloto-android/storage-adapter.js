// Co-piloto Android — Fase 1: adaptador de armazenamento.
//
// Este projeto é SEPARADO do Co-piloto de extensão (pasta ../co-piloto/) e
// não compartilha nenhum arquivo com ele — nenhum arquivo daqui é lido pela
// extensão, e nenhum arquivo da extensão é editado por este projeto.
//
// O objetivo deste arquivo é permitir que TODO o código de negócio do
// Co-piloto (auth.js, perfis.js, panel.js, chatbot.js, options.js — que
// serão trazidos sem alteração de lógica nas próximas fases) rode numa
// página web comum, sem extensão, sem precisar mudar nenhuma chamada a
// `chrome.storage.*`. Este arquivo define, em `window.chrome.storage`, a
// MESMA API que esses scripts já usam hoje (get/set/remove/clear/
// getBytesInUse, todas por Promise, mesmo formato de `changes` no
// onChanged) — só troca o que fica por baixo:
//
//   chrome.storage.local   -> IndexedDB (persiste entre sessões — capacidade
//                              alta, equivalente à permissão
//                              "unlimitedStorage" que a extensão declarava)
//   chrome.storage.session -> sessionStorage (some quando o app fecha de
//                              verdade, sobrevive a um F5 — mesmo
//                              comportamento que chrome.storage.session já
//                              tinha na extensão)
//
// Carregue este arquivo ANTES de auth.js/perfis.js/panel.js/chatbot.js/
// options.js na página final — ele precisa existir em `window.chrome`
// antes que qualquer um desses arquivos tente usar `chrome.storage`.
//
// O que este arquivo NÃO cobre (de propósito — é só a Fase 1):
// chrome.runtime.*, chrome.tabs.*, chrome.windows.*, chrome.action.* — nada
// disso existe fora de uma extensão, e cada um desses pontos precisa da sua
// própria decisão de design (ver Fases 2 e 3 do plano). Se algum código
// ainda não portado chamar isso, o erro "chrome.runtime is undefined" (ou
// similar) é esperado e intencional nesta fase — melhor um erro claro agora
// do que um mock errado escondendo um pedaço que ainda falta portar.

(function(){
  'use strict';

  // ---------- Emissor único de onChanged (compartilhado por local e session,
  // igual ao chrome.storage.onChanged real: um só registro de listeners,
  // cada listener recebe (changes, areaName) e filtra a área que quiser) ----------
  function criarEmissorOnChanged(){
    const listeners = new Set();
    return {
      addListener(fn){ listeners.add(fn); },
      removeListener(fn){ listeners.delete(fn); },
      hasListener(fn){ return listeners.has(fn); },
      // Disparo assíncrono (setTimeout 0), igual ao comportamento real do
      // chrome.storage.onChanged — nunca no mesmo tick de quem chamou
      // set()/remove()/clear(), pra ninguém que escute reagir no meio de uma
      // operação que ainda não terminou de resolver pra quem a disparou.
      //
      // O snapshot de quem escuta é tirado AGORA (na hora da mudança), não
      // dentro do setTimeout — senão um addListener() chamado logo depois de
      // um set()/remove()/clear() (antes do setTimeout(0) pendente rodar)
      // acabava recebendo, por acidente, um evento de uma mudança anterior à
      // sua própria inscrição.
      disparar(changes, areaName){
        if(!changes || !Object.keys(changes).length) return;
        const alvos = Array.from(listeners);
        setTimeout(() => {
          alvos.forEach(fn => {
            try{ fn(changes, areaName); }
            catch(e){ console.error('[storage-adapter] um listener de onChanged falhou:', e); }
          });
        }, 0);
      }
    };
  }

  const onChangedEmitter = criarEmissorOnChanged();

  // ---------- Driver IndexedDB (para chrome.storage.local) ----------
  //
  // Um object store só ("kv"), chave-valor direto — sem índices, sem
  // schema, porque o próprio Co-piloto já trata tudo como um dicionário
  // chave->valor (é assim que chrome.storage.local sempre funcionou).
  const IDB_NOME = 'copilotoAndroidStorage';
  const IDB_VERSAO = 1;
  const IDB_STORE = 'kv';

  function criarDriverIndexedDB(){
    let dbPromise = null;

    function abrirDB(){
      if(dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if(typeof indexedDB === 'undefined'){
          reject(new Error('IndexedDB indisponível neste navegador/contexto — o Co-piloto Android precisa de um contexto seguro (https ou localhost).'));
          return;
        }
        const req = indexedDB.open(IDB_NOME, IDB_VERSAO);
        req.onupgradeneeded = () => {
          const db = req.result;
          if(!db.objectStoreNames.contains(IDB_STORE)){
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    function comTransacao(modo, executar){
      return abrirDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, modo);
        const store = tx.objectStore(IDB_STORE);
        let resultado;
        Promise.resolve(executar(store))
          .then(r => { resultado = r; })
          .catch(reject);
        tx.oncomplete = () => resolve(resultado);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transação IndexedDB abortada'));
      }));
    }

    return {
      getAll(){
        return comTransacao('readonly', store => new Promise((resolve, reject) => {
          const chaves = [];
          const valores = [];
          const reqChaves = store.getAllKeys();
          const reqValores = store.getAll();
          let pendentes = 2;
          function checaFim(){
            pendentes--;
            if(pendentes === 0){
              const tudo = {};
              chaves.forEach((k, i) => { tudo[k] = valores[i]; });
              resolve(tudo);
            }
          }
          reqChaves.onsuccess = () => { chaves.push(...reqChaves.result); checaFim(); };
          reqChaves.onerror = () => reject(reqChaves.error);
          reqValores.onsuccess = () => { valores.push(...reqValores.result); checaFim(); };
          reqValores.onerror = () => reject(reqValores.error);
        }));
      },
      setMany(obj){
        return comTransacao('readwrite', store => {
          Object.keys(obj).forEach(k => store.put(obj[k], k));
        });
      },
      removeMany(chaves){
        return comTransacao('readwrite', store => {
          chaves.forEach(k => store.delete(k));
        });
      },
      clear(){
        return comTransacao('readwrite', store => { store.clear(); });
      }
    };
  }

  // ---------- Driver sessionStorage (para chrome.storage.session) ----------
  //
  // Prefixo pra nunca colidir com nenhuma outra chave que a própria página
  // (ou alguma lib futura) venha a guardar direto em sessionStorage por
  // outro motivo qualquer.
  const SESSION_PREFIXO = 'copilotoAndroidSession:';

  function criarDriverSessionStorage(){
    function chaveCompleta(k){ return SESSION_PREFIXO + k; }
    function chaveOriginal(chaveCompleta){ return chaveCompleta.slice(SESSION_PREFIXO.length); }

    return {
      async getAll(){
        const tudo = {};
        for(let i = 0; i < sessionStorage.length; i++){
          const chave = sessionStorage.key(i);
          if(!chave || !chave.startsWith(SESSION_PREFIXO)) continue;
          try{
            tudo[chaveOriginal(chave)] = JSON.parse(sessionStorage.getItem(chave));
          }catch(e){
            // Valor corrompido/não-JSON (não deveria acontecer, já que só
            // este adaptador escreve nessas chaves) — ignora em vez de
            // quebrar toda a leitura por causa de uma chave.
          }
        }
        return tudo;
      },
      async setMany(obj){
        Object.keys(obj).forEach(k => {
          sessionStorage.setItem(chaveCompleta(k), JSON.stringify(obj[k]));
        });
      },
      async removeMany(chaves){
        chaves.forEach(k => sessionStorage.removeItem(chaveCompleta(k)));
      },
      async clear(){
        const paraRemover = [];
        for(let i = 0; i < sessionStorage.length; i++){
          const chave = sessionStorage.key(i);
          if(chave && chave.startsWith(SESSION_PREFIXO)) paraRemover.push(chave);
        }
        paraRemover.forEach(k => sessionStorage.removeItem(k));
      }
    };
  }

  // ---------- Área genérica (get/set/remove/clear/getBytesInUse) por cima
  // de qualquer driver — mesma lógica pra local e pra session, só troca o
  // driver de baixo. Reproduz a assinatura exata que o Co-piloto já chama:
  // string, array de strings, objeto com valores-padrão, ou nada/null pra
  // "tudo". ----------
  function criarArea(driver, nomeArea){
    async function get(keys){
      const tudo = await driver.getAll();
      if(keys === undefined || keys === null) return tudo;
      if(typeof keys === 'string'){
        return (keys in tudo) ? { [keys]: tudo[keys] } : {};
      }
      if(Array.isArray(keys)){
        const resultado = {};
        keys.forEach(k => { if(k in tudo) resultado[k] = tudo[k]; });
        return resultado;
      }
      if(typeof keys === 'object'){
        // Objeto com valores-padrão (ex.: chrome.storage.local.get({x: 1})):
        // cada chave sua entra no resultado — com o valor salvo se existir,
        // senão o próprio padrão informado.
        const resultado = {};
        Object.keys(keys).forEach(k => { resultado[k] = (k in tudo) ? tudo[k] : keys[k]; });
        return resultado;
      }
      return {};
    }

    async function set(obj){
      const antes = await driver.getAll();
      const changes = {};
      Object.keys(obj).forEach(k => {
        changes[k] = { oldValue: antes[k], newValue: obj[k] };
      });
      await driver.setMany(obj);
      onChangedEmitter.disparar(changes, nomeArea);
    }

    async function remove(keys){
      const listaChaves = Array.isArray(keys) ? keys : [keys];
      const antes = await driver.getAll();
      const changes = {};
      listaChaves.forEach(k => {
        if(k in antes) changes[k] = { oldValue: antes[k], newValue: undefined };
      });
      await driver.removeMany(listaChaves);
      onChangedEmitter.disparar(changes, nomeArea);
    }

    async function clear(){
      const antes = await driver.getAll();
      const changes = {};
      Object.keys(antes).forEach(k => { changes[k] = { oldValue: antes[k], newValue: undefined }; });
      await driver.clear();
      onChangedEmitter.disparar(changes, nomeArea);
    }

    // Aproximação por tamanho serializado (mesmo princípio que o próprio
    // chrome.storage.local.getBytesInUse usa — não é uma medida exata de
    // disco, é só pra dar uma ideia de uso pra quem está vendo a tela de
    // "banco de dados"). `keys` aceita os mesmos formatos de get().
    async function getBytesInUse(keys){
      const tudo = await get(keys);
      let total = 0;
      Object.keys(tudo).forEach(k => {
        total += k.length + JSON.stringify(tudo[k]).length;
      });
      return total;
    }

    return { get, set, remove, clear, getBytesInUse };
  }

  const storageLocal = criarArea(criarDriverIndexedDB(), 'local');
  const storageSession = criarArea(criarDriverSessionStorage(), 'session');

  // ---------- Publica em window.chrome.storage, preservando qualquer coisa
  // que já exista em window.chrome (nenhuma sobrescrita bruta) ----------
  window.chrome = window.chrome || {};
  window.chrome.storage = window.chrome.storage || {};
  window.chrome.storage.local = storageLocal;
  window.chrome.storage.session = storageSession;
  window.chrome.storage.onChanged = onChangedEmitter;
})();
