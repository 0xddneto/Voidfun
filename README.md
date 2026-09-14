# Voidfun

Launchpad experimental na Deed 0001 da Robinhood Testnet. **Ainda não implantada publicamente.** Não usar fundos reais. O protocolo VoidChains não foi alterado por este projeto.

## Como funciona

`Runtime.execute` cobra o pedágio da Deed e encaminha a chamada ao gateway Voidfun. A implementação valida tanto o Runtime quanto o aplicativo em execução e obtém dele o usuário autenticado. Cada lançamento cria um token ERC-20 e uma curva independentes. O ETH de negociação fica na curva, não no gateway. Criador e tesouraria podem retirar somente suas taxas acumuladas, inclusive depois do encerramento.

A curva começa com oferta S e reserva virtual V em ETH: preço inicial = V / S; FDV inicial = V. V corresponde a US$ 3.000 no momento de criação. A reserva real começa em zero. Compras aumentam a reserva real e reduzem a quantidade de tokens na curva; vendas fazem o inverso. A reserva virtual não pode ser sacada.

No candidato atual, 80% da oferta é vendido antes do encerramento. Sem mudança ETH/USD, a referência de FDV chega a cerca de US$ 75.000. Isso não significa US$ 75.000 de liquidez real. A última compra devolve o excesso de ETH. Ao completar, compra e venda param permanentemente, e reserva e tokens remanescentes ficam no contrato. **Não existe migração, resgate ou retirada administrativa da reserva nesta versão de teste.**

Leia [DECISOES-ROBINHOOD.md](DECISOES-ROBINHOOD.md) para distinguir decisões aceitas de parâmetros econômicos candidatos.

## Desenvolvimento

Requer Node 22+ e npm. No Windows o Anvil é instalado como dependência opcional; em outros sistemas instale `anvil` no PATH.

```sh
npm ci
npm run compile
npm test
npm run build
npm run dev
```

Com o servidor local aberto em 3050 e Chrome instalado, `node scripts/test-ui.mjs` valida layout, ausência de erros JavaScript e bloqueio de transações antes do deploy. `node scripts/check-readiness.mjs` consulta somente dados públicos da rede.

`verification/local-tests.json` registra testes em Anvil: criação pelo gateway dentro do limite de gas, identidade, inicialização única, compra, venda, separação de taxas, conservação dos saldos, isolamento, encerramento e saque de taxas. Não é auditoria independente nem prova de invulnerabilidade. As capturas de interface são da versão sem implantação, com lista vazia real.

## Publicação na Deed

1. Confirmar as taxas candidatas e a tesouraria Voidfun. Não confundir tesouraria com dono da Deed ou criador do token.
2. Validar rede 46630, bytecodes Runtime/NativePrice, estado espelhado da Deed 0001 e cotação disponível.
3. Implantar LaunchToken e LaunchCurve como implementações, depois Voidfun com os endereços e taxas confirmados.
4. Chamar `Runtime.publish(1, implementation, 0x, salt)` e extrair o gateway do evento confirmado. O publicador controla `unregister`; o dono da Deed continua controlando o pedágio.
5. Esperar um bloco EVM posterior à publicação. Atualizar `src/deployment.json` somente após confirmar os recibos e bytecodes.
6. Testar um lançamento, pequena compra, aprovação exata e venda na rede pública de teste. Publicar as fontes verificáveis e os recibos. O encerramento completo foi testado localmente, sem gastar vários ETH de faucet.
7. Gerar e hospedar o site. A interface usa o gateway publicado e mostra as taxas lidas do contrato; enquanto não existir gateway, transações ficam desabilitadas.

Nenhum contrato do protocolo precisa ser reimplantado para publicar esta aplicação. A Deed continua sendo o NFT existente; os tokens criados são novos ERC-20 da aplicação. Interface atual lista os 30 lançamentos mais recentes, sem indexador histórico.

## Proveniência

`contracts/` contém esta implementação inspirada na matemática de reservas virtuais descrita pela PONs, sem importar seus hooks. OpenZeppelin 5.6.1 é instalado por npm, com suas próprias licenças.

`tests/protocol/*.sol` são fixtures de integração copiadas de `0xddneto/VoidChainsApp`, commit `687a74738a98bb2a5fdd323062b25cd2c4950333`, mantendo seus cabeçalhos SPDX. Só são implantadas no Anvil pelos testes; não substituem contratos públicos. Fontes de pesquisa: [PONs](https://github.com/ponsdotdev/ponsfamily), [Pump public docs](https://github.com/pump-fun/pump-public-docs).

### Script de implantação

Após confirmar os valores, `scripts/deploy.mjs` exige `--trade-bps`, `--protocol-share-bps`, `--creation-fee-wei` e `--treasury` explícitos. `VOIDFUN_DEPLOYER_KEY` deve ser injetada somente no ambiente do processo. Se for usada a carteira compartilhada do protocolo, manter seu lock de operador durante toda a execução.

O script limita a rede a 46630, persiste a transação assinada localmente antes de transmitir, confirma recibos e registra `deployments/46630.json`. Retentativas reutilizam a mesma transação. Arquivos assinados ficam em `.tools/`, ignorado pelo Git. Não executar com taxas não confirmadas. A fonte e o script estão preparados, mas isso não representa implantação, verificação pública de código ou smoke test já concluídos.
