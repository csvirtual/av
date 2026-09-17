// Aplica uma máscara de formatação (CNPJ, telefone, CEP, CPF/CNPJ misto
// etc.) num input de texto conforme a pessoa digita: a cada tecla,
// reformata o valor inteiro a partir do que já foi digitado. O mesmo
// padrão de 2 linhas repetido em setup.js, company.js, clientes.js e
// compras.js pra campos diferentes — só o elemento e a função de formatação
// mudam, por isso vira um helper de uma linha por campo.
export function wireMaskedInput(input, formatFn) {
  input.addEventListener('input', () => { input.value = formatFn(input.value); });
}
