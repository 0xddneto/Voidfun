# Voidfun — estudo e proposta antes da implementação

Data: 2026-09-14. Estado: pesquisa e proposta; nenhum contrato Voidfun foi implementado, publicado ou financiado. O repositório remoto estava vazio. Não foram modificados contratos do protocolo Deed.

## Fontes e limites

- PONs: https://github.com/ponsdotdev/ponsfamily — commit 856109de39458ce9f192380bff780549604fab7c.
- Pump: https://github.com/pump-fun/pump-public-docs — commit 81091419e4457566469d4e2a27f64ed84d42419c.
- Pump, estado e instruções: https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md
- PONs curva: https://github.com/ponsdotdev/ponsfamily/blob/main/contractsV2/src/v2/PonsV2BondingCurve.sol
- PONs matemática: https://github.com/ponsdotdev/ponsfamily/blob/main/contractsV2/src/v2/libraries/PonsV2BondingCurveMath.sol
- PONs graduação: https://github.com/ponsdotdev/ponsfamily/blob/main/contractsV2/src/v2/libraries/PonsV2GraduationMath.sol
- Uniswap: https://developers.uniswap.org/docs/get-started/concepts/how-uniswap-works
- Hooks: https://developers.uniswap.org/docs/protocols/v4/concepts/hooks

A página PONs e sua documentação web retornaram bloqueio regional à ferramenta de pesquisa; não houve tentativa de contorná-lo. O estudo usou seu repositório público oficial. Não foi realizada comparação do bytecode dos contratos PONs com essas fontes: conclusões referem-se à versão do repositório. A Pump publica documentação e IDLs; isso não equivale a uma auditoria do programa de produção. Parâmetros apresentados como exemplos de configuração não são garantia do estado atual de todos os lançamentos.

## O significado de nascer com US$ 3 mil

Preço marginal inicial multiplicado pela oferta total produz uma avaliação diluída (FDV). É comum uma interface chamá-la de market cap, embora market cap circulante devesse usar somente a oferta em circulação. A Voidfun deve distinguir essas métricas.

Exemplo original, sem taxas, arredondamentos ou mudança cambial: oferta S=1.000.000.000; reserva virtual de moeda F=3.000 unidades de um ativo de US$ 1; reserva inicial de tokens X=S. O produto K=F*S fixa a curva. A reserva real da moeda começa em zero. Após compras líquidas R, X=K/(F+R), preço marginal P=(F+R)/X e FDV=P*S. A reserva virtual não pode ser sacada.

| Entrada líquida acumulada | Tokens vendidos | Preço marginal USD | FDV USD  | Reserva real USD |
| ------------------------- | --------------- | ------------------ | -------- | ---------------- |
| 0                         | 0               | 0,000003           | 3.000    | 0                |
| 100                       | 32.258.064,52   | 0,000003203333     | 3.203,33 | 100              |
| 300                       | 90.909.090,91   | 0,00000363         | 3.630    | 300              |
| 1.000                     | 250.000.000     | 0,000005333333     | 5.333,33 | 1.000            |
| 12.000                    | 800.000.000     | 0,000075           | 75.000   | 12.000           |

Não há criação de dólares nem promessa de resgate da FDV. Uma venda percorre a curva para baixo. No exemplo, devolver todos os tokens comprados retorna a curva à origem e consome a reserva real, sem taxas. Uma carteira não pode retirar o produto de seu saldo pelo último preço marginal como se todas as unidades tivessem compradores nesse preço.

A reserva inicial virtual determina preço e profundidade; escolher US$ 3 mil apenas por estética não valida a economia. Depósitos efetivos, taxas e reservas precisam de contabilidade separada. Tokens distribuídos fora da curva podem quebrar a capacidade de recompra se não forem considerados no modelo.

## Pump e PONs

No exemplo de configuração oficial da Pump, há 30 SOL virtuais, 1,073 bilhão de tokens virtuais, oferta total de 1 bilhão e 793,1 milhões de tokens reais inicialmente negociáveis. O preço marginal inicial implica cerca de 27,959 SOL de FDV. Multiplicar pela cotação SOL/USD produz valores em dólares variáveis — não há regra universal de US$ 3 mil. A configuração global é alterável. A reserva real de SOL inicia em zero. A documentação descreve conclusão da curva ao esgotar os tokens negociáveis e migração permissionless para PumpSwap; referências antigas a Raydium não descrevem esse fluxo.

A PONs V1 inicializa uma pool V3 a partir de um tick configurado e deposita o token em uma posição unilateral. Isso estabelece um preço inicial sem exigir aporte equivalente de moeda do criador. A V2 usa uma curva por token e uma reserva phantomQuote. Compras acumulam o ativo de cotação; uma fração dos tokens é reservada para graduação. O repositório separa taxas, políticas, executor de graduação e locker. Esse desenho é uma referência, não uma implementação pronta para delegatecall na Deed.

## Graduação exige matemática própria

A pool externa só recebe ativos reais. No exemplo acima, graduar com 12.000 unidades e os 200 milhões de tokens restantes produziria, numa pool simples de faixa completa, preço aproximado de 0,00006, abaixo de 0,000075 no fim da curva. A diferença de 20% é resultado deste exemplo simplificado, não uma vulnerabilidade comprovada da PONs ou Pump.

Para preservar o preço, precisamos resolver os parâmetros em conjunto: reservas virtuais de tokens e moeda, oferta vendável, tokens destinados à pool, limiar de reserva real, taxas de migração e tratamento do excedente. Uma posição concentrada exige outra análise. A graduação deve ser única, verificável e repetível após falha sem duplicar liquidez ou perder fundos. Não prometer liquidez externa antes de validar DEX e contratos na rede escolhida.

## Proposta de arquitetura na Deed 0001

Uma launchpad EVM própria, com token ERC-20 de oferta fixa e uma curva/contabilidade isolada por lançamento. A interface Voidfun monta as transações; o usuário informa quantidades normais, nunca calldata manualmente. Começar com uma rede e uma moeda de cotação; Arc Testnet com USDC nativo é uma possibilidade, ainda não uma escolha aprovada. A curva trabalha em unidades do ativo, sem usar a cotação exibida como oráculo de execução. USDC não deve ser apresentado como garantia permanente de paridade em produção.

Fluxo proposto: carteira -> Runtime.execute -> gateway publicado na Deed 1 -> implementação Voidfun -> curva específica -> tokens ou pagamento diretamente à carteira beneficiária.

Cada compra e venda pré-graduação deve entrar pelo gateway. A curva externa deve exigir o gateway autorizado e receber uma identidade validada por ele. Não basta ler executingUser durante qualquer callback. O gateway verifica Runtime esperado e executingApp; a implementação deve suportar delegatecall e inicialização única. Tokens aprovados à curva só podem ser movimentados por ordens autenticadas; jamais uma API pública que aceite arbitrariamente victim e recipient.

O Runtime passa apenas appValue como msg.value à implementação; o pedágio fica separado. Compras nativas enviam valor de compra e taxa do aplicativo em appValue, mais o pedágio ao Runtime. Vendas enviam pedágio em moeda nativa e autorizam somente a quantidade de token vendida. Se a cotação for ERC-20, sua autorização é separada. Aprovações comuns de ERC-20 não pagam pedágio à Deed por si mesmas.

O AppGateway não tem receive/fallback de pagamentos comuns e reserva seletores próprios. Pagamentos nativos retornados por curvas não devem presumir que podem usar uma transferência vazia para o gateway. Preferir pagamento diretamente ao beneficiário ou projetar um caminho explícito e testado. Uma lógica que usa msg.sender como usuário sem adaptação enxergará o Runtime, não a carteira.

O limite de execução da aplicação é 2 milhões de gas; o deploy completo de vários contratos e graduação V4 dentro de uma única chamada pode excedê-lo. Simular custos, considerar clones de implementações auditadas e separar etapas determinísticas sem deixar estados parciais inseguros. Não alterar o protocolo Deed para esconder uma incompatibilidade do app.

O publisher pode desregistrar o gateway; não devemos manter a única saída de reservas dependente desse caminho. A política de encerramento da launchpad deve definir resgate protegido dos fundos reais ou conclusão da migração. Isso é responsabilidade da Voidfun como aplicativo. Não adicionar uma chave administrativa capaz de retirar reservas dos traders.

## Receitas e limite do pedágio

Separar quatro valores: preço da compra/venda; taxa da Voidfun; eventual parcela do criador do token; pedágio da Deed (95% ao proprietário/configuração e 5% ao protocolo), além do gás. Nenhuma taxa do app está aprovada neste documento.

Uma transferência ERC-20 ou operação em Uniswap/PumpSwap externa não entra automaticamente no Runtime. Logo, não gera pedágio apenas porque o token nasceu na Deed. Uma pool com hook pode ter taxas próprias, mas isso não transforma outras pools em aplicações da Deed. Não restringir toda transferência do token para forçar receita. Se quisermos negociação pós-graduação dentro de um AMM próprio da Voidfun, isso é outro componente a desenhar, testar e auditar.

## Como publicar após aprovação

1. Escolher rede inicial, moeda, oferta, curva, taxas, graduação e política de encerramento.
2. Implementar e testar no repositório Voidfun, sem alterar os contratos da Deed.
3. Conferir coleção ativa, propriedade e configuração da Deed 1; o usuário autoriza a ativação na rede escolhida se necessário.
4. Implantar implementação e componentes do aplicativo na testnet; verificar código e vínculos. Publicar implementação no Runtime com deedId=1 e inicialização validada. Definir explicitamente qual carteira será publisher.
5. Esperar o bloco permitido pelo Runtime, registrar o gateway na configuração Voidfun e verificar que o registro aponta para a Deed 1.
6. Interface própria chama Runtime.quote/execute; gateway.query ou views das curvas fazem as leituras. Nenhum campo de pagamento precisa voltar à página Build do protocolo.
7. Testar manualmente com quantias pequenas de testnet e verificar eventos, reservas e destinatários. Só publicar em mainnet após avaliação da implementação final e aprovação separada.

## Testes necessários antes de liberar

- Precisão e arredondamento em ambas as direções; compras mínimas e máximas; nenhuma criação de saldo em ciclos compra/venda.
- Conservação: entradas = reservas + saídas + taxas; separação entre lançamentos; taxas não contadas como liquidez.
- Slippage mínimo de saída e prazo definidos pela transação, não apenas pela tela da carteira; proteção contra reentrância e callback malicioso.
- Reservas insuficientes, zero liquidez inicial, transferências diretas/donations, comportamento de tokens incompatíveis e saldo real insuficiente.
- Inicialização duplicada, execução direta da implementação/curva, falsificação do usuário, allowances cruzadas, colisões de armazenamento/selectors.
- Graduação exata, compra que ultrapassa o limite, replay, falha de DEX, pool previamente inicializada e continuidade do preço; lock sem retirada administrativa.
- Pedágio separado, atualização de revision, oráculo vencido, transferir Deed, unregister e recuperação prevista.
- Gas máximo do Runtime, carteira contratual, substituição de nonce, reload de transação pendente, indexação sem duplicar volume e dados de MC/FDV/reserva claramente separados.
- Simular bots e MEV. Uma bonding curve não elimina front-running nem garante distribuição justa.

## Decisões ainda abertas

Rede/DEX de graduação; USDC ou ETH; curva que apenas imita a forma Pump versus outros parâmetros; FDV inicial desejada; taxa de criação/trading e divisão; distribuição inicial; LP lock; política de encerramento. Recomenda-se evitar mint adicional, bloqueio de vendas, taxas mutáveis sem limite e mecanismos de recompra na primeira versão, para manter o escopo compreensível e testável.

Licenças: PONs first-party declara MIT; componentes Uniswap e terceiros têm licenças próprias. O repositório Pump consultado não fornece aqui uma implementação Rust completa para portar. Copiar contratos exige revisar licenças e dependências por arquivo. Repositório aberto e fonte verificada não equivalem a segurança comprovada.
